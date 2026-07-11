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

# ── Heartbeat dos loops (vigiado pelo watchdog e exposto no /health) ─────────
# Cada loop registra quando TERMINOU um ciclo (com ou sem erro) e quando o
# último ciclo BEM-SUCEDIDO aconteceu. Se um loop morrer/travar, o watchdog
# derruba o processo (os._exit) e o Railway reinicia o container — o motor
# volta sozinho em vez de ficar parado em silêncio perdendo dados.
_hb: dict[str, Any] = {
    'iniciado_em':          datetime.now(timezone.utc),
    'polling_ultimo_ok':    None,   # último ciclo concluído sem erro
    'polling_ultimo_fim':   None,   # última tentativa concluída (ok ou erro)
    'polling_ultimo_erro':  None,
    'polling_posicoes':     0,      # posições gravadas no último ciclo OK
    'recalc_ultimo_ok':     None,
    'recalc_ultimo_fim':    None,
    'recalc_ultimo_erro':   None,
}

# Tempo máximo de UM ciclo — um travamento (ex.: conexão pendurada) vira
# exceção em vez de paralisar o loop para sempre.
_POLL_TIMEOUT_S = int(os.getenv('POLL_TIMEOUT', '600'))     # 10 min
_CALC_TIMEOUT_S = int(os.getenv('CALC_TIMEOUT', '1800'))    # 30 min

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
            await asyncio.wait_for(_recalcular_mes_atual(), timeout=_CALC_TIMEOUT_S)
            _hb['recalc_ultimo_ok'] = datetime.now(timezone.utc)
            _hb['recalc_ultimo_erro'] = None
        except Exception as e:
            log.error('recalculo.erro_geral', error=str(e))
            _hb['recalc_ultimo_erro'] = str(e)[:300]
        finally:
            _hb['recalc_ultimo_fim'] = datetime.now(timezone.utc)
        await asyncio.sleep(interval)


# ── Loop de polling ───────────────────────────────────────────

async def _loop():
    interval = int(os.getenv('POLLING_INTERVAL', str(cfg.multiportal_polling_interval)))
    log.info('worker.iniciando', interval_s=interval)
    while _running:
        try:
            resumo = await asyncio.wait_for(_polling_todos(), timeout=_POLL_TIMEOUT_S)
            _hb['polling_ultimo_ok'] = datetime.now(timezone.utc)
            _hb['polling_ultimo_erro'] = None
            _hb['polling_posicoes'] = sum(d.get('posicoes', 0) for d in resumo.get('detalhes', []))
        except Exception as e:
            log.error('polling.erro_geral', error=str(e))
            _hb['polling_ultimo_erro'] = str(e)[:300]
        finally:
            _hb['polling_ultimo_fim'] = datetime.now(timezone.utc)
        await asyncio.sleep(interval)


# ── Watchdog: reinicia o processo se um loop morrer/travar ────

async def _loop_watchdog():
    """Se o polling ou o recálculo pararem de concluir ciclos (task morta,
    await pendurado além do timeout, bug não previsto), derruba o processo —
    o Railway reinicia o container e o motor volta sozinho. Sem isto, o
    processo ficava "vivo" com /health ok e sem ingerir dados."""
    poll_int = int(os.getenv('POLLING_INTERVAL', str(cfg.multiportal_polling_interval)))
    calc_int = int(os.getenv('CALC_INTERVAL', '3600'))
    limite_poll = max(3 * poll_int, 900) + _POLL_TIMEOUT_S
    limite_calc = 2 * calc_int + _CALC_TIMEOUT_S
    while _running:
        await asyncio.sleep(60)
        agora = datetime.now(timezone.utc)

        def atraso(chave: str) -> float:
            ultimo = _hb[chave] or _hb['iniciado_em']
            return (agora - ultimo).total_seconds()

        if atraso('polling_ultimo_fim') > limite_poll:
            log.error('watchdog.polling_travado', atraso_s=int(atraso('polling_ultimo_fim')),
                      ultimo_erro=_hb['polling_ultimo_erro'])
            os._exit(1)
        if atraso('recalc_ultimo_fim') > limite_calc:
            log.error('watchdog.recalculo_travado', atraso_s=int(atraso('recalc_ultimo_fim')),
                      ultimo_erro=_hb['recalc_ultimo_erro'])
            os._exit(1)


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
    t_dog  = asyncio.create_task(_loop_watchdog())
    yield
    _running = False
    t_poll.cancel()
    t_calc.cancel()
    t_dog.cancel()


