// Todas as chamadas passam pelo proxy Next.js /api/backend/*
// A URL do backend fica em BACKEND_URL no servidor — sem depender do build

const PROXY = "/api/backend";

// ── Persistência da sessão (token) ────────────────────────────
const AUTH_KEY = "infobridge_auth";

export type SessaoSalva = { token: string; nome: string };

export function salvarSessao(token: string, nome: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(AUTH_KEY, JSON.stringify({ token, nome }));
  } catch { /* ignora storage indisponível */ }
}

export function carregarSessao(): SessaoSalva | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(AUTH_KEY);
    return raw ? (JSON.parse(raw) as SessaoSalva) : null;
  } catch {
    return null;
  }
}

export function limparSessao() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(AUTH_KEY);
  } catch { /* ignora */ }
}

export async function apiLogin(email: string, senha: string) {
  const res = await fetch(`${PROXY}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, senha }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.mensagem ?? err?.message ?? "Credenciais inválidas");
  }

  return res.json() as Promise<{
    accessToken: string;
    usuario: { nome: string; perfil: string };
  }>;
}

export async function apiFetch<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${PROXY}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.mensagem ?? err?.message ?? `Erro ${res.status}: ${path}`);
  }
  return res.json() as Promise<T>;
}

export async function apiPost<T>(path: string, token: string, body: unknown): Promise<T> {
  const res = await fetch(`${PROXY}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.mensagem ?? err?.message ?? `Erro ${res.status}: ${path}`);
  }
  return res.json() as Promise<T>;
}

export async function apiDelete<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${PROXY}${path}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.mensagem ?? err?.message ?? `Erro ${res.status}: ${path}`);
  }
  return res.json().catch(() => ({})) as Promise<T>;
}
