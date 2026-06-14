"""
calculador_pontuacao.py

Calcula a pontuação gamificada (máx 1000 pts) e o ranking dos motoristas.

Regra:
  pontos_performance = (nota_desempenho / nota_max_grupo) × 600
  pontos_km          = (km_total / km_max_grupo) × 400
  pontuacao_final    = pontos_performance + pontos_km

nota_max_grupo e km_max_grupo são os maiores valores do grupo (tenant)
no mesmo período — calculados uma vez com todos os motoristas disponíveis.
"""
from __future__ import annotations

import asyncio
from datetime import date

import asyncpg
import structlog

from celery_app import app as celery_app
from config     import get_settings

log = structlog.get_logger(__name__)
cfg = get_settings()


@celery_app.task(name='motor.calculador_pontuacao.calcular_pontuacao_mensal_todos')
def calcular_pontuacao_mensal_todos():
    asyncio.run(_calcular_pontuacao_todos())


@celery_app.task(
    name='motor.calculador_pontuacao.calcular_pontuacao_tenant',
    bind=True, max_retries=2,
)
def calcular_pontuacao_tenant(
    self,
    tenant_id: str,
    periodo_inicio: str,
    periodo_fim: str,
):
    try:
        asyncio.run(_calcular_pontuacao_tenant(
            tenant_id,
            date.fromisoformat(periodo_inicio),
            date.fromisoformat(periodo_fim),
        ))
    except Exception as exc:
        log.error('motor.pontuacao.erro', tenant_id=tenant_id, error=str(exc))
        raise self.retry(exc=exc)


async def _calcular_pontuacao_todos():
    """Dispara cálculo de pontuação para todos os tenants."""
    hoje = date.today().replace(day=1)
    if hoje.month == 1:
        inicio = date(hoje.year - 1, 12, 1)
    else:
        inicio = date(hoje.year, hoje.month - 1, 1)
    import calendar
    fim = date(inicio.year, inicio.month, calendar.monthrange(inicio.year, inicio.month)[1])

    conn = await asyncpg.connect(cfg.database_url)
    try:
        tenants = await conn.fetch(
            """
            SELECT DISTINCT tenant_id::text
            FROM   indicador_periodo
            WHERE  periodo_inicio = $1 AND periodo_fim = $2
            """,
            inicio, fim,
        )
    finally:
        await conn.close()

    for t in tenants:
        calcular_pontuacao_tenant.delay(t['tenant_id'], inicio.isoformat(), fim.isoformat())


async def _calcular_pontuacao_tenant(
    tenant_id: str,
    inicio: date,
    fim: date,
):
    conn = await asyncpg.connect(cfg.database_url)
    try:
        # Buscar todos os indicadores do grupo (tenant + período)
        indicadores = await conn.fetch(
            """
            SELECT motorista_id::text, nota_desempenho, km_total
            FROM   indicador_periodo
            WHERE  tenant_id = $1::uuid
              AND  periodo_inicio = $2 AND periodo_fim = $3
              AND  nota_desempenho IS NOT NULL
            ORDER BY nota_desempenho DESC
            """,
            tenant_id, inicio, fim,
        )

        if not indicadores:
            log.warning('motor.pontuacao.sem_indicadores', tenant_id=tenant_id)
            return

        # Referências do grupo (máximos)
        nota_max = max(float(r['nota_desempenho'] or 0) for r in indicadores)
        km_max   = max(float(r['km_total'] or 0) for r in indicadores)
        total    = len(indicadores)

        # Calcular e inserir pontuação para cada motorista
        for posicao, row in enumerate(indicadores, start=1):
            nota   = float(row['nota_desempenho'] or 0)
            km     = float(row['km_total'] or 0)

            pontos_perf = round((nota / nota_max * cfg.peso_pontos_performance)
                                if nota_max > 0 else 0.0, 2)
            pontos_km   = round((km / km_max * cfg.peso_pontos_km)
                                if km_max > 0 else 0.0, 2)
            total_pts   = round(pontos_perf + pontos_km, 2)

            await conn.execute(
                """
                INSERT INTO pontuacao_periodo (
                    tenant_id, motorista_id,
                    periodo_inicio, periodo_fim, tipo_periodo,
                    nota_desempenho, km_total,
                    nota_max_grupo, km_max_grupo,
                    pontos_performance, pontos_km, pontuacao_final,
                    posicao_ranking, total_motoristas_grupo
                ) VALUES (
                    $1::uuid, $2::uuid, $3, $4, 'mensal',
                    $5, $6, $7, $8, $9, $10, $11, $12, $13
                )
                ON CONFLICT (tenant_id, motorista_id, periodo_inicio, periodo_fim)
                DO UPDATE SET
                    nota_max_grupo        = EXCLUDED.nota_max_grupo,
                    km_max_grupo          = EXCLUDED.km_max_grupo,
                    pontos_performance    = EXCLUDED.pontos_performance,
                    pontos_km             = EXCLUDED.pontos_km,
                    pontuacao_final       = EXCLUDED.pontuacao_final,
                    posicao_ranking       = EXCLUDED.posicao_ranking,
                    total_motoristas_grupo = EXCLUDED.total_motoristas_grupo,
                    calculado_em          = NOW()
                """,
                tenant_id, row['motorista_id'],
                inicio, fim,
                nota, km, nota_max, km_max,
                pontos_perf, pontos_km, total_pts,
                posicao, total,
            )

        log.info('motor.pontuacao.concluida', tenant_id=tenant_id,
                 total_motoristas=total, periodo=f'{inicio}/{fim}')
    finally:
        await conn.close()
