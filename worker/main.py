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
            res = await _polling_tenant(dict(t), db)
            log.info('polling.ciclo', tenant_id=t['tenant_id'], **res)
            resumo['detalhes'].append({'tenant_id': t['tenant_id'], **res})
    finally:
        await db.close()
    return resumo


# ── Recálculo de indicadores do mês atual ─────────────────────

async def _recalcular_mes_atual():
    """Recalcula indicadores do mês corrente para todos os pares com telemetria."""
    hoje = date.today()
    inicio = hoje.replace(day=1)
    fim = hoje

    db = await asyncpg.connect(cfg.database_url)
    try:
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
        except Exception as e:
            log.error('recalculo.par_erro', error=str(e),
                      motorista=par['motorista_id'])
    log.info('recalculo.concluido', pares=len(pares))


# ── Loop principal ────────────────────────────────────────────

async def _loop_recalculo():
    """A cada CALC_INTERVAL segundos recalcula os indicadores do mês atual."""
    interval = int(os.getenv('CALC_INTERVAL', '3600'))  # 1h por padrão
    log.info('recalculo.iniciando', interval_s=interval)
    while _running:
        await asyncio.sleep(interval)
        try:
            await _recalcular_mes_atual()
        except Exception as e:
            log.error('recalculo.erro_geral', error=str(e))


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

@asynccontextmanager
async def lifespan(app: FastAPI):
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
    }
    resultado: dict = {}
    try:
        db = await asyncpg.connect(cfg.database_url)
    except Exception as e:
        return {'erro_conexao': str(e)}
    try:
        for chave, sql in consultas.items():
            try:
                resultado[chave] = await db.fetchval(sql)
            except Exception as e:
                resultado[chave] = f'ERRO: {e}'
    finally:
        await db.close()
    return resultado


@api.post('/jobs/recalcular')
async def recalcular_manual():
    """Força o recálculo dos indicadores do mês atual para todos os pares."""
    await _recalcular_mes_atual()
    return {'status': 'ok', 'mensagem': 'Recálculo do mês atual concluído'}


if __name__ == '__main__':
    import uvicorn
    port = int(os.getenv('PORT', '8000'))
    uvicorn.run('main:api', host='0.0.0.0', port=port, log_level='info')
