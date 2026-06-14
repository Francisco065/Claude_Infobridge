"""
calculador_nota.py

Calcula a nota de desempenho (0-100) e gera a nota textual ao condutor.

Composição da Nota de Desempenho:
  Critério                     Peso   Regra
  ─────────────────────────────────────────────────────────────
  Faixa Verde                  25%    % tempo faixa verde total
  Embalo                       10%    % tempo em embalo
  Motor Ligado Parado          20%    100 - % tempo ocioso penalizado
  Acelerando acima do verde    25%    100 - % freio_motor_acelerando
  Excesso de velocidade        10%    score por janela de 1h
  ─────────────────────────────────────────────────────────────
  Soma dos pesos               90%    normalizado para 0-100 (÷ 0,90)
"""
from __future__ import annotations

import asyncio
from datetime import date
from typing import Any

import asyncpg
import structlog

from celery_app import app as celery_app
from config     import get_settings

log = structlog.get_logger(__name__)
cfg = get_settings()


# ── Celery Task ───────────────────────────────────────────────

@celery_app.task(
    name='motor.calculador_nota.calcular_nota_desempenho_task',
    bind=True, max_retries=2,
)
def calcular_nota_desempenho_task(
    self,
    tenant_id: str,
    motorista_id: str,
    veiculo_id: str,
    periodo_inicio: str,
    periodo_fim: str,
):
    try:
        asyncio.run(_calcular_e_salvar(
            tenant_id, motorista_id, veiculo_id,
            date.fromisoformat(periodo_inicio),
            date.fromisoformat(periodo_fim),
        ))
    except Exception as exc:
        log.error('motor.nota.erro', error=str(exc))
        raise self.retry(exc=exc)


# ── Cálculo da Nota ───────────────────────────────────────────

def calcular_nota_desempenho(ind: dict) -> dict:
    """
    Recebe o dicionário de indicadores do período e retorna
    os scores individuais e a nota final de desempenho.
    """

    # 1. Faixa Verde (25%) — soma das duas faixas verdes, cap 100
    score_faixa_verde = min(
        100.0,
        float(ind.get('perc_faixa_verde_inicial', 0) or 0) +
        float(ind.get('perc_faixa_verde_final', 0) or 0),
    )

    # 2. Embalo (10%) — % de tempo em embalo
    score_embalo = min(100.0, float(ind.get('perc_embalo', 0) or 0))

    # 3. Motor Ocioso (20%) — penaliza % de motor ocioso além da tolerância
    score_motor_ocioso = max(0.0, 100.0 - float(ind.get('perc_motor_ocioso', 0) or 0))

    # 4. Acelerando acima do verde (25%) — penaliza freio motor com aceleração
    score_acelerando_critico = max(
        0.0, 100.0 - float(ind.get('perc_freio_motor_acel', 0) or 0),
    )

    # 5. Excesso de velocidade (10%) — já é o % médio de posições acima de 90 km/h
    #    por janela de 1h; já descontada a tolerância de 10% no calculador_indicadores
    perc_excesso = float(ind.get('perc_excesso_velocidade', 0) or 0)
    excedente    = max(0.0, perc_excesso - cfg.excesso_tolerancia_perc)
    score_excesso_velocidade = max(0.0, 100.0 - excedente)

    # ── Composição final ──────────────────────────────────────
    soma_pesos = cfg.soma_pesos_nota  # = 0.90

    nota_bruta = (
        score_faixa_verde        * cfg.peso_faixa_verde +
        score_embalo             * cfg.peso_embalo +
        score_motor_ocioso       * cfg.peso_motor_ocioso +
        score_acelerando_critico * cfg.peso_acelerando_critico +
        score_excesso_velocidade * cfg.peso_excesso_velocidade
    )

    # Normaliza para 0-100 (divide pela soma dos pesos = 0,90)
    nota_desempenho = round(nota_bruta / soma_pesos, 2) if soma_pesos > 0 else 0.0

    return {
        'score_faixa_verde':        round(score_faixa_verde, 2),
        'score_embalo':             round(score_embalo, 2),
        'score_motor_ocioso':       round(score_motor_ocioso, 2),
        'score_acelerando_critico': round(score_acelerando_critico, 2),
        'score_excesso_velocidade': round(score_excesso_velocidade, 2),
        'nota_desempenho':          nota_desempenho,
    }


