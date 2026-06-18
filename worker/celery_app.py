from celery import Celery
from celery.schedules import crontab
from config import get_settings

cfg = get_settings()

app = Celery(
    'infobridge',
    broker=cfg.broker_url,
    backend=cfg.result_backend,
    include=[
        'ingestao.worker_dados_novos',
        'motor.calculador_indicadores',
        'motor.calculador_nota',
        'motor.calculador_pontuacao',
    ],
)

app.conf.update(
    task_serializer='json',
    result_serializer='json',
    accept_content=['json'],
    timezone='America/Sao_Paulo',
    enable_utc=True,
    task_acks_late=True,         # confirmar task só após execução (evita perda em crash)
    worker_prefetch_multiplier=1, # uma task por vez por worker (fair dispatch)
    task_routes={
        'ingestao.*': {'queue': 'ingestao'},
        'motor.*':    {'queue': 'motor'},
    },
)

# ── Agendamento de jobs recorrentes (Celery Beat) ──────────
app.conf.beat_schedule = {

    # Polling de dados_novos a cada 2 minutos (para todos os tenants ativos)
    # A Multiportal recomenda no mínimo 120s entre chamadas
    'polling-dados-novos': {
        'task':     'ingestao.worker_dados_novos.executar_polling_todos_tenants',
        'schedule': cfg.multiportal_polling_interval,  # segundos
        'options':  {'queue': 'ingestao'},
    },

    # Cálculo de indicadores mensais — dia 1 de cada mês às 02:00
    'indicadores-mensais': {
        'task':     'motor.calculador_indicadores.calcular_indicadores_mensais_todos',
        'schedule': crontab(day_of_month=1, hour=2, minute=0),
        'options':  {'queue': 'motor'},
    },

    # Pontuação e ranking — dia 1 às 03:00 (após indicadores estarem prontos)
    'pontuacao-mensal': {
        'task':     'motor.calculador_pontuacao.calcular_pontuacao_mensal_todos',
        'schedule': crontab(day_of_month=1, hour=3, minute=0),
        'options':  {'queue': 'motor'},
    },
}
