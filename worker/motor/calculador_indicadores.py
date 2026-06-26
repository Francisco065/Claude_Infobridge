"""
calculador_indicadores.py

Motor principal de cálculo de indicadores por motorista/veículo/período.

Fontes de dados (em ordem de preferência):
  1. leitura_telemetria (série temporal — para veículos CAN/OBD2 e GPS)
  2. acumulado_diario   (agregados diários — gerados pelo worker_acumulados)

O resultado é salvo em indicador_periodo e acumulado_diario.

Fluxo:
  calcular_indicadores_periodo()
    ├── buscar leituras do período em leitura_telemetria (pandas DataFrame)
    ├── calcular_km_e_consumo()
    ├── calcular_velocidade_media()
    ├── calcular_faixas_rpm()
    ├── calcular_faixas_acelerador()
    ├── calcular_frenagens()   ← detecta via Δv/Δt
    ├── calcular_motor_ocioso()
    ├── calcular_excesso_velocidade()
    └── salvar em indicador_periodo
"""
from __future__ import annotations

import asyncio
from datetime import date
from typing import Any

import asyncpg
import numpy as np
import pandas as pd
import structlog

from config     import get_settings
from motor.classificador import Classificador

log = structlog.get_logger(__name__)
cfg = get_settings()
clf = Classificador(cfg)


# ── Lógica principal ──────────────────────────────────────────

async def _calcular_mensais_todos():
    """Dispara o cálculo mensal para todos os motoristas de todos os tenants."""
    conn = await asyncpg.connect(cfg.database_url)
    try:
        # Período: mês anterior completo
        hoje = date.today().replace(day=1)
        if hoje.month == 1:
            inicio = date(hoje.year - 1, 12, 1)
        else:
            inicio = date(hoje.year, hoje.month - 1, 1)
        import calendar
        ultimo_dia = calendar.monthrange(inicio.year, inicio.month)[1]
        fim = date(inicio.year, inicio.month, ultimo_dia)

        pares = await conn.fetch(
            """
            SELECT DISTINCT
                lt.tenant_id::text,
                lt.motorista_id::text,
                lt.veiculo_id::text
            FROM  leitura_telemetria lt
            WHERE lt.ts BETWEEN $1 AND $2
              AND lt.motorista_id IS NOT NULL
            """,
            inicio, fim,
        )
    finally:
        await conn.close()

    for par in pares:
        calcular_indicadores_periodo_task.delay(
            par['tenant_id'], par['motorista_id'], par['veiculo_id'],
            inicio.isoformat(), fim.isoformat(),
        )


