"""
worker/main.py — Polling loop simples (sem Celery/Redis)

Roda continuamente:
  1. Busca todos os tenants com credencial Multiportal ativa
  2. Para cada tenant: chama /integracao/dados_novos e persiste telemetria
  3. Aguarda POLLING_INTERVAL segundos e repete

FastAPI expõe /health e disparo manual de cálculo de indicadores.
"""
from __future__ import annotations

import asyncio
import base64
import csv
import io
import json
import logging
import os
import signal
import sys
import time
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from typing import Any

import asyncpg
import httpx
import structlog
from fastapi import FastAPI, Response
from pydantic import BaseModel

from config import get_settings
from ingestao.worker_dados_novos import processar_posicao, extrair_componente
from ingestao.multiportal_client_simple import MultiportalClientSimple
from motor.calculador_indicadores import _calcular_periodo
from motor.calculador_nota import _calcular_e_salvar as _calcular_nota

log = structlog.get_logger(__name__)
cfg = get_settings()

# ── Controle do loop ──────────────────────────────────────────

_running = True

# Estatística de componentes Multiportal vistos no polling (diagnóstico).
# Acumula {id_componente: {'count': n, 'exemplo': valor}} de forma não destrutiva.
_comp_stats: dict[int, dict] = {}


def _stop(sig, frame):
    global _running
    log.info('worker.parando')
    _running = False


signal.signal(signal.SIGTERM, _stop)
signal.signal(signal.SIGINT, _stop)


# ── Polling de um tenant ──────────────────────────────────────

async def _polling_tenant(tenant: dict, db: asyncpg.Connection) -> dict:
    password = base64.b64decode(tenant['password_enc'].encode()).decode()
    client = MultiportalClientSimple(
        base_url=cfg.multiportal_base_url,
        username=tenant['username'],
        password=password,
        appid=tenant['appid'],
    )
    try:
        veiculos = await client.dados_novos()
    except Exception as e:
        log.error('polling.multiportal_erro', tenant_id=tenant['tenant_id'], error=str(e))
        return {'veiculos': 0, 'posicoes': 0, 'erro': str(e)}
    finally:
        await client.close()

    total = 0
    for veiculo_raw in veiculos:
        id_multiportal = veiculo_raw.get('id')
        if not id_multiportal:
            continue

        # Garante que o veículo exista no nosso banco (sincronização automática
        # a partir da Multiportal). Cria com os campos disponíveis; se já existir,
        # apenas completa os dados que vierem preenchidos.
        await db.execute(
            """
            INSERT INTO veiculos (
                id, tenant_id, id_multiportal, placa, marca, modelo, frota,
                tipo_monitoramento, tipo_dispositivo, ativo
            ) VALUES (
                gen_random_uuid(), $1::uuid, $2, $3, $4, $5, $6, $7, 'GPS', true
            )
            ON CONFLICT (tenant_id, id_multiportal) DO UPDATE SET
                placa  = COALESCE(EXCLUDED.placa,  veiculos.placa),
                marca  = COALESCE(EXCLUDED.marca,  veiculos.marca),
                modelo = COALESCE(EXCLUDED.modelo, veiculos.modelo),
                frota  = COALESCE(EXCLUDED.frota,  veiculos.frota),
                tipo_monitoramento = COALESCE(EXCLUDED.tipo_monitoramento, veiculos.tipo_monitoramento),
                atualizado_em = NOW()
            """,
            tenant['tenant_id'], id_multiportal,
            veiculo_raw.get('placa'), veiculo_raw.get('marca'),
            veiculo_raw.get('modelo'), veiculo_raw.get('frota'),
            veiculo_raw.get('tipoMonitoramento'),
        )

        row = await db.fetchrow(
            """
            SELECT v.id::text AS veiculo_id,
                   fn_motorista_em(v.tenant_id, v.id, NOW())::text AS motorista_id
            FROM   veiculos v
            WHERE  v.tenant_id = $1::uuid AND v.id_multiportal = $2
            """,
            tenant['tenant_id'], id_multiportal,
        )
        if not row:
            continue

        for disp in veiculo_raw.get('dispositivos', []):
            registros = []
            for pos in disp.get('posicoes', []):
                # Diagnóstico: registra quais IDs de componente chegam e um exemplo
                for c in pos.get('componentes', []) or []:
                    cid = c.get('id')
                    if cid is None:
                        continue
                    s = _comp_stats.setdefault(
                        cid, {'count': 0, 'exemplos': [], 'min': None, 'max': None})
                    s['count'] += 1
                    val = c.get('valor')
                    if val in (None, '', 'null'):
                        continue
                    # guarda até 6 valores distintos de exemplo
                    if val not in s['exemplos'] and len(s['exemplos']) < 6:
                        s['exemplos'].append(val)
                    # rastreia faixa numérica (ajuda a identificar RPM: 0..milhares)
                    try:
                        num_val = float(str(val).replace(',', '.'))
                        s['min'] = num_val if s['min'] is None else min(s['min'], num_val)
                        s['max'] = num_val if s['max'] is None else max(s['max'], num_val)
                    except (ValueError, TypeError):
                        pass
                try:
                    r = processar_posicao(row['veiculo_id'], row['motorista_id'],
                                          tenant['tenant_id'], pos)
                except Exception as e:
                    log.warning('polling.posicao_erro', tenant_id=tenant['tenant_id'], error=str(e))
                    r = None
                if r:
                    # Guarda o array de componentes CRU (como a Multiportal envia),
                    # para comparação 1:1 com o que extraímos. Diagnóstico.
                    r['componentes_raw'] = json.dumps(pos.get('componentes') or [], ensure_ascii=False)
                    registros.append(r)

            if registros:
                await db.executemany(
                    """
                    INSERT INTO leitura_telemetria (
                        tenant_id, veiculo_id, motorista_id, ts, ts_gateway,
                        evento_id, latitude, longitude, altitude_m, proa,
                        hdop, satelites, gps_valido, endereco, velocidade,
                        rpm, perc_acelerador, odometro_km, consumo_total_l,
                        consumo_inst_l, ignicao, cruise_ctrl, pedal_freio,
                        embreagem, faixa_rpm, faixa_acelerador,
                        is_motor_ocioso, is_embalo, fonte_rpm, fonte_acelerador,
                        componentes_raw,
                        nivel_combustivel_pct, fonte_velocidade, fonte_combustivel
                    ) VALUES (
                        $1::uuid, $2::uuid, $3::uuid,
                        to_timestamp($4), to_timestamp($5),
                        $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                        $16, $17, $18, $19, $20, $21, $22, $23, $24,
                        $25, $26, $27, $28, $29, $30, $31::jsonb,
                        $32, $33, $34
                    ) ON CONFLICT (tenant_id, veiculo_id, ts) DO NOTHING
                    """,
                    [(
                        r['tenant_id'], r['veiculo_id'], r['motorista_id'],
                        r['ts'], r['ts_gateway'], r['evento_id'],
                        r['latitude'], r['longitude'], r['altitude_m'], r['proa'],
                        r['hdop'], r['satelites'], r['gps_valido'], r['endereco'],
                        r['velocidade'], r['rpm'], r['perc_acelerador'],
                        r['odometro_km'], r['consumo_total_l'], r['consumo_inst_l'],
                        r['ignicao'], r['cruise_ctrl'], r['pedal_freio'],
                        r['embreagem'], r['faixa_rpm'], r['faixa_acelerador'],
                        r['is_motor_ocioso'], r['is_embalo'],
                        r['fonte_rpm'], r['fonte_acelerador'],
                        r['componentes_raw'],
                        r['nivel_combustivel_pct'], r['fonte_velocidade'], r['fonte_combustivel'],
                    ) for r in registros],
                )
                total += len(registros)
    return {'veiculos': len(veiculos), 'posicoes': total}


