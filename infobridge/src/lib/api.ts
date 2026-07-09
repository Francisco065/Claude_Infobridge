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

// ── Permissões (lidas do JWT da sessão) ───────────────────────
export const TELAS = [
  { key: "info-analise", label: "Info Análise", icone: "ti-chart-dots", href: "/info-analise" },
  { key: "mapa-ao-vivo", label: "Mapa ao vivo", icone: "ti-map-2", href: "/mapa-ao-vivo" },
  { key: "cadastros", label: "Cadastros", icone: "ti-folder", href: "/cadastros" },
  { key: "usuarios", label: "Usuários", icone: "ti-users", href: "/usuarios" },
] as const;

export type Permissoes = { id?: string; acessoTotal: boolean; telas: string[]; perfil?: string; nome?: string };

export function permissoesDaSessao(): Permissoes {
  const s = carregarSessao();
  if (!s?.token) return { acessoTotal: false, telas: [] };
  try {
    const b64 = s.token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const p = JSON.parse(decodeURIComponent(escape(window.atob(b64))));
    // Token expirado: limpa a sessão e trata como não autenticado (não decide
    // UI/rotas com claims vencidos — evita "Sem acesso" enganoso e loops).
    if (p.exp && p.exp * 1000 <= Date.now()) {
      limparSessao();
      return { acessoTotal: false, telas: [] };
    }
    return {
      id: p.sub,
      acessoTotal: !!p.acessoTotal,
      telas: Array.isArray(p.telas) ? p.telas : [],
      perfil: p.perfil,
      nome: p.nome,
    };
  } catch {
    return { acessoTotal: false, telas: [] };
  }
}

// Admin do tenant e quem tem acessoTotal enxergam tudo; demais, só as telas liberadas.
export function podeAcessar(tela: string): boolean {
  const p = permissoesDaSessao();
  return p.perfil === "admin" || p.acessoTotal || p.telas.includes(tela);
}

// Href da primeira tela que o usuário pode acessar (para redirecionamento/fallback).
export function primeiraTelaPermitida(): string {
  const t = TELAS.find((x) => podeAcessar(x.key));
  return t?.href ?? "/info-analise";
}

// Sessão expirada/token inválido (401): limpa a sessão e volta à tela de login.
let _redirecionando = false;
function sessaoExpirou() {
  limparSessao();
  if (typeof window !== "undefined" && !_redirecionando) {
    _redirecionando = true;
    window.location.reload(); // a página remonta sem sessão → mostra o login
  }
}

export async function apiLogin(email: string, senha: string) {
  const res = await fetch(`${PROXY}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, senha }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? err?.mensagem ?? err?.message ?? "Credenciais inválidas");
  }

  return res.json() as Promise<{
    accessToken: string;
    usuario: { nome: string; perfil: string; precisaTrocarSenha?: boolean };
  }>;
}

export async function apiFetch<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${PROXY}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    if (res.status === 401) sessaoExpirou();
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? err?.mensagem ?? err?.message ?? `Erro ${res.status}: ${path}`);
  }
  return res.json() as Promise<T>;
}

// Perfil é gestor ou admin (gerencia usuários, cadastros etc.)
export function ehGestorOuAdmin(): boolean {
  const p = permissoesDaSessao().perfil;
  return p === "admin" || p === "gestor";
}

// Administrador interno Infobridge com acesso total — única condição para ver "Empresas".
export function ehAdminTotal(): boolean {
  const p = permissoesDaSessao();
  return p.perfil === "admin" && p.acessoTotal;
}

// ── Tipos de Empresa (cliente) ────────────────────────────────
export type ResponsavelEmpresa = { nome: string; email?: string; telefone?: string };

export type Empresa = {
  id: string;
  cnpj?: string;
  nome: string;
  nomeFantasia?: string;
  endereco?: string;
  cep?: string;
  logradouro?: string;
  numero?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
  representanteComercial?: string;
  tipo: "transportadora" | "embarcador" | "consultoria" | "outros";
  responsaveis: ResponsavelEmpresa[];
  ativo: boolean;
  veiculos?: { id: string; placa?: string }[];
  totalVeiculos?: number;
  totalMotoristas?: number;
};

// Valida um CNPJ real (14 dígitos + dígitos verificadores).
export function cnpjValido(valor: string): boolean {
  const c = (valor ?? "").replace(/\D/g, "");
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const calc = (base: number): number => {
    const pesos = base === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let soma = 0;
    for (let i = 0; i < base; i++) soma += parseInt(c[i], 10) * pesos[i];
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === parseInt(c[12], 10) && calc(13) === parseInt(c[13], 10);
}

export const fmtCnpj = (c?: string) =>
  c && c.replace(/\D/g, "").length === 14
    ? c.replace(/\D/g, "").replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")
    : (c ?? "—");

export const EMPRESA_TIPOS = [
  { v: "transportadora", label: "Transportadora" },
  { v: "embarcador", label: "Embarcador" },
  { v: "consultoria", label: "Consultoria" },
  { v: "outros", label: "Outros" },
] as const;

export async function apiPatch<T>(path: string, token: string, body: unknown): Promise<T> {
  const res = await fetch(`${PROXY}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    if (res.status === 401) sessaoExpirou();
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? err?.mensagem ?? err?.message ?? `Erro ${res.status}: ${path}`);
  }
  return res.json().catch(() => ({})) as Promise<T>;
}

// "Esqueci minha senha" — rota pública; define senha provisória padrão no backend.
export async function apiSolicitarReset(email: string): Promise<void> {
  await fetch(`${PROXY}/auth/solicitar-reset-senha`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
}

export async function apiPost<T>(path: string, token: string, body: unknown): Promise<T> {
  const res = await fetch(`${PROXY}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    if (res.status === 401) sessaoExpirou();
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? err?.mensagem ?? err?.message ?? `Erro ${res.status}: ${path}`);
  }
  return res.json() as Promise<T>;
}

export async function apiDelete<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${PROXY}${path}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    if (res.status === 401) sessaoExpirou();
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? err?.mensagem ?? err?.message ?? `Erro ${res.status}: ${path}`);
  }
  return res.json().catch(() => ({})) as Promise<T>;
}