async def _calcular_periodo(
    tenant_id: str,
    motorista_id: str,
    veiculo_id: str,
    inicio: date,
    fim: date,
):
    conn = await asyncpg.connect(cfg.database_url)
    try:
        rows = await conn.fetch(
            """
            SELECT
                ts, velocidade, rpm, perc_acelerador, odometro_km,
                consumo_total_l, consumo_inst_l, ignicao,
                faixa_rpm, faixa_acelerador, is_motor_ocioso, is_embalo,
                evento_id, gps_valido
            FROM  leitura_telemetria
            WHERE tenant_id   = $1::uuid
              AND veiculo_id  = $2::uuid
              AND motorista_id = $3::uuid
              AND ts BETWEEN $4 AND $5
              AND gps_valido  = TRUE
            ORDER BY ts ASC
            """,
            tenant_id, veiculo_id, motorista_id, inicio, fim,
        )

        if len(rows) < 2:
            log.warning('motor.indicadores.sem_dados',
                        tenant_id=tenant_id, motorista_id=motorista_id,
                        veiculo_id=veiculo_id)
            return

        df = pd.DataFrame(rows, columns=[
            'ts', 'velocidade', 'rpm', 'perc_acelerador', 'odometro_km',
            'consumo_total_l', 'consumo_inst_l', 'ignicao',
            'faixa_rpm', 'faixa_acelerador', 'is_motor_ocioso', 'is_embalo',
            'evento_id', 'gps_valido',
        ])
        df['ts'] = pd.to_datetime(df['ts'], utc=True)
        df = df.sort_values('ts').reset_index(drop=True)

        # ── delta_t entre posições consecutivas (segundos) ────
        df['delta_t'] = df['ts'].diff().dt.total_seconds().fillna(0)
        # Limitar delta_t a 10 min para evitar que paradas longas distorçam
        df['delta_t'] = df['delta_t'].clip(upper=600)

        tempo_total_s = df['delta_t'].sum()
        if tempo_total_s == 0:
            return

        # ── KM e Consumo ─────────────────────────────────────
        km_total, odometro_ini, odometro_fim, consumo_total = _km_e_consumo(df)

        # ── Velocidade ────────────────────────────────────────
        vel_media, vel_max = _velocidade(df)

        # ── Faixas RPM ────────────────────────────────────────
        faixas_rpm = _faixas_rpm(df, tempo_total_s)

        # ── Faixas Acelerador ─────────────────────────────────
        faixas_acel = _faixas_acelerador(df, tempo_total_s)

        # ── Frenagens ─────────────────────────────────────────
        frenagens = _detectar_frenagens(df)

        # ── Motor Ocioso ──────────────────────────────────────
        motor_ocioso = _motor_ocioso(df, tempo_total_s)

        # ── Excesso de Velocidade ─────────────────────────────
        excesso_vel = _excesso_velocidade(df)

        indicador = {
            **{'tenant_id': tenant_id, 'motorista_id': motorista_id,
               'veiculo_id': veiculo_id, 'periodo_inicio': inicio,
               'periodo_fim': fim, 'tipo_periodo': 'mensal'},
            'km_total':             km_total,
            'odometro_inicial_km':  odometro_ini,
            'odometro_final_km':    odometro_fim,
            'consumo_total_litros': consumo_total,
            'media_km_l':           round(km_total / consumo_total, 3) if consumo_total else None,
            'velocidade_media_kmh': vel_media,
            'velocidade_max_kmh':   vel_max,
            **frenagens,
            **faixas_acel,
            **faixas_rpm,
            **motor_ocioso,
            **excesso_vel,
            'total_posicoes':       len(df),
        }

        # Salvar no banco
        await _salvar_indicador(conn, indicador)
        log.info('motor.indicadores.salvo', tenant_id=tenant_id,
                 motorista_id=motorista_id, periodo=f'{inicio}/{fim}')
    finally:
        await conn.close()


# ── Funções de cálculo ────────────────────────────────────────

def _km_e_consumo(df: pd.DataFrame):
    odometros = df['odometro_km'].dropna()
    if len(odometros) >= 2:
        ini, fim = odometros.iloc[0], odometros.iloc[-1]
        km = max(0.0, float(fim - ini))
    else:
        km, ini, fim = 0.0, None, None

    consumo = None
    if df['consumo_total_l'].notna().any():
        c = df['consumo_total_l'].dropna()
        consumo = float(c.iloc[-1] - c.iloc[0]) if len(c) >= 2 else None

    return round(km, 3), ini, fim, consumo


def _velocidade(df: pd.DataFrame):
    em_mov = df[df['velocidade'].notna() & (df['velocidade'] > 0)]
    if em_mov.empty:
        return None, None
    vel_media = round(
        float(np.average(em_mov['velocidade'], weights=em_mov['delta_t'].clip(lower=0.1))),
        2,
    )
    vel_max = float(em_mov['velocidade'].max())
    return vel_media, vel_max