api = FastAPI(title='Infobridge Worker', lifespan=lifespan)


@api.get('/health')
def health(response: Response):
    """Saúde REAL do motor: verifica se os loops estão concluindo ciclos.
    Retorna 503 quando degradado — configure este path como healthcheck no
    Railway para reinício automático também por aqui."""
    agora = datetime.now(timezone.utc)
    poll_int = int(os.getenv('POLLING_INTERVAL', str(cfg.multiportal_polling_interval)))
    calc_int = int(os.getenv('CALC_INTERVAL', '3600'))

    def seg(chave: str):
        return int((agora - _hb[chave]).total_seconds()) if _hb[chave] else None

    uptime = int((agora - _hb['iniciado_em']).total_seconds())
    degradado: list[str] = []
    s_poll = seg('polling_ultimo_ok')
    if s_poll is None or s_poll > max(3 * poll_int, 900):
        degradado.append('polling')
    s_calc = seg('recalc_ultimo_ok')
    if s_calc is None or s_calc > 2 * calc_int + 1800:
        degradado.append('recalculo')
    # Carência de startup: primeiro ciclo ainda pode não ter rodado.
    if uptime < max(2 * poll_int, 300):
        degradado = [d for d in degradado if d != 'polling']
    if uptime < calc_int + 600:
        degradado = [d for d in degradado if d != 'recalculo']

    if degradado:
        response.status_code = 503
    return {
        'status': 'degradado' if degradado else 'ok',
        'service': 'infobridge-worker',
        'uptime_s': uptime,
        'degradado': degradado,
        'polling': {
            'ultimo_ok_s': s_poll, 'ultimo_erro': _hb['polling_ultimo_erro'],
            'posicoes_ultimo_ciclo': _hb['polling_posicoes'], 'intervalo_s': poll_int,
        },
        'recalculo': {
            'ultimo_ok_s': s_calc, 'ultimo_erro': _hb['recalc_ultimo_erro'], 'intervalo_s': calc_int,
        },
    }


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


@api.get('/debug/frenagens')
async def debug_frenagens(placa: str = 'QOD5557'):
    """Diagnóstico de freadas do mês: indicadores atuais, códigos de evento que o
    device envia (para achar o de freada), e a maior variação de velocidade entre
    posições (mostra se o método Δv/Δt tem resolução)."""
    hoje = date.today()
    inicio = datetime(hoje.year, hoje.month, 1)
    db = await asyncpg.connect(cfg.database_url)
    try:
        indicadores = await db.fetch(
            """
            SELECT m.nome AS motorista, ip.frenagens_totais, ip.frenagens_bruscas,
                   ip.frenagens_alta_velocidade, ip.frenagens_por_100km, ip.km_total
            FROM   indicador_periodo ip
            JOIN   veiculos v   ON v.id = ip.veiculo_id
            LEFT JOIN motoristas m ON m.id = ip.motorista_id
            WHERE  v.placa = $1 AND ip.periodo_inicio >= $2
            """,
            placa, inicio.date(),
        )
        eventos = await db.fetch(
            """
            SELECT lt.evento_id, COUNT(*) AS n
            FROM   leitura_telemetria lt JOIN veiculos v ON v.id = lt.veiculo_id
            WHERE  v.placa = $1 AND lt.ts >= $2 AND lt.evento_id IS NOT NULL
            GROUP BY lt.evento_id ORDER BY n DESC LIMIT 25
            """,
            placa, inicio,
        )
        dv = await db.fetchrow(
            """
            WITH s AS (
              SELECT velocidade,
                     LAG(velocidade) OVER (ORDER BY ts) AS vel_ant,
                     EXTRACT(EPOCH FROM (ts - LAG(ts) OVER (ORDER BY ts))) AS dt
              FROM leitura_telemetria lt JOIN veiculos v ON v.id = lt.veiculo_id
              WHERE v.placa = $1 AND lt.ts >= $2 AND lt.velocidade IS NOT NULL
            )
            SELECT MAX(vel_ant - velocidade) AS maior_queda_kmh,
                   ROUND(AVG(dt)::numeric, 1) AS intervalo_medio_s,
                   COUNT(*) FILTER (WHERE vel_ant - velocidade > 0 AND dt > 0
                                    AND (vel_ant - velocidade)/3.6/dt >= 2.0) AS pares_desac_2ms2
            FROM s
            """,
            placa, inicio,
        )
        return {
            'placa': placa, 'mes': hoje.strftime('%Y-%m'),
            'indicadores': [dict(r) for r in indicadores],
            'evento_13654_freada_brusca': next((r['n'] for r in eventos if r['evento_id'] == 13654), 0),
            'eventos_no_mes': [{'evento_id': r['evento_id'], 'n': r['n']} for r in eventos],
            'velocidade': {
                'maior_queda_entre_posicoes_kmh': float(dv['maior_queda_kmh']) if dv and dv['maior_queda_kmh'] is not None else None,
                'intervalo_medio_s': float(dv['intervalo_medio_s']) if dv and dv['intervalo_medio_s'] is not None else None,
                'pares_com_desaceleracao_2ms2': dv['pares_desac_2ms2'] if dv else 0,
            },
        }
    finally:
        await db.close()