def gerar_insights(ind: dict, scores: dict, pontuacao: dict | None = None,
                   ind_anterior: dict | None = None) -> list[dict]:
    """
    Gera a lista estruturada de insights para a nota ao condutor.
    Cada insight tem: tipo, valor, mensagem.
    """
    insights = []

    # ── Consumo km/L ──────────────────────────────────────────
    kml_atual = ind.get('media_km_l')
    if kml_atual:
        if ind_anterior and ind_anterior.get('media_km_l'):
            delta = round(float(kml_atual) - float(ind_anterior['media_km_l']), 3)
            if delta > 0:
                msg = f"Sua média de consumo subiu para {kml_atual:.2f} km/L " \
                      f"(+{delta:.2f} em relação ao período anterior). Continue assim!"
            elif delta < 0:
                msg = f"Sua média de consumo caiu para {kml_atual:.2f} km/L " \
                      f"({delta:.2f} em relação ao período anterior)."
            else:
                msg = f"Sua média de consumo se manteve em {kml_atual:.2f} km/L."
        else:
            msg = f"Sua média de consumo no período foi de {kml_atual:.2f} km/L."
        insights.append({'tipo': 'consumo_kml', 'valor': float(kml_atual),
                         'delta': delta if ind_anterior else None, 'mensagem': msg})

    # ── Acelerador Crítico ────────────────────────────────────
    perc_critico = float(ind.get('perc_acel_critico', 0) or 0)
    if perc_critico > 5:
        insights.append({
            'tipo':    'acelerador_critico',
            'valor':   perc_critico,
            'mensagem': f"Você ficou {perc_critico:.1f}% do tempo com o acelerador "
                        f"na faixa crítica (acima de 70%). Isso aumenta o consumo "
                        f"e o desgaste do motor.",
        })

    # ── Freio Motor mal utilizado ─────────────────────────────
    perc_fm_acel = float(ind.get('perc_freio_motor_acel', 0) or 0)
    if perc_fm_acel > 1:
        insights.append({
            'tipo':    'freio_motor_acelerando',
            'valor':   perc_fm_acel,
            'mensagem': f"Em {perc_fm_acel:.1f}% do tempo você acelerou enquanto o "
                        f"motor estava na faixa de freio motor (2100-2800 RPM). "
                        f"Nessa faixa, solte o acelerador para economizar combustível.",
        })

    # ── Frenagens bruscas ────────────────────────────────────
    bruscas = int(ind.get('frenagens_bruscas', 0) or 0)
    alta_vel = int(ind.get('frenagens_alta_velocidade', 0) or 0)
    if bruscas > 0:
        insights.append({
            'tipo':    'frenagem_brusca',
            'valor':   bruscas,
            'mensagem': f"Foram registradas {bruscas} frenagem(ns) brusca(s) "
                        f"(desaceleração ≥ 0,30g)."
                        + (f" Destas, {alta_vel} ocorreram acima de 70 km/h." if alta_vel else ''),
        })

    # ── Motor Ligado Parado ───────────────────────────────────
    perc_ocioso = float(ind.get('perc_motor_ocioso', 0) or 0)
    if perc_ocioso > 3:
        tempo_min = round(int(ind.get('tempo_motor_ocioso_penalizado_s', 0) or 0) / 60, 1)
        insights.append({
            'tipo':    'motor_ocioso',
            'valor':   perc_ocioso,
            'mensagem': f"O motor ficou ligado parado por {tempo_min} minutos "
                        f"além da tolerância ({perc_ocioso:.1f}% do período). "
                        f"Desligue o motor em paradas longas.",
        })

    # ── Pontuação ─────────────────────────────────────────────
    if pontuacao:
        insights.append({
            'tipo':    'pontuacao',
            'valor':   float(pontuacao.get('pontuacao_final', 0) or 0),
            'mensagem': f"Sua pontuação do período foi de "
                        f"{pontuacao['pontuacao_final']:.0f} pontos "
                        f"({pontuacao['pontos_performance']:.0f} de desempenho + "
                        f"{pontuacao['pontos_km']:.0f} de km rodado).",
        })

    return insights


