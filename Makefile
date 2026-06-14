# ============================================================
#  INFOBRIDGE — Makefile
#  Comandos para desenvolvimento e teste
# ============================================================

.PHONY: help up down logs seed test test-e2e smoke hash-senha lint clean

# ── Configuração ─────────────────────────────────────────────
DC      = docker compose -f docker-compose.dev.yml
DC_PROD = docker compose -f docker-compose.yml

help: ## Mostra os comandos disponíveis
	@grep -E '^[a-zA-Z_-]+:.*?##' $(MAKEFILE_LIST) | \
	awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

# ── Docker ───────────────────────────────────────────────────
up: ## Sobe o ambiente de desenvolvimento (db + redis + api)
	$(DC) up -d
	@echo ""
	@echo "✅  Ambiente DEV rodando!"
	@echo "    API:      http://localhost:3000/api/v1"
	@echo "    Swagger:  http://localhost:3000/docs"
	@echo "    DB:       postgresql://infobridge:dev_senha_123@localhost:5432/infobridge_dev"

down: ## Para e remove os containers de dev
	$(DC) down

logs: ## Exibe logs em tempo real (Ctrl+C para sair)
	$(DC) logs -f api

db-shell: ## Abre o psql no container de desenvolvimento
	$(DC) exec db psql -U infobridge -d infobridge_dev

redis-cli: ## Abre o redis-cli
	$(DC) exec redis redis-cli -a dev_redis_123

# ── Banco ────────────────────────────────────────────────────
seed: ## Aplica o seed de desenvolvimento (dados de teste)
	$(DC) exec db psql -U infobridge -d infobridge_dev -f /docker-entrypoint-initdb.d/02_seed.sql
	@echo "✅  Seed aplicado"

seed-reset: ## DANGER: apaga tudo e reseed (dados de teste frescos)
	$(DC) exec db psql -U infobridge -d infobridge_dev -c \
	  "TRUNCATE tenants, usuarios, veiculos, motoristas, \
	   vinculo_motorista_veiculo CASCADE;"
	$(MAKE) seed

# ── Testes ───────────────────────────────────────────────────
smoke: ## Roda smoke tests via cURL (requer API rodando)
	@echo "🧪  Smoke tests — aguardando API estar pronta..."
	@sleep 2
	@bash scripts/test-api.sh http://localhost:3000/api/v1

test-e2e: ## Roda a suite e2e com Jest (requer API rodando)
	@cd api && npm run test:e2e

test: up smoke ## Sobe tudo e roda os smoke tests

# ── Utilitários ──────────────────────────────────────────────
hash-senha: ## Gera hash bcrypt para uma senha. Ex: make hash-senha SENHA=MinhaS@nha1
	@cd api && node -e "require('bcrypt').hash('$(SENHA)',12).then(h=>console.log(h))"

lint: ## Roda o linter no código da API
	@cd api && npm run lint

install: ## Instala dependências da API
	@cd api && npm install
	@cd worker && pip install -r requirements.txt

build: ## Faz o build de produção da API
	@cd api && npm run build

clean: ## Remove todos os containers, volumes e builds
	$(DC) down -v
	@cd api && rm -rf dist node_modules
	@echo "🗑️   Limpeza concluída"

# ── Produção ─────────────────────────────────────────────────
prod-up: ## Sobe o ambiente de produção completo
	$(DC_PROD) up -d

prod-down: ## Para produção
	$(DC_PROD) down
