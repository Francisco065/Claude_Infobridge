# Infobridge — Guia de Teste Local

## Pré-requisitos

- Docker Desktop instalado e rodando
- Make (opcional, mas facilita)
- curl e Python 3 (para os smoke tests)

---

## 1. Preparar o ambiente

```bash
# Clonar/abrir o projeto
cd infobridge

# Copiar o .env de desenvolvimento
cp .env.dev .env.dev  # já vem pronto!

# Gerar o hash bcrypt da senha do seed ANTES de subir
# (só precisa fazer uma vez — resultado vai no seed.sql)
cd api && npm install && \
  node -e "require('bcrypt').hash('Infobridge@2026',12).then(console.log)"
```

Copie o hash gerado e substitua os 3 valores de `senha_hash` no arquivo
`database/seed.sql` (são todos iguais — senha `Infobridge@2026` para todos os
usuários de dev).

---

## 2. Subir o ambiente

```bash
# Opção A — via Makefile (recomendado)
make up

# Opção B — via docker compose direto
docker compose -f docker-compose.dev.yml up -d

# Aguardar o banco ficar pronto (~30s na primeira vez)
docker compose -f docker-compose.dev.yml logs -f api
```

Quando ver `🚀 Infobridge API rodando na porta 3000` no log, está pronto.

---

## 3. Verificar o Swagger

Acesse: **http://localhost:3000/docs**

Você verá todos os endpoints documentados e pode testá-los interativamente.

---

## 4. Rodar os Smoke Tests (cURL)

```bash
# Opção A — via Makefile
make smoke

# Opção B — direto
bash scripts/test-api.sh http://localhost:3000/api/v1
```

Saída esperada:
```
🚀  Infobridge Smoke Tests  →  http://localhost:3000/api/v1
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

▶  1/8  Health check
✅ PASS GET /health
▶  2/8  Login
✅ PASS POST /auth/login
     token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  PASS: 10   FAIL: 0
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 5. Rodar os Testes E2E (Jest)

```bash
# Instalar dependências de teste (uma vez só)
cd api && npm install

# Rodar com a API já no ar
npm run test:e2e
```

---

## 6. Testar manualmente via cURL

### Login
```bash
curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@inovalogistica.com.br","senha":"Infobridge@2026"}' | python3 -m json.tool
```

### Usar o token (substitua SEU_TOKEN)
```bash
TOKEN="SEU_TOKEN_AQUI"

# Listar veículos
curl -s http://localhost:3000/api/v1/veiculos \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# Listar motoristas
curl -s http://localhost:3000/api/v1/motoristas \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# Criar usuário
curl -s -X POST http://localhost:3000/api/v1/usuarios \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"nome":"Teste","email":"teste@empresa.com","senha":"Teste@123!","perfil":"operador"}' | python3 -m json.tool
```

---

## 7. Testar a separação multi-tenant

Para confirmar que o RLS está funcionando:

```bash
# 1. Login com admin do tenant A
TOKEN_A=$(curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@inovalogistica.com.br","senha":"Infobridge@2026"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")

# 2. Criar segundo tenant via superAdmin (quando implementado)
# Por ora, inserir direto no banco:
docker compose -f docker-compose.dev.yml exec db psql -U infobridge -d infobridge_dev -c "
  INSERT INTO tenants (id, nome, plano) VALUES
    ('22222222-2222-2222-2222-000000000000', 'Empresa B Ltda', 'starter');
  INSERT INTO usuarios (tenant_id, nome, email, senha_hash, perfil, ativo)
    VALUES ('22222222-2222-2222-2222-000000000000', 'Admin B', 'admin@empresab.com',
    'HASH_AQUI', 'admin', true);
"

# 3. Com o TOKEN_A, os endpoints NUNCA retornarão dados da Empresa B
# O RLS do PostgreSQL + o TenantAwareRepository garantem isolamento duplo
```

---

## 8. Verificar logs

```bash
# Logs da API em tempo real
make logs

# Logs do banco (queries SQL)
docker compose -f docker-compose.dev.yml exec db tail -f /var/log/postgresql/postgresql*.log
```

---

## 9. Acessar o banco diretamente

```bash
make db-shell

# Dentro do psql:
\dt          -- listar tabelas
SELECT * FROM tenants;
SELECT * FROM usuarios;
SELECT count(*) FROM leitura_telemetria;
```

---

## Credenciais de desenvolvimento

| Campo      | Valor                           |
|------------|----------------------------------|
| API URL    | http://localhost:3000/api/v1    |
| Swagger    | http://localhost:3000/docs      |
| DB host    | localhost:5432                   |
| DB name    | infobridge_dev                   |
| DB user    | infobridge                       |
| DB pass    | dev_senha_123                    |
| Redis      | localhost:6379 (pass: dev_redis_123) |
| Email admin | admin@inovalogistica.com.br    |
| Senha      | Infobridge@2026                  |
| Tenant ID  | 11111111-1111-1111-1111-111111111111 |