async def _polling_todos() -> dict:
    resumo: dict = {'tenants': 0, 'detalhes': []}
    db = await asyncpg.connect(cfg.database_url)
    try:
        tenants = await db.fetch(
            """
            SELECT t.id::text AS tenant_id,
                   ci.username, ci.password_enc, ci.appid
            FROM   tenants t
            JOIN   credencial_integracao ci ON ci.tenant_id = t.id
            WHERE  t.ativo = true AND ci.ativo = true
            """
        )
        resumo['tenants'] = len(tenants)
        for t in tenants:
            try:
                res = await _polling_tenant(dict(t), db)
            except Exception as e:
                log.error('polling.tenant_erro', tenant_id=t['tenant_id'], error=str(e))
                res = {'veiculos': 0, 'posicoes': 0, 'erro': str(e)}
            log.info('polling.ciclo', tenant_id=t['tenant_id'], **res)
            resumo['detalhes'].append({'tenant_id': t['tenant_id'], **res})
    finally:
        await db.close()
    return resumo


# ── KM rodado por linha (odômetro atual − anterior, saneado) ──

async def _atualizar_km_rodado(db, inicio: datetime):
    """
    Grava km_rodado em cada leitura do período: diferença do odômetro em relação
    à posição ANTERIOR do mesmo veículo (LAG por ts), saneada — 0 < d ≤ 30 km;
    saltos negativos (reset) e gigantes (oscilação de escala do GPS) viram 0.
    Assim o km fica auditável linha a linha e km_total = SUM(km_rodado).
    A janela inclui 2 dias antes do início para a 1ª posição do mês ter referência.
    """
    await db.execute(
        """
        WITH d AS (
          SELECT tenant_id, veiculo_id, ts,
                 odometro_km - LAG(odometro_km) OVER (
                     PARTITION BY tenant_id, veiculo_id ORDER BY ts
                 ) AS delta
          FROM   leitura_telemetria
          WHERE  ts >= $1::timestamptz - INTERVAL '2 days'
        )
        UPDATE leitura_telemetria lt
        SET    km_rodado = CASE WHEN d.delta > 0 AND d.delta <= 30 THEN d.delta ELSE 0 END
        FROM   d
        WHERE  lt.tenant_id = d.tenant_id
          AND  lt.veiculo_id = d.veiculo_id
          AND  lt.ts = d.ts
          AND  lt.ts >= $1::timestamptz
        """,
        inicio,
    )


# ── Recálculo de indicadores do mês atual ─────────────────────

