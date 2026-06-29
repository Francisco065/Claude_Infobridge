"use client";

import { useState, useEffect, useCallback } from "react";
import {
  apiFetch, apiPost, salvarSessao, carregarSessao, limparSessao,
  permissoesDaSessao, podeAcessar, TELAS,
} from "@/lib/api";
import LoginForm from "@/components/LoginForm";

// ── Paleta / tipografia ───────────────────────────────────────
const VINHO = "#6E1414";
const VERDE = "#16A34A";
const VERMELHO = "#C0322B";
const SANS = "'IBM Plex Sans', system-ui, sans-serif";
const MONO = "'IBM Plex Mono', ui-monospace, monospace";

const PERFIS = [
  { v: "admin", label: "Administrador" },
  { v: "gestor", label: "Gestor" },
  { v: "operador", label: "Operador" },
  { v: "readonly", label: "Somente leitura" },
];
const perfilLabel = (p?: string) => PERFIS.find((x) => x.v === p)?.label ?? p ?? "—";

type Usuario = {
  id: string;
  nome: string;
  email: string;
  perfil?: string;
  acessoTotal?: boolean;
  telas?: string[];
  ativo?: boolean;
};

const iniciais = (n?: string) =>
  n ? n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() : "—";

// Senha forte: maiúscula + número + caractere especial + 8+ (igual ao backend)
const senhaForte = (s: string) => /^(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#$%^&*]).{8,}$/.test(s);

// ── Logotipo ──────────────────────────────────────────────────
function LogoInfobridge({ height = 34 }: { height?: number }) {
  return (
    <svg height={height} viewBox="0 0 120 76" fill="none" aria-label="Infobridge">
      <g stroke={VINHO} strokeWidth="3.4" strokeLinecap="round" fill="none">
        <line x1="40" y1="10" x2="40" y2="60" /><line x1="80" y1="10" x2="80" y2="60" />
        <path d="M40 12 Q60 40 80 12" /><path d="M40 12 Q20 42 6 60" /><path d="M80 12 Q100 42 114 60" />
        <line x1="5" y1="60" x2="115" y2="60" />
      </g>
      <g fill={VINHO}>
        <rect x="52" y="40" width="16" height="14" rx="2.5" /><rect x="64" y="44" width="6" height="10" rx="1.5" />
        <circle cx="56" cy="56" r="3" /><circle cx="66" cy="56" r="3" />
      </g>
    </svg>
  );
}

// ── Página ────────────────────────────────────────────────────
export default function UsuariosPage() {
  const [token, setToken] = useState<string | null>(null);
  const [nomeUsuario, setNomeUsuario] = useState("");
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");

  // Form
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [perfil, setPerfil] = useState("operador");
  const [modoAcesso, setModoAcesso] = useState<"geral" | "personalizado">("geral");
  const [telasSel, setTelasSel] = useState<string[]>([]);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async (tk: string) => {
    setCarregando(true); setErro("");
    try {
      const res = await apiFetch<{ dados: Usuario[] }>("/usuarios?limite=100", tk);
      setUsuarios(res.dados ?? []);
    } catch (e: any) {
      const msg = e?.message ?? "Erro ao carregar usuários";
      if (/401|403/.test(msg)) { limparSessao(); setToken(null); }
      else setErro(msg);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    const sessao = carregarSessao();
    if (sessao?.token) {
      setToken(sessao.token);
      setNomeUsuario(sessao.nome);
      if (podeAcessar("usuarios")) carregar(sessao.token);
    }
  }, [carregar]);

  function handleLogin(tk: string, nome: string) {
    salvarSessao(tk, nome);
    setToken(tk); setNomeUsuario(nome);
    if (podeAcessar("usuarios")) carregar(tk);
  }

  function toggleTela(key: string) {
    setTelasSel((prev) => prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]);
  }

  async function criarUsuario(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setErro(""); setAviso("");
    if (!senhaForte(senha)) {
      setErro("Senha fraca: use 8+ caracteres com maiúscula, número e caractere especial (!@#$%^&*).");
      return;
    }
    if (modoAcesso === "personalizado" && telasSel.length === 0) {
      setErro("Escolha ao menos uma tela no acesso personalizado.");
      return;
    }
    setSalvando(true);
    try {
      const body = {
        nome, email, senha, perfil,
        acessoTotal: modoAcesso === "geral",
        telas: modoAcesso === "geral" ? [] : telasSel,
      };
      const novo = await apiPost<Usuario>("/usuarios", token, body);
      setAviso(`Usuário “${novo.nome}” criado.`);
      setNome(""); setEmail(""); setSenha(""); setPerfil("operador");
      setModoAcesso("geral"); setTelasSel([]);
      await carregar(token);
    } catch (e: any) {
      setErro(e?.message ?? "Erro ao criar usuário");
    } finally {
      setSalvando(false);
    }
  }

  if (!token) return <LoginForm onLogin={handleLogin} />;

  // Guarda de acesso
  if (!podeAcessar("usuarios")) {
    return (
      <div style={{ minHeight: "100vh", background: "#E9EBEF", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: SANS, padding: 24 }}>
        <div style={{ background: "#FFFFFF", border: "1px solid #E2E4E9", borderRadius: 16, padding: 32, maxWidth: 420, textAlign: "center", boxShadow: "0 12px 40px rgba(30,32,40,.10)" }}>
          <i className="ti ti-lock" aria-hidden="true" style={{ fontSize: 32, color: VINHO }} />
          <h1 style={{ fontSize: 18, fontWeight: 700, color: "#1F2024", margin: "12px 0 6px" }}>Sem acesso</h1>
          <p style={{ fontSize: 14, color: "#5A5D65", margin: "0 0 16px" }}>Você não tem permissão para gerenciar usuários. Fale com um administrador.</p>
          <a href="/info-analise" style={{ color: VINHO, fontWeight: 600, fontSize: 14, textDecoration: "none" }}>Voltar ao painel</a>
        </div>
      </div>
    );
  }

  const navTelas = TELAS.filter((t) => podeAcessar(t.key));
  const input: React.CSSProperties = {
    width: "100%", boxSizing: "border-box", background: "#FFFFFF", border: "1px solid #E2E4E9",
    borderRadius: 10, padding: "10px 12px", fontSize: 13, color: "#1F2024", fontFamily: SANS, outline: "none",
  };
  const label: React.CSSProperties = { fontSize: 12, color: "#5A5D65", display: "block", marginBottom: 5 };

  return (
    <div style={{ minHeight: "100vh", background: "#E9EBEF", padding: 30, fontFamily: SANS }}>
      <style>{`.ti{font-family:'tabler-icons'!important;font-style:normal}`}</style>

      <div style={{ maxWidth: 1080, margin: "0 auto", background: "#FFFFFF", border: "1px solid #E2E4E9", borderRadius: 18, overflow: "hidden", boxShadow: "0 12px 40px rgba(30,32,40,.10)" }}>
        {/* Cabeçalho */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 24px", borderBottom: "1px solid #EDEFF2", flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <LogoInfobridge height={34} />
              <div style={{ borderLeft: "1px solid #E2E4E9", paddingLeft: 12 }}>
                <div style={{ fontSize: 8, letterSpacing: 2.4, color: VINHO, textTransform: "uppercase", fontWeight: 700 }}>Infobridge</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#1F2024" }}>Usuários</div>
              </div>
            </div>
            <nav style={{ display: "flex", alignItems: "center", gap: 4 }}>
              {navTelas.map((t) => (
                <a key={t.key} href={t.href} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: t.key === "usuarios" ? VINHO : "#5A5D65", background: t.key === "usuarios" ? "#F6F2F2" : "transparent", fontWeight: t.key === "usuarios" ? 600 : 500, padding: "8px 12px", borderRadius: 9, textDecoration: "none" }}>
                  <i className={`ti ${t.icone}`} aria-hidden="true" style={{ fontSize: 16 }} />{t.label}
                </a>
              ))}
            </nav>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ width: 32, height: 32, borderRadius: "50%", background: "#F4EDED", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <i className="ti ti-user" aria-hidden="true" style={{ fontSize: 17, color: VINHO }} />
            </span>
            <span style={{ fontSize: 13, color: "#33363D", fontWeight: 500 }}>{nomeUsuario || "Administrador"}</span>
            <button onClick={() => { limparSessao(); setToken(null); }} style={{ display: "flex", alignItems: "center", gap: 6, background: "#FFFFFF", border: "1px solid #DDE0E6", borderRadius: 9, padding: "7px 12px", fontSize: 13, color: "#5A5D65", cursor: "pointer", fontFamily: SANS }}>
              <i className="ti ti-logout" aria-hidden="true" style={{ fontSize: 15 }} /> Sair
            </button>
          </div>
        </div>

        <div style={{ background: "#F6F7F9", padding: 24, display: "grid", gridTemplateColumns: "1fr 360px", gap: 18, alignItems: "start" }}>
          {/* Lista de usuários */}
          <div>
            {erro && <div role="alert" style={{ background: "#FDF1F1", border: "1px solid #E7B0AC", borderRadius: 12, padding: 14, color: VERMELHO, fontSize: 13, marginBottom: 14 }}>{erro}</div>}
            {aviso && <div role="status" style={{ background: "#F0FAF3", border: "1px solid #B7E4C7", borderRadius: 12, padding: 14, color: VERDE, fontSize: 13, marginBottom: 14 }}>{aviso}</div>}

            <div style={{ background: "#FFFFFF", border: "1px solid #E7E9ED", borderRadius: 14, padding: 18 }}>
              <h2 style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.4, textTransform: "uppercase", color: "#6B6E76", margin: "0 0 12px" }}>Usuários ({usuarios.length})</h2>
              {carregando ? (
                <p style={{ fontSize: 13, color: "#6B6E76" }}>Carregando…</p>
              ) : usuarios.length === 0 ? (
                <p style={{ fontSize: 13, color: "#6B6E76" }}>Nenhum usuário cadastrado.</p>
              ) : (
                <div>
                  {usuarios.map((u) => {
                    const acesso = u.acessoTotal
                      ? "Acesso geral"
                      : (u.telas && u.telas.length
                          ? u.telas.map((k) => TELAS.find((t) => t.key === k)?.label ?? k).join(", ")
                          : "Sem telas");
                    return (
                      <div key={u.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 4px", borderBottom: "1px solid #EEF0F3" }}>
                        <span style={{ flexShrink: 0, width: 36, height: 36, borderRadius: "50%", background: "#F4EDED", color: VINHO, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13, fontFamily: MONO }}>{iniciais(u.nome)}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 600, color: "#1F2024" }}>{u.nome}</div>
                          <div style={{ fontSize: 12, color: "#6B6E76" }}>{u.email}</div>
                          <div style={{ fontSize: 11, color: "#8A8D96", marginTop: 2 }}>
                            <i className="ti ti-eye" aria-hidden="true" style={{ fontSize: 12, marginRight: 3 }} />{acesso}
                          </div>
                        </div>
                        <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 600, color: "#6E5A14", background: "#F4EFE6", borderRadius: 999, padding: "3px 9px" }}>{perfilLabel(u.perfil)}</span>
                        <span style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: u.ativo === false ? "#94A3B8" : VERDE }}>
                          <span style={{ width: 7, height: 7, borderRadius: "50%", background: u.ativo === false ? "#94A3B8" : VERDE }} />{u.ativo === false ? "Inativo" : "Ativo"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Novo usuário */}
          <div style={{ background: "#FFFFFF", border: "1px solid #E7E9ED", borderRadius: 14, padding: 18 }}>
            <h2 style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.4, textTransform: "uppercase", color: "#6B6E76", margin: "0 0 14px", display: "flex", alignItems: "center", gap: 7 }}>
              <i className="ti ti-user-plus" aria-hidden="true" style={{ fontSize: 15, color: VINHO }} />Novo usuário
            </h2>
            <form onSubmit={criarUsuario} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label htmlFor="u-nome" style={label}>Nome <span style={{ color: VINHO }}>*</span></label>
                <input id="u-nome" style={input} value={nome} onChange={(e) => setNome(e.target.value)} required minLength={2} placeholder="Maria Souza" />
              </div>
              <div>
                <label htmlFor="u-email" style={label}>E-mail <span style={{ color: VINHO }}>*</span></label>
                <input id="u-email" type="email" autoComplete="off" style={input} value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="maria@empresa.com" />
              </div>
              <div>
                <label htmlFor="u-senha" style={label}>Senha <span style={{ color: VINHO }}>*</span></label>
                <input id="u-senha" type="password" autoComplete="new-password" style={input} value={senha} onChange={(e) => setSenha(e.target.value)} required placeholder="8+ com maiúscula, número e símbolo" />
                {senha.length > 0 && !senhaForte(senha) && <span style={{ fontSize: 11, color: VERMELHO, display: "block", marginTop: 3 }}>Senha fraca</span>}
              </div>
              <div>
                <label htmlFor="u-perfil" style={label}>Perfil</label>
                <select id="u-perfil" style={input} value={perfil} onChange={(e) => setPerfil(e.target.value)}>
                  {PERFIS.map((p) => <option key={p.v} value={p.v}>{p.label}</option>)}
                </select>
              </div>

              {/* Acesso */}
              <div>
                <span style={label}>Acesso às telas <span style={{ color: VINHO }}>*</span></span>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#33363D", cursor: "pointer" }}>
                    <input type="radio" name="acesso" checked={modoAcesso === "geral"} onChange={() => setModoAcesso("geral")} />
                    Acesso geral <span style={{ fontSize: 11, color: "#8A8D96" }}>(todas as telas)</span>
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#33363D", cursor: "pointer" }}>
                    <input type="radio" name="acesso" checked={modoAcesso === "personalizado"} onChange={() => setModoAcesso("personalizado")} />
                    Personalizado <span style={{ fontSize: 11, color: "#8A8D96" }}>(escolher telas)</span>
                  </label>
                </div>
                {modoAcesso === "personalizado" && (
                  <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 7, padding: "10px 12px", background: "#F6F7F9", borderRadius: 10, border: "1px solid #E7E9ED" }}>
                    {TELAS.map((t) => (
                      <label key={t.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#33363D", cursor: "pointer" }}>
                        <input type="checkbox" checked={telasSel.includes(t.key)} onChange={() => toggleTela(t.key)} />
                        <i className={`ti ${t.icone}`} aria-hidden="true" style={{ fontSize: 15, color: VINHO }} />{t.label}
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <button disabled={salvando} style={{ width: "100%", background: VINHO, color: "#fff", borderRadius: 10, padding: 11, fontSize: 14, fontWeight: 600, border: "none", cursor: salvando ? "default" : "pointer", opacity: salvando ? 0.6 : 1, fontFamily: SANS }}>
                {salvando ? "Criando…" : "Criar usuário"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
