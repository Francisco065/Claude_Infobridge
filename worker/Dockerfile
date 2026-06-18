FROM python:3.11-slim

# Dependências do sistema
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libpq-dev curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Instalar dependências Python
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copiar código
COPY . .
RUN chmod +x start.sh

# Usuário não-root
RUN useradd -m worker && chown -R worker:worker /app
USER worker

EXPOSE 8000

# Sobe Celery worker+beat (polling) e a FastAPI (disparo manual) juntos
CMD ["./start.sh"]