async def _recalcular_mes_atual():
    """Recalcula indicadores do mês corrente para todos os pares com telemetria."""
    import calendar
    hoje = date.today()
    inicio = hoje.replace(day=1)
    # Período mensal ESTÁVEL (fim = último dia do mês). Assim o recálculo diário
    # atualiza a MESMA linha (ON CONFLICT) em vez de criar uma nova por dia —
    # evita o acúmulo de períodos quase duplicados no filtro.
    ultimo_dia = calendar.monthrange(hoje.year, hoje.month)[1]
    fim = hoje.replace(day=ultimo_dia)

    db = await asyncpg.connect(cfg.database_url)
    try:
        # Atualiza o km_rodado por linha ANTES de agregar os indicadores.
        await _atualizar_km_rodado(db, datetime(inicio.year, inicio.month, inicio.day))
        pares = await db.fetch(
            """
            SELECT DISTINCT
                lt.tenant_id::text   AS tenant_id,
                lt.motorista_id::text AS motorista_id,
                lt.veiculo_id::text  AS veiculo_id
            FROM  leitura_telemetria lt
            WHERE lt.ts >= $1 AND lt.motorista_id IS NOT NULL
            """,
            datetime(inicio.year, inicio.month, inicio.day),
        )
    finally:
        await db.close()

    for par in pares:
        try:
            await _calcular_periodo(
                par['tenant_id'], par['motorista_id'], par['veiculo_id'],
                inicio, fim,
            )
            # Calcula scores + nota de desempenho e gera a nota ao condutor.
            # Depende do indicador já ter sido salvo acima.
            await _calcular_nota(
                par['tenant_id'], par['motorista_id'], par['veiculo_id'],
                inicio, fim,
            )
        except Exception as e:
            log.error('recalculo.par_erro', error=str(e),
                      motorista=par['motorista_id'])
    log.info('recalculo.concluido', pares=len(pares))


# ── Loop principal ────────────────────────────────────────────

async def _loop_recalculo():
    """A cada CALC_INTERVAL segundos recalcula os indicadores do mês atual."""
    interval = int(os.getenv('CALC_INTERVAL', '3600'))  # 1h por padrão
    log.info('recalculo.iniciando', interval_s=interval)
    # Pequeno atraso inicial para o primeiro ciclo de polling popular dados,
    # depois recalcula imediatamente (sem esperar 1h) e segue no intervalo.
    await asyncio.sleep(int(os.getenv('CALC_INICIAL_DELAY', '60')))
    while _running:
        try:
            await _recalcular_mes_atual()
        except Exception as e:
            log.error('recalculo.erro_geral', error=str(e))
        await asyncio.sleep(interval)


# ── Loop de polling ───────────────────────────────────────────

async def _loop():
    interval = int(os.getenv('POLLING_INTERVAL', str(cfg.multiportal_polling_interval)))
    log.info('worker.iniciando', interval_s=interval)
    while _running:
        try:
            await _polling_todos()
        except Exception as e:
            log.error('polling.erro_geral', error=str(e))
        await asyncio.sleep(interval)


# ── FastAPI ───────────────────────────────────────────────────

async def _garantir_colunas():
    """Garante que as colunas novas existam (independe do synchronize da API)."""
    db = await asyncpg.connect(cfg.database_url)
    try:
        await db.execute(
            """
            ALTER TABLE leitura_telemetria
                ADD COLUMN IF NOT EXISTS nivel_combustivel_pct numeric(5,1),
                ADD COLUMN IF NOT EXISTS fonte_velocidade  varchar(10),
                ADD COLUMN IF NOT EXISTS fonte_combustivel varchar(10),
                ADD COLUMN IF NOT EXISTS km_rodado numeric(8,3)
            """
        )
    finally:
        await db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        await _garantir_colunas()
    except Exception as e:
        log.error('startup.garantir_colunas_erro', error=str(e))
    t_poll = asyncio.create_task(_loop())
    t_calc = asyncio.create_task(_loop_recalculo())
    yield
    _running = False
    t_poll.cancel()
    t_calc.cancel()


api = FastAPI(title='Infobridge Worker', lifespan=lifespan)


@api.get('/health')
def health():
    return {'status': 'ok', 'service': 'infobridge-worker'}


class IndicadoresRequest(BaseModel):
    tenant_id:      str
    motorista_id:   str
    veiculo_id:     str
    periodo_inicio: str  # 'yyyy-MM-dd'
    periodo_fim:    str


@api.post('/jobs/indicadores')
async def calcular_indicadores(req: IndicadoresRequest):
    """Dispara cálculo de indicadores para um motorista/veículo/período específico."""
    await _calcular_periodo(
        req.tenant_id, req.motorista_id, req.veiculo_id,
        date.fromisoformat(req.periodo_inicio),
        date.fromisoformat(req.periodo_fim),
    )
    return {'status': 'ok', 'mensagem': 'Indicadores calculados'}


@api.post('/jobs/polling')
async def polling_manual():
    """Força um ciclo de polling imediato para todos os tenants."""
    resumo = await _polling_todos()
    return {'status': 'ok', **resumo}


@api.post('/jobs/vincular-telemetria')
async def vincular_telemetria():
    """
    Backfill: atribui o motorista vinculado (vínculo ativo) às leituras de
    telemetria que estão sem motorista. Útil logo após criar os vínculos,
    para que a telemetria já coletada possa gerar indicadores.
    Usa o vínculo ativo (fim IS NULL) mais recente de cada veículo.
    """
    db = await asyncpg.connect(cfg.database_url)
    try:
        resultado = await db.execute(
            """
            UPDATE leitura_telemetria lt
            SET    motorista_id = v.motorista_id
            FROM (
                SELECT DISTINCT ON (veiculo_id)
                       tenant_id, veiculo_id, motorista_id
                FROM   vinculo_motorista_veiculo
                WHERE  fim IS NULL
                ORDER BY veiculo_id, inicio DESC
            ) v
            WHERE lt.veiculo_id   = v.veiculo_id
              AND lt.tenant_id    = v.tenant_id
              AND lt.motorista_id IS NULL
            """
        )
        # resultado vem como 'UPDATE N'
        atualizadas = int(resultado.split()[-1]) if resultado else 0
        log.info('backfill.telemetria', atualizadas=atualizadas)
        return {'status': 'ok', 'leituras_atualizadas': atualizadas}
    finally:
        await db.close()