@api.get('/debug/ocioso')
async def debug_ocioso(placa: str = 'QOD5557'):
    """Diagnóstico do motor ocioso do mês: lista os episódios de parada com
    ignição ligada (início/fim BRT, duração, nº de leituras, RPM presente?) e
    compara o total penalizado ANTES e DEPOIS da regra de evidência de RPM —
    mostra exatamente de onde vêm as horas contabilizadas."""
    hoje = date.today()
    inicio = datetime(hoje.year, hoje.month, 1)
    brt = timezone(timedelta(hours=-3))
    TOLERANCIA = cfg.motor_ocioso_tolerancia_s

    db = await asyncpg.connect(cfg.database_url)
    try:
        rows = await db.fetch(
            """
            SELECT lt.ts, lt.velocidade, lt.ignicao, lt.is_motor_ocioso, lt.rpm,
                   lt.latitude, lt.longitude
            FROM   leitura_telemetria lt JOIN veiculos v ON v.id = lt.veiculo_id
            WHERE  v.placa = $1 AND lt.ts >= $2
            ORDER  BY lt.ts
            """,
            placa, inicio,
        )
    finally:
        await db.close()

    if not rows:
        return {'placa': placa, 'mes': hoje.strftime('%Y-%m'), 'mensagem': 'sem leituras no mês'}

    veiculo_envia_rpm = any((r['rpm'] or 0) > 0 for r in rows)

    # Mesmo limiar adaptativo do calculador: cobertura de RPM nas leituras em
    # movimento ≥80% → 3 leituras bastam como evidência; senão, 10.
    em_mov = [r for r in rows if (r['velocidade'] or 0) > 0]
    cobertura_rpm = (sum(1 for r in em_mov if (r['rpm'] or 0) > 0) / len(em_mov)) if len(em_mov) >= 50 else 0.0
    MIN_LEITURAS_EVIDENCIA = 3 if (veiculo_envia_rpm and cobertura_rpm >= 0.8) else 10

    # Reconstrói episódios exatamente como o calculador: sequências contínuas
    # de is_motor_ocioso, delta_t limitado a 600s, 1ª leitura fora da duração.
    episodios: list[dict] = []
    atual: list[tuple] = []   # (ts, delta_t, rpm)
    ant_ts = None
    for r in rows:
        dt = min((r['ts'] - ant_ts).total_seconds(), 600) if ant_ts else 0.0
        ant_ts = r['ts']
        if r['is_motor_ocioso'] is True:
            atual.append((r['ts'], dt, r['rpm'], r['latitude'], r['longitude']))
        else:
            if atual:
                episodios.append(_resumir_episodio(atual, TOLERANCIA, MIN_LEITURAS_EVIDENCIA, veiculo_envia_rpm, brt))
                atual = []
    if atual:
        episodios.append(_resumir_episodio(atual, TOLERANCIA, MIN_LEITURAS_EVIDENCIA, veiculo_envia_rpm, brt))

    pen_antes  = sum(e['penalizado_s'] for e in episodios)
    pen_depois = sum(e['penalizado_s'] for e in episodios if not e['descartado_por_rpm'])
    episodios.sort(key=lambda e: e['duracao_s'], reverse=True)

    def hm(s: float) -> str:
        m = int(round(s / 60))
        return f'{m // 60}h{m % 60:02d}'

    return {
        'placa': placa, 'mes': hoje.strftime('%Y-%m'),
        'veiculo_envia_rpm': veiculo_envia_rpm,
        'cobertura_rpm_em_movimento': round(cobertura_rpm, 3),
        'min_leituras_evidencia': MIN_LEITURAS_EVIDENCIA,
        'episodios_total': len(episodios),
        'penalizado_regra_antiga': hm(pen_antes),
        'penalizado_regra_nova':   hm(pen_depois),
        'descartado_como_motor_desligado': hm(pen_antes - pen_depois),
        'top_episodios': episodios[:40],
    }