def montar_texto_nota(ind: dict, scores: dict, insights: list[dict]) -> str:
    """Monta o texto legível da nota ao condutor a partir dos insights."""
    linhas = [
        f"📊 Resumo do período {ind['periodo_inicio']} a {ind['periodo_fim']}:",
        f"",
        f"🔑 Nota de desempenho: {scores['nota_desempenho']:.1f}/100",
        f"",
    ]
    for insight in insights:
        linhas.append(f"• {insight['mensagem']}")
    if not insights:
        linhas.append("✅ Ótimo desempenho no período! Continue assim.")
    return '\n'.join(linhas)


# ── Persistência ──────────────────────────────────────────────

async def _calcular_e_salvar(
    tenant_id: str, motorista_id: str, veiculo_id: str,
    inicio: date, fim: date,
):
    conn = await asyncpg.connect(cfg.database_url)
    try:
        # Buscar indicadores do período
        ind_row = await conn.fetchrow(
            """
            SELECT * FROM indicador_periodo
            WHERE  tenant_id = $1::uuid AND motorista_id = $2::uuid
              AND  periodo_inicio = $3 AND periodo_fim = $4
            """,
            tenant_id, motorista_id, inicio, fim,
        )
        if not ind_row:
            log.warning('motor.nota.sem_indicador', motorista_id=motorista_id)
            return

        ind = dict(ind_row)
        scores = calcular_nota_desempenho(ind)

        # Atualizar scores e nota em indicador_periodo
        await conn.execute(
            """
            UPDATE indicador_periodo SET
                score_faixa_verde        = $1,
                score_embalo             = $2,
                score_motor_ocioso       = $3,
                score_acelerando_critico = $4,
                score_excesso_velocidade = $5,
                nota_desempenho          = $6
            WHERE tenant_id = $7::uuid AND motorista_id = $8::uuid
              AND periodo_inicio = $9 AND periodo_fim = $10
            """,
            scores['score_faixa_verde'], scores['score_embalo'],
            scores['score_motor_ocioso'], scores['score_acelerando_critico'],
            scores['score_excesso_velocidade'], scores['nota_desempenho'],
            tenant_id, motorista_id, inicio, fim,
        )

        # Buscar pontuação (pode não existir ainda — calculada depois)
        pont_row = await conn.fetchrow(
            """
            SELECT pontuacao_final, pontos_performance, pontos_km
            FROM   pontuacao_periodo
            WHERE  tenant_id = $1::uuid AND motorista_id = $2::uuid
              AND  periodo_inicio = $3 AND periodo_fim = $4
            """,
            tenant_id, motorista_id, inicio, fim,
        )

        pontuacao = dict(pont_row) if pont_row else None

        # Buscar indicador do período anterior para comparação
        # (mês anterior ao período atual)
        ind_ant_row = await conn.fetchrow(
            """
            SELECT media_km_l, nota_desempenho
            FROM   indicador_periodo
            WHERE  tenant_id = $1::uuid AND motorista_id = $2::uuid
              AND  periodo_fim < $3
            ORDER BY periodo_fim DESC LIMIT 1
            """,
            tenant_id, motorista_id, inicio,
        )
        ind_anterior = dict(ind_ant_row) if ind_ant_row else None

        insights   = gerar_insights(ind, scores, pontuacao, ind_anterior)
        texto_nota = montar_texto_nota(ind, scores, insights)

        import json
        await conn.execute(
            """
            INSERT INTO nota_gerada (
                tenant_id, motorista_id, indicador_periodo_id,
                periodo_inicio, periodo_fim, texto_nota, insights,
                nota_desempenho_anterior, media_kml_anterior,
                delta_kml, gerado_por
            ) VALUES (
                $1::uuid, $2::uuid, $3::uuid, $4, $5, $6,
                $7::jsonb, $8, $9, $10, 'template'
            )
            ON CONFLICT DO NOTHING
            """,
            tenant_id, motorista_id, ind['id'],
            inicio, fim, texto_nota,
            json.dumps(insights),
            ind_anterior.get('nota_desempenho') if ind_anterior else None,
            ind_anterior.get('media_km_l') if ind_anterior else None,
            round(float(ind.get('media_km_l', 0) or 0) -
                  float((ind_anterior or {}).get('media_km_l', 0) or 0), 3),
        )
        log.info('motor.nota.gerada', tenant_id=tenant_id, motorista_id=motorista_id,
                 nota=scores['nota_desempenho'])
    finally:
        await conn.close()