@api.get('/debug/export')
async def export_telemetria(placa: str = 'QOD5557', inicio_h: int = 5, fim_h: int = 12):
    """
    Exporta em CSV toda a telemetria que o sistema tem de um veículo num
    intervalo de horas DE HOJE (horário de Brasília, UTC-3). Default: QOD5557, 05h–12h.
    Ex.: /debug/export?placa=QOD5557&inicio_h=5&fim_h=12
    """
    brt = timezone(timedelta(hours=-3))
    agora = datetime.now(timezone.utc).astimezone(brt)
    ini = datetime(agora.year, agora.month, agora.day, inicio_h, 0, tzinfo=brt)
    fim = datetime(agora.year, agora.month, agora.day, fim_h, 0, tzinfo=brt)

    db = await asyncpg.connect(cfg.database_url)
    try:
        rows = await db.fetch(
            """
            SELECT lt.ts, lt.evento_id, lt.gps_valido, lt.latitude, lt.longitude,
                   lt.velocidade, lt.rpm, lt.perc_acelerador, lt.odometro_km,
                   lt.consumo_total_l, lt.consumo_inst_l, lt.ignicao,
                   lt.cruise_ctrl, lt.pedal_freio, lt.embreagem,
                   lt.faixa_rpm, lt.faixa_acelerador, lt.is_motor_ocioso, lt.is_embalo,
                   lt.fonte_rpm, lt.fonte_acelerador, lt.motorista_id::text AS motorista_id,
                   lt.endereco
            FROM   leitura_telemetria lt
            JOIN   veiculos v ON v.id = lt.veiculo_id
            WHERE  v.placa = $1 AND lt.ts >= $2 AND lt.ts < $3
            ORDER BY lt.ts
            """,
            placa, ini, fim,
        )
    finally:
        await db.close()

    buf = io.StringIO()
    w = csv.writer(buf, delimiter=';')
    cols = [
        'ts_brt', 'ts_utc', 'evento_id', 'gps_valido', 'latitude', 'longitude',
        'velocidade', 'rpm', 'perc_acelerador', 'odometro_km',
        'consumo_total_l', 'consumo_inst_l', 'ignicao', 'cruise_ctrl',
        'pedal_freio', 'embreagem', 'faixa_rpm', 'faixa_acelerador',
        'is_motor_ocioso', 'is_embalo', 'fonte_rpm', 'fonte_acelerador',
        'motorista_id', 'endereco',
    ]
    w.writerow(cols)
    for r in rows:
        ts = r['ts']
        w.writerow([
            ts.astimezone(brt).strftime('%d/%m/%Y %H:%M:%S') if ts else '',
            ts.astimezone(timezone.utc).isoformat() if ts else '',
            r['evento_id'], r['gps_valido'], r['latitude'], r['longitude'],
            r['velocidade'], r['rpm'], r['perc_acelerador'], r['odometro_km'],
            r['consumo_total_l'], r['consumo_inst_l'], r['ignicao'], r['cruise_ctrl'],
            r['pedal_freio'], r['embreagem'], r['faixa_rpm'], r['faixa_acelerador'],
            r['is_motor_ocioso'], r['is_embalo'], r['fonte_rpm'], r['fonte_acelerador'],
            r['motorista_id'], r['endereco'],
        ])

    nome = f'{placa}_{agora.strftime("%Y%m%d")}_{inicio_h:02d}-{fim_h:02d}h.csv'
    # BOM para o Excel abrir os acentos corretamente
    conteudo = '﻿' + buf.getvalue()
    return Response(
        content=conteudo,
        media_type='text/csv; charset=utf-8',
        headers={'Content-Disposition': f'attachment; filename="{nome}"',
                 'X-Total-Linhas': str(len(rows))},
    )


