"use client";

import { useState, useEffect, useCallback } from "react";
import {
  apiFetch, apiPost, apiPatch, apiDelete,
  salvarSessao, carregarSessao, limparSessao,
  permissoesDaSessao, ehAdminTotal, ehGestorOuAdmin,
  EMPRESA_TIPOS, type Empresa, type ResponsavelEmpresa,
} from "@/lib/api";
import LoginForm from "@/components/LoginForm";
import BotaoTrocarSenha from "@/components/BotaoTrocarSenha";

// ── Paleta / tipografia ───────────────────────────────────────
const VINHO = "#6E1414";
const AZUL = "#27508F";
const VERDE = "#16A34A";
const VERMELHO = "#C0322B";
const SANS = "'IBM Plex Sans', system-ui, sans-serif";

const tipoLabel = (t?: string) => EMPRESA_TIPOS.find((x) => x.v === t)?.label ?? t ?? "—";
const fmtCnpj = (c?: string) =>
  c && c.length === 14 ? c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : (c ?? "—");

type Veiculo = { id: string; placa?: string; modelo?: string; empresaId?: string | null };

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

const inputBase: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", background: "#FFFFFF", border: "1px solid #E2E4E9",
  borderRadius: 10, padding: "10px 12px", fontSize: 13, color: "#1F2024", fontFamily: SANS, outline: "none",
};
const labelBase: React.CSSProperties = { fontSize: 12, color: "#5A5D65", display: "block", marginBottom: 5 };

