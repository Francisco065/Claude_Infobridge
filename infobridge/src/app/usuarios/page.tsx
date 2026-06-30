"use client";

import { useState, useEffect, useCallback } from "react";
import {
  apiFetch, apiPost, apiPatch, salvarSessao, carregarSessao, limparSessao,
  permissoesDaSessao, podeAcessar, ehGestorOuAdmin, ehAdminTotal, TELAS,
} from "@/lib/api";
import LoginForm from "@/components/LoginForm";
import BotaoTrocarSenha from "@/components/BotaoTrocarSenha";
import LogoInfobridge from "@/components/LogoInfobridge";
import MenuNavegacao from "@/components/MenuNavegacao";

// ── Paleta / tipografia ───────────────────────────────────────
const VINHO = "#6E1414";
const VERDE = "#16A34A";
const AZUL = "#27508F";
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
  empresaId?: string | null;
  empresaNomeFantasia?: string | null;
};

const iniciais = (n?: string) =>
  n ? n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() : "—";

const senhaForte = (s: string) => /^(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#$%^&*]).{8,}$/.test(s);

// Resumo de acesso: "Acesso geral" (admin/total) ou "X/4 telas" com tooltip.
function resumoAcesso(u: Usuario): { texto: string; titulo: string } {
  if (u.perfil === "admin" || u.acessoTotal) return { texto: "Acesso geral", titulo: "Todas as telas" };
  const labels = (u.telas ?? []).map((k) => TELAS.find((t) => t.key === k)?.label ?? k);
  return {
    texto: `${labels.length}/${TELAS.length} telas`,
    titulo: labels.length ? labels.join(", ") : "Nenhuma tela liberada",
  };
}

// ── Logotipo ──────────────────────────────────────────────────

const inputBase: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", background: "#FFFFFF", border: "1px solid #E2E4E9",
  borderRadius: 10, padding: "10px 12px", fontSize: 13, color: "#1F2024", fontFamily: SANS, outline: "none",
};
const labelBase: React.CSSProperties = { fontSize: 12, color: "#5A5D65", display: "block", marginBottom: 5 };

