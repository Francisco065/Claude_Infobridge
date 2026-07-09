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
                ts, velocidade, rpm, perc_acelerador, odometro_km, km_rodado,
                consumo_total_l, consumo_inst_l, nivel_combustivel_pct, ignicao,
                faixa_rpm, faixa_acelerador, is_motor_ocioso, is_embalo,
                evento_id, gps_valido
            FROM  leitura_telemetria
            WHERE tenant_id   = $1::uuid
              AND veiculo_id  = $2::uuid
              AND motorista_id = $3::uuid
              AND ts >= $4::date
              AND ts <  ($5::date + INTERVAL '1 day')
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
            'ts', 'velocidade', 'rpm', 'perc_acelerador', 'odometro_km', 'km_rodado',
            'consumo_total_l', 'consumo_inst_l', 'nivel_combustivel_pct', 'ignicao',
            'faixa_rpm', 'faixa_acelerador', 'is_motor_ocioso', 'is_embalo',
            'evento_id', 'gps_valido',
        ])

        # Capacidade do tanque (para estimar consumo pelo nível quando o PID direto
        # de consumo não é enviado pelo equipamento).
        cap_row = await conn.fetchrow(
            "SELECT capacidade_tanque_l FROM veiculos WHERE id = $1::uuid", veiculo_id)
        capacidade_tanque = (float(cap_row['capacidade_tanque_l'])
                             if cap_row and cap_row['capacidade_tanque_l'] else None)
        df['ts'] = pd.to_datetime(df['ts'], utc=True)
        df = df.sort_values('ts').reset_index(drop=True)

        # ── delta_t entre posições consecutivas (segundos) ────
        df['delta_t'] = df['ts'].diff().dt.total_seconds().fillna(0)
        # Limitar delta_t a 10 min para evitar que paradas longas distorçam
        df['delta_t'] = df['delta_t'].clip(upper=600)

        tempo_total_s = df['delta_t'].sum()
        if tempo_total_s == 0:
            return

        # ── Tempo em movimento x parado (base = tempo de telemetria) ──
        # Movimento = velocidade > 0; parado = restante do tempo ativo.
        tempo_movimento_s = float(df[df['velocidade'].fillna(0) > 0]['delta_t'].sum())
        tempo_parado_s    = max(0.0, float(tempo_total_s) - tempo_movimento_s)

        # ── KM e Consumo ─────────────────────────────────────
        km_total, odometro_ini, odometro_fim, consumo_total = _km_e_consumo(df, capacidade_tanque)

        # ── Velocidade ────────────────────────────────────────
        vel_media, vel_max = _velocidade(df)

        # ── Faixas RPM ────────────────────────────────────────
        faixas_rpm = _faixas_rpm(df, tempo_total_s)

        # ── Faixas Acelerador ─────────────────────────────────
        faixas_acel = _faixas_acelerador(df, tempo_total_s)

        # ── Frenagens ─────────────────────────────────────────
        frenagens = _detectar_frenagens(df, km_total)

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
            'tempo_total_s':        int(tempo_total_s),
            'tempo_movimento_s':    int(tempo_movimento_s),
            'tempo_parado_s':       int(tempo_parado_s),
            'total_posicoes':       len(df),
        }

        # Salvar no banco
        await _salvar_indicador(conn, indicador)
        log.info('motor.indicadores.salvo', tenant_id=tenant_id,
                 motorista_id=motorista_id, periodo=f'{inicio}/{fim}')
    finally:
        await conn.close()


# ── Funções de cálculo ────────────────────────────────────────

# Máximo plausível de avanço entre duas posições consecutivas (delta_t ≤ 600s).
# A ~130 km/h em 10 min dá ~21,7 km; usamos 30 km como teto e filtramos:
#  - saltos negativos (reset do contador / troca de escala/fonte),
#  - saltos gigantes (oscilação do odômetro GPS entre escalas, ex.: 1295 ↔ 974828).
_KM_SALTO_MAX = 30.0       # km entre posições
_CONSUMO_SALTO_MAX = 50.0  # litros entre posições


def _soma_deltas_plausiveis(serie: pd.Series, cap: float):
    """Soma só os incrementos consecutivos positivos e plausíveis (0 < d ≤ cap).
    Robusto a reset do contador e a odômetro que oscila entre escalas."""
    s = pd.to_numeric(serie, errors='coerce').dropna()
    if len(s) < 2:
        return None, (float(s.iloc[0]) if len(s) else None), (float(s.iloc[-1]) if len(s) else None)
    d = s.diff()
    d = d[(d > 0) & (d <= cap)]
    return float(d.sum()), float(s.iloc[0]), float(s.iloc[-1])


def _consumo_por_nivel(serie_pct: pd.Series, capacidade_l: float):
    """Estima litros consumidos pela QUEDA do nível do tanque (%) × capacidade.
    Só conta descidas (consumo); subidas (reabastecimento) são ignoradas."""
    s = pd.to_numeric(serie_pct, errors='coerce').dropna()
    if len(s) < 2:
        return None
    d = s.diff()
    quedas = -d[d < 0]              # % que desceu, como positivo
    quedas = quedas[quedas <= 100]  # descarta ruído (queda > 100% é impossível)
    litros = float(quedas.sum()) * capacidade_l / 100.0
    return round(litros, 3) if litros > 0 else None


