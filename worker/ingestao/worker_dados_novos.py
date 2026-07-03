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
import structlog

from config    import get_settings
from motor.classificador import Classificador

log = structlog.get_logger(__name__)
cfg = get_settings()
clf = Classificador(cfg)


# ── Helper: extrai valor de componente por lista de IDs (prioridade) ──

def extrair_componente(componentes: list[dict], *ids: int,
                       permitir_zero: bool = False) -> str | None:
    """
    Busca o primeiro id encontrado na lista de componentes.
    Estratégia dual-track: primeiro CAN, depois OBD2, depois básico.

    Por padrão descarta '0' (valor que muitos dispositivos usam para
    "componente ausente"). Use permitir_zero=True quando 0 for um valor
    legítimo do dado — ex.: pedal do acelerador solto (0%).
    """
    proibidos = ('', 'null') if permitir_zero else ('', 'null', '0')
    index = {c['id']: c.get('valor') for c in componentes}
    for cid in ids:
        val = index.get(cid)
        if val is not None and val not in proibidos:
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

    # ── Velocidade: CAN → OBD2 → GPS (campo top-level) ────────
    velocidade_raw = extrair_componente(
        componentes,
        cfg.comp_velocidade_can,   # 9089 CAN
        cfg.comp_velocidade_obd2,  # 9183 OBD2
    )
    velocidade = parsear_int(velocidade_raw)
    if velocidade is None:
        velocidade = pos.get('velocidade')   # fallback GPS/rastreador

    # ── Componentes com hierarquia dual-track ─────────────────
    # Ignição: CAN (9201) → rastreador (1)
    ignicao_raw  = extrair_componente(componentes, cfg.comp_ignicao_can, cfg.comp_ignicao)
    ignicao      = ignicao_raw == '1' if ignicao_raw else None

    rpm_raw      = extrair_componente(
        componentes,
        cfg.comp_rpm_can,       # 9090 CAN
        cfg.comp_rpm_obd2,      # 9182 OBD2
        cfg.comp_rpm_basico,    # 95   instantâneo (básico)
    )
    rpm = parsear_int(rpm_raw)

    acelerador_raw = extrair_componente(
        componentes,
        cfg.comp_acelerador_can,       # 9208 CAN
        cfg.comp_acelerador_obd2,      # 9445 OBD2
        cfg.comp_acelerador_obd2_alt,  # 9171 OBD2 (relativa) — fallback extra
        permitir_zero=True,            # pedal solto (0%) é valor legítimo, não "ausente"
    )
    perc_acelerador = parsear_float(acelerador_raw)

    # Odômetro: usar SOMENTE o CAN (9088) — o hodômetro real do veículo.
    # extrair_componente já descarta '0', então quando o CAN vem 0/ausente o valor
    # fica None e o cálculo usa a última leitura CAN válida conhecida. Não misturamos
    # com o odômetro do GPS (id 10), que tem escala totalmente diferente e fazia o
    # valor oscilar entre o hodômetro real (~972k) e a distância do GPS (~33k).
    odometro_raw = extrair_componente(componentes, cfg.comp_odometro_can)  # 9088 CAN
    odometro_km = (parsear_float(odometro_raw.replace(' KM', '').replace('KM', ''))
                   if odometro_raw else None)

    consumo_total = parsear_float(extrair_componente(
        componentes,
        cfg.comp_consumo_total_can,   # 9202 CAN
        cfg.comp_consumo_total_obd2,  # 9443 OBD2
    ))
    consumo_inst = parsear_float(extrair_componente(
        componentes,
        cfg.comp_consumo_can,  # 9092 CAN
    ))

    # Nível de combustível (%) — CAN → OBD2 → Omnicomm → genérico.
    nivel_combustivel = parsear_float(extrair_componente(
        componentes,
        cfg.comp_nivel_comb_pct_can,   # 9206 % CAN
        cfg.comp_nivel_comb_obd2,      # 9179 OBD2 (% do tanque)
        cfg.comp_nivel_comb_omnicomm,  # 9052 Omnicomm
        cfg.comp_nivel_comb_generico,  # 9167 genérico
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
    fonte_acelerador = 'CAN' if extrair_componente(componentes, cfg.comp_acelerador_can, permitir_zero=True) \
                       else ('OBD2' if extrair_componente(componentes, cfg.comp_acelerador_obd2, permitir_zero=True) \
                       else ('OBD2' if extrair_componente(componentes, cfg.comp_acelerador_obd2_alt, permitir_zero=True) else None))
    fonte_velocidade = 'CAN' if extrair_componente(componentes, cfg.comp_velocidade_can) \
                       else ('OBD2' if extrair_componente(componentes, cfg.comp_velocidade_obd2) \
                       else ('GPS' if pos.get('velocidade') is not None else None))
    fonte_combustivel = 'CAN' if extrair_componente(componentes, cfg.comp_nivel_comb_pct_can) \
                       else ('OBD2' if extrair_componente(componentes, cfg.comp_nivel_comb_obd2) \
                       else ('OMNICOMM' if extrair_componente(componentes, cfg.comp_nivel_comb_omnicomm) \
                       else ('GENERICO' if extrair_componente(componentes, cfg.comp_nivel_comb_generico) else None)))

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
        'nivel_combustivel_pct': nivel_combustivel,
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
        'fonte_velocidade': fonte_velocidade,
        'fonte_combustivel': fonte_combustivel,
    }


async def _processar_tenant(tenant_id: str, username: str,
                             password_enc: str, appid: int):
    import base64
    from ingestao.multiportal_client_simple import MultiportalClientSimple
    password = base64.b64decode(password_enc.encode()).decode()
    client = MultiportalClientSimple(cfg.multiportal_base_url, username, password, appid)

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