@api.get('/debug/export-bruto')
async def export_bruto(placa: str = 'QOD5557', inicio_h: int = 5, fim_h: int = 12):
    """
    Exporta em JSON, por posição, o ARRAY DE COMPONENTES CRU (como a Multiportal
    envia) ao lado do que o sistema EXTRAIU (rpm, acelerador, odômetro...). Permite
    ver 1:1 se estamos descartando algum dado. Só captura posições gravadas APÓS o
    deploy desta versão (a coluna componentes_raw começa a ser preenchida agora).
    Default: QOD5557, 05h–12h de hoje (BRT).
    """
    brt = timezone(timedelta(hours=-3))
    agora = datetime.now(timezone.utc).astimezone(brt)
    ini = datetime(agora.year, agora.month, agora.day, inicio_h, 0, tzinfo=brt)
    fim = datetime(agora.year, agora.month, agora.day, fim_h, 0, tzinfo=brt)

    db = await asyncpg.connect(cfg.database_url)
    try:
        rows = await db.fetch(
            """
            SELECT lt.ts, lt.velocidade, lt.rpm, lt.perc_acelerador, lt.odometro_km,
                   lt.consumo_total_l, lt.ignicao, lt.faixa_rpm, lt.faixa_acelerador,
                   lt.componentes_raw
            FROM   leitura_telemetria lt
            JOIN   veiculos v ON v.id = lt.veiculo_id
            WHERE  v.placa = $1 AND lt.ts >= $2 AND lt.ts < $3
            ORDER BY lt.ts
            """,
            placa, ini, fim,
        )
    finally:
        await db.close()

    saida = []
    com_raw = 0
    for r in rows:
        raw = r['componentes_raw']
        if raw is not None:
            com_raw += 1
            if isinstance(raw, str):
                try: raw = json.loads(raw)
                except Exception: pass
        saida.append({
            'ts_brt': r['ts'].astimezone(brt).strftime('%d/%m/%Y %H:%M:%S') if r['ts'] else None,
            'extraido': {
                'velocidade': r['velocidade'], 'rpm': r['rpm'],
                'perc_acelerador': float(r['perc_acelerador']) if r['perc_acelerador'] is not None else None,
                'odometro_km': float(r['odometro_km']) if r['odometro_km'] is not None else None,
                'consumo_total_l': float(r['consumo_total_l']) if r['consumo_total_l'] is not None else None,
                'ignicao': r['ignicao'], 'faixa_rpm': r['faixa_rpm'], 'faixa_acelerador': r['faixa_acelerador'],
            },
            'componentes_bruto': raw,
        })

    payload = json.dumps({
        'placa': placa, 'intervalo': f'{inicio_h:02d}h-{fim_h:02d}h BRT',
        'total_posicoes': len(rows), 'posicoes_com_bruto': com_raw,
        'posicoes': saida,
    }, ensure_ascii=False, indent=2)
    nome = f'{placa}_{agora.strftime("%Y%m%d")}_bruto.json'
    return Response(content=payload, media_type='application/json; charset=utf-8',
                    headers={'Content-Disposition': f'attachment; filename="{nome}"'})


@api.get('/debug/export-mes')
async def export_mes(placa: str = 'QOD5557'):
    """
    Export bruto do MÊS ATUAL de uma placa: para cada posição, o array de
    componentes CRU (como a Multiportal envia) + o que o sistema EXTRAIU
    (velocidade, rpm, acelerador, odômetro, consumo, combustível, fontes).
    Só inclui posições com componentes_raw. Default: QOD5557.
    """
    brt = timezone(timedelta(hours=-3))
    hoje = date.today()
    inicio = datetime(hoje.year, hoje.month, 1)

    db = await asyncpg.connect(cfg.database_url)
    try:
        rows = await db.fetch(
            """
            SELECT lt.ts, lt.velocidade, lt.rpm, lt.perc_acelerador, lt.odometro_km,
                   lt.consumo_total_l, lt.consumo_inst_l, lt.nivel_combustivel_pct,
                   lt.ignicao, lt.cruise_ctrl, lt.pedal_freio, lt.embreagem,
                   lt.faixa_rpm, lt.faixa_acelerador, lt.is_motor_ocioso, lt.is_embalo,
                   lt.fonte_rpm, lt.fonte_acelerador, lt.fonte_velocidade, lt.fonte_combustivel,
                   lt.componentes_raw
            FROM   leitura_telemetria lt
            JOIN   veiculos v ON v.id = lt.veiculo_id
            WHERE  v.placa = $1 AND lt.ts >= $2
            ORDER BY lt.ts
            """,
            placa, inicio,
        )
    finally:
        await db.close()

    def f(v): return float(v) if v is not None else None
    saida = []
    com_raw = 0
    for r in rows:
        raw = r['componentes_raw']
        if raw is not None:
            com_raw += 1
            if isinstance(raw, str):
                try: raw = json.loads(raw)
                except Exception: pass
        saida.append({
            'ts_brt': r['ts'].astimezone(brt).strftime('%d/%m/%Y %H:%M:%S') if r['ts'] else None,
            'extraido': {
                'velocidade': r['velocidade'], 'rpm': r['rpm'],
                'perc_acelerador': f(r['perc_acelerador']), 'odometro_km': f(r['odometro_km']),
                'consumo_total_l': f(r['consumo_total_l']), 'consumo_inst_l': f(r['consumo_inst_l']),
                'nivel_combustivel_pct': f(r['nivel_combustivel_pct']),
                'ignicao': r['ignicao'], 'cruise_ctrl': r['cruise_ctrl'],
                'pedal_freio': r['pedal_freio'], 'embreagem': r['embreagem'],
                'faixa_rpm': r['faixa_rpm'], 'faixa_acelerador': r['faixa_acelerador'],
                'is_motor_ocioso': r['is_motor_ocioso'], 'is_embalo': r['is_embalo'],
                'fonte_rpm': r['fonte_rpm'], 'fonte_acelerador': r['fonte_acelerador'],
                'fonte_velocidade': r['fonte_velocidade'], 'fonte_combustivel': r['fonte_combustivel'],
            },
            'componentes_bruto': raw,
        })

    payload = json.dumps({
        'placa': placa, 'mes': hoje.strftime('%Y-%m'),
        'total_posicoes': len(rows), 'posicoes_com_bruto': com_raw,
        'posicoes': saida,
    }, ensure_ascii=False, indent=2)
    nome = f'{placa}_{hoje.strftime("%Y%m")}_bruto_mes.json'
    return Response(content=payload, media_type='application/json; charset=utf-8',
                    headers={'Content-Disposition': f'attachment; filename="{nome}"',
                             'X-Total-Linhas': str(len(rows))})


