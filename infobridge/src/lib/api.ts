// Todas as chamadas passam pelo proxy Next.js /api/backend/*
// A URL do backend fica em BACKEND_URL no servidor — sem depender do build

const PROXY = "/api/backend";

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
