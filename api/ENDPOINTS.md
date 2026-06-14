# Infobridge API — Mapa de Endpoints (v1.0)
Base: `POST/GET/PATCH/DELETE https://api.infobridge.com.br/api/v1/`

## Autenticação pública (sem JWT)
| Método | Endpoint                         | Descrição                                  |
|--------|----------------------------------|--------------------------------------------|
| POST   | /auth/login                      | Login → access token + refresh token       |
| POST   | /auth/refresh                    | Renovar access token via refresh token     |
| POST   | /auth/solicitar-reset-senha      | Solicita e-mail de reset (sempre 204)      |
| POST   | /auth/confirmar-reset-senha      | Redefine senha com token do e-mail         |

## Usuário autenticado (qualquer perfil)
| Método | Endpoint                         | Descrição                                  |
|--------|----------------------------------|--------------------------------------------|
| GET    | /auth/me                         | Perfil do usuário logado                   |
| POST   | /auth/logout                     | Invalida refresh token                     |
| POST   | /auth/alterar-senha              | Altera senha (requer senha atual)          |

---

## Tenants (SuperAdmin Infobridge)
Prefixo: `/admin/tenants` — requer flag `isSuperAdmin: true` no JWT

| Método | Endpoint                             | Descrição                                  |
|--------|--------------------------------------|--------------------------------------------|
| GET    | /admin/tenants                       | Lista todos os clientes (paginado)         |
| GET    | /admin/tenants/:id                   | Detalhe do cliente                         |
| POST   | /admin/tenants                       | Onboarding completo (tenant + admin + cred)|
| PATCH  | /admin/tenants/:id                   | Atualiza nome/plano                        |
| PATCH  | /admin/tenants/:id/ativar            | Ativa o cliente                            |
| PATCH  | /admin/tenants/:id/desativar         | Bloqueia acesso do cliente                 |
| POST   | /admin/tenants/:id/credencial-multiportal | Configura credenciais da API Multiportal |

---

## Usuários (perfis: admin, gestor, operador, readonly)
Prefixo: `/usuarios` — escopo do tenant do JWT

| Método | Endpoint                             | Perfil mínimo | Descrição                        |
|--------|--------------------------------------|---------------|----------------------------------|
| GET    | /usuarios                            | gestor        | Lista usuários do tenant         |
| GET    | /usuarios/:id                        | gestor        | Detalhe de usuário               |
| POST   | /usuarios                            | admin         | Cria usuário com senha temporária|
| PATCH  | /usuarios/:id                        | admin         | Atualiza nome, perfil ou status  |
| PATCH  | /usuarios/:id/redefinir-senha        | admin         | Admin redefine senha de usuário  |
| DELETE | /usuarios/:id                        | admin         | Desativa usuário (soft delete)   |

---

## Veículos
Prefixo: `/veiculos` — escopo do tenant do JWT

| Método | Endpoint               | Perfil mínimo | Descrição                                      |
|--------|------------------------|---------------|------------------------------------------------|
| GET    | /veiculos              | operador      | Lista veículos com motorista ativo             |
| GET    | /veiculos/:id          | operador      | Detalhe do veículo com motorista ativo         |
| PATCH  | /veiculos/:id          | gestor        | Atualiza benchmark de consumo e capacidade     |

Parâmetros de filtro em GET /veiculos:
  ?busca=placa_ou_modelo&tipoDispositivo=CAN&pagina=1&limite=20

---

## Motoristas
Prefixo: `/motoristas` — escopo do tenant do JWT

| Método | Endpoint                      | Perfil mínimo | Descrição                                   |
|--------|-------------------------------|---------------|---------------------------------------------|
| GET    | /motoristas                   | operador      | Lista com veículo ativo                     |
| GET    | /motoristas/:id               | operador      | Detalhe com histórico de vínculos           |
| GET    | /motoristas/:id/historico     | operador      | Histórico completo de vínculos              |
| POST   | /motoristas                   | gestor        | Cadastro manual de motorista                |
| PATCH  | /motoristas/:id               | gestor        | Atualiza dados                              |
| POST   | /motoristas/:id/vincular      | gestor        | Vincula ao veículo (fecha vínculo anterior) |
| DELETE | /motoristas/:id/vincular      | gestor        | Remove vínculo ativo com veículo            |
| DELETE | /motoristas/:id               | admin         | Desativa motorista (soft delete)            |

Parâmetros de filtro em GET /motoristas:
  ?busca=nome_ou_cpf&pagina=1&limite=20

---

## (Próximos módulos a implementar)

### Telemetria
| GET | /telemetria/:veiculoId?de=&ate= | Leituras de um veículo no período |
| GET | /telemetria/:veiculoId/ultima   | Última posição                    |

### Indicadores
| GET | /indicadores?motorista=&periodo=2026-05 | Indicadores do período |
| GET | /indicadores/:id/scores                 | Scores detalhados      |

### Pontuação / Ranking
| GET | /pontuacao?periodo=2026-05 | Ranking do tenant no período |
| GET | /pontuacao/:motoristaId    | Histórico de pontuação       |

### Notas ao Condutor
| GET  | /notas?motorista=&periodo= | Lista notas geradas          |
| GET  | /notas/:id                 | Texto completo da nota       |
| POST | /notas/:id/lida            | Marca nota como visualizada  |

---

## Padrão de Respostas

### Sucesso (lista paginada)
```json
{
  "dados": [...],
  "meta": {
    "pagina": 1,
    "limite": 20,
    "total": 54,
    "totalPaginas": 3,
    "temProxima": true,
    "temAnterior": false
  }
}
```

### Erro (todos os endpoints)
```json
{
  "statusCode": 422,
  "mensagem": "CPF '12345678901' já cadastrado no tenant",
  "erros": ["nome não deve ser vazio"],
  "timestamp": "2026-06-13T10:00:00.000Z",
  "path": "/api/v1/motoristas"
}
```

## Hierarquia de Permissões
```
isSuperAdmin  → acesso total (Infobridge)
  └── admin   → gerencia o tenant inteiro
      ├── gestor   → CRUD de veículos/motoristas, sem criar usuários
      │    └── operador   → leitura + visualização própria
      │         └── readonly  → somente leitura
```
