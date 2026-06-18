"""
worker_dados_novos.py

Celery task: polling de /integracao/dados_novos para todos os tenants ativos.

Fluxo por posição recebida:
  1. Extrair campos top-level  (velocidade, lat/lng, eventoId, ts …)
  2. Extrair componentes       (RPM, acelerador, odômetro, ignição …)
  3. Classificar faixas        (faixa_rpm, faixa_acelerador — via classificador.py)
  4. Detectar estados derivados (is_motor_ocioso, is_embalo)
  5. Persistir em leitura_telemetria
  6. (Opcional) Disparar task de cálculo incremental se dados suficientes
"""
from __future__ import annotations

import asyncio
from typing import Any

import asyncpg
import redis.asyncio as aioredis
import structlog

from celery_app import app as celery_app
from config    import get_settings
from ingestao.multiportal_client import MultiportalClient
from motor.classificador import Classificador

log = structlog.get_logger(__name__)
cfg = get_settings()
clf = Classificador(cfg)


# ── Helper: extrai valor de componente por lista de IDs (prioridade) ──

def extrair_componente(componentes: list[dict], *ids: int) -> str | None:
    """
    Busca o primeiro id encontrado na lista de componentes.
    Estratégia dual-track: primeiro CAN, depois OBD2, depois básico.
    """
    index = {c['id']: c.get('valor') for c in componentes}
    for cid in ids:
        val = index.get(cid)
        if val is not None and val not in ('', 'null', '0'):
            return val
    return None


def parsear_float(valor: str | None) -> float | None:
    if valor is None:
        return None
    try:
        return float(valor.replace(',', '.'))
    except (ValueError, AttributeError):
        return None


def parsear_int(valor: str | None) -> int | None:
    if valor is None:
        return None
    try:
        return int(float(valor.replace(',', '.')))
    except (ValueError, AttributeError):
        return None


# ── Processamento de uma posição ──────────────────────────────

def processar_posicao(
    veiculo_id_interno: str,
    motorista_id: str | None,
    tenant_id: str,
    pos: dict,
) -> dict | None:
    """
    Transforma um objeto posição da Multiportal no formato
    para inserção em leitura_telemetria.
    Retorna None se a posição for inválida (GPS inválido).
    """
    if not pos.get('validade', True):
        return None

    componentes: list[dict] = pos.get('componentes', [])

    # ── Campos top-level ──────────────────────────────────────
    ts_ms  = pos.get('dataEquipamento')
    if not ts_ms:
        return None

    velocidade = pos.get('velocidade')

    # ── Componentes com hierarquia dual-track ─────────────────
    ignicao_raw  = extrair_componente(componentes, cfg.comp_ignicao)
    ignicao      = ignicao_raw == '1' if ignicao_raw else None

    rpm_raw      = extrair_componente(
        componentes,
        cfg.comp_rpm_can,       # 9090 CAN
        cfg.comp_rpm_obd2,      # 9182 OBD2
        cfg.comp_rpm_basico,    # 90   básico
    )
    rpm = parsear_int(rpm_raw)

    acelerador_raw = extrair_componente(
        componentes,
        cfg.comp_acelerador_can,   # 9208 CAN
        cfg.comp_acelerador_obd2,  # 9445 OBD2
    )
    perc_acelerador = parsear_float(acelerador_raw)

    odometro_raw = extrair_componente(
        componentes,
        cfg.comp_odometro_can,   # 9088 CAN
        cfg.comp_odometro_gps,   # 10   GPS
    )
    # Fallback para campo top-level odometroGps
    if odometro_raw is None:
        odometro_km = parsear_float(str(pos.get('odometroGps', '')))
    else:
        # Remover sufixo " KM" se existir
        odometro_km = parsear_float(odometro_raw.replace(' KM', '').replace('KM', ''))

    consumo_total = parsear_float(extrair_componente(
        componentes,
        cfg.comp_consumo_total_can,   # 9202 CAN
        cfg.comp_consumo_total_obd2,  # 9443 OBD2
    ))
    consumo_inst = parsear_float(extrair_componente(
        componentes,
        cfg.comp_consumo_can,  # 9092 CAN
    ))
    embreagem_raw = extrair_componente(componentes, cfg.comp_embreagem)
    embreagem     = embreagem_raw == '1' if embreagem_raw else None

    cruise_raw  = extrair_componente(componentes, cfg.comp_cruise_ctrl)
    cruise_ctrl = cruise_raw == '1' if cruise_raw else None

    pedal_freio_raw = extrair_componente(componentes, cfg.comp_pedal_freio)
    pedal_freio     = pedal_freio_raw == '1' if pedal_freio_raw else None

    # ── Classificações derivadas ──────────────────────────────
    faixa_rpm        = clf.classificar_rpm(rpm, perc_acelerador)
    faixa_acelerador = clf.classificar_acelerador(perc_acelerador)
    is_motor_ocioso  = ignicao is True and (velocidade or 0) == 0
    is_embalo        = clf.detectar_embalo(velocidade, perc_acelerador, embreagem)

    # ── Fonte das leituras (para rastreabilidade) ─────────────
    fonte_rpm        = 'CAN' if extrair_componente(componentes, cfg.comp_rpm_can) \
                       else ('OBD2' if extrair_componente(componentes, cfg.comp_rpm_obd2) \
                       else ('BASICO' if extrair_componente(componentes, cfg.comp_rpm_basico) else None))
    fonte_acelerador = 'CAN' if extrair_componente(componentes, cfg.comp_acelerador_can) \
                       else ('OBD2' if extrair_componente(componentes, cfg.comp_acelerador_obd2) else None)

    return {
        'tenant_id':        tenant_id,
        'veiculo_id':       veiculo_id_interno,
        'motorista_id':     motorista_id,
        'ts':               ts_ms / 1000,        # Unix seconds para asyncpg
        'ts_gateway':       (pos.get('dataGateway') or 0) / 1000 or None,
        'evento_id':        pos.get('eventoId'),
        'latitude':         pos.get('latitude'),
        'longitude':        pos.get('longitude'),
        'altitude_m':       pos.get('altitude'),
        'proa':             pos.get('proa'),
        'hdop':             pos.get('hdop'),
        'satelites':        pos.get('satelites'),
        'gps_valido':       pos.get('validade', True),
        'endereco':         pos.get('endereco'),
        'velocidade':       velocidade,
        'rpm':              rpm,
        'perc_acelerador':  perc_acelerador,
        'odometro_km':      odometro_km,
        'consumo_total_l':  consumo_total,
        'consumo_inst_l':   consumo_inst,
        'ignicao':          ignicao,
        'cruise_ctrl':      cruise_ctrl,
        'pedal_freio':      pedal_freio,
        'embreagem':        embreagem,
        'faixa_rpm':        faixa_rpm,
        'faixa_acelerador': faixa_acelerador,
        'is_motor_ocioso':  is_motor_ocioso,
        'is_embalo':        is_embalo,
        'fonte_rpm':        fonte_rpm,
        'fonte_acelerador': fonte_acelerador,
    }


