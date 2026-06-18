"""
Cliente HTTP para a Multiportal sem dependência de Redis.
Token é cacheado em memória dentro da instância.
"""
from __future__ import annotations

import time
import httpx
import structlog

log = structlog.get_logger(__name__)


class MultiportalClientSimple:
    def __init__(self, base_url: str, username: str, password: str, appid: int) -> None:
        self._base_url   = base_url.rstrip('/')
        self._username   = username
        self._password   = password
        self._appid      = appid
        self._token: str | None = None
        self._token_exp: float  = 0
        self._http = httpx.AsyncClient(
            timeout=httpx.Timeout(30.0, connect=10.0),
            headers={'Content-Type': 'application/json'},
        )

    async def _get_token(self) -> str:
        if self._token and time.time() < self._token_exp:
            return self._token

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
        obj = resp.json()['object']
        self._token = obj['token']
        exp_ms = obj.get('expiration')
        self._token_exp = (exp_ms / 1000 - 60) if exp_ms else (time.time() + 3540)
        log.info('multiportal.token_obtido')
        return self._token

    async def _post(self, path: str, body: dict | None = None,
                    headers_extra: dict | None = None) -> dict:
        token = await self._get_token()
        headers = {'Content-Type': 'application/json', 'token': token}
        if headers_extra:
            headers.update(headers_extra)
        resp = await self._http.post(
            f'{self._base_url}{path}', json=body or {}, headers=headers,
        )
        if resp.status_code == 401:
            self._token = None  # força renovação
            token = await self._get_token()
            headers['token'] = token
            resp = await self._http.post(
                f'{self._base_url}{path}', json=body or {}, headers=headers,
            )
        resp.raise_for_status()
        return resp.json()

    async def dados_novos(self) -> list[dict]:
        data = await self._post('/integracao/dados_novos')
        return data.get('object', [])

    async def close(self) -> None:
        await self._http.aclose()
