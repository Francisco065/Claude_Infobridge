"""
Cliente HTTP para a API Multiportal.

Responsabilidades:
  - Autenticação (handshake) com cache de token no Redis
  - Todas as chamadas de dados que o motor precisa
  - Renovação automática de token expirado
  - Retry automático (httpx + tenacity)

Referência de endpoints (API Multiportal v1.8):
  POST /seguranca/logon          → autenticação
  POST /integracao/dados_novos   → posições online (polling)
  POST /acumulados/conducao      → tempo de condução acumulado
  POST /acumulados/paradas       → paradas acumuladas
  POST /acumulados/velocidade    → excesso de velocidade
  POST /acumulados/              → acumulado geral (vel + condução + paradas)
  POST /acumulados/tempoignicaomensal  → ignição mensal
  POST /acumulados/odometromensal      → odômetro mensal
  POST /posicoes/ultimaPosicao   → última posição de todos os veículos
"""
from __future__ import annotations

import json
import time
from typing import Any

import httpx
import redis.asyncio as aioredis
import structlog

from config import get_settings

log = structlog.get_logger(__name__)
cfg = get_settings()


class MultiportalClient:
    """
    Client para a API Multiportal.
    Instanciar um por tenant — guarda credenciais do tenant.
    """

    def __init__(
        self,
        tenant_id: str,
        username: str,
        password: str,
        appid: int,
        redis_client: aioredis.Redis,
    ) -> None:
        self.tenant_id    = tenant_id
        self._username    = username
        self._password    = password
        self._appid       = appid
        self._redis       = redis_client
        self._token_key   = f'multiportal:token:{tenant_id}'
        self._base_url    = cfg.multiportal_base_url.rstrip('/')
        self._http        = httpx.AsyncClient(
            timeout=httpx.Timeout(30.0, connect=10.0),
            headers={'Content-Type': 'application/json'},
        )

    # ── Token ────────────────────────────────────────────────

    async def _get_token(self) -> str:
        """Retorna token válido do cache Redis ou autentica novamente."""
        cached = await self._redis.get(self._token_key)
        if cached:
            return cached.decode()

        log.info('multiportal.autenticando', tenant_id=self.tenant_id)
        resp = await self._http.post(
            f'{self._base_url}/seguranca/logon',
            json={
                'username':   self._username,
                'password':   self._password,
                'appid':      self._appid,
                'token':      None,
                'expiration': None,
            },
        )
        resp.raise_for_status()
        data  = resp.json()
        obj   = data['object']
        token = obj['token']

        # Calcular TTL até a expiração (campo expiration é Unix timestamp ms)
        expiration_ms = obj.get('expiration')
        ttl_s = max(60, int((expiration_ms / 1000) - time.time()) - 60) \
                if expiration_ms else 3600

        await self._redis.setex(self._token_key, ttl_s, token)
        log.info('multiportal.token_obtido', tenant_id=self.tenant_id, ttl_s=ttl_s)
        return token

    async def _headers(self) -> dict:
        return {
            'Content-Type': 'application/json',
            'token':        await self._get_token(),
        }

    async def _post(self, path: str, body: Any = None, headers_extra: dict | None = None) -> Any:
        """POST genérico com renovação automática de token em 401."""
        headers = await self._headers()
        if headers_extra:
            headers.update(headers_extra)
        try:
            resp = await self._http.post(
                f'{self._base_url}{path}',
                json=body or {},
                headers=headers,
            )
            if resp.status_code == 401:
                # Token expirou no servidor — limpa cache e tenta uma vez
                await self._redis.delete(self._token_key)
                headers = await self._headers()
                resp = await self._http.post(
                    f'{self._base_url}{path}',
                    json=body or {},
                    headers=headers,
                )
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPStatusError as e:
            log.error('multiportal.http_error', status=e.response.status_code,
                      path=path, tenant_id=self.tenant_id)
            raise
        except httpx.RequestError as e:
            log.error('multiportal.request_error', path=path, error=str(e),
                      tenant_id=self.tenant_id)
            raise

    # ── Endpoints ────────────────────────────────────────────

    async def dados_novos(self) -> list[dict]:
        """
        GET /integracao/dados_novos
        Retorna a fila de posições novas desde a última chamada.
        Chamar a cada ~120s (polling recorrente).
        """
        data = await self._post('/integracao/dados_novos')
        veiculos: list[dict] = data.get('object', [])
        log.debug('multiportal.dados_novos', tenant_id=self.tenant_id,
                  total_veiculos=len(veiculos))
        return veiculos

    async def ultima_posicao(self) -> list[dict]:
        """GET /posicoes/ultimaPosicao — cache de 3 min no servidor."""
        data = await self._post('/posicoes/ultimaPosicao')
        return data.get('object', [])

    async def acumulado_conducao(self, veiculo_id: int, mes_ano: str) -> dict:
        """
        POST /acumulados/conducao
        Retorna km rodado, tempo de condução, paradas por dia do mês.
        mes_ano: 'MM/yyyy'
        """
        data = await self._post(
            '/acumulados/conducao',
            body={'veiculoid': veiculo_id},
            headers_extra={'mesAno': mes_ano},
        )
        return data.get('object', {})

    async def acumulado_odometro_mensal(self, veiculo_id: int, mes_ano: str) -> dict:
        """POST /acumulados/odometromensal — odômetro diário do mês."""
        data = await self._post(
            '/acumulados/odometromensal',
            body={'veiculoid': veiculo_id},
            headers_extra={'mesAno': mes_ano},
        )
        return data.get('object', {})

    async def acumulado_velocidade(self, veiculo_id: int, mes_ano: str) -> dict:
        """POST /acumulados/velocidade — excesso de velocidade do mês."""
        data = await self._post(
            '/acumulados/velocidade',
            body={'veiculoid': veiculo_id},
            headers_extra={'mesAno': mes_ano},
        )
        return data.get('object', {})

    async def acumulados_geral(self, veiculo_id: int, mes_ano: str) -> dict:
        """
        POST /acumulados/
        Retorna velocidade + condução + paradas em uma única chamada.
        Preferir esse ao invés de chamadas individuais para economizar requests.
        """
        data = await self._post(
            '/acumulados/',
            body={'veiculoid': veiculo_id},
            headers_extra={'mesAno': mes_ano},
        )
        return data.get('object', {})

    async def close(self) -> None:
        await self._http.aclose()
