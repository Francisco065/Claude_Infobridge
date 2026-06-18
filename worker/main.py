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
import logging
import os
import signal
import sys
import time
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta
from typing import Any

import asyncpg
import httpx
import structlog
from fastapi import FastAPI
from pydantic import BaseModel

from config import get_settings
from ingestao.worker_dados_novos import processar_posicao, extrair_componente
from ingestao.multiportal_client_simple import MultiportalClientSimple
from motor.calculador_indicadores import _calcular_periodo

log = structlog.get_logger(__name__)
cfg = get_settings()

# ── Controle do loop ──────────────────────────────────────────

_running = True


def _stop(sig, frame):
    global _running
    log.info('worker.parando')
    _running = False


signal.signal(signal.SIGTERM, _stop)
signal.signal(signal.SIGINT, _stop)


# ── Polling de um tenant ──────────────────────────────────────

async def _polling_tenant(tenant: dict, db: asyncpg.Connection) -> int:
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
        return 0
    finally:
        await client.close()

    total = 0
    for veiculo_raw in veiculos:
        id_multiportal = veiculo_raw.get('id')
        if not id_multiportal:
            continue

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
                r = processar_posicao(row['veiculo_id'], row['motorista_id'],
                                      tenant['tenant_id'], pos)
                if r:
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
                        is_motor_ocioso, is_embalo, fonte_rpm, fonte_acelerador
                    ) VALUES (
                        $1::uuid, $2::uuid, $3::uuid,
                        to_timestamp($4), to_timestamp($5),
                        $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                        $16, $17, $18, $19, $20, $21, $22, $23, $24,
                        $25, $26, $27, $28, $29, $30
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
                    ) for r in registros],
                )
                total += len(registros)
    return total


async def _polling_todos():
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
        for t in tenants:
            posicoes = await _polling_tenant(dict(t), db)
            log.info('polling.ciclo', tenant_id=t['tenant_id'], posicoes=posicoes)
    finally:
        await db.close()


# ── Loop principal ────────────────────────────────────────────

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

@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(_loop())
    yield
    _running = False
    task.cancel()


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
    await _polling_todos()
    return {'status': 'ok'}


if __name__ == '__main__':
    import uvicorn
    port = int(os.getenv('PORT', '8000'))
    uvicorn.run('main:api', host='0.0.0.0', port=port, log_level='info')