@api.get('/debug/componentes')
def debug_componentes():
    """
    Lista os IDs de componente Multiportal vistos no polling desde que o worker
    subiu, ordenados por frequência, com um valor de exemplo. Serve para
    descobrir sob qual ID este rastreador envia RPM/acelerador/consumo.
    """
    itens = sorted(_comp_stats.items(), key=lambda kv: kv[1]['count'], reverse=True)
    return {
        'total_ids_distintos': len(itens),
        'dica_ids_esperados': {
            'rpm_can': cfg.comp_rpm_can, 'rpm_obd2': cfg.comp_rpm_obd2,
            'rpm_basico': cfg.comp_rpm_basico, 'acelerador_can': cfg.comp_acelerador_can,
            'acelerador_obd2': cfg.comp_acelerador_obd2,
        },
        'componentes': [{'id': cid, **info} for cid, info in itens],
    }


@api.get('/debug')
async def debug():
    """Contagens úteis para diagnóstico (sem dados sensíveis)."""
    consultas = {
        'tenants_ativos':        "SELECT COUNT(*) FROM tenants WHERE ativo = true",
        'credenciais_ativas':    "SELECT COUNT(*) FROM credencial_integracao WHERE ativo = true",
        'veiculos':              "SELECT COUNT(*) FROM veiculos",
        'motoristas':            "SELECT COUNT(*) FROM motoristas",
        'vinculos_ativos':       "SELECT COUNT(*) FROM vinculo_motorista_veiculo WHERE fim IS NULL",
        'leitura_telemetria':    "SELECT COUNT(*) FROM leitura_telemetria",
        'leitura_com_motorista': "SELECT COUNT(*) FROM leitura_telemetria WHERE motorista_id IS NOT NULL",
        'indicador_periodo':     "SELECT COUNT(*) FROM indicador_periodo",
        # Cobertura de dados CAN (quantas leituras trazem cada componente)
        'leit_com_rpm':          "SELECT COUNT(*) FROM leitura_telemetria WHERE rpm IS NOT NULL",
        'leit_com_acelerador':   "SELECT COUNT(*) FROM leitura_telemetria WHERE perc_acelerador IS NOT NULL",
        'leit_com_faixa_rpm':    "SELECT COUNT(*) FROM leitura_telemetria WHERE faixa_rpm IS NOT NULL",
        'leit_com_velocidade':   "SELECT COUNT(*) FROM leitura_telemetria WHERE velocidade IS NOT NULL",
        'leit_com_odometro':     "SELECT COUNT(*) FROM leitura_telemetria WHERE odometro_km IS NOT NULL",
        'leit_com_consumo':      "SELECT COUNT(*) FROM leitura_telemetria WHERE consumo_total_l IS NOT NULL",
        'indicadores_com_nota':  "SELECT COUNT(*) FROM indicador_periodo WHERE nota_desempenho IS NOT NULL",
    }
    # Diagnóstico de variáveis de ambiente relacionadas a banco (sem expor segredos)
    candidatas = [
        'DATABASE_URL', 'DATABASE_PRIVATE_URL', 'DATABASE_PUBLIC_URL', 'POSTGRES_URL',
        'PGHOST', 'PGUSER', 'PGDATABASE', 'PGPORT',
    ]
    env_info = {c: ('definida' if os.getenv(c) else 'vazia') for c in candidatas}
    dsn = cfg.database_url or ''
    dsn_resumo = 'NENHUMA'
    if '://' in dsn:
        try:
            esquema, resto = dsn.split('://', 1)
            host = resto.split('@', 1)[1].split('/', 1)[0] if '@' in resto else resto.split('/', 1)[0]
            dsn_resumo = f'{esquema}://…@{host}'
        except Exception:
            dsn_resumo = 'invalida'
    raw = os.getenv('DATABASE_URL') or ''
    raw_preview = ''
    if raw:
        prefixo = raw[:18]
        eh_ref = raw.strip().startswith('${')
        raw_preview = ('REFERENCIA_NAO_RESOLVIDA ' if eh_ref else '') + prefixo + ('…' if len(raw) > 18 else '')
    diag = {
        'env': env_info,
        'dsn_efetiva': dsn_resumo,
        'database_url_tamanho': len(raw),
        'database_url_preview': raw_preview,
    }

    resultado: dict = {'_diagnostico': diag}
    if '://' not in dsn:
        resultado['erro_conexao'] = 'DATABASE_URL ausente/sem esquema — configure no serviço worker'
        return resultado
    try:
        db = await asyncpg.connect(dsn)
    except Exception as e:
        resultado['erro_conexao'] = str(e)
        return resultado
    try:
        for chave, sql in consultas.items():
            try:
                resultado[chave] = await db.fetchval(sql)
            except Exception as e:
                resultado[chave] = f'ERRO: {e}'

        # Quebra por veículo nas últimas 24h: leituras com RPM/acelerador e máximos.
        # Útil para validar mudança de configuração de um veículo específico (ex.: QOD5557).
        try:
            linhas = await db.fetch(
                """
                SELECT v.placa,
                       COUNT(*)                  AS leituras,
                       COUNT(lt.rpm)             AS com_rpm,
                       MAX(lt.rpm)               AS rpm_max,
                       COUNT(lt.perc_acelerador) AS com_acelerador,
                       MAX(lt.perc_acelerador)   AS acel_max,
                       MAX(lt.ts)                AS ultima_leitura
                FROM   leitura_telemetria lt
                JOIN   veiculos v ON v.id = lt.veiculo_id
                WHERE  lt.ts >= NOW() - INTERVAL '24 hours'
                GROUP BY v.placa
                ORDER BY v.placa
                """
            )
            resultado['por_veiculo_24h'] = [
                {
                    'placa':          r['placa'],
                    'leituras':       r['leituras'],
                    'com_rpm':        r['com_rpm'],
                    'rpm_max':        r['rpm_max'],
                    'com_acelerador': r['com_acelerador'],
                    'acel_max':       float(r['acel_max']) if r['acel_max'] is not None else None,
                    'ultima_leitura': r['ultima_leitura'].isoformat() if r['ultima_leitura'] else None,
                }
                for r in linhas
            ]
        except Exception as e:
            resultado['por_veiculo_24h'] = f'ERRO: {e}'
    finally:
        await db.close()
    return resultado