// ── Formulário de usuário (criar e editar) ────────────────────
function FormUsuario({ inicial, onSalvar, onCancelar, salvando, modoEdicao, empresas }: {
  inicial?: Partial<Usuario>;
  onSalvar: (dados: any) => void;
  onCancelar?: () => void;
  salvando: boolean;
  modoEdicao: boolean;
  empresas: { id: string; nome: string }[];
}) {
  const [nome, setNome] = useState(inicial?.nome ?? "");
  const [email, setEmail] = useState(inicial?.email ?? "");
  const [senha, setSenha] = useState("");
  const [perfil, setPerfil] = useState(inicial?.perfil ?? "operador");
  const [empresaId, setEmpresaId] = useState(inicial?.empresaId ?? "");
  const [modoAcesso, setModoAcesso] = useState<"geral" | "personalizado">(inicial?.acessoTotal ? "geral" : (inicial && !modoEdicao ? "geral" : (inicial?.acessoTotal === false ? "personalizado" : "geral")));
  const [telasSel, setTelasSel] = useState<string[]>(inicial?.telas ?? []);
  const [erro, setErro] = useState("");

  const toggleTela = (k: string) => setTelasSel((p) => p.includes(k) ? p.filter((x) => x !== k) : [...p, k]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    if (!modoEdicao && !senhaForte(senha)) {
      setErro("Senha fraca: 8+ caracteres com maiúscula, número e caractere especial (!@#$%^&*).");
      return;
    }
    if (modoEdicao && senha && !senhaForte(senha)) {
      setErro("Senha fraca: 8+ caracteres com maiúscula, número e caractere especial (!@#$%^&*).");
      return;
    }
    if (modoAcesso === "personalizado" && telasSel.length === 0) {
      setErro("Escolha ao menos uma tela no acesso personalizado.");
      return;
    }
    const dados: any = {
      nome, email, perfil,
      acessoTotal: modoAcesso === "geral",
      telas: modoAcesso === "geral" ? [] : telasSel,
      empresaId: empresaId || null,
    };
    if (!modoEdicao) dados.senha = senha;
    onSalvar(dados);
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {erro && <div role="alert" style={{ background: "#FDF1F1", border: "1px solid #E7B0AC", borderRadius: 10, padding: 10, color: VERMELHO, fontSize: 12 }}>{erro}</div>}
      <div>
        <label style={labelBase}>Nome <span style={{ color: VINHO }}>*</span></label>
        <input style={inputBase} value={nome} onChange={(e) => setNome(e.target.value)} required minLength={2} placeholder="Maria Souza" />
      </div>
      <div>
        <label style={labelBase}>E-mail <span style={{ color: VINHO }}>*</span></label>
        <input type="email" autoComplete="off" style={inputBase} value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="maria@empresa.com" />
      </div>
      {!modoEdicao && (
        <div>
          <label style={labelBase}>Senha <span style={{ color: VINHO }}>*</span></label>
          <input type="password" autoComplete="new-password" style={inputBase} value={senha} onChange={(e) => setSenha(e.target.value)} required placeholder="8+ com maiúscula, número e símbolo" />
          {senha.length > 0 && !senhaForte(senha) && <span style={{ fontSize: 11, color: VERMELHO, display: "block", marginTop: 3 }}>Senha fraca</span>}
        </div>
      )}
      <div>
        <label style={labelBase}>Perfil</label>
        <select style={inputBase} value={perfil} onChange={(e) => setPerfil(e.target.value)}>
          {PERFIS.map((p) => <option key={p.v} value={p.v}>{p.label}</option>)}
        </select>
      </div>
      {empresas.length > 0 && (
        <div>
          <label style={labelBase}>Empresa <span style={{ color: "#A4A7AE", fontWeight: 400 }}>(restringe os dados do usuário)</span></label>
          <select style={inputBase} value={empresaId ?? ""} onChange={(e) => setEmpresaId(e.target.value)}>
            <option value="">Sem vínculo (vê todos os dados)</option>
            {empresas.map((emp) => <option key={emp.id} value={emp.id}>{emp.nome}</option>)}
          </select>
        </div>
      )}
      <div>
        <span style={labelBase}>Acesso às telas <span style={{ color: VINHO }}>*</span></span>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#33363D", cursor: "pointer" }}>
            <input type="radio" name={`acesso-${modoEdicao}`} checked={modoAcesso === "geral"} onChange={() => setModoAcesso("geral")} />
            Acesso geral <span style={{ fontSize: 11, color: "#8A8D96" }}>(todas as telas)</span>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#33363D", cursor: "pointer" }}>
            <input type="radio" name={`acesso-${modoEdicao}`} checked={modoAcesso === "personalizado"} onChange={() => setModoAcesso("personalizado")} />
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
      <div style={{ display: "flex", gap: 8 }}>
        <button disabled={salvando} style={{ flex: 1, background: VINHO, color: "#fff", borderRadius: 10, padding: 11, fontSize: 14, fontWeight: 600, border: "none", cursor: salvando ? "default" : "pointer", opacity: salvando ? 0.6 : 1, fontFamily: SANS }}>
          {salvando ? "Salvando…" : (modoEdicao ? "Salvar alterações" : "Criar usuário")}
        </button>
        {onCancelar && (
          <button type="button" onClick={onCancelar} style={{ background: "#FFFFFF", border: "1px solid #DDE0E6", borderRadius: 10, padding: "11px 14px", fontSize: 13, color: "#5A5D65", cursor: "pointer", fontFamily: SANS }}>Cancelar</button>
        )}
      </div>
    </form>
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
  const [salvando, setSalvando] = useState(false);
  const [editando, setEditando] = useState<Usuario | null>(null);
  const [busca, setBusca] = useState("");
  const [filtroPerfil, setFiltroPerfil] = useState("");
  const [filtroAtivo, setFiltroAtivo] = useState("");
  const [cadNavAberto, setCadNavAberto] = useState(false);
  const [empresas, setEmpresas] = useState<{ id: string; nome: string; nomeFantasia?: string }[]>([]);
  const nomeEmpresa = (u: Usuario) => {
    if (u.empresaNomeFantasia) return u.empresaNomeFantasia;
    if (!u.empresaId) return null;
    const e = empresas.find((x) => x.id === u.empresaId);
    return e ? (e.nomeFantasia || e.nome) : null;
  };

  const eu = permissoesDaSessao();
  const podeGerenciar = ehGestorOuAdmin();

  const carregar = useCallback(async (tk: string) => {
    setCarregando(true); setErro("");
    try {
      const res = await apiFetch<{ dados: Usuario[] }>("/usuarios?limite=100", tk);
      setUsuarios(res.dados ?? []);
      if (ehAdminTotal()) {
        try {
          const emp = await apiFetch<{ id: string; nome: string; nomeFantasia?: string }[]>("/empresas", tk);
          setEmpresas(Array.isArray(emp) ? emp : []);
        } catch { /* silencioso */ }
      }
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

  async function criar(dados: any) {
    if (!token) return;
    setSalvando(true); setErro(""); setAviso("");
    try {
      const novo = await apiPost<Usuario>("/usuarios", token, dados);
      setAviso(`Usuário “${novo.nome}” criado.`);
      await carregar(token);
    } catch (e: any) { setErro(e?.message ?? "Erro ao criar usuário"); }
    finally { setSalvando(false); }
  }

  async function salvarEdicao(dados: any) {
    if (!token || !editando) return;
    setSalvando(true); setErro(""); setAviso("");
    try {
      await apiPatch(`/usuarios/${editando.id}`, token, dados);
      setAviso(`Usuário “${dados.nome}” atualizado.`);
      setEditando(null);
      await carregar(token);
    } catch (e: any) { setErro(e?.message ?? "Erro ao atualizar usuário"); }
    finally { setSalvando(false); }
  }

  async function alternarAtivo(u: Usuario) {
    if (!token) return;
    setErro(""); setAviso("");
    try {
      await apiPatch(`/usuarios/${u.id}`, token, { ativo: u.ativo === false });
      setAviso(`Usuário “${u.nome}” ${u.ativo === false ? "ativado" : "inativado"}.`);
      await carregar(token);
    } catch (e: any) { setErro(e?.message ?? "Erro ao alterar status"); }
  }

  if (!token) return <LoginForm onLogin={handleLogin} />;

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

  const navTelas = TELAS.filter((t) => t.key !== "usuarios" && podeAcessar(t.key));

  // Busca (nome/e-mail) + filtros (perfil, ativo/inativo)
  const q = busca.trim().toLowerCase();
  const usuariosFiltrados = usuarios.filter((u) => {
    if (q && !(`${u.nome} ${u.email}`.toLowerCase().includes(q))) return false;
    if (filtroPerfil && u.perfil !== filtroPerfil) return false;
    if (filtroAtivo === "ativo" && u.ativo === false) return false;
    if (filtroAtivo === "inativo" && u.ativo !== false) return false;
    return true;
  });

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
            <MenuNavegacao atual="usuarios" />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ width: 32, height: 32, borderRadius: "50%", background: "#F4EDED", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <i className="ti ti-user" aria-hidden="true" style={{ fontSize: 17, color: VINHO }} />
            </span>
            <span style={{ fontSize: 13, color: "#33363D", fontWeight: 500 }}>{nomeUsuario || "Administrador"}</span>
            {token && <BotaoTrocarSenha token={token} />}
            <button onClick={() => { limparSessao(); setToken(null); }} style={{ display: "flex", alignItems: "center", gap: 6, background: "#FFFFFF", border: "1px solid #DDE0E6", borderRadius: 9, padding: "7px 12px", fontSize: 13, color: "#5A5D65", cursor: "pointer", fontFamily: SANS }}>
              <i className="ti ti-logout" aria-hidden="true" style={{ fontSize: 15 }} /> Sair
            </button>
          </div>
        </div>

        <div style={{ background: "#F6F7F9", padding: 24, display: "grid", gridTemplateColumns: "1fr 360px", gap: 18, alignItems: "start" }}>
          {/* Lista */}
          <div>
            {erro && <div role="alert" style={{ background: "#FDF1F1", border: "1px solid #E7B0AC", borderRadius: 12, padding: 14, color: VERMELHO, fontSize: 13, marginBottom: 14 }}>{erro}</div>}
            {aviso && <div role="status" style={{ background: "#F0FAF3", border: "1px solid #B7E4C7", borderRadius: 12, padding: 14, color: VERDE, fontSize: 13, marginBottom: 14 }}>{aviso}</div>}

            <div style={{ background: "#FFFFFF", border: "1px solid #E7E9ED", borderRadius: 14, padding: 18 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
                <h2 style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.4, textTransform: "uppercase", color: "#6B6E76", margin: 0 }}>Usuários ({usuariosFiltrados.length})</h2>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <div style={{ position: "relative" }}>
                    <i className="ti ti-search" aria-hidden="true" style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", fontSize: 14, color: "#9A9DA4" }} />
                    <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar nome ou e-mail…" style={{ ...inputBase, padding: "7px 10px 7px 28px", width: 190, fontSize: 12 }} />
                  </div>
                  <select value={filtroPerfil} onChange={(e) => setFiltroPerfil(e.target.value)} style={{ ...inputBase, width: "auto", fontSize: 12, padding: "7px 10px" }}>
                    <option value="">Todos os perfis</option>
                    {PERFIS.map((p) => <option key={p.v} value={p.v}>{p.label}</option>)}
                  </select>
                  <select value={filtroAtivo} onChange={(e) => setFiltroAtivo(e.target.value)} style={{ ...inputBase, width: "auto", fontSize: 12, padding: "7px 10px" }}>
                    <option value="">Ativos e inativos</option>
                    <option value="ativo">Apenas ativos</option>
                    <option value="inativo">Apenas inativos</option>
                  </select>
                </div>
              </div>
              {carregando ? (
                <p style={{ fontSize: 13, color: "#6B6E76" }}>Carregando…</p>
              ) : usuariosFiltrados.length === 0 ? (
                <p style={{ fontSize: 13, color: "#6B6E76" }}>{usuarios.length === 0 ? "Nenhum usuário cadastrado." : "Nenhum usuário corresponde aos filtros."}</p>
              ) : (
                <div>
                  {usuariosFiltrados.map((u) => {
                    const a = resumoAcesso(u);
                    const inativo = u.ativo === false;
                    return (
                      <div key={u.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 4px", borderBottom: "1px solid #EEF0F3", opacity: inativo ? 0.6 : 1 }}>
                        <span style={{ flexShrink: 0, width: 36, height: 36, borderRadius: "50%", background: "#F4EDED", color: VINHO, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13, fontFamily: MONO }}>{iniciais(u.nome)}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 600, color: "#1F2024", display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                            {u.nome}
                            {nomeEmpresa(u) && (
                              <span title="Empresa vinculada" style={{ fontSize: 10.5, fontWeight: 600, color: AZUL, background: "#EEF2F9", borderRadius: 6, padding: "2px 8px", display: "inline-flex", alignItems: "center", gap: 4 }}>
                                <i className="ti ti-building-warehouse" aria-hidden="true" style={{ fontSize: 12 }} />{nomeEmpresa(u)}
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 12, color: "#6B6E76" }}>{u.email}</div>
                          <div title={a.titulo} style={{ fontSize: 11, color: "#8A8D96", marginTop: 2, cursor: "help", display: "inline-flex", alignItems: "center", gap: 3 }}>
                            <i className="ti ti-eye" aria-hidden="true" style={{ fontSize: 12 }} />{a.texto}
                          </div>
                        </div>
                        <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 600, color: "#6E5A14", background: "#F4EFE6", borderRadius: 999, padding: "3px 9px" }}>{perfilLabel(u.perfil)}</span>
                        <span style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: inativo ? "#94A3B8" : VERDE, minWidth: 56 }}>
                          <span style={{ width: 7, height: 7, borderRadius: "50%", background: inativo ? "#94A3B8" : VERDE }} />{inativo ? "Inativo" : "Ativo"}
                        </span>
                        {podeGerenciar && (
                          <div style={{ flexShrink: 0, display: "flex", gap: 4 }}>
                            <button onClick={() => { setEditando(u); setAviso(""); setErro(""); }} title="Editar" aria-label="Editar usuário" style={{ background: "#FFFFFF", border: "1px solid #E2E4E9", borderRadius: 8, padding: "6px 8px", cursor: "pointer", color: "#5A5D65", display: "flex" }}>
                              <i className="ti ti-pencil" aria-hidden="true" style={{ fontSize: 14 }} />
                            </button>
                            {u.id !== eu.id && (
                              <button onClick={() => alternarAtivo(u)} title={inativo ? "Ativar" : "Inativar"} aria-label={inativo ? "Ativar usuário" : "Inativar usuário"} style={{ background: "#FFFFFF", border: "1px solid #E2E4E9", borderRadius: 8, padding: "6px 8px", cursor: "pointer", color: inativo ? VERDE : VERMELHO, display: "flex" }}>
                                <i className={`ti ${inativo ? "ti-user-check" : "ti-user-off"}`} aria-hidden="true" style={{ fontSize: 14 }} />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Criar / Editar */}
          <div style={{ background: "#FFFFFF", border: "1px solid #E7E9ED", borderRadius: 14, padding: 18 }}>
            <h2 style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.4, textTransform: "uppercase", color: "#6B6E76", margin: "0 0 14px", display: "flex", alignItems: "center", gap: 7 }}>
              <i className={`ti ${editando ? "ti-pencil" : "ti-user-plus"}`} aria-hidden="true" style={{ fontSize: 15, color: VINHO }} />
              {editando ? `Editar: ${editando.nome}` : "Novo usuário"}
            </h2>
            {editando ? (
              <FormUsuario key={editando.id} inicial={editando} modoEdicao onSalvar={salvarEdicao} onCancelar={() => setEditando(null)} salvando={salvando} empresas={empresas} />
            ) : (
              <FormUsuario key="novo" modoEdicao={false} onSalvar={criar} salvando={salvando} empresas={empresas} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
