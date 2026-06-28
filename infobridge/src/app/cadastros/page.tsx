"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  apiLogin, apiFetch, apiPost, apiDelete,
  salvarSessao, carregarSessao, limparSessao,
} from "@/lib/api";

// ── Paleta / tipografia (mesmo sistema da Info Análise) ───────
const VINHO = "#6E1414";
const VERDE = "#16A34A";
const VERMELHO = "#C0322B";
const SANS = "'IBM Plex Sans', system-ui, sans-serif";
const MONO = "'IBM Plex Mono', ui-monospace, monospace";

// Avatares: tons suaves derivados do vinho/operação
const PALETAS = [
  { bg: "#F4EDED", cor: "#6E1414" },
  { bg: "#EAF1F0", cor: "#15803D" },
  { bg: "#EEF0F6", cor: "#3A5BA0" },
  { bg: "#F4EFE6", cor: "#9A6312" },
];

// ── Tipos (o backend pode expor o vínculo em qualquer um dos lados) ──
type Motorista = {
  id: string;
  nome: string;
  cpf?: string;
  cnh?: string;
  ativo?: boolean;
  // vínculo (qualquer um destes, conforme o backend) ─ ver PULL_REQUEST
  veiculoId?: string | null;
  placa?: string | null;
};

type Veiculo = {
  id: string;
  placa?: string;
  marca?: string;
  modelo?: string;
  frota?: string;
  // vínculo no lado do veículo (opcional)
  motoristaId?: string | null;
  motorista?: { id?: string; nome?: string } | null;
};

// ── Helpers de apresentação ───────────────────────────────────
const iniciais = (nome: string) =>
  nome.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

const modeloDe = (v?: Veiculo | null) =>
  v ? [v.marca, v.modelo].filter(Boolean).join(" ") || "Sem modelo" : "";

const cpfFmt = (cpf?: string | null) => {
  const d = (cpf ?? "").replace(/\D/g, "");
  if (d.length !== 11) return cpf || "";
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
};

// ── Logotipo Infobridge (idêntico ao da Info Análise) ─────────
function LogoInfobridge({ height = 38 }: { height?: number }) {
  return (
    <svg height={height} viewBox="0 0 120 76" fill="none" aria-label="Infobridge">
      <g stroke={VINHO} strokeWidth="3.4" strokeLinecap="round" fill="none">
        <line x1="40" y1="10" x2="40" y2="60" />
        <line x1="80" y1="10" x2="80" y2="60" />
        <path d="M40 12 Q60 40 80 12" />
        <path d="M40 12 Q20 42 6 60" />
        <path d="M80 12 Q100 42 114 60" />
        <line x1="50" y1="20" x2="50" y2="60" strokeWidth="1.6" />
        <line x1="60" y1="26" x2="60" y2="60" strokeWidth="1.6" />
        <line x1="70" y1="20" x2="70" y2="60" strokeWidth="1.6" />
        <line x1="26" y1="33" x2="26" y2="60" strokeWidth="1.6" />
        <line x1="94" y1="33" x2="94" y2="60" strokeWidth="1.6" />
        <line x1="5" y1="60" x2="115" y2="60" />
      </g>
      <g fill={VINHO}>
        <rect x="52" y="40" width="16" height="14" rx="2.5" />
        <rect x="64" y="44" width="6" height="10" rx="1.5" />
        <circle cx="56" cy="56" r="3" />
        <circle cx="66" cy="56" r="3" />
      </g>
    </svg>
  );
}