@api.post('/jobs/recalcular')
async def recalcular_manual():
    """Força o recálculo dos indicadores do mês atual para todos os pares."""
    await _recalcular_mes_atual()
    return {'status': 'ok', 'mensagem': 'Recálculo do mês atual concluído'}


@api.get('/debug/mes-atual')
async def debug_mes_atual():
    """Diagnóstico do mês corrente: leituras, pares elegíveis e indicadores."""
    hoje = date.today()
    inicio = datetime(hoje.year, hoje.month, 1)
    db = await asyncpg.connect(cfg.database_url)
    try:
        out = {
            'mes': hoje.strftime('%Y-%m'),
            'leituras_mes': await db.fetchval(
                "SELECT COUNT(*) FROM leitura_telemetria WHERE ts >= $1", inicio),
            'leituras_mes_com_motorista': await db.fetchval(
                "SELECT COUNT(*) FROM leitura_telemetria WHERE ts >= $1 AND motorista_id IS NOT NULL", inicio),
            'motoristas_distintos_mes': await db.fetchval(
                "SELECT COUNT(DISTINCT motorista_id) FROM leitura_telemetria WHERE ts >= $1 AND motorista_id IS NOT NULL", inicio),
            'pares_elegiveis': await db.fetchval(
                "SELECT COUNT(*) FROM (SELECT DISTINCT tenant_id, motorista_id, veiculo_id "
                "FROM leitura_telemetria WHERE ts >= $1 AND motorista_id IS NOT NULL) s", inicio),
            'indicadores_mes': await db.fetchval(
                "SELECT COUNT(*) FROM indicador_periodo WHERE periodo_inicio >= $1", inicio.date()),
            'indicadores_mes_com_nota': await db.fetchval(
                "SELECT COUNT(*) FROM indicador_periodo WHERE periodo_inicio >= $1 AND nota_desempenho IS NOT NULL", inicio.date()),
        }
        amostra = await db.fetch(
            """
            SELECT m.nome AS motorista, ip.periodo_inicio, ip.periodo_fim,
                   ip.nota_desempenho, ip.km_total
            FROM   indicador_periodo ip
            LEFT JOIN motoristas m ON m.id = ip.motorista_id
            WHERE  ip.periodo_inicio >= $1
            ORDER BY ip.periodo_inicio DESC
            LIMIT 10
            """,
            inicio.date(),
        )
        out['amostra_indicadores'] = [
            {'motorista': r['motorista'], 'inicio': str(r['periodo_inicio']),
             'fim': str(r['periodo_fim']),
             'nota': float(r['nota_desempenho']) if r['nota_desempenho'] is not None else None,
             'km': float(r['km_total']) if r['km_total'] is not None else None}
            for r in amostra
        ]
    finally:
        await db.close()
    return out


@api.get('/debug/odometro')
async def debug_odometro(placa: str = 'QOD5557'):
    """Diagnóstico do odômetro/km do mês para uma placa: cobertura, min/max,
    soma de km_rodado e uma amostra de posições consecutivas com o delta."""
    hoje = date.today()
    inicio = datetime(hoje.year, hoje.month, 1)
    db = await asyncpg.connect(cfg.database_url)
    try:
        resumo = await db.fetchrow(
            """
            SELECT COUNT(*)                       AS leituras,
                   COUNT(lt.odometro_km)          AS com_odometro,
                   MIN(lt.odometro_km)            AS odo_min,
                   MAX(lt.odometro_km)            AS odo_max,
                   COUNT(lt.km_rodado)            AS com_km_rodado,
                   COALESCE(SUM(lt.km_rodado), 0) AS km_total_soma
            FROM   leitura_telemetria lt
            JOIN   veiculos v ON v.id = lt.veiculo_id
            WHERE  v.placa = $1 AND lt.ts >= $2
            """,
            placa, inicio,
        )
        amostra = await db.fetch(
            """
            SELECT lt.ts, lt.odometro_km, lt.km_rodado
            FROM   leitura_telemetria lt
            JOIN   veiculos v ON v.id = lt.veiculo_id
            WHERE  v.placa = $1 AND lt.ts >= $2 AND lt.odometro_km IS NOT NULL
            ORDER BY lt.ts
            LIMIT 20
            """,
            placa, inicio,
        )
        f = lambda x: float(x) if x is not None else None
        return {
            'placa': placa, 'mes': hoje.strftime('%Y-%m'),
            'leituras': resumo['leituras'],
            'com_odometro': resumo['com_odometro'],
            'odometro_min': f(resumo['odo_min']),
            'odometro_max': f(resumo['odo_max']),
            'com_km_rodado': resumo['com_km_rodado'],
            'km_total_soma': f(resumo['km_total_soma']),
            'amostra': [
                {'ts': r['ts'].isoformat() if r['ts'] else None,
                 'odometro_km': f(r['odometro_km']), 'km_rodado': f(r['km_rodado'])}
                for r in amostra
            ],
        }
    finally:
        await db.close()