def _km_e_consumo(df: pd.DataFrame, capacidade_tanque: float | None = None):
    # KM do período = SOMA do km_rodado persistido por linha (odômetro atual −
    # anterior, já saneado). Fallback: recalcula pelos deltas do odômetro se a
    # coluna ainda não foi populada.
    if 'km_rodado' in df.columns and df['km_rodado'].notna().any():
        km = round(float(pd.to_numeric(df['km_rodado'], errors='coerce').fillna(0).clip(lower=0).sum()), 3)
    else:
        km_calc, _, _ = _soma_deltas_plausiveis(df['odometro_km'], _KM_SALTO_MAX)
        km = round(km_calc, 3) if km_calc is not None else 0.0

    # Odômetro inicial/final na ESCALA DOMINANTE (o hodômetro real). O odômetro
    # GPS deste equipamento oscila entre duas escalas (ex.: ~34 mil e ~974 mil);
    # descartamos a menor (< 50% do máximo) para exibir o valor real, não o glitch.
    odo = pd.to_numeric(df['odometro_km'], errors='coerce').dropna()
    if len(odo):
        dominante = odo[odo >= float(odo.max()) * 0.5]
        ini, fim = float(dominante.min()), float(dominante.max())
    else:
        ini = fim = None

    # Consumo: preferir o dado DIRETO (contador do motor). Se o equipamento não
    # envia (vem 0/ausente) mas há nível de tanque + capacidade cadastrada,
    # ESTIMA pela queda de nível × capacidade.
    consumo_direto, _, _ = _soma_deltas_plausiveis(df['consumo_total_l'], _CONSUMO_SALTO_MAX)
    consumo_direto = round(consumo_direto, 3) if consumo_direto is not None else None

    if consumo_direto and consumo_direto > 0:
        consumo = consumo_direto
    elif capacidade_tanque and 'nivel_combustivel_pct' in df.columns:
        consumo = _consumo_por_nivel(df['nivel_combustivel_pct'], capacidade_tanque)
    else:
        consumo = consumo_direto

    return km, ini, fim, consumo


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


def _detectar_frenagens(df: pd.DataFrame, km_total: float) -> dict:
    totais = normais = bruscas = alta_vel = 0

    # Detectar via evento_id (frenagem brusca já detectada pela Multiportal)
    frenagens_evento = df[df['evento_id'] == 13654]
    bruscas_evento   = len(frenagens_evento)

    # Detectar via Δv/Δt para as demais (quando temos velocidade). O delta_t é
    # RECALCULADO dentro do subconjunto de posições com velocidade — senão o Δv
    # seria dividido por um intervalo defasado (linhas sem velocidade no meio),
    # forjando frenagens bruscas falsas. Descartamos pares muito espaçados (>60s).
    df_vel = df[df['velocidade'].notna()].copy()
    df_vel['vel_anterior'] = df_vel['velocidade'].shift(1)
    df_vel['dt_vel'] = df_vel['ts'].diff().dt.total_seconds()
    df_vel = df_vel.dropna(subset=['vel_anterior', 'dt_vel'])
    df_vel = df_vel[(df_vel['dt_vel'] > 0) & (df_vel['dt_vel'] <= 60)]

    for _, row in df_vel.iterrows():
        resultado = clf.classificar_frenagem(
            float(row['vel_anterior']), float(row['velocidade']), float(row['dt_vel']),
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

    # Reutiliza o km_total JÁ SANEADO; sem km confiável (≤0) não fabrica índice.
    por_100km = round(totais / km_total * 100, 2) if km_total and km_total > 0 else None

    return {
        'frenagens_totais':          totais,
        'frenagens_normais':         normais,
        'frenagens_bruscas':         bruscas,
        'frenagens_alta_velocidade': alta_vel,
        'frenagens_por_100km':       por_100km,
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
        # O delta_t da 1ª linha da sequência é o intervalo desde a leitura ANTERIOR
        # (possivelmente em movimento) — não faz parte da parada. Somamos do 2º em diante.
        duracao = float(grupo['delta_t'].iloc[1:].sum())
        if duracao > TOLERANCIA:
            tempo_penalizado += (duracao - TOLERANCIA)

    return {
        'perc_motor_ocioso':               round(tempo_penalizado / tempo_total_s * 100, 2),
        'tempo_motor_ocioso_penalizado_s': int(tempo_penalizado),
    }


def _excesso_velocidade(df: pd.DataFrame) -> dict:
    # % do TEMPO com velocidade acima do limite, sobre o tempo com velocidade
    # medida (ponderado por delta_t). Evita a diluição de janelas horárias vazias
    # e a contagem por nº de posições da versão anterior.
    dfv = df[df['velocidade'].notna()]
    tempo_com_vel = float(dfv['delta_t'].sum())
    if tempo_com_vel <= 0:
        return {'perc_excesso_velocidade': 0.0}
    tempo_acima = float(dfv[dfv['velocidade'] > cfg.velocidade_excesso_kmh]['delta_t'].sum())
    return {'perc_excesso_velocidade': round(tempo_acima / tempo_com_vel * 100, 2)}


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
            perc_excesso_velocidade,
            tempo_total_s, tempo_movimento_s, tempo_parado_s,
            total_posicoes
        ) VALUES (
            $1::uuid, $2::uuid, $3::uuid, $4, $5, $6,
            $7, $8, $9, $10, $11, $12, $13,
            $14, $15, $16, $17, $18,
            $19, $20, $21, $22, $23, $24, $25, $26,
            $27, $28, $29, $31, $32, $33,
            $30
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
            tempo_total_s = EXCLUDED.tempo_total_s,
            tempo_movimento_s = EXCLUDED.tempo_movimento_s,
            tempo_parado_s = EXCLUDED.tempo_parado_s,
            total_posicoes = EXCLUDED.total_posicoes,
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
        ind.get('tempo_total_s', 0), ind.get('tempo_movimento_s', 0), ind.get('tempo_parado_s', 0),
    )