// ── Formulário (criar/editar empresa) ─────────────────────────
function FormEmpresa({
  editando, veiculos, salvando, onSalvar, onCancelar,
}: {
  editando: Empresa | null;
  veiculos: Veiculo[];
  salvando: boolean;
  onSalvar: (dados: any) => void;
  onCancelar: () => void;
}) {
  const [cnpj, setCnpj] = useState("");
  const [nome, setNome] = useState("");
  const [nomeFantasia, setNomeFantasia] = useState("");
  const [endereco, setEndereco] = useState("");
  const [representante, setRepresentante] = useState("");
  const [tipo, setTipo] = useState("outros");
  const [responsaveis, setResponsaveis] = useState<ResponsavelEmpresa[]>([]);
  const [veiculoIds, setVeiculoIds] = useState<string[]>([]);
  const [erro, setErro] = useState("");

  useEffect(() => {
    if (editando) {
      setCnpj(editando.cnpj ?? "");
      setNome(editando.nome ?? "");
      setNomeFantasia(editando.nomeFantasia ?? "");
      setEndereco(editando.endereco ?? "");
      setRepresentante(editando.representanteComercial ?? "");
      setTipo(editando.tipo ?? "outros");
      setResponsaveis(editando.responsaveis ?? []);
      setVeiculoIds((editando.veiculos ?? []).map((v) => v.id));
    } else {
      setCnpj(""); setNome(""); setNomeFantasia(""); setEndereco("");
      setRepresentante(""); setTipo("outros"); setResponsaveis([]); setVeiculoIds([]);
    }
    setErro("");
  }, [editando]);

  function addResponsavel() { setResponsaveis((r) => [...r, { nome: "", email: "", telefone: "" }]); }
  function setResp(i: number, campo: keyof ResponsavelEmpresa, val: string) {
    setResponsaveis((r) => r.map((x, idx) => (idx === i ? { ...x, [campo]: val } : x)));
  }
  function removeResp(i: number) { setResponsaveis((r) => r.filter((_, idx) => idx !== i)); }

  function toggleVeiculo(id: string) {
    setVeiculoIds((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id]));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    if (nome.trim().length < 2) { setErro("Informe o nome da empresa."); return; }
    if (cnpj && !/^\d{14}$/.test(cnpj.replace(/\D/g, ""))) { setErro("CNPJ deve ter 14 dígitos."); return; }
    const respLimpos = responsaveis.filter((r) => r.nome.trim());
    onSalvar({
      cnpj: cnpj ? cnpj.replace(/\D/g, "") : undefined,
      nome: nome.trim(),
      nomeFantasia: nomeFantasia.trim() || undefined,
      endereco: endereco.trim() || undefined,
      representanteComercial: representante.trim() || undefined,
      tipo,
      responsaveis: respLimpos,
      veiculoIds,
    });
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 13 }}>
      <h2 style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.4, textTransform: "uppercase", color: "#6B6E76", margin: 0 }}>
        {editando ? "Editar empresa" : "Nova empresa"}
      </h2>
      {erro && <div role="alert" style={{ background: "#FDF1F1", border: "1px solid #E7B0AC", borderRadius: 10, padding: 10, color: VERMELHO, fontSize: 12 }}>{erro}</div>}

      <div>
        <label style={labelBase}>Nome / Razão social <span style={{ color: VINHO }}>*</span></label>
        <input style={inputBase} value={nome} onChange={(e) => setNome(e.target.value)} required minLength={2} placeholder="Transportes Silva LTDA" />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <label style={labelBase}>CNPJ</label>
          <input style={inputBase} value={cnpj} onChange={(e) => setCnpj(e.target.value)} placeholder="00000000000000" inputMode="numeric" />
        </div>
        <div>
          <label style={labelBase}>Nome fantasia</label>
          <input style={inputBase} value={nomeFantasia} onChange={(e) => setNomeFantasia(e.target.value)} placeholder="Silva Log" />
        </div>
      </div>
      <div>
        <label style={labelBase}>Endereço</label>
        <input style={inputBase} value={endereco} onChange={(e) => setEndereco(e.target.value)} placeholder="Rua, nº, cidade/UF" />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <label style={labelBase}>Representante comercial</label>
          <input style={inputBase} value={representante} onChange={(e) => setRepresentante(e.target.value)} placeholder="Nome do representante" />
        </div>
        <div>
          <label style={labelBase}>Tipo de empresa</label>
          <select style={inputBase} value={tipo} onChange={(e) => setTipo(e.target.value)}>
            {EMPRESA_TIPOS.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
          </select>
        </div>
      </div>

      {/* Responsáveis */}
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <span style={labelBase}>Responsáveis</span>
          <button type="button" onClick={addResponsavel} style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "#F6F2F2", border: "1px solid #E7D7D7", color: VINHO, borderRadius: 8, padding: "5px 9px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: SANS }}>
            <i className="ti ti-plus" aria-hidden="true" style={{ fontSize: 13 }} />Adicionar
          </button>
        </div>
        {responsaveis.length === 0 && <p style={{ fontSize: 12, color: "#9A9DA4", margin: "0 0 4px" }}>Nenhum responsável adicionado.</p>}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {responsaveis.map((r, i) => (
            <div key={i} style={{ border: "1px solid #ECEDF1", borderRadius: 10, padding: 10, display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 7, alignItems: "center" }}>
              <input style={{ ...inputBase, padding: "8px 10px", fontSize: 12 }} value={r.nome} onChange={(e) => setResp(i, "nome", e.target.value)} placeholder="Nome" />
              <input style={{ ...inputBase, padding: "8px 10px", fontSize: 12 }} value={r.email ?? ""} onChange={(e) => setResp(i, "email", e.target.value)} placeholder="E-mail" type="email" />
              <input style={{ ...inputBase, padding: "8px 10px", fontSize: 12 }} value={r.telefone ?? ""} onChange={(e) => setResp(i, "telefone", e.target.value)} placeholder="Telefone" />
              <button type="button" onClick={() => removeResp(i)} title="Remover" style={{ background: "#FFFFFF", border: "1px solid #E7B0AC", color: VERMELHO, borderRadius: 8, padding: "8px 9px", cursor: "pointer" }}>
                <i className="ti ti-trash" aria-hidden="true" style={{ fontSize: 13 }} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Veículos vinculados */}
      <div>
        <span style={labelBase}>Veículos da empresa ({veiculoIds.length} selecionados)</span>
        <div style={{ border: "1px solid #ECEDF1", borderRadius: 10, padding: 8, maxHeight: 200, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
          {veiculos.length === 0 && <p style={{ fontSize: 12, color: "#9A9DA4", margin: 6 }}>Nenhum veículo disponível.</p>}
          {veiculos.map((v) => {
            const marcado = veiculoIds.includes(v.id);
            const deOutra = !!v.empresaId && v.empresaId !== editando?.id;
            return (
              <label key={v.id} style={{ display: "flex", alignItems: "center", gap: 9, padding: "6px 8px", borderRadius: 7, cursor: "pointer", background: marcado ? "#F6F2F2" : "transparent" }}>
                <input type="checkbox" checked={marcado} onChange={() => toggleVeiculo(v.id)} />
                <span style={{ fontSize: 13, fontWeight: 600, color: "#1F2024" }}>{v.placa || "Sem placa"}</span>
                <span style={{ fontSize: 12, color: "#8A8D96" }}>{v.modelo || ""}</span>
                {deOutra && !marcado && <span style={{ fontSize: 10, color: "#B0741A", background: "#FBF0DC", borderRadius: 5, padding: "1px 6px", marginLeft: "auto" }}>outra empresa</span>}
              </label>
            );
          })}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button disabled={salvando} style={{ flex: 1, background: VINHO, color: "#fff", borderRadius: 10, padding: 11, fontSize: 14, fontWeight: 600, border: "none", cursor: salvando ? "default" : "pointer", opacity: salvando ? 0.6 : 1, fontFamily: SANS }}>
          {salvando ? "Salvando…" : editando ? "Salvar alterações" : "Cadastrar empresa"}
        </button>
        {editando && (
          <button type="button" onClick={onCancelar} style={{ background: "#FFFFFF", border: "1px solid #DDE0E6", borderRadius: 10, padding: "11px 14px", fontSize: 13, color: "#5A5D65", cursor: "pointer", fontFamily: SANS }}>Cancelar</button>
        )}
      </div>
    </form>
  );
}

// ── Página ────────────────────────────────────────────────────
export default function EmpresasPage() {
  const [token, setToken] = useState<string | null>(null);
  const [nomeUsuario, setNomeUsuario] = useState("");
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [veiculos, setVeiculos] = useState<Veiculo[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [editando, setEditando] = useState<Empresa | null>(null);
  const [busca, setBusca] = useState("");
  const [menuAberto, setMenuAberto] = useState(false);

  const carregar = useCallback(async (tk: string) => {
    setCarregando(true); setErro("");
    try {
      const [emp, vei] = await Promise.all([
        apiFetch<Empresa[]>("/empresas", tk),
        apiFetch<{ dados: Veiculo[] }>("/veiculos?limite=200", tk),
      ]);
      setEmpresas(Array.isArray(emp) ? emp : []);
      setVeiculos(vei.dados ?? []);
    } catch (e: any) {
      const msg = e?.message ?? "Erro ao carregar empresas";
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
      if (ehAdminTotal()) carregar(sessao.token);
    }
  }, [carregar]);

  function handleLogin(tk: string, nome: string) {
    salvarSessao(tk, nome);
    setToken(tk); setNomeUsuario(nome);
    if (ehAdminTotal()) carregar(tk);
  }

  async function onSalvar(dados: any) {
    if (!token) return;
    setSalvando(true); setErro(""); setAviso("");
    try {
      if (editando) {
        await apiPatch(`/empresas/${editando.id}`, token, dados);
        setAviso(`Empresa “${dados.nome}” atualizada.`);
        setEditando(null);
      } else {
        const nova = await apiPost<Empresa>("/empresas", token, dados);
        setAviso(`Empresa “${nova.nome}” cadastrada.`);
      }
      await carregar(token);
    } catch (e: any) { setErro(e?.message ?? "Erro ao salvar empresa"); }
    finally { setSalvando(false); }
  }

  async function abrirEdicao(e: Empresa) {
    if (!token) return;
    setAviso(""); setErro("");
    try {
      // Busca detalhe (traz veículos vinculados) para preencher o form.
      const det = await apiFetch<Empresa>(`/empresas/${e.id}`, token);
      setEditando(det);
    } catch { setEditando(e); }
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function desativar(e: Empresa) {
    if (!token) return;
    if (typeof window !== "undefined" && !window.confirm(`Desativar a empresa “${e.nome}”?`)) return;
    setErro(""); setAviso("");
    try {
      await apiDelete(`/empresas/${e.id}`, token);
      setAviso(`Empresa “${e.nome}” desativada.`);
      if (editando?.id === e.id) setEditando(null);
      await carregar(token);
    } catch (err: any) { setErro(err?.message ?? "Erro ao desativar empresa"); }
  }

  if (!token) return <LoginForm onLogin={handleLogin} />;

  if (!ehAdminTotal()) {
    return (
      <div style={{ minHeight: "100vh", background: "#E9EBEF", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: SANS, padding: 24 }}>
        <div style={{ background: "#FFFFFF", border: "1px solid #E2E4E9", borderRadius: 16, padding: 32, maxWidth: 420, textAlign: "center", boxShadow: "0 12px 40px rgba(30,32,40,.10)" }}>
          <i className="ti ti-lock" aria-hidden="true" style={{ fontSize: 32, color: VINHO }} />
          <h1 style={{ fontSize: 18, fontWeight: 700, color: "#1F2024", margin: "12px 0 6px" }}>Sem acesso</h1>
          <p style={{ fontSize: 14, color: "#5A5D65", margin: "0 0 16px" }}>O cadastro de empresas é exclusivo para administradores Infobridge com acesso total.</p>
          <a href="/info-analise" style={{ color: VINHO, fontWeight: 600, fontSize: 14, textDecoration: "none" }}>Voltar ao painel</a>
        </div>
      </div>
    );
  }

  const empresasFiltradas = empresas.filter((e) => {
    if (!busca.trim()) return true;
    const b = busca.toLowerCase();
    return (e.nome ?? "").toLowerCase().includes(b)
      || (e.nomeFantasia ?? "").toLowerCase().includes(b)
      || (e.cnpj ?? "").includes(b.replace(/\D/g, ""));
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
                <div style={{ fontSize: 15, fontWeight: 700, color: "#1F2024" }}>Empresas</div>
              </div>
            </div>
            <nav style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
              <a href="/info-analise" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "#5A5D65", fontWeight: 500, padding: "8px 12px", borderRadius: 9, textDecoration: "none" }}>
                <i className="ti ti-chart-dots" aria-hidden="true" style={{ fontSize: 16 }} />Info Análise
              </a>
              <a href="/mapa-ao-vivo" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "#5A5D65", fontWeight: 500, padding: "8px 12px", borderRadius: 9, textDecoration: "none" }}>
                <i className="ti ti-map-2" aria-hidden="true" style={{ fontSize: 16 }} />Mapa ao vivo
              </a>
              {ehGestorOuAdmin() && (
                <a href="/usuarios" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "#5A5D65", fontWeight: 500, padding: "8px 12px", borderRadius: 9, textDecoration: "none" }}>
                  <i className="ti ti-users" aria-hidden="true" style={{ fontSize: 16 }} />Usuários
                </a>
              )}
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: VINHO, background: "#F6F2F2", fontWeight: 600, padding: "8px 12px", borderRadius: 9 }}>
                <i className="ti ti-building-warehouse" aria-hidden="true" style={{ fontSize: 16 }} />Empresas
              </span>
              <div style={{ position: "relative" }}>
                <button onClick={() => setMenuAberto((a) => !a)} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "#5A5D65", background: menuAberto ? "#EFF0F3" : "transparent", border: "none", fontWeight: 500, padding: "8px 12px", borderRadius: 9, cursor: "pointer", fontFamily: SANS }}>
                  <i className="ti ti-folder" aria-hidden="true" style={{ fontSize: 16 }} />Cadastros
                  <i className={`ti ${menuAberto ? "ti-chevron-up" : "ti-chevron-down"}`} aria-hidden="true" style={{ fontSize: 14, opacity: 0.7 }} />
                </button>
                {menuAberto && (
                  <div role="menu" style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 40, width: 200, background: "#FFFFFF", border: "1px solid #E7E9ED", borderRadius: 12, boxShadow: "0 14px 38px rgba(30,32,40,.16)", padding: 6 }}>
                    <a href="/cadastros" role="menuitem" style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 10px", borderRadius: 8, textDecoration: "none", color: "#33363D", fontSize: 13, fontWeight: 500 }}>
                      <i className="ti ti-id-badge-2" aria-hidden="true" style={{ fontSize: 16, color: VINHO }} />Motoristas
                    </a>
                    <a href="/cadastros?tela=vei" role="menuitem" style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 10px", borderRadius: 8, textDecoration: "none", color: "#33363D", fontSize: 13, fontWeight: 500 }}>
                      <i className="ti ti-truck" aria-hidden="true" style={{ fontSize: 16, color: AZUL }} />Veículos
                    </a>
                  </div>
                )}
              </div>
            </nav>
            {menuAberto && <div onClick={() => setMenuAberto(false)} style={{ position: "fixed", inset: 0, zIndex: 25, background: "transparent" }} />}
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

        <div style={{ background: "#F6F7F9", padding: 24, display: "grid", gridTemplateColumns: "1fr 420px", gap: 18, alignItems: "start" }}>
          {/* Lista */}
          <div>
            {erro && <div role="alert" style={{ background: "#FDF1F1", border: "1px solid #E7B0AC", borderRadius: 12, padding: 14, color: VERMELHO, fontSize: 13, marginBottom: 14 }}>{erro}</div>}
            {aviso && <div role="status" style={{ background: "#F0FAF3", border: "1px solid #B7E4C7", borderRadius: 12, padding: 14, color: VERDE, fontSize: 13, marginBottom: 14 }}>{aviso}</div>}

            <div style={{ background: "#FFFFFF", border: "1px solid #E7E9ED", borderRadius: 14, padding: 18 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
                <h2 style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.4, textTransform: "uppercase", color: "#6B6E76", margin: 0 }}>Empresas ({empresasFiltradas.length})</h2>
                <div style={{ position: "relative" }}>
                  <i className="ti ti-search" aria-hidden="true" style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", fontSize: 14, color: "#9A9DA4" }} />
                  <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar nome ou CNPJ…" style={{ ...inputBase, padding: "7px 10px 7px 28px", width: 220, fontSize: 12 }} />
                </div>
              </div>

              {carregando ? (
                <p style={{ fontSize: 13, color: "#6B6E76" }}>Carregando…</p>
              ) : empresasFiltradas.length === 0 ? (
                <p style={{ fontSize: 13, color: "#6B6E76" }}>{empresas.length === 0 ? "Nenhuma empresa cadastrada." : "Nenhuma empresa corresponde à busca."}</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {empresasFiltradas.map((e) => (
                    <div key={e.id} style={{ border: "1px solid #ECEDF1", borderRadius: 12, padding: 14, opacity: e.ativo === false ? 0.55 : 1 }}>
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 15, fontWeight: 700, color: "#1F2024" }}>{e.nome}</span>
                            <span style={{ fontSize: 10, fontWeight: 600, color: AZUL, background: "#EEF2F9", borderRadius: 6, padding: "2px 7px", textTransform: "uppercase", letterSpacing: 0.5 }}>{tipoLabel(e.tipo)}</span>
                            {e.ativo === false && <span style={{ fontSize: 10, fontWeight: 600, color: VERMELHO, background: "#FDF1F1", borderRadius: 6, padding: "2px 7px" }}>Inativa</span>}
                          </div>
                          <div style={{ fontSize: 12, color: "#8A8D96", marginTop: 3 }}>
                            {e.nomeFantasia ? `${e.nomeFantasia} · ` : ""}CNPJ {fmtCnpj(e.cnpj)}
                          </div>
                          <div style={{ fontSize: 12, color: "#6B6E76", marginTop: 6, display: "flex", gap: 14, flexWrap: "wrap" }}>
                            <span><i className="ti ti-truck" aria-hidden="true" style={{ fontSize: 13, marginRight: 4, color: AZUL }} />{e.totalVeiculos ?? 0} veículos</span>
                            <span><i className="ti ti-id-badge-2" aria-hidden="true" style={{ fontSize: 13, marginRight: 4, color: VINHO }} />{e.totalMotoristas ?? 0} motoristas</span>
                            {(e.responsaveis?.length ?? 0) > 0 && <span><i className="ti ti-user-check" aria-hidden="true" style={{ fontSize: 13, marginRight: 4 }} />{e.responsaveis.length} responsável(is)</span>}
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                          <button onClick={() => abrirEdicao(e)} title="Editar" style={{ background: "#FFFFFF", border: "1px solid #DDE0E6", borderRadius: 8, padding: "7px 9px", color: "#5A5D65", cursor: "pointer" }}>
                            <i className="ti ti-edit" aria-hidden="true" style={{ fontSize: 14 }} />
                          </button>
                          {e.ativo !== false && (
                            <button onClick={() => desativar(e)} title="Desativar" style={{ background: "#FFFFFF", border: "1px solid #E7B0AC", borderRadius: 8, padding: "7px 9px", color: VERMELHO, cursor: "pointer" }}>
                              <i className="ti ti-archive" aria-hidden="true" style={{ fontSize: 14 }} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Formulário */}
          <div style={{ background: "#FFFFFF", border: "1px solid #E7E9ED", borderRadius: 14, padding: 18, position: "sticky", top: 24 }}>
            <FormEmpresa
              editando={editando}
              veiculos={veiculos}
              salvando={salvando}
              onSalvar={onSalvar}
              onCancelar={() => setEditando(null)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