def _faixas_rpm(df: pd.DataFrame, tempo_total_s: float) -> dict:
    contagens = {
        'abaixo_verde':           0.0,
        'verde_inicial':          0.0,
        'verde_final':            0.0,
        'freio_motor_ok':         0.0,
        'freio_motor_acelerando': 0.0,
        'acima':                  0.0,
    }
    for faixa, grupo in df[df['faixa_rpm'].notna()].groupby('faixa_rpm'):
        contagens[faixa] = float(grupo['delta_t'].sum())

    def pct(v): return round(v / tempo_total_s * 100, 2) if tempo_total_s else 0.0

    return {
        'perc_faixa_verde_inicial':  pct(contagens['verde_inicial']),
        'perc_faixa_verde_final':    pct(contagens['verde_final']),
        'perc_freio_motor_ok':       pct(contagens['freio_motor_ok']),
        'perc_freio_motor_acel':     pct(contagens['freio_motor_acelerando']),
        'perc_embalo':               pct(float(df[df['is_embalo'] == True]['delta_t'].sum())),
    }


def _faixas_acelerador(df: pd.DataFrame, tempo_total_s: float) -> dict:
    contagens = {'ideal': 0.0, 'atencao': 0.0, 'critico': 0.0}
    for faixa, grupo in df[df['faixa_acelerador'].notna()].groupby('faixa_acelerador'):
        contagens[faixa] = float(grupo['delta_t'].sum())

    def pct(v): return round(v / tempo_total_s * 100, 2) if tempo_total_s else 0.0

    return {
        'perc_acel_ideal':   pct(contagens['ideal']),
        'perc_acel_atencao': pct(contagens['atencao']),
        'perc_acel_critico': pct(contagens['critico']),
    }


def _detectar_frenagens(df: pd.DataFrame) -> dict:
    totais = normais = bruscas = alta_vel = 0

    # Detectar via evento_id (frenagem brusca já detectada pela Multiportal)
    frenagens_evento = df[df['evento_id'] == 13654]
    bruscas_evento   = len(frenagens_evento)

    # Detectar via Δv/Δt para as demais (quando temos velocidade)
    df_vel = df[df['velocidade'].notna()].copy()
    df_vel['vel_anterior'] = df_vel['velocidade'].shift(1)
    df_vel = df_vel.dropna(subset=['vel_anterior', 'delta_t'])
    df_vel = df_vel[df_vel['delta_t'] > 0]

    for _, row in df_vel.iterrows():
        resultado = clf.classificar_frenagem(
            float(row['vel_anterior']), float(row['velocidade']), float(row['delta_t']),
        )
        if resultado.tipo:
            totais += 1
            if resultado.tipo == 'brusca':
                bruscas += 1
            else:
                normais += 1
            if resultado.alta_velocidade:
                alta_vel += 1

    # Se o evento Multiportal detectou frenagens bruscas e não tínhamos no Δv,
    # usar o máximo dos dois como estimativa conservadora
    bruscas = max(bruscas, bruscas_evento)
    totais  = max(totais, bruscas + normais)

    km_total_approx = df['odometro_km'].dropna()
    km = float(km_total_approx.iloc[-1] - km_total_approx.iloc[0]) \
         if len(km_total_approx) >= 2 else 1.0

    return {
        'frenagens_totais':          totais,
        'frenagens_normais':         normais,
        'frenagens_bruscas':         bruscas,
        'frenagens_alta_velocidade': alta_vel,
        'frenagens_por_100km':       round(totais / km * 100, 2) if km > 0 else 0.0,
    }


def _motor_ocioso(df: pd.DataFrame, tempo_total_s: float) -> dict:
    TOLERANCIA = cfg.motor_ocioso_tolerancia_s  # 300s = 5 min

    df_ocioso = df[df['is_motor_ocioso'] == True].copy()
    if df_ocioso.empty:
        return {'perc_motor_ocioso': 0.0, 'tempo_motor_ocioso_penalizado_s': 0}

    # Agrupar sequências contínuas de parada
    df_ocioso['grupo'] = (df_ocioso.index.to_series().diff() > 1).cumsum()
    tempo_penalizado = 0.0
    for _, grupo in df_ocioso.groupby('grupo'):
        duracao = float(grupo['delta_t'].sum())
        if duracao > TOLERANCIA:
            tempo_penalizado += (duracao - TOLERANCIA)

    return {
        'perc_motor_ocioso':               round(tempo_penalizado / tempo_total_s * 100, 2),
        'tempo_motor_ocioso_penalizado_s': int(tempo_penalizado),
    }


