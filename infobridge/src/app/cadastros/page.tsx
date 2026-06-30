"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  apiFetch, apiPost, apiPatch, apiDelete, podeAcessar, primeiraTelaPermitida, ehGestorOuAdmin, ehAdminTotal,
  salvarSessao, carregarSessao, limparSessao,
} from "@/lib/api";
import LoginForm from "@/components/LoginForm";
import BotaoTrocarSenha from "@/components/BotaoTrocarSenha";
import SemAcesso from "@/components/SemAcesso";
import LogoInfobridge from "@/components/LogoInfobridge";
import MenuNavegacao from "@/components/MenuNavegacao";

// ── Paleta / tipografia (mesmo sistema da Info Análise) ───────
const VINHO = "#6E1414";
const AZUL = "#3A5BA0";
const VERDE = "#16A34A";
const VERMELHO = "#C0322B";
const SANS = "'IBM Plex Sans', system-ui, sans-serif";
const MONO = "'IBM Plex Mono', ui-monospace, monospace";

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
  telefone?: string;
  cnh?: string;
  ativo?: boolean;
  veiculoId?: string | null;
  placa?: string | null;
  empresaId?: string | null;
};

type Veiculo = {
  id: string;
  placa?: string;
  marca?: string;
  modelo?: string;
  frota?: string;
  motoristaId?: string | null;
  motorista?: { id?: string; nome?: string } | null;
};

type Tela = "mot" | "vei";

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

