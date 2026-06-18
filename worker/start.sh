#!/usr/bin/env bash
set -e

# Celery worker + beat (polling recorrente) em background.
# As filas 'ingestao' e 'motor' são consumidas pelo mesmo worker.
celery -A celery_app worker \
  --beat \
  --queues=ingestao,motor \
  --concurrency=2 \
  --loglevel="${LOG_LEVEL:-info}" &

# FastAPI (health check + disparo manual de jobs) em foreground.
# Railway injeta a porta via $PORT.
exec uvicorn main:app --host 0.0.0.0 --port "${PORT:-8000}"
