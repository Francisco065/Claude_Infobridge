"""
main.py — Worker API (FastAPI)

Endpoints internos para:
  - Health check (monitoramento do container)
  - Disparo manual de jobs (útil para testes e reprocessamentos)
  - Status de jobs Celery

NÃO é a API pública — essa é o NestJS.
"""
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from celery_app import app as celery_app

app = FastAPI(
    title='Infobridge Worker API',
    description='Endpoints internos do worker Python',
    version='1.0.0',
    docs_url='/docs',
)


@app.get('/health')
def health():
    """Health check para o Docker/Kubernetes."""
    return {'status': 'ok', 'service': 'infobridge-worker'}


@app.get('/health/celery')
def health_celery():
    """Verifica se o Celery está conectado ao broker."""
    try:
        inspect = celery_app.control.inspect(timeout=3)
        active  = inspect.active()
        return {'status': 'ok', 'workers': list(active.keys()) if active else []}
    except Exception as e:
        raise HTTPException(status_code=503, detail=f'Celery indisponível: {e}')


# ── Disparo manual de jobs ────────────────────────────────────

class PollingRequest(BaseModel):
    tenant_id: str


@app.post('/jobs/polling/{tenant_id}')
def disparar_polling(tenant_id: str):
    """Força um polling imediato de dados_novos para o tenant informado."""
    from ingestao.worker_dados_novos import executar_polling_tenant
    # Buscar credenciais do banco (simplificado — em produção buscar do DB)
    # TODO: buscar credenciais do banco antes de disparar
    return {'status': 'agendado', 'tenant_id': tenant_id,
            'mensagem': 'Implementar busca de credenciais antes de disparar'}


class IndicadoresRequest(BaseModel):
    tenant_id:     str
    motorista_id:  str
    veiculo_id:    str
    periodo_inicio: str   # 'yyyy-MM-dd'
    periodo_fim:   str


@app.post('/jobs/indicadores')
def disparar_indicadores(req: IndicadoresRequest):
    """Dispara o cálculo de indicadores para um motorista/período específico."""
    from motor.calculador_indicadores import calcular_indicadores_periodo_task
    task = calcular_indicadores_periodo_task.delay(
        req.tenant_id, req.motorista_id, req.veiculo_id,
        req.periodo_inicio, req.periodo_fim,
    )
    return {'status': 'agendado', 'task_id': task.id}


@app.post('/jobs/pontuacao/{tenant_id}')
def disparar_pontuacao(tenant_id: str, periodo_inicio: str, periodo_fim: str):
    """Dispara o cálculo de pontuação e ranking para um tenant."""
    from motor.calculador_pontuacao import calcular_pontuacao_tenant
    task = calcular_pontuacao_tenant.delay(tenant_id, periodo_inicio, periodo_fim)
    return {'status': 'agendado', 'task_id': task.id}


@app.get('/jobs/{task_id}')
def status_job(task_id: str):
    """Retorna o status de um job Celery pelo task_id."""
    result = celery_app.AsyncResult(task_id)
    return {
        'task_id': task_id,
        'status':  result.status,
        'result':  str(result.result) if result.ready() else None,
    }