def _excesso_velocidade(df: pd.DataFrame) -> dict:
    # Janelas de 1h
    df2 = df.set_index('ts').resample('1h').agg(
        total=('velocidade', 'count'),
        acima=('velocidade', lambda v: (v > cfg.velocidade_excesso_kmh).sum()),
    ).reset_index()
    df2['perc'] = df2['acima'] / df2['total'].replace(0, 1) * 100
    # Média das janelas — cada janela pesa igual
    perc_medio = float(df2['perc'].mean()) if not df2.empty else 0.0
    return {'perc_excesso_velocidade': round(perc_medio, 2)}


async def _salvar_indicador(conn: asyncpg.Connection, ind: dict):
    await conn.execute(
        """
        INSERT INTO indicador_periodo (
            tenant_id, motorista_id, veiculo_id,
            periodo_inicio, periodo_fim, tipo_periodo,
            km_total, odometro_inicial_km, odometro_final_km,
            consumo_total_litros, media_km_l,
            velocidade_media_kmh, velocidade_max_kmh,
            frenagens_totais, frenagens_normais, frenagens_bruscas,
            frenagens_alta_velocidade, frenagens_por_100km,
            perc_acel_ideal, perc_acel_atencao, perc_acel_critico,
            perc_faixa_verde_inicial, perc_faixa_verde_final,
            perc_freio_motor_ok, perc_freio_motor_acel, perc_embalo,
            perc_motor_ocioso, tempo_motor_ocioso_penalizado_s,
            perc_excesso_velocidade, total_posicoes
        ) VALUES (
            $1::uuid, $2::uuid, $3::uuid, $4, $5, $6,
            $7, $8, $9, $10, $11, $12, $13,
            $14, $15, $16, $17, $18,
            $19, $20, $21, $22, $23, $24, $25, $26,
            $27, $28, $29, $30
        )
        ON CONFLICT (tenant_id, motorista_id, veiculo_id, periodo_inicio, periodo_fim)
        DO UPDATE SET
            km_total = EXCLUDED.km_total,
            consumo_total_litros = EXCLUDED.consumo_total_litros,
            media_km_l = EXCLUDED.media_km_l,
            frenagens_totais = EXCLUDED.frenagens_totais,
            frenagens_bruscas = EXCLUDED.frenagens_bruscas,
            perc_faixa_verde_inicial = EXCLUDED.perc_faixa_verde_inicial,
            perc_freio_motor_acel = EXCLUDED.perc_freio_motor_acel,
            perc_motor_ocioso = EXCLUDED.perc_motor_ocioso,
            perc_excesso_velocidade = EXCLUDED.perc_excesso_velocidade,
            calculado_em = NOW()
        """,
        ind['tenant_id'], ind['motorista_id'], ind['veiculo_id'],
        ind['periodo_inicio'], ind['periodo_fim'], ind['tipo_periodo'],
        ind.get('km_total'), ind.get('odometro_inicial_km'), ind.get('odometro_final_km'),
        ind.get('consumo_total_litros'), ind.get('media_km_l'),
        ind.get('velocidade_media_kmh'), ind.get('velocidade_max_kmh'),
        ind.get('frenagens_totais', 0), ind.get('frenagens_normais', 0),
        ind.get('frenagens_bruscas', 0), ind.get('frenagens_alta_velocidade', 0),
        ind.get('frenagens_por_100km', 0),
        ind.get('perc_acel_ideal', 0), ind.get('perc_acel_atencao', 0),
        ind.get('perc_acel_critico', 0),
        ind.get('perc_faixa_verde_inicial', 0), ind.get('perc_faixa_verde_final', 0),
        ind.get('perc_freio_motor_ok', 0), ind.get('perc_freio_motor_acel', 0),
        ind.get('perc_embalo', 0),
        ind.get('perc_motor_ocioso', 0), ind.get('tempo_motor_ocioso_penalizado_s', 0),
        ind.get('perc_excesso_velocidade', 0), ind.get('total_posicoes', 0),
    )