def _resumir_episodio(leituras: list[tuple], tolerancia: int, min_evid: int,
                      envia_rpm: bool, brt: timezone) -> dict:
    duracao = sum(dt for _, dt, *_ in leituras[1:])
    com_rpm = sum(1 for _, _, rpm, *_ in leituras if (rpm or 0) > 0)
    descartado = envia_rpm and len(leituras) >= min_evid and com_rpm == 0
    pen = max(0.0, duracao - tolerancia)
    ini, fim = leituras[0][0], leituras[-1][0]
    lat, lng = leituras[0][3], leituras[0][4]
    return {
        'inicio_brt': ini.astimezone(brt).strftime('%d/%m %H:%M'),
        'fim_brt':    fim.astimezone(brt).strftime('%d/%m %H:%M'),
        'duracao_s':  int(duracao),
        'duracao':    f'{int(duracao // 3600)}h{int(duracao % 3600 // 60):02d}',
        'leituras':   len(leituras),
        'leituras_com_rpm': com_rpm,
        'penalizado_s': int(pen),
        'descartado_por_rpm': descartado,
        'posicao': [float(lat), float(lng)] if lat is not None and lng is not None else None,
    }


@api.get('/debug/rpm')
async def debug_rpm(placa: str = 'QOD5557'):
    """Distribuição de RPM do mês: cobertura, min/max/média, histograma por faixa
    e fonte — mostra se o RPM chega e como está distribuído pelas faixas."""
    hoje = date.today()
    inicio = datetime(hoje.year, hoje.month, 1)
    db = await asyncpg.connect(cfg.database_url)
    try:
        s = await db.fetchrow(
            """
            SELECT COUNT(*)                              AS leituras,
                   COUNT(lt.rpm)                         AS com_rpm,
                   MIN(lt.rpm) FILTER (WHERE lt.rpm > 0) AS min_ativo,
                   MAX(lt.rpm)                           AS maximo,
                   ROUND(AVG(lt.rpm) FILTER (WHERE lt.rpm > 0)::numeric, 0) AS media_ativo,
                   COUNT(*) FILTER (WHERE lt.rpm > 0 AND lt.rpm < 1300)          AS abaixo_verde,
                   COUNT(*) FILTER (WHERE lt.rpm >= 1300 AND lt.rpm <= 1899)     AS verde_inicial,
                   COUNT(*) FILTER (WHERE lt.rpm >= 1900 AND lt.rpm <= 2099)     AS verde_final,
                   COUNT(*) FILTER (WHERE lt.rpm >= 2100 AND lt.rpm <= 2800)     AS freio_motor,
                   COUNT(*) FILTER (WHERE lt.rpm > 2800)                         AS acima
            FROM   leitura_telemetria lt JOIN veiculos v ON v.id = lt.veiculo_id
            WHERE  v.placa = $1 AND lt.ts >= $2
            """,
            placa, inicio,
        )
        fontes = await db.fetch(
            """
            SELECT COALESCE(fonte_rpm, '(nulo)') AS k, COUNT(*) AS n
            FROM   leitura_telemetria lt JOIN veiculos v ON v.id = lt.veiculo_id
            WHERE  v.placa = $1 AND lt.ts >= $2 GROUP BY 1 ORDER BY 2 DESC
            """,
            placa, inicio,
        )
        faixas = await db.fetch(
            """
            SELECT COALESCE(faixa_rpm::text, '(nulo)') AS k, COUNT(*) AS n
            FROM   leitura_telemetria lt JOIN veiculos v ON v.id = lt.veiculo_id
            WHERE  v.placa = $1 AND lt.ts >= $2 GROUP BY 1 ORDER BY 2 DESC
            """,
            placa, inicio,
        )
        f = lambda x: float(x) if x is not None else None
        return {
            'placa': placa, 'mes': hoje.strftime('%Y-%m'),
            'leituras': s['leituras'], 'com_rpm': s['com_rpm'],
            'cobertura_pct': round(s['com_rpm'] / s['leituras'] * 100, 1) if s['leituras'] else 0,
            'rpm_min_ativo': f(s['min_ativo']), 'rpm_max': f(s['maximo']), 'rpm_media_ativo': f(s['media_ativo']),
            'histograma_rpm': {
                'abaixo_1300': s['abaixo_verde'], 'verde_1300_1899': s['verde_inicial'],
                'verde_1900_2099': s['verde_final'], 'freio_2100_2800': s['freio_motor'],
                'acima_2800': s['acima'],
            },
            'fonte_rpm': {r['k']: r['n'] for r in fontes},
            'faixa_rpm_gravada': {r['k']: r['n'] for r in faixas},
        }
    finally:
        await db.close()