const telFmt = (tel?: string | null) => {
  const d = (tel ?? "").replace(/\D/g, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return tel || "";
};

// Valida CPF real (11 dígitos + dígitos verificadores). Rejeita sequências iguais.
function validarCpf(valor: string): boolean {
  const c = (valor ?? "").replace(/\D/g, "");
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const dig = (base: number) => {
    let soma = 0;
    for (let i = 0; i < base; i++) soma += parseInt(c[i], 10) * (base + 1 - i);
    const r = 11 - (soma % 11);
    return r >= 10 ? 0 : r;
  };
  return dig(9) === parseInt(c[9], 10) && dig(10) === parseInt(c[10], 10);
}
const telefoneValido = (valor: string) => /^\d{10,11}$/.test((valor ?? "").replace(/\D/g, ""));

// ── Logotipo Infobridge ───────────────────────────────────────


// ── Modal: Novo motorista (CPF e Telefone obrigatórios) ───────
function ModalNovoMotorista({ onFechar, onCriar, salvando, empresas, exigeEmpresa }: {
  onFechar: () => void;
  onCriar: (dados: { nome: string; cpf: string; telefone: string; cnh: string; empresaId?: string }) => void;
  salvando: boolean;
  empresas: { id: string; nome: string }[];
  exigeEmpresa: boolean;
}) {
  const [nome, setNome] = useState("");
  const [cpf, setCpf] = useState("");
  const [telefone, setTelefone] = useState("");
  const [cnh, setCnh] = useState("");
  const [empresaId, setEmpresaId] = useState("");

  const cpfRealInvalido = cpf.replace(/\D/g, "").length === 11 && !validarCpf(cpf);
  const podeCriar = nome.trim().length >= 3 && validarCpf(cpf) && telefoneValido(telefone) && (!exigeEmpresa || !!empresaId);

  const input: React.CSSProperties = {
    width: "100%", boxSizing: "border-box", background: "#FFFFFF", border: "1px solid #E2E4E9",
    borderRadius: 10, padding: "10px 12px", fontSize: 13, color: "#1F2024", fontFamily: SANS, outline: "none",
  };
  const label: React.CSSProperties = { fontSize: 12, color: "#5A5D65", display: "block", marginBottom: 5 };

  return (
    <div onClick={onFechar} style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(24,18,18,.42)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Novo motorista" style={{ width: "100%", maxWidth: 440, background: "#FFFFFF", borderRadius: 16, boxShadow: "0 24px 60px rgba(20,16,16,.32)", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "18px 22px", borderBottom: "1px solid #EDEFF2" }}>
          <span style={{ width: 36, height: 36, borderRadius: 10, background: "#F4EDED", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <i className="ti ti-user-plus" aria-hidden="true" style={{ fontSize: 18, color: VINHO }} />
          </span>
          <div style={{ flex: 1 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#1F2024" }}>Novo motorista</h3>
            <div style={{ fontSize: 11.5, color: "#8A8D96", marginTop: 1 }}>Campos com <span style={{ color: VINHO }}>*</span> são obrigatórios</div>
          </div>
          <button onClick={onFechar} aria-label="Fechar" style={{ background: "none", border: "none", cursor: "pointer", color: "#9A9DA4", display: "flex", padding: 4 }}>
            <i className="ti ti-x" aria-hidden="true" style={{ fontSize: 18 }} />
          </button>
        </div>
        <div style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label htmlFor="nm-nome" style={label}>Nome <span style={{ color: VINHO }}>*</span></label>
            <input id="nm-nome" style={input} value={nome} onChange={(e) => setNome(e.target.value)} minLength={3} placeholder="Carlos Andrade" />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label htmlFor="nm-cpf" style={label}>CPF <span style={{ color: VINHO }}>*</span></label>
              <input id="nm-cpf" aria-invalid={cpfRealInvalido} style={{ ...input, fontFamily: MONO }} value={cpf} onChange={(e) => setCpf(e.target.value.replace(/\D/g, "").slice(0, 11))} inputMode="numeric" placeholder="000.000.000-00" />
              {cpfRealInvalido && <span style={{ fontSize: 11, color: VERMELHO, display: "block", marginTop: 3 }}>CPF inválido</span>}
            </div>
            <div>
              <label htmlFor="nm-tel" style={label}>Telefone <span style={{ color: VINHO }}>*</span></label>
              <input id="nm-tel" style={{ ...input, fontFamily: MONO }} value={telefone} onChange={(e) => setTelefone(e.target.value.replace(/\D/g, "").slice(0, 11))} inputMode="tel" placeholder="(00) 00000-0000" />
            </div>
          </div>
          <div>
            <label htmlFor="nm-cnh" style={label}>CNH <span style={{ color: "#A4A7AE", fontWeight: 400 }}>(opcional)</span></label>
            <input id="nm-cnh" style={{ ...input, fontFamily: MONO }} value={cnh} onChange={(e) => setCnh(e.target.value)} placeholder="0000000000" />
          </div>
          {exigeEmpresa && (
            <div>
              <label htmlFor="nm-emp" style={label}>Empresa <span style={{ color: VINHO }}>*</span></label>
              <select id="nm-emp" style={input} value={empresaId} onChange={(e) => setEmpresaId(e.target.value)}>
                <option value="">Selecione a empresa…</option>
                {empresas.map((emp) => <option key={emp.id} value={emp.id}>{emp.nome}</option>)}
              </select>
              {empresas.length === 0 && <span style={{ fontSize: 11, color: VERMELHO, display: "block", marginTop: 3 }}>Nenhuma empresa cadastrada. Cadastre uma empresa antes.</span>}
            </div>
          )}
          <div style={{ display: "flex", alignItems: "flex-start", gap: 7, fontSize: 11.5, color: "#6B6E76", lineHeight: 1.5 }}>
            <i className="ti ti-info-circle" aria-hidden="true" style={{ fontSize: 14, marginTop: 1, flexShrink: 0, color: "#8A8D96" }} />
            CPF e telefone identificam o motorista nos relatórios e evitam cadastros duplicados.
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, padding: "16px 22px", borderTop: "1px solid #EDEFF2", background: "#FAFBFC" }}>
          <button onClick={onFechar} style={{ background: "#FFFFFF", border: "1px solid #DDE0E6", borderRadius: 9, padding: "9px 16px", fontSize: 13, color: "#5A5D65", cursor: "pointer", fontFamily: SANS, fontWeight: 500 }}>Cancelar</button>
          <button onClick={() => podeCriar && onCriar({ nome: nome.trim(), cpf: cpf.trim(), telefone: telefone.trim(), cnh: cnh.trim(), empresaId: empresaId || undefined })}
            disabled={!podeCriar || salvando}
            style={{ display: "inline-flex", alignItems: "center", gap: 7, background: VINHO, color: "#fff", border: "none", borderRadius: 9, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: !podeCriar || salvando ? "not-allowed" : "pointer", fontFamily: SANS, whiteSpace: "nowrap", opacity: !podeCriar || salvando ? 0.5 : 1 }}>
            <i className="ti ti-check" aria-hidden="true" style={{ fontSize: 16 }} />{salvando ? "Salvando…" : "Criar motorista"}
          </button>
        </div>
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
  const [empresas, setEmpresas] = useState<{ id: string; nome: string }[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");

  // Navegação
  const [tela, setTela] = useState<Tela>("mot");
  const [menuAberto, setMenuAberto] = useState(false);

  // Busca
  const [buscaMot, setBuscaMot] = useState("");
  const [buscaVei, setBuscaVei] = useState("");

  // Modal de criação
  const [modalAberto, setModalAberto] = useState(false);
  const [salvandoMoto, setSalvandoMoto] = useState(false);

  // Vínculo inline
  const [vincMotoId, setVincMotoId] = useState<string | null>(null);
  const [selVeiculo, setSelVeiculo] = useState("");
  const [vincVeiId, setVincVeiId] = useState<string | null>(null);
  const [selMotorista, setSelMotorista] = useState("");
  const [vinculoDesde, setVinculoDesde] = useState(""); // data retroativa (YYYY-MM-DD); vazio = agora
  const [ocupado, setOcupado] = useState(false);

  const sair = useCallback(() => { limparSessao(); setToken(null); }, []);

  const carregar = useCallback(async (tk: string) => {
    setCarregando(true); setErro("");
    try {
      const [m, v] = await Promise.all([
        apiFetch<{ dados: any[] }>("/motoristas?limite=100", tk),
        apiFetch<{ dados: any[] }>("/veiculos?limite=100", tk),
      ]);
      // A API entrega o vínculo aninhado (vinculos[0].veiculo / .motorista,
      // já filtrado para fim IS NULL). Achatamos para os campos planos da UI.
      const motos: Motorista[] = (m.dados ?? []).map((mo: any) => {
        const veic = mo.vinculos?.[0]?.veiculo;
        return { ...mo, veiculoId: veic?.id ?? mo.veiculoId ?? null, placa: veic?.placa ?? mo.placa ?? null };
      });
      const veics: Veiculo[] = (v.dados ?? []).map((ve: any) => {
        const mot = ve.vinculos?.[0]?.motorista;
        return { ...ve, motoristaId: mot?.id ?? ve.motoristaId ?? null, motorista: mot ? { id: mot.id, nome: mot.nome } : (ve.motorista ?? null) };
      });
      setMotoristas(motos);
      setVeiculos(veics);
      // Empresas só para admin com acesso total (exigidas no cadastro de motorista).
      if (ehAdminTotal()) {
        try {
          const emp = await apiFetch<{ id: string; nome: string }[]>("/empresas", tk);
          setEmpresas(Array.isArray(emp) ? emp : []);
        } catch { /* silencioso: não bloqueia cadastros se /empresas falhar */ }
      }
    } catch (e: any) {
      const msg = e?.message ?? "Erro ao carregar cadastros";
      if (/401|403/.test(msg)) { limparSessao(); setToken(null); }
      else setErro(msg);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    // Deep-link: /cadastros?tela=vei abre direto a aba Veículos
    try {
      const t = new URLSearchParams(window.location.search).get("tela");
      if (t === "vei" || t === "mot") setTela(t);
    } catch { /* ignora */ }

    const sessao = carregarSessao();
    if (sessao?.token) {
      setToken(sessao.token);
      setNomeUsuario(sessao.nome);
      carregar(sessao.token);
    }
  }, [carregar]);

  // Fecha o menu com Esc
  useEffect(() => {
    if (!menuAberto) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuAberto(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuAberto]);

  function handleLogin(tk: string, nome: string) {
    salvarSessao(tk, nome);
    setToken(tk); setNomeUsuario(nome);
    carregar(tk);
  }

  function irPara(t: Tela) {
    setTela(t); setMenuAberto(false); setVincMotoId(null); setVincVeiId(null);
  }

  // ── Vínculo derivado dos dois lados (defensivo) ─────────────
  const { veiculoDoMotorista, motoristaDoVeiculo } = useMemo(() => {
    const mPorId = new Map(motoristas.map((m) => [m.id, m]));
    const vPorId = new Map(veiculos.map((v) => [v.id, v]));
    const vPorPlaca = new Map(veiculos.filter((v) => v.placa).map((v) => [v.placa, v]));

    const veiculoDoMotorista = new Map<string, Veiculo>();
    const motoristaDoVeiculo = new Map<string, Motorista>();

    for (const m of motoristas) {
      const v = (m.veiculoId && vPorId.get(m.veiculoId)) || (m.placa && vPorPlaca.get(m.placa)) || null;
      if (v) { veiculoDoMotorista.set(m.id, v); motoristaDoVeiculo.set(v.id, m); }
    }
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
  const motoristasLivres = useMemo(
    () => motoristas.filter((m) => !veiculoDoMotorista.has(m.id)),
    [motoristas, veiculoDoMotorista]
  );

  const motoristasFiltrados = useMemo(() => {
    const q = buscaMot.trim().toLowerCase();
    if (!q) return motoristas;
    const qd = q.replace(/\D/g, "");
    return motoristas.filter((m) =>
      m.nome.toLowerCase().includes(q) ||
      (qd && (m.cpf ?? "").replace(/\D/g, "").includes(qd)) ||
      (qd && (m.telefone ?? "").replace(/\D/g, "").includes(qd))
    );
  }, [motoristas, buscaMot]);

  const veiculosFiltrados = useMemo(() => {
    const q = buscaVei.trim().toLowerCase();
    if (!q) return veiculos;
    return veiculos.filter((v) =>
      (v.placa ?? "").toLowerCase().includes(q) || modeloDe(v).toLowerCase().includes(q)
    );
  }, [veiculos, buscaVei]);

  // ── Ações ───────────────────────────────────────────────────
  async function criarMotorista(dados: { nome: string; cpf: string; telefone: string; cnh: string; empresaId?: string }) {
    if (!token) return;
    setSalvandoMoto(true); setErro(""); setAviso("");
    try {
      const body: Record<string, string> = { nome: dados.nome, cpf: dados.cpf, telefone: dados.telefone };
      if (dados.cnh) body.cnh = dados.cnh;
      if (dados.empresaId) body.empresaId = dados.empresaId;
      const novo = await apiPost<Motorista>("/motoristas", token, body);
      setAviso(`Motorista “${novo.nome ?? dados.nome}” criado.`);
      setModalAberto(false);
      await carregar(token);
    } catch (e: any) {
      setErro(e?.message ?? "Erro ao criar motorista");
    } finally {
      setSalvandoMoto(false);
    }
  }

  async function vincularEmpresaMotorista(motoId: string, empresaId: string) {
    if (!token) return;
    setErro(""); setAviso("");
    try {
      await apiPatch(`/motoristas/${motoId}/empresa`, token, { empresaId: empresaId || null });
      const nm = empresas.find((e) => e.id === empresaId)?.nome;
      setAviso(empresaId ? `Motorista vinculado à empresa “${nm}”.` : "Motorista desvinculado da empresa.");
      await carregar(token);
    } catch (e: any) {
      setErro(e?.message ?? "Erro ao vincular empresa");
    }
  }

  async function vincular(motoId: string, veiId: string, nomeMoto: string, placa: string) {
    if (!token || !motoId || !veiId) return;
    setOcupado(true); setErro(""); setAviso("");
    try {
      const body: Record<string, string> = { veiculoId: veiId };
      // Vínculo retroativo: se houver data escolhida, a telemetria já gravada a
      // partir dela é re-atribuída a este motorista (backend faz a re-atribuição).
      if (vinculoDesde) body.inicio = new Date(`${vinculoDesde}T00:00:00`).toISOString();
      await apiPost(`/motoristas/${motoId}/vincular`, token, body);
      setAviso(vinculoDesde
        ? `${nomeMoto} vinculado ao veículo ${placa} desde ${vinculoDesde.split("-").reverse().join("/")}. A telemetria desse período foi atribuída a ele.`
        : `${nomeMoto} vinculado ao veículo ${placa}. A telemetria a partir de agora será atribuída a ele.`);
      setVincMotoId(null); setSelVeiculo(""); setVincVeiId(null); setSelMotorista(""); setVinculoDesde("");
      await carregar(token);
    } catch (e: any) {
      setErro(e?.message ?? "Erro ao vincular");
    } finally {
      setOcupado(false);
    }
  }

  async function desvincular(motoId: string, nomeMoto: string) {
    if (!token || !motoId) return;
    setOcupado(true); setErro(""); setAviso("");
    try {
      // DELETE /motoristas/:id/vincular  (proxy já encaminha DELETE) ─ ver PULL_REQUEST
      await apiDelete(`/motoristas/${motoId}/vincular`, token);
      setAviso(`${nomeMoto} desvinculado. Novas coletas não serão atribuídas a ele.`);
      await carregar(token);
    } catch (e: any) {
      setErro(e?.message ?? "Erro ao desvincular");
    } finally {
      setOcupado(false);
    }
  }

  if (!token) return <LoginForm onLogin={handleLogin} />;
  if (!podeAcessar("cadastros")) return <SemAcesso destino={primeiraTelaPermitida()} />;

  // Operador/Somente leitura: apenas visualizam (não criam motorista nem vinculam).
  const podeEditar = ehGestorOuAdmin();
  const nomeEmpresaMoto = (id?: string | null) => (id ? (empresas.find((e) => e.id === id)?.nome ?? null) : null);

  // ── Estilos reutilizados ────────────────────────────────────
  const cardLista: React.CSSProperties = {
    background: "#FFFFFF", border: "1px solid #E7E9ED", borderRadius: 14, padding: "8px 18px 14px",
    boxShadow: "0 1px 3px rgba(30,32,40,.04)",
  };
  const inp: React.CSSProperties = {
    width: "100%", boxSizing: "border-box", background: "#FFFFFF", border: "1px solid #E2E4E9",
    borderRadius: 10, padding: "10px 12px", fontSize: 13, color: "#1F2024", fontFamily: SANS, outline: "none",
  };
  const tituloSec: React.CSSProperties = {
    fontSize: 11, fontWeight: 600, letterSpacing: 1.4, textTransform: "uppercase", color: "#6B6E76", margin: 0,
  };
  const contador: React.CSSProperties = {
    background: "#F1F3F6", color: "#5A5D65", fontSize: 11, fontWeight: 600, borderRadius: 999, padding: "2px 8px",
  };
  const isMot = tela === "mot";

  const itemMenu = (t: Tela, icon: string, iconBg: string, iconColor: string, titulo: string, desc: string, total: number) => (
    <button onClick={() => irPara(t)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 11, background: tela === t ? (t === "mot" ? "#F6F2F2" : "#EEF0F6") : "transparent", border: "none", borderRadius: 10, padding: "10px 11px", cursor: "pointer", textAlign: "left", fontFamily: SANS, marginTop: t === "vei" ? 2 : 0 }}>
      <span style={{ flexShrink: 0, width: 34, height: 34, borderRadius: 9, background: iconBg, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <i className={`ti ${icon}`} aria-hidden="true" style={{ fontSize: 17, color: iconColor }} />
      </span>
      <span style={{ flex: 1 }}>
        <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#1F2024" }}>{titulo}</span>
        <span style={{ display: "block", fontSize: 11, color: "#8A8D96", marginTop: 1 }}>{desc}</span>
      </span>
      <span style={{ fontFamily: MONO, fontSize: 12, color: "#9A9DA4" }}>{total}</span>
    </button>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#E9EBEF", fontFamily: SANS }}>
      <style>{`
        .ti { font-family: 'tabler-icons' !important; font-style: normal; }
        .cad-page { padding: 30px; }
        .cad-inp:focus { border-color: ${VINHO}; box-shadow: 0 0 0 3px rgba(110,20,20,.08); }
        .cad-row { display: flex; align-items: center; gap: 13px; padding: 14px 4px; border-bottom: 1px solid #EEF0F3; }
        .cad-row:last-child { border-bottom: none; }
        .cad-mi:hover { background: #F6F2F2 !important; }
        @media (max-width: 880px) {
          .cad-page { padding: 14px; }
          .cad-header { flex-wrap: wrap; gap: 12px; }
          .cad-titlebar { flex-wrap: wrap; }
          .cad-search { width: 100% !important; }
        }
      `}</style>

      <div className="cad-page" style={{ display: "flex", justifyContent: "center" }}>
        <div style={{ width: "100%", maxWidth: 1080, background: "#FFFFFF", border: "1px solid #E2E4E9", borderRadius: 18, overflow: "hidden", boxShadow: "0 12px 40px rgba(30,32,40,.10)" }}>

          {/* Cabeçalho com menu */}
          <div className="cad-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 24px", borderBottom: "1px solid #EDEFF2", position: "relative", zIndex: 30 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <LogoInfobridge height={34} />
                <div style={{ borderLeft: "1px solid #E2E4E9", paddingLeft: 12 }}>
                  <div style={{ fontSize: 8, letterSpacing: 2.4, color: VINHO, textTransform: "uppercase", fontWeight: 700 }}>Infobridge</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#1F2024" }}>Sistema</div>
                </div>
              </div>

              <MenuNavegacao atual="cadastros" />
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ width: 32, height: 32, borderRadius: "50%", background: "#F4EDED", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <i className="ti ti-user" aria-hidden="true" style={{ fontSize: 17, color: VINHO }} />
              </span>
              <span style={{ fontSize: 13, color: "#33363D", fontWeight: 500 }}>{nomeUsuario || "Administrador"}</span>
              {token && <BotaoTrocarSenha token={token} />}
              <button onClick={sair} style={{ display: "flex", alignItems: "center", gap: 6, background: "#FFFFFF", border: "1px solid #DDE0E6", borderRadius: 9, padding: "7px 12px", fontSize: 13, color: "#5A5D65", cursor: "pointer", fontFamily: SANS }}>
                <i className="ti ti-logout" aria-hidden="true" style={{ fontSize: 15 }} /> Sair
              </button>
            </div>
          </div>

          {/* Backdrop de clique-fora do menu */}

          {/* Título da tela + busca */}
          <div className="cad-titlebar" style={{ background: "#F6F7F9", padding: "16px 24px", borderBottom: "1px solid #EDEFF2", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
              <span style={{ width: 38, height: 38, borderRadius: 10, background: isMot ? "#F4EDED" : "#EEF0F6", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <i className={`ti ${isMot ? "ti-id-badge-2" : "ti-truck"}`} aria-hidden="true" style={{ fontSize: 20, color: isMot ? VINHO : AZUL }} />
              </span>
              <div>
                <h1 style={{ fontSize: 17, fontWeight: 700, color: "#1F2024", margin: 0 }}>{isMot ? "Motoristas" : "Veículos"}</h1>
                <div style={{ fontSize: 12, color: "#6B6E76", marginTop: 1 }}>{isMot ? "Cadastre e vincule motoristas a veículos" : "Frota e o motorista responsável por cada veículo"}</div>
              </div>
            </div>
            <div className="cad-search" style={{ position: "relative", width: 300, maxWidth: "100%" }}>
              <i className="ti ti-search" aria-hidden="true" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 15, color: "#A4A7AE" }} />
              <label htmlFor="cad-busca" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Buscar</label>
              <input id="cad-busca" className="cad-inp" style={{ ...inp, paddingLeft: 34 }}
                placeholder={isMot ? "Buscar por nome, CPF ou telefone…" : "Buscar por placa ou modelo…"}
                value={isMot ? buscaMot : buscaVei}
                onChange={(e) => (isMot ? setBuscaMot(e.target.value) : setBuscaVei(e.target.value))} />
            </div>
          </div>

          {/* Conteúdo */}
          <div style={{ background: "#F6F7F9", padding: 24, minHeight: 440 }}>

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

            {/* ===== TELA MOTORISTAS ===== */}
            {isMot && (
              <div style={cardLista}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0 6px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <h2 style={tituloSec}>Motoristas</h2>
                    <span style={contador}>{motoristasFiltrados.length}</span>
                  </div>
                  {podeEditar && (
                  <button onClick={() => setModalAberto(true)} style={{ display: "inline-flex", alignItems: "center", gap: 7, background: VINHO, color: "#fff", border: "none", borderRadius: 9, padding: "9px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: SANS, whiteSpace: "nowrap", flexShrink: 0 }}>
                    <i className="ti ti-user-plus" aria-hidden="true" style={{ fontSize: 16 }} />Novo motorista
                  </button>
                  )}
                </div>

                {carregando ? (
                  <p style={{ fontSize: 13, color: "#8A8D96", padding: "16px 4px" }}>Carregando…</p>
                ) : motoristasFiltrados.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "36px 16px", color: "#8A8D96" }}>
                    <i className="ti ti-user-question" aria-hidden="true" style={{ fontSize: 30, color: "#C7CAD1" }} />
                    <p style={{ fontSize: 13, margin: "8px 0 0" }}>{buscaMot ? "Nenhum motorista corresponde à busca." : "Nenhum motorista cadastrado ainda."}</p>
                  </div>
                ) : (
                  motoristasFiltrados.map((m, i) => {
                    const p = PALETAS[i % PALETAS.length];
                    const ativo = m.ativo !== false;
                    const veic = veiculoDoMotorista.get(m.id) ?? null;
                    const sub = [`CPF ${cpfFmt(m.cpf)}`, m.telefone ? `Tel ${telFmt(m.telefone)}` : null, m.cnh ? `CNH ${m.cnh}` : null].filter(Boolean).join("  ·  ");
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
                          {ehAdminTotal() ? (
                            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 6 }}>
                              <i className="ti ti-building-warehouse" aria-hidden="true" style={{ fontSize: 13, color: AZUL }} />
                              <select
                                value={m.empresaId ?? ""}
                                onChange={(e) => vincularEmpresaMotorista(m.id, e.target.value)}
                                aria-label="Empresa do motorista"
                                style={{ ...inp, padding: "5px 8px", fontSize: 11.5, width: "auto", maxWidth: 220, cursor: "pointer", color: m.empresaId ? "#33363D" : "#9A9DA4" }}
                              >
                                <option value="">Sem empresa…</option>
                                {empresas.map((emp) => <option key={emp.id} value={emp.id}>{emp.nome}</option>)}
                              </select>
                            </div>
                          ) : nomeEmpresaMoto(m.empresaId) ? (
                            <div style={{ display: "inline-flex", alignItems: "center", gap: 5, marginTop: 6, fontSize: 10.5, fontWeight: 600, color: AZUL, background: "#EEF2F9", borderRadius: 6, padding: "2px 8px" }}>
                              <i className="ti ti-building-warehouse" aria-hidden="true" style={{ fontSize: 12 }} />{nomeEmpresaMoto(m.empresaId)}
                            </div>
                          ) : null}
                        </div>

                        {veic ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#F1F3F6", border: "1px solid #E2E4E9", borderRadius: 999, padding: "5px 11px" }}>
                              <i className="ti ti-truck" aria-hidden="true" style={{ fontSize: 14, color: VINHO }} />
                              <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, color: "#33363D" }}>{veic.placa ?? "(sem placa)"}</span>
                            </span>
                            {podeEditar && (
                            <button onClick={() => desvincular(m.id, m.nome)} disabled={ocupado} title="Desvincular" style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "#FFFFFF", border: "1px solid #E2E4E9", borderRadius: 8, padding: "6px 10px", cursor: ocupado ? "default" : "pointer", fontSize: 12, color: "#6B6E76", fontFamily: SANS, opacity: ocupado ? 0.6 : 1 }}>
                              <i className="ti ti-unlink" aria-hidden="true" style={{ fontSize: 14 }} />Desvincular
                            </button>
                            )}
                          </div>
                        ) : !podeEditar ? (
                          <span style={{ fontSize: 12, color: "#8A8D96" }}>Sem veículo</span>
                        ) : vincMotoId === m.id ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ position: "relative" }}>
                              <i className="ti ti-truck" aria-hidden="true" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", fontSize: 14, color: VINHO }} />
                              <label htmlFor={`sel-v-${m.id}`} style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Veículo livre</label>
                              <select id={`sel-v-${m.id}`} value={selVeiculo} onChange={(e) => setSelVeiculo(e.target.value)} style={{ ...inp, padding: "7px 10px 7px 30px", fontSize: 12, width: 215, cursor: "pointer" }}>
                                <option value="">Selecione um veículo livre…</option>
                                {veiculosLivres.map((v) => (
                                  <option key={v.id} value={v.id}>{v.placa ?? "(sem placa)"}{modeloDe(v) ? ` — ${modeloDe(v)}` : ""}</option>
                                ))}
                              </select>
                            </div>
                            <div style={{ position: "relative" }} title="Vínculo válido desde (opcional) — para vinculação retroativa">
                              <label htmlFor={`desde-v-${m.id}`} style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Vínculo válido desde</label>
                              <input id={`desde-v-${m.id}`} type="date" value={vinculoDesde} onChange={(e) => setVinculoDesde(e.target.value)} max={new Date().toISOString().slice(0, 10)} style={{ ...inp, padding: "7px 10px", fontSize: 12, width: 150, cursor: "pointer" }} />
                            </div>
                            <button onClick={() => vincular(m.id, selVeiculo, m.nome, veiculos.find((v) => v.id === selVeiculo)?.placa ?? "veículo")} disabled={ocupado || !selVeiculo} style={{ display: "inline-flex", alignItems: "center", gap: 5, background: VINHO, border: "none", borderRadius: 8, padding: "7px 12px", cursor: ocupado || !selVeiculo ? "default" : "pointer", fontSize: 12, color: "#fff", fontWeight: 600, fontFamily: SANS, opacity: ocupado || !selVeiculo ? 0.55 : 1 }}>
                              <i className="ti ti-link" aria-hidden="true" style={{ fontSize: 14 }} />Vincular
                            </button>
                            <button onClick={() => { setVincMotoId(null); setSelVeiculo(""); }} aria-label="Cancelar" style={{ background: "none", border: "none", cursor: "pointer", color: "#9A9DA4", display: "flex", padding: 4 }}>
                              <i className="ti ti-x" aria-hidden="true" style={{ fontSize: 15 }} />
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => { setVincMotoId(m.id); setSelVeiculo(""); }} disabled={veiculosLivres.length === 0} title={veiculosLivres.length === 0 ? "Nenhum veículo livre" : "Vincular veículo"} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#FFFFFF", border: "1px solid #DDD0D0", borderRadius: 8, padding: "7px 12px", cursor: veiculosLivres.length === 0 ? "default" : "pointer", fontSize: 12, color: VINHO, fontWeight: 600, fontFamily: SANS, opacity: veiculosLivres.length === 0 ? 0.5 : 1 }}>
                            <i className="ti ti-link" aria-hidden="true" style={{ fontSize: 14 }} />Vincular veículo
                          </button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {/* ===== TELA VEÍCULOS ===== */}
            {!isMot && (
              <div style={cardLista}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0 6px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <h2 style={tituloSec}>Veículos da frota</h2>
                    <span style={contador}>{veiculosFiltrados.length}</span>
                  </div>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "#8A8D96" }}>
                    <i className="ti ti-cloud-download" aria-hidden="true" style={{ fontSize: 14 }} />Importados da API · somente leitura
                  </span>
                </div>

                {carregando ? (
                  <p style={{ fontSize: 13, color: "#8A8D96", padding: "16px 4px" }}>Carregando…</p>
                ) : veiculosFiltrados.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "36px 16px", color: "#8A8D96" }}>
                    <i className="ti ti-truck-off" aria-hidden="true" style={{ fontSize: 30, color: "#C7CAD1" }} />
                    <p style={{ fontSize: 13, margin: "8px 0 0" }}>{buscaVei ? "Nenhum veículo corresponde à busca." : "Nenhum veículo importado ainda."}</p>
                  </div>
                ) : (
                  veiculosFiltrados.map((v) => {
                    const moto = motoristaDoVeiculo.get(v.id) ?? null;
                    return (
                      <div key={v.id} className="cad-row">
                        <span style={{ flexShrink: 0, width: 38, height: 38, borderRadius: 10, background: "#EEF0F6", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <i className="ti ti-truck" aria-hidden="true" style={{ fontSize: 18, color: AZUL }} />
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontFamily: MONO, fontSize: 14, fontWeight: 700, color: "#1F2024" }}>{v.placa ?? "(sem placa)"}</span>
                            {v.frota && <span style={{ fontSize: 11, color: "#8A8D96" }}>{v.frota}</span>}
                          </div>
                          <div style={{ fontSize: 11.5, color: "#6B6E76", marginTop: 2 }}>{modeloDe(v) || "—"}</div>
                        </div>

                        {moto ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "#F4EDED", borderRadius: 999, padding: "4px 11px 4px 5px", maxWidth: 180 }}>
                              <span style={{ width: 24, height: 24, borderRadius: "50%", background: "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                                <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, color: VINHO }}>{iniciais(moto.nome)}</span>
                              </span>
                              <span style={{ fontSize: 12, color: VINHO, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{moto.nome}</span>
                            </span>
                            {podeEditar && (
                            <button onClick={() => desvincular(moto.id, moto.nome)} disabled={ocupado} title="Desvincular" style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "#FFFFFF", border: "1px solid #E2E4E9", borderRadius: 8, padding: "6px 10px", cursor: ocupado ? "default" : "pointer", fontSize: 12, color: "#6B6E76", fontFamily: SANS, opacity: ocupado ? 0.6 : 1 }}>
                              <i className="ti ti-unlink" aria-hidden="true" style={{ fontSize: 14 }} />Desvincular
                            </button>
                            )}
                          </div>
                        ) : !podeEditar ? (
                          <span style={{ fontSize: 12, color: "#8A8D96" }}>Sem motorista</span>
                        ) : vincVeiId === v.id ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ position: "relative" }}>
                              <i className="ti ti-user" aria-hidden="true" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", fontSize: 14, color: AZUL }} />
                              <label htmlFor={`sel-m-${v.id}`} style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Motorista livre</label>
                              <select id={`sel-m-${v.id}`} value={selMotorista} onChange={(e) => setSelMotorista(e.target.value)} style={{ ...inp, padding: "7px 10px 7px 30px", fontSize: 12, width: 215, cursor: "pointer" }}>
                                <option value="">Selecione um motorista livre…</option>
                                {motoristasLivres.map((m) => (
                                  <option key={m.id} value={m.id}>{m.nome}</option>
                                ))}
                              </select>
                            </div>
                            <div style={{ position: "relative" }} title="Vínculo válido desde (opcional) — para vinculação retroativa">
                              <label htmlFor={`desde-m-${v.id}`} style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Vínculo válido desde</label>
                              <input id={`desde-m-${v.id}`} type="date" value={vinculoDesde} onChange={(e) => setVinculoDesde(e.target.value)} max={new Date().toISOString().slice(0, 10)} style={{ ...inp, padding: "7px 10px", fontSize: 12, width: 150, cursor: "pointer" }} />
                            </div>
                            <button onClick={() => vincular(selMotorista, v.id, motoristas.find((m) => m.id === selMotorista)?.nome ?? "Motorista", v.placa ?? "veículo")} disabled={ocupado || !selMotorista} style={{ display: "inline-flex", alignItems: "center", gap: 5, background: VINHO, border: "none", borderRadius: 8, padding: "7px 12px", cursor: ocupado || !selMotorista ? "default" : "pointer", fontSize: 12, color: "#fff", fontWeight: 600, fontFamily: SANS, opacity: ocupado || !selMotorista ? 0.55 : 1 }}>
                              <i className="ti ti-link" aria-hidden="true" style={{ fontSize: 14 }} />Vincular
                            </button>
                            <button onClick={() => { setVincVeiId(null); setSelMotorista(""); }} aria-label="Cancelar" style={{ background: "none", border: "none", cursor: "pointer", color: "#9A9DA4", display: "flex", padding: 4 }}>
                              <i className="ti ti-x" aria-hidden="true" style={{ fontSize: 15 }} />
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => { setVincVeiId(v.id); setSelMotorista(""); }} disabled={motoristasLivres.length === 0} title={motoristasLivres.length === 0 ? "Nenhum motorista livre" : "Vincular motorista"} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#FFFFFF", border: "1px solid #CFD6E4", borderRadius: 8, padding: "7px 12px", cursor: motoristasLivres.length === 0 ? "default" : "pointer", fontSize: 12, color: AZUL, fontWeight: 600, fontFamily: SANS, opacity: motoristasLivres.length === 0 ? 0.5 : 1 }}>
                            <i className="ti ti-link" aria-hidden="true" style={{ fontSize: 14 }} />Vincular motorista
                          </button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}

          </div>

          {/* Rodapé */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 24px", borderTop: "1px solid #EDEFF2", background: "#FFFFFF" }}>
            <span style={{ fontSize: 12, color: "#6B6E76" }}>Cadastros · Motoristas e vínculos</span>
            <span style={{ fontSize: 12, color: "#6B6E76" }}><span style={{ color: VINHO, fontWeight: 600 }}>INFOBRIDGE</span> · Transformando dados em economia · © 2026</span>
          </div>

        </div>
      </div>

      {modalAberto && (
        <ModalNovoMotorista onFechar={() => setModalAberto(false)} onCriar={criarMotorista} salvando={salvandoMoto} empresas={empresas} exigeEmpresa={ehAdminTotal()} />
      )}
    </div>
  );
}