// ── Tela de login (tema claro, mesmo padrão) ──────────────────
function LoginForm({ onLogin }: { onLogin: (token: string, nome: string) => void }) {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setCarregando(true); setErro("");
    try {
      const { accessToken, usuario } = await apiLogin(email, senha);
      onLogin(accessToken, usuario.nome);
    } catch (e: any) {
      setErro(e?.message ?? "Erro ao conectar com o servidor.");
    } finally {
      setCarregando(false);
    }
  }

  const input: React.CSSProperties = {
    width: "100%", background: "#F6F7F9", border: "1px solid #E2E4E9", borderRadius: 10,
    padding: "10px 12px", fontSize: 14, color: "#1F2024", fontFamily: SANS, outline: "none",
  };

  return (
    <div style={{ minHeight: "100vh", background: "#E9EBEF", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: SANS }}>
      <div style={{ background: "#FFFFFF", border: "1px solid #E2E4E9", borderRadius: 18, boxShadow: "0 12px 40px rgba(30,32,40,.10)", padding: 32, width: "100%", maxWidth: 380 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 26 }}>
          <LogoInfobridge height={40} />
          <div style={{ borderLeft: "1px solid #E2E4E9", paddingLeft: 12 }}>
            <p style={{ fontSize: 8, letterSpacing: 2.4, color: VINHO, textTransform: "uppercase", margin: 0 }}>Infobridge</p>
            <p style={{ fontSize: 16, fontWeight: 700, color: "#1F2024", margin: "2px 0 0" }}>Cadastros</p>
          </div>
        </div>
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label htmlFor="login-email" style={{ fontSize: 12, color: "#5A5D65", display: "block", marginBottom: 5 }}>E-mail</label>
            <input id="login-email" style={input} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <label htmlFor="login-senha" style={{ fontSize: 12, color: "#5A5D65", display: "block", marginBottom: 5 }}>Senha</label>
            <input id="login-senha" style={input} type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} required />
          </div>
          {erro && <p role="alert" aria-live="assertive" style={{ color: VERMELHO, fontSize: 12, margin: 0 }}>{erro}</p>}
          <button style={{ width: "100%", background: VINHO, color: "#fff", borderRadius: 10, padding: "11px", fontSize: 14, fontWeight: 600, border: "none", cursor: "pointer", opacity: carregando ? 0.6 : 1, fontFamily: SANS }}
            disabled={carregando}>{carregando ? "Entrando..." : "Entrar"}</button>
        </form>
      </div>
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────
export default function CadastrosPage() {
  const [token, setToken] = useState<string | null>(null);
  const [nomeUsuario, setNomeUsuario] = useState("");

  const [motoristas, setMotoristas] = useState<Motorista[]>([]);
  const [veiculos, setVeiculos] = useState<Veiculo[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");

  // Form: novo motorista
  const [nome, setNome] = useState("");
  const [cpf, setCpf] = useState("");
  const [cnh, setCnh] = useState("");
  const [salvandoMoto, setSalvandoMoto] = useState(false);

  // Busca + vínculo inline por linha
  const [busca, setBusca] = useState("");
  const [vinculandoId, setVinculandoId] = useState<string | null>(null); // motorista em modo "escolher veículo"
  const [veiculoEscolhido, setVeiculoEscolhido] = useState("");
  const [ocupado, setOcupado] = useState(false); // bloqueia ações enquanto salva

  const sair = useCallback(() => { limparSessao(); setToken(null); }, []);

  const carregar = useCallback(async (tk: string) => {
    setCarregando(true); setErro("");
    try {
      const [m, v] = await Promise.all([
        apiFetch<{ dados: any[] }>("/motoristas?limite=100", tk),
        apiFetch<{ dados: any[] }>("/veiculos?limite=100", tk),
      ]);
      // A API entrega o vínculo aninhado (vinculos[0].veiculo / .motorista,
      // já filtrado para fim IS NULL). Achatamos para os campos planos que a UI lê.
      const motos: Motorista[] = (m.dados ?? []).map((mo: any) => {
        const veic = mo.vinculos?.[0]?.veiculo;
        return {
          ...mo,
          veiculoId: veic?.id ?? mo.veiculoId ?? null,
          placa: veic?.placa ?? mo.placa ?? null,
        };
      });
      const veics: Veiculo[] = (v.dados ?? []).map((ve: any) => {
        const mot = ve.vinculos?.[0]?.motorista;
        return {
          ...ve,
          motoristaId: mot?.id ?? ve.motoristaId ?? null,
          motorista: mot ? { id: mot.id, nome: mot.nome } : (ve.motorista ?? null),
        };
      });
      setMotoristas(motos);
      setVeiculos(veics);
    } catch (e: any) {
      const msg = e?.message ?? "Erro ao carregar cadastros";
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
      carregar(sessao.token);
    }
  }, [carregar]);

  function handleLogin(tk: string, nome: string) {
    salvarSessao(tk, nome);
    setToken(tk); setNomeUsuario(nome);
    carregar(tk);
  }

  // ── Vínculo motorista↔veículo, derivado dos dois lados ──────
  // O backend pode expor o vínculo no motorista (veiculoId/placa) OU no
  // veículo (motoristaId/motorista). Montamos os dois mapas de forma
  // defensiva para a UI funcionar independentemente do lado preenchido.
  const { veiculoDoMotorista, motoristaDoVeiculo } = useMemo(() => {
    const mPorId = new Map(motoristas.map((m) => [m.id, m]));
    const vPorId = new Map(veiculos.map((v) => [v.id, v]));
    const vPorPlaca = new Map(veiculos.filter((v) => v.placa).map((v) => [v.placa, v]));

    const veiculoDoMotorista = new Map<string, Veiculo>();
    const motoristaDoVeiculo = new Map<string, Motorista>();

    // Lado do motorista
    for (const m of motoristas) {
      const v = (m.veiculoId && vPorId.get(m.veiculoId)) || (m.placa && vPorPlaca.get(m.placa)) || null;
      if (v) { veiculoDoMotorista.set(m.id, v); motoristaDoVeiculo.set(v.id, m); }
    }
    // Lado do veículo (preenche o que faltou)
    for (const v of veiculos) {
      if (motoristaDoVeiculo.has(v.id)) continue;
      const mid = v.motoristaId ?? v.motorista?.id ?? null;
      const m = mid ? mPorId.get(mid) : null;
      if (m) { motoristaDoVeiculo.set(v.id, m); if (!veiculoDoMotorista.has(m.id)) veiculoDoMotorista.set(m.id, v); }
    }
    return { veiculoDoMotorista, motoristaDoVeiculo };
  }, [motoristas, veiculos]);

  const veiculosLivres = useMemo(
    () => veiculos.filter((v) => !motoristaDoVeiculo.has(v.id)),
    [veiculos, motoristaDoVeiculo]
  );

  const motoristasFiltrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return motoristas;
    const qd = q.replace(/\D/g, "");
    return motoristas.filter((m) =>
      m.nome.toLowerCase().includes(q) ||
      (qd && (m.cpf ?? "").replace(/\D/g, "").includes(qd))
    );
  }, [motoristas, busca]);

  // ── Ações ───────────────────────────────────────────────────
  async function criarMotorista(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setSalvandoMoto(true); setErro(""); setAviso("");
    try {
      const body: Record<string, string> = { nome };
      if (cpf.trim()) body.cpf = cpf.trim();
      if (cnh.trim()) body.cnh = cnh.trim();
      const novo = await apiPost<Motorista>("/motoristas", token, body);
      setAviso(`Motorista “${novo.nome}” criado.`);
      setNome(""); setCpf(""); setCnh("");
      await carregar(token);
    } catch (e: any) {
      setErro(e?.message ?? "Erro ao criar motorista");
    } finally {
      setSalvandoMoto(false);
    }
  }

  async function vincular(motorista: Motorista) {
    if (!token || !veiculoEscolhido) return;
    setOcupado(true); setErro(""); setAviso("");
    try {
      await apiPost(`/motoristas/${motorista.id}/vincular`, token, { veiculoId: veiculoEscolhido });
      const placa = veiculos.find((v) => v.id === veiculoEscolhido)?.placa ?? "veículo";
      setAviso(`${motorista.nome} vinculado ao veículo ${placa}. A telemetria a partir de agora será atribuída a ele.`);
      setVinculandoId(null); setVeiculoEscolhido("");
      await carregar(token);
    } catch (e: any) {
      setErro(e?.message ?? "Erro ao vincular");
    } finally {
      setOcupado(false);
    }
  }

  async function desvincular(motorista: Motorista) {
    if (!token) return;
    setOcupado(true); setErro(""); setAviso("");
    try {
      // DELETE /motoristas/:id/vincular  (proxy já encaminha DELETE) ─ ver PULL_REQUEST
      await apiDelete(`/motoristas/${motorista.id}/vincular`, token);
      setAviso(`${motorista.nome} desvinculado. Novas coletas não serão atribuídas a ele.`);
      await carregar(token);
    } catch (e: any) {
      setErro(e?.message ?? "Erro ao desvincular");
    } finally {
      setOcupado(false);
    }
  }

  if (!token) return <LoginForm onLogin={handleLogin} />;

  // ── Estilos reutilizados ────────────────────────────────────
  const card: React.CSSProperties = {
    background: "#FFFFFF", border: "1px solid #E7E9ED", borderRadius: 14, padding: 18,
    boxShadow: "0 1px 3px rgba(30,32,40,.04)",
  };
  const tituloSec: React.CSSProperties = {
    fontSize: 11, fontWeight: 600, letterSpacing: 1.4, textTransform: "uppercase",
    color: "#6B6E76", margin: 0, display: "flex", alignItems: "center", gap: 7,
  };
  const input: React.CSSProperties = {
    width: "100%", boxSizing: "border-box", background: "#FFFFFF", border: "1px solid #E2E4E9",
    borderRadius: 10, padding: "10px 12px", fontSize: 13, color: "#1F2024", fontFamily: SANS, outline: "none",
  };
  const contador: React.CSSProperties = {
    background: "#F1F3F6", color: "#5A5D65", fontSize: 11, fontWeight: 600, borderRadius: 999, padding: "2px 8px",
  };

  return (
    <div className="cad-page" style={{ minHeight: "100vh", background: "#E9EBEF", fontFamily: SANS }}>
      <style>{`
        .ti { font-family: 'tabler-icons' !important; font-style: normal; }
        .cad-page { padding: 30px; }
        .cad-grid { display: grid; grid-template-columns: 1fr 372px; gap: 18px; align-items: start; }
        .cad-row { display: flex; align-items: center; gap: 13px; padding: 13px 4px; border-bottom: 1px solid #EEF0F3; }
        .cad-row:last-child { border-bottom: none; }
        .cad-inp:focus { border-color: ${VINHO}; box-shadow: 0 0 0 3px rgba(110,20,20,.08); }
        @media (max-width: 880px) {
          .cad-page { padding: 14px; }
          .cad-grid { grid-template-columns: 1fr; }
          .cad-header { flex-wrap: wrap; gap: 12px; }
        }
      `}</style>

      <div style={{ maxWidth: 1120, margin: "0 auto", background: "#FFFFFF", border: "1px solid #E2E4E9", borderRadius: 18, boxShadow: "0 12px 40px rgba(30,32,40,.10)", overflow: "hidden" }}>

        {/* Cabeçalho */}
        <div className="cad-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 24px", borderBottom: "1px solid #EDEFF2" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <LogoInfobridge height={38} />
            <div style={{ borderLeft: "1px solid #E2E4E9", paddingLeft: 14 }}>
              <p style={{ fontSize: 8, letterSpacing: 2.4, color: VINHO, textTransform: "uppercase", margin: 0 }}>Infobridge</p>
              <h1 style={{ fontSize: 16, fontWeight: 700, color: "#1F2024", margin: "2px 0 0" }}>Cadastros</h1>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <a href="/info-analise" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: VINHO, textDecoration: "none", fontWeight: 600 }}>
              <i className="ti ti-chart-dots" aria-hidden="true" style={{ fontSize: 16 }} /> Info Análise
            </a>
            <div style={{ width: 1, height: 20, background: "#E2E4E9" }} />
            <span style={{ width: 32, height: 32, borderRadius: "50%", background: "#F4EDED", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <i className="ti ti-user" aria-hidden="true" style={{ fontSize: 17, color: VINHO }} />
            </span>
            <span style={{ fontSize: 13, color: "#33363D", fontWeight: 500 }}>{nomeUsuario || "Administrador"}</span>
            <button onClick={sair} style={{ display: "flex", alignItems: "center", gap: 6, background: "#FFFFFF", border: "1px solid #DDE0E6", borderRadius: 9, padding: "7px 12px", fontSize: 13, color: "#5A5D65", cursor: "pointer", fontFamily: SANS }}>
              <i className="ti ti-logout" aria-hidden="true" style={{ fontSize: 15 }} /> Sair
            </button>
          </div>
        </div>

        {/* Faixa de contexto */}
        <div style={{ background: "#F6F7F9", padding: "14px 24px", borderBottom: "1px solid #EDEFF2", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div style={{ fontSize: 13, color: "#5A5D65" }}>
            Gerencie motoristas e seus <b style={{ color: "#3A3D44", fontWeight: 600 }}>vínculos com veículos</b>. A telemetria é atribuída ao motorista vinculado no momento da coleta.
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#FFFFFF", border: "1px solid #E7E9ED", borderRadius: 999, padding: "6px 12px", fontSize: 12, color: "#5A5D65" }}>
              <i className="ti ti-users" aria-hidden="true" style={{ fontSize: 14, color: VINHO }} /><b style={{ fontFamily: MONO, color: "#1F2024" }}>{motoristas.length}</b> motoristas
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#FFFFFF", border: "1px solid #E7E9ED", borderRadius: 999, padding: "6px 12px", fontSize: 12, color: "#5A5D65" }}>
              <i className="ti ti-truck" aria-hidden="true" style={{ fontSize: 14, color: VINHO }} /><b style={{ fontFamily: MONO, color: "#1F2024" }}>{veiculos.length}</b> veículos
            </span>
          </div>
        </div>

        {/* Conteúdo */}
        <div style={{ background: "#F6F7F9", padding: 24 }}>

          {erro && (
            <div role="alert" style={{ display: "flex", alignItems: "center", gap: 10, background: "#FDF1F1", border: `1px solid ${VERMELHO}40`, borderRadius: 12, padding: "11px 16px", marginBottom: 18, color: VERMELHO, fontSize: 13 }}>
              <i className="ti ti-alert-triangle" aria-hidden="true" style={{ fontSize: 18 }} />{erro}
            </div>
          )}
          {aviso && (
            <div role="status" style={{ display: "flex", alignItems: "center", gap: 10, background: "#F0FAF3", border: "1px solid #BBE7C9", borderRadius: 12, padding: "11px 16px", marginBottom: 18 }}>
              <i className="ti ti-circle-check" aria-hidden="true" style={{ fontSize: 18, color: VERDE }} />
              <div style={{ fontSize: 13, color: "#15803D" }}>{aviso}</div>
              <button onClick={() => setAviso("")} aria-label="Fechar aviso" style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "#15803D", display: "flex", padding: 2 }}>
                <i className="ti ti-x" aria-hidden="true" style={{ fontSize: 15 }} />
              </button>
            </div>
          )}

          <div className="cad-grid">

            {/* Coluna principal: Motoristas */}
            <div style={card}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <h2 style={tituloSec}><i className="ti ti-id-badge-2" aria-hidden="true" style={{ fontSize: 15, color: VINHO }} />Motoristas</h2>
                  <span style={contador}>{motoristasFiltrados.length}</span>
                </div>
                <button onClick={() => token && carregar(token)} style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "#6B6E76", fontFamily: SANS }}>
                  <i className="ti ti-refresh" aria-hidden="true" style={{ fontSize: 14 }} />Atualizar
                </button>
              </div>

              {/* Busca */}
              <div style={{ position: "relative", marginBottom: 6 }}>
                <i className="ti ti-search" aria-hidden="true" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 15, color: "#A4A7AE" }} />
                <label htmlFor="busca-motorista" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Buscar motorista</label>
                <input id="busca-motorista" className="cad-inp" style={{ ...input, paddingLeft: 34 }} placeholder="Buscar por nome ou CPF…" value={busca} onChange={(e) => setBusca(e.target.value)} />
              </div>

              {/* Lista */}
              {carregando ? (
                <p style={{ fontSize: 13, color: "#8A8D96", padding: "16px 4px" }}>Carregando…</p>
              ) : motoristasFiltrados.length === 0 ? (
                <div style={{ textAlign: "center", padding: "32px 16px", color: "#8A8D96" }}>
                  <i className="ti ti-user-question" aria-hidden="true" style={{ fontSize: 30, color: "#C7CAD1" }} />
                  <p style={{ fontSize: 13, margin: "8px 0 0" }}>{busca ? "Nenhum motorista corresponde à busca." : "Nenhum motorista cadastrado ainda."}</p>
                </div>
              ) : (
                motoristasFiltrados.map((m, i) => {
                  const p = PALETAS[i % PALETAS.length];
                  const ativo = m.ativo !== false;
                  const veic = veiculoDoMotorista.get(m.id) ?? null;
                  const sub = [m.cpf ? `CPF ${cpfFmt(m.cpf)}` : "CPF não informado", m.cnh ? `CNH ${m.cnh}` : "CNH —"].join("  ·  ");
                  return (
                    <div key={m.id} className="cad-row">
                      <span style={{ flexShrink: 0, width: 38, height: 38, borderRadius: "50%", background: p.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 700, color: p.cor }}>{iniciais(m.nome)}</span>
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 14, fontWeight: 600, color: "#1F2024" }}>{m.nome}</span>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 600, color: ativo ? VERDE : "#9A9DA4" }}>
                            <span style={{ width: 6, height: 6, borderRadius: "50%", background: ativo ? VERDE : "#B4B7BE" }} />{ativo ? "Ativo" : "Inativo"}
                          </span>
                        </div>
                        <div style={{ fontSize: 11.5, color: "#6B6E76", marginTop: 2 }}>{sub}</div>
                      </div>

                      {/* Estado do vínculo */}
                      {veic ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#F1F3F6", border: "1px solid #E2E4E9", borderRadius: 999, padding: "5px 11px" }}>
                            <i className="ti ti-truck" aria-hidden="true" style={{ fontSize: 14, color: VINHO }} />
                            <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, color: "#33363D" }}>{veic.placa ?? "(sem placa)"}</span>
                          </span>
                          <button onClick={() => desvincular(m)} disabled={ocupado} title="Desvincular" style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "#FFFFFF", border: "1px solid #E2E4E9", borderRadius: 8, padding: "6px 10px", cursor: ocupado ? "default" : "pointer", fontSize: 12, color: "#6B6E76", fontFamily: SANS, opacity: ocupado ? 0.6 : 1 }}>
                            <i className="ti ti-unlink" aria-hidden="true" style={{ fontSize: 14 }} />Desvincular
                          </button>
                        </div>
                      ) : vinculandoId === m.id ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ position: "relative" }}>
                            <i className="ti ti-truck" aria-hidden="true" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", fontSize: 14, color: VINHO }} />
                            <label htmlFor={`sel-veic-${m.id}`} style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Veículo livre</label>
                            <select id={`sel-veic-${m.id}`} value={veiculoEscolhido} onChange={(e) => setVeiculoEscolhido(e.target.value)} style={{ ...input, padding: "7px 10px 7px 30px", fontSize: 12, width: 210, cursor: "pointer" }}>
                              <option value="">Selecione um veículo livre…</option>
                              {veiculosLivres.map((v) => (
                                <option key={v.id} value={v.id}>{v.placa ?? "(sem placa)"}{modeloDe(v) ? ` — ${modeloDe(v)}` : ""}</option>
                              ))}
                            </select>
                          </div>
                          <button onClick={() => vincular(m)} disabled={ocupado || !veiculoEscolhido} style={{ display: "inline-flex", alignItems: "center", gap: 5, background: VINHO, border: "none", borderRadius: 8, padding: "7px 12px", cursor: ocupado || !veiculoEscolhido ? "default" : "pointer", fontSize: 12, color: "#fff", fontWeight: 600, fontFamily: SANS, opacity: ocupado || !veiculoEscolhido ? 0.55 : 1 }}>
                            <i className="ti ti-link" aria-hidden="true" style={{ fontSize: 14 }} />Vincular
                          </button>
                          <button onClick={() => { setVinculandoId(null); setVeiculoEscolhido(""); }} aria-label="Cancelar" style={{ background: "none", border: "none", cursor: "pointer", color: "#9A9DA4", display: "flex", padding: 4 }}>
                            <i className="ti ti-x" aria-hidden="true" style={{ fontSize: 15 }} />
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => { setVinculandoId(m.id); setVeiculoEscolhido(""); }} disabled={veiculosLivres.length === 0} title={veiculosLivres.length === 0 ? "Nenhum veículo livre" : "Vincular veículo"} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#FFFFFF", border: "1px solid #DDD0D0", borderRadius: 8, padding: "7px 12px", cursor: veiculosLivres.length === 0 ? "default" : "pointer", fontSize: 12, color: VINHO, fontWeight: 600, fontFamily: SANS, opacity: veiculosLivres.length === 0 ? 0.5 : 1 }}>
                          <i className="ti ti-link" aria-hidden="true" style={{ fontSize: 14 }} />Vincular veículo
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Coluna lateral */}
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

              {/* Novo motorista */}
              <div style={card}>
                <h2 style={{ ...tituloSec, marginBottom: 14 }}><i className="ti ti-user-plus" aria-hidden="true" style={{ fontSize: 15, color: VINHO }} />Novo motorista</h2>
                <form onSubmit={criarMotorista} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div>
                    <label htmlFor="novo-nome" style={{ fontSize: 12, color: "#5A5D65", display: "block", marginBottom: 5 }}>Nome <span style={{ color: VINHO }}>*</span></label>
                    <input id="novo-nome" className="cad-inp" style={input} value={nome} onChange={(e) => setNome(e.target.value)} required minLength={3} placeholder="Carlos Andrade" />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div>
                      <label htmlFor="novo-cpf" style={{ fontSize: 12, color: "#5A5D65", display: "block", marginBottom: 5 }}>CPF</label>
                      <input id="novo-cpf" className="cad-inp" style={{ ...input, fontFamily: MONO }} value={cpf} onChange={(e) => setCpf(e.target.value.replace(/\D/g, ""))} maxLength={11} placeholder="000.000.000-00" />
                    </div>
                    <div>
                      <label htmlFor="novo-cnh" style={{ fontSize: 12, color: "#5A5D65", display: "block", marginBottom: 5 }}>CNH</label>
                      <input id="novo-cnh" className="cad-inp" style={{ ...input, fontFamily: MONO }} value={cnh} onChange={(e) => setCnh(e.target.value)} placeholder="0000000000" />
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 7, fontSize: 11.5, color: "#6B6E76", lineHeight: 1.5 }}>
                    <i className="ti ti-info-circle" aria-hidden="true" style={{ fontSize: 14, marginTop: 1, flexShrink: 0 }} />CPF e CNH são opcionais, mas ajudam a identificar o motorista nos relatórios e a evitar duplicidade.
                  </div>
                  <button disabled={salvandoMoto} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 7, background: VINHO, color: "#fff", border: "none", borderRadius: 10, padding: 11, fontSize: 14, fontWeight: 600, cursor: salvandoMoto ? "default" : "pointer", fontFamily: SANS, opacity: salvandoMoto ? 0.6 : 1 }}>
                    <i className="ti ti-plus" aria-hidden="true" style={{ fontSize: 16 }} />{salvandoMoto ? "Salvando…" : "Criar motorista"}
                  </button>
                </form>
              </div>

              {/* Veículos */}
              <div style={card}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <h2 style={tituloSec}><i className="ti ti-truck" aria-hidden="true" style={{ fontSize: 15, color: VINHO }} />Veículos</h2>
                  <span style={contador}>{veiculos.length}</span>
                </div>
                {carregando ? (
                  <p style={{ fontSize: 13, color: "#8A8D96", padding: "8px 2px" }}>Carregando…</p>
                ) : veiculos.length === 0 ? (
                  <p style={{ fontSize: 13, color: "#8A8D96", padding: "8px 2px" }}>Nenhum veículo cadastrado ainda.</p>
                ) : (
                  veiculos.map((v) => {
                    const moto = motoristaDoVeiculo.get(v.id) ?? null;
                    return (
                      <div key={v.id} style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 2px", borderBottom: "1px solid #EEF0F3" }}>
                        <span style={{ flexShrink: 0, width: 34, height: 34, borderRadius: 9, background: "#F1F3F6", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <i className="ti ti-truck" aria-hidden="true" style={{ fontSize: 16, color: VINHO }} />
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontFamily: MONO, fontSize: 13, fontWeight: 600, color: "#1F2024" }}>{v.placa ?? "(sem placa)"}</div>
                          <div style={{ fontSize: 11, color: "#6B6E76", marginTop: 1 }}>{modeloDe(v) || "—"}</div>
                        </div>
                        {moto ? (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "#F4EDED", borderRadius: 999, padding: "4px 9px", maxWidth: 140 }}>
                            <i className="ti ti-user" aria-hidden="true" style={{ fontSize: 12, color: VINHO, flexShrink: 0 }} />
                            <span style={{ fontSize: 11, color: VINHO, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{moto.nome}</span>
                          </span>
                        ) : (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "#F1F3F6", borderRadius: 999, padding: "4px 9px", fontSize: 11, color: "#8A8D96", fontWeight: 500 }}>
                            <i className="ti ti-minus" aria-hidden="true" style={{ fontSize: 12 }} />Livre
                          </span>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

            </div>
          </div>
        </div>

        {/* Rodapé */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 24px", borderTop: "1px solid #EDEFF2", background: "#FFFFFF" }}>
          <span style={{ fontSize: 12, color: "#6B6E76" }}>Cadastros · Motoristas e vínculos</span>
          <span style={{ fontSize: 12, color: "#6B6E76" }}><span style={{ color: VINHO, fontWeight: 600 }}>INFOBRIDGE</span> · Transformando dados em economia · © 2026</span>
        </div>

      </div>
    </div>
  );
}