@api.get('/debug/acelerador')
async def debug_acelerador(placa: str = 'QOD5557'):
    """Distribuição de perc_acelerador do mês: cobertura, min/max/média, histograma
    por faixa e a fonte — para ver se há dado real de pedal ou se vem sempre 0."""
    hoje = date.today()
    inicio = datetime(hoje.year, hoje.month, 1)
    db = await asyncpg.connect(cfg.database_url)
    try:
        s = await db.fetchrow(
            """
            SELECT COUNT(*)                                            AS leituras,
                   COUNT(lt.perc_acelerador)                           AS com_acel,
                   MIN(lt.perc_acelerador)                             AS minimo,
                   MAX(lt.perc_acelerador)                             AS maximo,
                   ROUND(AVG(lt.perc_acelerador)::numeric, 2)          AS media,
                   COUNT(*) FILTER (WHERE lt.perc_acelerador = 0)      AS zero,
                   COUNT(*) FILTER (WHERE lt.perc_acelerador > 0  AND lt.perc_acelerador <= 60) AS ate_60,
                   COUNT(*) FILTER (WHERE lt.perc_acelerador > 60 AND lt.perc_acelerador <= 70) AS f_61_70,
                   COUNT(*) FILTER (WHERE lt.perc_acelerador > 70)     AS acima_70
            FROM   leitura_telemetria lt JOIN veiculos v ON v.id = lt.veiculo_id
            WHERE  v.placa = $1 AND lt.ts >= $2
            """,
            placa, inicio,
        )
        fontes = await db.fetch(
            """
            SELECT COALESCE(fonte_acelerador, '(nulo)') AS k, COUNT(*) AS n
            FROM   leitura_telemetria lt JOIN veiculos v ON v.id = lt.veiculo_id
            WHERE  v.placa = $1 AND lt.ts >= $2 GROUP BY 1 ORDER BY 2 DESC
            """,
            placa, inicio,
        )
        f = lambda x: float(x) if x is not None else None
        return {
            'placa': placa, 'mes': hoje.strftime('%Y-%m'),
            'leituras': s['leituras'], 'com_acelerador': s['com_acel'],
            'min': f(s['minimo']), 'max': f(s['maximo']), 'media': f(s['media']),
            'histograma': {
                'igual_a_0': s['zero'], '1_a_60_ideal': s['ate_60'],
                '61_a_70_atencao': s['f_61_70'], 'acima_70_critico': s['acima_70'],
            },
            'fonte_acelerador': {r['k']: r['n'] for r in fontes},
        }
    finally:
        await db.close()


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
