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
