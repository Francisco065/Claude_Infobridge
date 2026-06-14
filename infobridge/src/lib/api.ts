const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

export async function apiLogin(email: string, senha: string) {
  const res = await fetch(`${API_URL}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, senha }),
  });
  if (!res.ok) throw new Error("Credenciais inválidas");
  return res.json() as Promise<{ accessToken: string; usuario: { nome: string; perfil: string } }>;
}

export async function apiFetch<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${API_URL}/api/v1${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Erro ${res.status}: ${path}`);
  return res.json() as Promise<T>;
}