# ── Reprocessamento do mês atual a partir de componentes_raw ──

async def _reprocessar_mes_atual() -> dict:
    """
    Reaplica a extração de componentes (fontes atuais: CAN → OBD2 → GPS) sobre
    as leituras do mês corrente, usando o array componentes_raw já armazenado.
    Só afeta linhas que tenham componentes_raw (ingeridas após esse recurso).
    """
    await _garantir_colunas()
    hoje = date.today()
    inicio = datetime(hoje.year, hoje.month, 1)
    db = await asyncpg.connect(cfg.database_url)
    total = 0
    updates: list[tuple] = []
    try:
        rows = await db.fetch(
            """
            SELECT tenant_id::text AS tenant_id, veiculo_id::text AS veiculo_id,
                   (extract(epoch from ts) * 1000)::double precision AS ts_ms,
                   velocidade AS vel_gps,
                   componentes_raw
            FROM   leitura_telemetria
            WHERE  ts >= $1 AND componentes_raw IS NOT NULL
            """,
            inicio,
        )
        total = len(rows)
        for row in rows:
            raw = row['componentes_raw']
            comp = json.loads(raw) if isinstance(raw, str) else (raw or [])
            pos = {
                'validade': True,
                'dataEquipamento': row['ts_ms'],
                'velocidade': row['vel_gps'],   # fallback GPS = velocidade já gravada
                'componentes': comp,
            }
            r = processar_posicao(row['veiculo_id'], None, row['tenant_id'], pos)
            if not r:
                continue
            updates.append((
                r['velocidade'], r['rpm'], r['perc_acelerador'], r['odometro_km'],
                r['consumo_total_l'], r['consumo_inst_l'], r['nivel_combustivel_pct'],
                r['ignicao'], r['cruise_ctrl'], r['pedal_freio'], r['embreagem'],
                r['faixa_rpm'], r['faixa_acelerador'], r['is_motor_ocioso'], r['is_embalo'],
                r['fonte_rpm'], r['fonte_acelerador'], r['fonte_velocidade'], r['fonte_combustivel'],
                row['tenant_id'], row['veiculo_id'], row['ts_ms'] / 1000.0,
            ))

        if updates:
            await db.executemany(
                """
                UPDATE leitura_telemetria SET
                    velocidade=$1, rpm=$2, perc_acelerador=$3, odometro_km=$4,
                    consumo_total_l=$5, consumo_inst_l=$6, nivel_combustivel_pct=$7,
                    ignicao=$8, cruise_ctrl=$9, pedal_freio=$10, embreagem=$11,
                    faixa_rpm=$12, faixa_acelerador=$13, is_motor_ocioso=$14, is_embalo=$15,
                    fonte_rpm=$16, fonte_acelerador=$17, fonte_velocidade=$18, fonte_combustivel=$19
                WHERE tenant_id=$20::uuid AND veiculo_id=$21::uuid AND ts=to_timestamp($22)
                """,
                updates,
            )

        # Distribuição de fontes após o reprocessamento (comparativo).
        fontes = {}
        for campo in ('fonte_velocidade', 'fonte_rpm', 'fonte_acelerador', 'fonte_combustivel'):
            linhas = await db.fetch(
                f"SELECT COALESCE({campo}, '(nulo)') AS k, COUNT(*) AS n "
                f"FROM leitura_telemetria WHERE ts >= $1 GROUP BY 1 ORDER BY 2 DESC",
                inicio,
            )
            fontes[campo] = {r['k']: r['n'] for r in linhas}
    finally:
        await db.close()

    return {'linhas_no_mes': total, 'reprocessadas': len(updates), 'fontes': fontes}


@api.api_route('/jobs/reprocessar-mes', methods=['GET', 'POST'])
async def reprocessar_mes(recalcular: bool = True):
    """
    Reprocessa as leituras do mês atual (fontes CAN→OBD2→GPS) a partir de
    componentes_raw e, por padrão, recalcula os indicadores em seguida.
    """
    try:
        resultado = await _reprocessar_mes_atual()
        if recalcular:
            await _recalcular_mes_atual()
            resultado['recalculo'] = 'ok'
        return {'status': 'ok', **resultado}
    except Exception as e:
        import traceback
        log.error('reprocessar.erro', error=str(e))
        return Response(
            content=json.dumps({'status': 'erro', 'erro': str(e),
                                'trace': traceback.format_exc()[-1500:]}, ensure_ascii=False),
            media_type='application/json; charset=utf-8', status_code=500,
        )


if __name__ == '__main__':
    import uvicorn
    port = int(os.getenv('PORT', '8000'))
    uvicorn.run('main:api', host='0.0.0.0', port=port, log_level='info')