# ── Celery Tasks ──────────────────────────────────────────────

@celery_app.task(name='ingestao.worker_dados_novos.executar_polling_todos_tenants')
def executar_polling_todos_tenants():
    """
    Disparada pelo Celery Beat a cada N segundos.
    Busca todos os tenants ativos e dispara uma task por tenant.
    """
    asyncio.run(_polling_todos_tenants())


async def _polling_todos_tenants():
    conn = await asyncpg.connect(cfg.database_url)
    try:
        tenants = await conn.fetch(
            """
            SELECT t.id::text AS tenant_id,
                   ci.username,
                   ci.password_enc,
                   ci.appid
            FROM   tenants t
            JOIN   credencial_integracao ci ON ci.tenant_id = t.id
            WHERE  t.ativo = true AND ci.ativo = true
            """
        )
    finally:
        await conn.close()

    for tenant in tenants:
        executar_polling_tenant.delay(
            tenant_id=tenant['tenant_id'],
            username=tenant['username'],
            password_enc=tenant['password_enc'],
            appid=tenant['appid'],
        )
        log.info('polling.agendado', tenant_id=tenant['tenant_id'])


@celery_app.task(
    name='ingestao.worker_dados_novos.executar_polling_tenant',
    bind=True,
    max_retries=3,
    default_retry_delay=30,
)
def executar_polling_tenant(self, tenant_id: str, username: str,
                             password_enc: str, appid: int):
    """
    Faz o polling de /integracao/dados_novos para um tenant específico.
    Persiste as posições novas em leitura_telemetria.
    """
    try:
        asyncio.run(_processar_tenant(tenant_id, username, password_enc, appid))
    except Exception as exc:
        log.error('polling.erro', tenant_id=tenant_id, error=str(exc))
        raise self.retry(exc=exc)


async def _processar_tenant(tenant_id: str, username: str,
                             password_enc: str, appid: int):
    # A API NestJS guarda a senha em base64 (placeholder de criptografia).
    # TODO: migrar ambos os lados para Fernet/AES-256 antes de produção real.
    import base64
    password = base64.b64decode(password_enc.encode()).decode()

    redis_client = aioredis.from_url(cfg.redis_url, decode_responses=False)
    client = MultiportalClient(tenant_id, username, password, appid, redis_client)

    db = await asyncpg.connect(cfg.database_url)
    try:
        veiculos = await client.dados_novos()
        total_inseridas = 0

        for veiculo_raw in veiculos:
            id_multiportal = veiculo_raw.get('id')
            if not id_multiportal:
                continue

            # Buscar UUID interno e motorista ativo do veículo
            row = await db.fetchrow(
                """
                SELECT v.id::text AS veiculo_id,
                       fn_motorista_em(v.tenant_id, v.id, NOW())::text AS motorista_id
                FROM   veiculos v
                WHERE  v.tenant_id = $1::uuid AND v.id_multiportal = $2
                """,
                tenant_id, id_multiportal,
            )
            if not row:
                continue

            dispositivos = veiculo_raw.get('dispositivos', [])
            for disp in dispositivos:
                posicoes = disp.get('posicoes', [])
                registros = []
                for pos in posicoes:
                    r = processar_posicao(
                        row['veiculo_id'], row['motorista_id'], tenant_id, pos,
                    )
                    if r:
                        registros.append(r)

                if registros:
                    # Inserção em lote (ON CONFLICT = ignora duplicatas pelo PK)
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
                        )
                        ON CONFLICT (tenant_id, veiculo_id, ts) DO NOTHING
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
                    total_inseridas += len(registros)

        log.info('polling.concluido', tenant_id=tenant_id,
                 veiculos=len(veiculos), posicoes=total_inseridas)
    finally:
        await db.close()
        await client.close()
        await redis_client.aclose()
