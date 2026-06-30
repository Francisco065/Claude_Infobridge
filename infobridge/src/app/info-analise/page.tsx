"use client";

import { useState, useEffect, useCallback } from "react";
import { apiFetch, salvarSessao, carregarSessao, limparSessao, podeAcessar, primeiraTelaPermitida, ehGestorOuAdmin, ehAdminTotal } from "@/lib/api";
import SemAcesso from "@/components/SemAcesso";
import LoginForm from "@/components/LoginForm";
import BotaoTrocarSenha from "@/components/BotaoTrocarSenha";
import LogoInfobridge from "@/components/LogoInfobridge";

// ── Paleta ────────────────────────────────────────────────────
const VINHO = "#6E1414";
const AZUL = "#3A5BA0";
const VERDE = "#16A34A";
const AMARELO = "#D97706";
const VERMELHO = "#DC2626";
const CINZA = "#9A9DA5";
const TINT = { verde: "#F0FAF3", amarelo: "#FEF7EC", vermelho: "#FDF1F1", neutro: "#F2F3F5" };

const MONO = "'IBM Plex Mono', ui-monospace, monospace";
const SANS = "'IBM Plex Sans', system-ui, sans-serif";

// ── Status semântico (item 1 + 2) ─────────────────────────────
// Cada métrica declara sua POLARIDADE:
//   "maior" → quanto maior, melhor (faixa verde, freio motor, ...)
//   "menor" → quanto menor, melhor (excesso de velocidade, motor parado, ...)
//   "fixo"  → card constante/positivo (Em movimento)
// Além da cor, todo status carrega um ÍCONE DE FORMA e um RÓTULO de texto,
// para que o estado seja legível por daltônicos e em tons de cinza.
type Polaridade = "maior" | "menor" | "fixo";
type Status = { cor: string; tint: string; icon: string; label: string };

const ST_BOM: Status = { cor: VERDE, tint: TINT.verde, icon: "ti-circle-check-filled", label: "Bom" };
const ST_ATENCAO: Status = { cor: AMARELO, tint: TINT.amarelo, icon: "ti-alert-triangle-filled", label: "Atenção" };
const ST_CRITICO: Status = { cor: VERMELHO, tint: TINT.vermelho, icon: "ti-alert-octagon-filled", label: "Crítico" };
// Estado neutro: período sem dados suficientes (nenhuma viagem processada).
const ST_NEUTRO: Status = { cor: CINZA, tint: TINT.neutro, icon: "ti-minus", label: "Sem dados" };

// Cortes iniciais — ponto único de calibração com o time de operação.
const CORTE_MAIOR = { bom: 70, atencao: 40 }; // ≥bom = verde · ≥atencao = amarelo · resto = vermelho
const CORTE_MENOR = { bom: 15, atencao: 35 }; // ≤bom = verde · ≤atencao = amarelo · resto = vermelho

function statusDe(pct: number, pol: Polaridade): Status {
  if (pol === "fixo") return ST_BOM;
  if (pol === "menor") {
    if (pct <= CORTE_MENOR.bom) return ST_BOM;
    if (pct <= CORTE_MENOR.atencao) return ST_ATENCAO;
    return ST_CRITICO;
  }
  // "maior"
  if (pct >= CORTE_MAIOR.bom) return ST_BOM;
  if (pct >= CORTE_MAIOR.atencao) return ST_ATENCAO;
  return ST_CRITICO;
}

// ── Conversão segura para número ──────────────────────────────
function num(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Data "2026-06-01" → "01/06"
function ddmm(s?: string): string {
  if (!s || s.length < 10) return "—";
  return `${s.slice(8, 10)}/${s.slice(5, 7)}`;
}

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
// "2026-06-01" → "Junho 2026"
function mesLabel(iso?: string): string {
  if (!iso || iso.length < 7) return "—";
  const [a, m] = iso.split("-");
  return `${MESES[Number(m) - 1] ?? m} ${a}`;
}

// Chip de identificação (pílula) usado na faixa de filtros
function ChipInfo({ icone, rotulo, valor }: { icone: string; rotulo: string; valor: string }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 7, background: "#FFFFFF",
      border: "1px solid #E7E9ED", borderRadius: 999, padding: "8px 14px", fontSize: 13,
      boxShadow: "0 1px 3px rgba(30,32,40,.04)",
    }}>
      <i className={`ti ${icone}`} aria-hidden style={{ fontSize: 16, color: VINHO }} />
      <span style={{ color: "#6B6E76" }}>{rotulo}</span>
      <span style={{ color: "#33363D", fontWeight: 700 }}>{valor}</span>
    </span>
  );
}

// Cor semântica "quanto maior, melhor" — usada pela nota geral (que é sempre maior-melhor)
function corPorValor(pct: number): string {
  if (pct >= CORTE_MAIOR.bom) return VERDE;
  if (pct >= CORTE_MAIOR.atencao) return AMARELO;
  return VERMELHO;
}

// ── Medidor circular de nota ──────────────────────────────────
function Gauge({ nota, semDados }: { nota: number; semDados?: boolean }) {
  const cor = semDados ? CINZA : corPorValor(nota);
  const label = semDados
    ? "Sem dados"
    : nota >= CORTE_MAIOR.bom ? "Ótimo" : nota >= CORTE_MAIOR.atencao ? "Regular" : "Crítico";
  const r = 54, c = 2 * Math.PI * r;
  return (
    <svg width="150" height="150" viewBox="0 0 150 150" role="img"
      aria-label={semDados ? "Nota de desempenho: sem dados no período" : `Nota de desempenho: ${nota} de 100 — ${label}`}>
      <circle cx="75" cy="75" r={r} fill="none" stroke="#EDEFF2" strokeWidth="12" />
      {!semDados && (
        <circle cx="75" cy="75" r={r} fill="none" stroke={cor} strokeWidth="12"
          strokeDasharray={`${(nota / 100) * c} ${c}`} strokeLinecap="round"
          transform="rotate(-90 75 75)" />
      )}
      <text x="75" y="72" textAnchor="middle" dominantBaseline="central"
        fill={cor} fontSize="34" fontWeight="700" style={{ fontFamily: MONO }}>{semDados ? "—" : nota}</text>
      <text x="75" y="100" textAnchor="middle" fill="#6B6E76" fontSize="12"
        style={{ fontFamily: SANS }}>{label}</text>
    </svg>
  );
}

// ── Barra segmentada (5 segmentos) ────────────────────────────
function Segmentos({ pct, cor }: { pct: number; cor: string }) {
  const cheios = Math.round(pct / 20);
  return (
    <div style={{ display: "flex", gap: 3, margin: "10px 0 8px" }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} style={{ flex: 1, height: 4, borderRadius: 2, background: i < cheios ? cor : "#E7E9ED" }} />
      ))}
    </div>
  );
}

// ── Cartão de comportamento ───────────────────────────────────
// `pol` define a polaridade da métrica (item 1). O status traz cor + ícone de
// forma + rótulo (item 2), garantindo leitura sem depender só da cor.
// Quando `semDados`, o card fica neutro (cinza) e não classifica nada.
function CardComportamento({ nome, pct, pol = "maior", semDados }: {
  nome: string; pct: number; pol?: Polaridade; semDados?: boolean;
}) {
  const valor = pol === "fixo" ? 100 : pct;
  const st = semDados ? ST_NEUTRO : statusDe(valor, pol);
  return (
    <div style={{
      background: "#FFFFFF", border: "1px solid #E7E9ED", borderRadius: 13,
      padding: "14px 15px", boxShadow: `inset 3px 0 0 0 ${st.cor}, 0 1px 3px rgba(30,32,40,.04)`,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontFamily: MONO, fontSize: 24, fontWeight: 600, color: st.cor, fontFeatureSettings: "'tnum'" }}>
          {semDados ? "—" : `${valor.toFixed(pol === "fixo" ? 0 : 1)}%`}
        </span>
        <i className={`ti ${st.icon}`} aria-hidden style={{ fontSize: 18, color: st.cor }} />
      </div>
      <Segmentos pct={semDados ? 0 : valor} cor={st.cor} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
        <span style={{ fontSize: 13, color: "#3A3D44", fontWeight: 500, lineHeight: 1.25 }}>{nome}</span>
        <span style={{
          flexShrink: 0, display: "inline-flex", alignItems: "center", background: st.tint,
          color: st.cor, fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 999,
        }}>{st.label}</span>
      </div>
    </div>
  );
}

// ── Cartão "Em movimento" (tempo em movimento x parado, em horas + %) ──
// Base = tempo de telemetria (ativo). Verde se movimento >= 45%, senão amarelo.
function CardMovimento({ movimentoS, paradoS, semDados }: {
  movimentoS: number; paradoS: number; semDados?: boolean;
}) {
  const [tip, setTip] = useState(false);
  const totalS = movimentoS + paradoS;
  const semTempo = semDados || totalS <= 0;
  const pctMov = totalS > 0 ? (movimentoS / totalS) * 100 : 0;
  const st = semTempo ? ST_NEUTRO : (pctMov >= 45 ? ST_BOM : ST_ATENCAO);
  const h = (s: number) => (s / 3600).toFixed(1);
  return (
    <div style={{
      background: "#FFFFFF", border: "1px solid #E7E9ED", borderRadius: 13,
      padding: "14px 15px", boxShadow: `inset 3px 0 0 0 ${st.cor}, 0 1px 3px rgba(30,32,40,.04)`,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontFamily: MONO, fontSize: 24, fontWeight: 600, color: st.cor, fontFeatureSettings: "'tnum'" }}>
          {semTempo ? "—" : `${pctMov.toFixed(0)}%`}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 7, position: "relative" }}>
          <button
            type="button"
            aria-label="O que significa Em movimento e Parado"
            aria-expanded={tip}
            style={{ cursor: "pointer", background: "none", border: "none", padding: 0, lineHeight: 0, color: "#B4B7BE" }}
            onMouseEnter={() => setTip(true)}
            onMouseLeave={() => setTip(false)}
            onFocus={() => setTip(true)}
            onBlur={() => setTip(false)}
            onClick={() => setTip(v => !v)}
            onKeyDown={e => { if (e.key === "Escape") setTip(false); }}
          >
            <i className="ti ti-info-circle" aria-hidden="true" style={{ fontSize: 15, color: "#B4B7BE" }} />
          </button>
          {tip && (
            <div role="tooltip" style={{
              position: "absolute", top: 22, right: 0, zIndex: 20, background: "#1F2024", color: "#fff",
              borderRadius: 10, padding: "10px 12px", fontSize: 11.5, width: 214, lineHeight: 1.55, textAlign: "left",
              boxShadow: "0 10px 30px rgba(0,0,0,.25)", animation: "fadeUp .15s ease",
            }}>
              <b>Em movimento</b>: tempo com o veículo em deslocamento (velocidade &gt; 0).<br />
              <b>Parado</b>: tempo ligado, mas sem deslocamento.<br />
              Base: tempo com telemetria no período. Fica verde quando o movimento é ≥ 45%.
            </div>
          )}
          <i className={`ti ${st.icon}`} aria-hidden style={{ fontSize: 18, color: st.cor }} />
        </div>
      </div>
      <Segmentos pct={semTempo ? 0 : pctMov} cor={st.cor} />
      <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 2 }}>
        <span style={{ fontSize: 13, color: "#3A3D44", fontWeight: 500 }}>Horas produtivas</span>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#5A5D65" }}>
          <span><i className="ti ti-steering-wheel" aria-hidden style={{ fontSize: 12, marginRight: 3, color: st.cor }} />
            {semTempo ? "—" : `${h(movimentoS)}h`}</span>
          <span style={{ color: "#6B6E76" }}>Parado {semTempo ? "—" : `${h(paradoS)}h`}</span>
        </div>
      </div>
    </div>
  );
}

// ── Aviso de período sem dados ────────────────────────────────
function AvisoSemDados() {
  return (
    <div role="status" style={{
      display: "flex", alignItems: "flex-start", gap: 10, background: TINT.neutro,
      border: "1px solid #E2E4E9", borderRadius: 12, padding: "13px 16px", marginBottom: 20,
    }}>
      <i className="ti ti-info-circle" aria-hidden="true" style={{ fontSize: 18, color: "#6B6E76", marginTop: 1 }} />
      <div style={{ fontSize: 13, color: "#5A5D65", lineHeight: 1.5 }}>
        <b style={{ color: "#3A3D44" }}>Período sem viagens processadas.</b> Os indicadores de comportamento e a nota
        de desempenho são calculados após coletar dados de telemetria e registrar quilometragem neste período — por isso
        aparecem como <i>“Sem dados”</i>. Caso julgue que os dados estão errados, entre em contato com o suporte.
      </div>
    </div>
  );
}

// ── Linha do acelerador ───────────────────────────────────────
function LinhaAcel({ nome, valor, cor }: { nome: string; valor: number; cor: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 0", boxShadow: `inset 3px 0 0 0 ${cor}`, paddingLeft: 12 }}>
      <span style={{ flex: "0 0 80px", fontSize: 13, color: "#3A3D44", fontWeight: 500 }}>{nome}</span>
      <span style={{ flex: "0 0 56px", fontFamily: MONO, fontSize: 14, fontWeight: 600, color: cor, fontFeatureSettings: "'tnum'" }}>
        {valor.toFixed(1)}%
      </span>
      <div style={{ flex: 1, height: 8, borderRadius: 5, background: "#EDEFF2", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${Math.min(valor, 100)}%`, background: cor, borderRadius: 5 }} />
      </div>
    </div>
  );
}

// ── Cartão de estatística (chip de ícone + valor + rótulo) ────
function CardStat({ icone, valor, rotulo, chipBg, chipCor }: {
  icone: string; valor: string; rotulo: string; chipBg?: string; chipCor?: string;
}) {
  return (
    <div style={{
      background: "#FFFFFF", border: "1px solid #E7E9ED", borderRadius: 13,
      padding: 14, display: "flex", alignItems: "center", gap: 12, boxShadow: "0 1px 3px rgba(30,32,40,.04)",
    }}>
      <span style={{
        flex: "0 0 36px", width: 36, height: 36, borderRadius: 10, display: "flex",
        alignItems: "center", justifyContent: "center", background: chipBg ?? "#F4EDED",
      }}>
        <i className={`ti ${icone}`} aria-hidden style={{ fontSize: 18, color: chipCor ?? VINHO }} />
      </span>
      <div style={{ minWidth: 0 }}>
        <p style={{ fontFamily: MONO, fontSize: 16, fontWeight: 600, color: "#1F2024", fontFeatureSettings: "'tnum'", margin: 0 }}>{valor}</p>
        <p style={{ fontSize: 12, color: "#5A5D65", margin: "2px 0 0" }}>{rotulo}</p>
      </div>
    </div>
  );
}

// ── Título de seção ───────────────────────────────────────────
function TituloSecao({ children, icone }: { children: React.ReactNode; icone?: string }) {
  return (
    <h2 style={{
      fontSize: 11, fontWeight: 600, letterSpacing: 1.4, textTransform: "uppercase",
      color: "#6B6E76", margin: "0 0 12px", display: "flex", alignItems: "center", gap: 7,
    }}>
      {icone && <i className={`ti ${icone}`} aria-hidden style={{ fontSize: 15, color: VINHO }} />}
      {children}
    </h2>
  );
}

// ── Logotipo Infobridge (marca ponte + caminhão, em vinho) ────


// ── Página principal ──────────────────────────────────────────
export default function InfoAnalisePage() {
  const [token, setToken] = useState<string | null>(null);
  const [nomeUsuario, setNomeUsuario] = useState("");
  const [indicadores, setIndicadores] = useState<any[]>([]);
  const [motoristaSel, setMotoristaSel] = useState("");   // id do motorista
  const [periodoSel, setPeriodoSel] = useState("");       // chave "inicio|fim"
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");
  const [tooltipAcel, setTooltipAcel] = useState(false);
  const [menuAberto, setMenuAberto] = useState(false);

  // Fecha o menu de navegação ao pressionar Esc
  useEffect(() => {
    if (!menuAberto) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuAberto(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuAberto]);

  const buscarIndicadores = useCallback(async (tk: string) => {
    setCarregando(true); setErro("");
    try {
      // limite alto para trazer 100% dos indicadores (sem cortar em 50)
      const res = await apiFetch<{ dados: any[] }>("/indicadores?limite=1000", tk);
      const dados = res.dados ?? [];
      setIndicadores(dados);
      // Padrão: primeiro motorista (período resolvido no render).
      // Deep-link: /info-analise?veiculo=<id> pré-seleciona o motorista desse veículo.
      if (dados.length) {
        let motoristaAlvo = dados[0].motorista?.id ?? "";
        try {
          const veic = new URLSearchParams(window.location.search).get("veiculo");
          if (veic) {
            const m = dados.find((i) => i.veiculo?.id === veic)?.motorista?.id;
            if (m) motoristaAlvo = m;
          }
        } catch { /* ignora */ }
        setMotoristaSel(motoristaAlvo);
        setPeriodoSel("");
      }
    } catch (e: any) {
      const msg = e.message ?? "Erro ao carregar indicadores";
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
      buscarIndicadores(sessao.token);
    }
  }, [buscarIndicadores]);

  function handleLogin(tk: string, nome: string) {
    salvarSessao(tk, nome);
    setToken(tk); setNomeUsuario(nome);
    buscarIndicadores(tk);
  }

  if (!token) return <LoginForm onLogin={handleLogin} />;
  if (!podeAcessar("info-analise")) return <SemAcesso destino={primeiraTelaPermitida()} />;

  // ── Filtros derivados: Motorista e Período (independentes) ──
  const motoristasOpc = (() => {
    const vistos = new Set<string>();
    const lista: { id: string; nome: string }[] = [];
    for (const i of indicadores) {
      const id = i.motorista?.id;
      if (id && !vistos.has(id)) { vistos.add(id); lista.push({ id, nome: i.motorista?.nome ?? "—" }); }
    }
    return lista.sort((a, b) => a.nome.localeCompare(b.nome));
  })();

  // Períodos do motorista, DEDUPLICADOS por mês: para cada mês mantém a linha
  // de maior periodoFim (a que reflete todos os dados acumulados do mês).
  const periodosOpc = (() => {
    const porMes = new Map<string, { key: string; inicio: string; fim: string; mes: string }>();
    for (const i of indicadores) {
      if (i.motorista?.id !== motoristaSel) continue;
      const mes = (i.periodoInicio ?? "").slice(0, 7); // YYYY-MM
      const cur = porMes.get(mes);
      if (!cur || (i.periodoFim ?? "") > cur.fim) {
        porMes.set(mes, { key: `${i.periodoInicio}|${i.periodoFim}`, inicio: i.periodoInicio, fim: i.periodoFim, mes });
      }
    }
    return [...porMes.values()].sort((a, b) => (a.mes < b.mes ? 1 : -1)); // mês mais recente primeiro
  })();

  function trocarMotorista(id: string) {
    setMotoristaSel(id);
    setPeriodoSel(""); // período é resolvido pelo fallback abaixo
  }

  // Período ativo: o selecionado (se ainda existir) ou o mais recente do motorista
  const periodoAtivo = periodosOpc.find((p) => p.key === periodoSel)?.key ?? periodosOpc[0]?.key ?? "";

  const d = indicadores.find(
    (i) => i.motorista?.id === motoristaSel && `${i.periodoInicio}|${i.periodoFim}` === periodoAtivo,
  ) ?? null;
  const hoje = new Date().toLocaleDateString("pt-BR");
  // Período sem telemetria suficiente: nenhuma quilometragem registrada.
  const semDados = !!d && num(d.kmTotal) <= 0;

  return (
    <div className="ib-page" style={{ minHeight: "100vh", background: "#E9EBEF", fontFamily: SANS }}>
      {/* estilos globais auxiliares (ícones + animação do tooltip) */}
      <style>{`
        .ti { font-family: 'tabler-icons' !important; font-style: normal; }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(4px);} to { opacity: 1; transform: translateY(0);} }

        /* Layout responsivo */
        .ib-page { padding: 30px; }
        .ib-layout { display: grid; grid-template-columns: 1fr 300px; gap: 18px; align-items: start; }
        .ib-pos-comp { grid-column: 1; grid-row: 1; }
        .ib-pos-nota { grid-column: 2; grid-row: 1; }
        .ib-pos-viagem { grid-column: 1; grid-row: 2; }
        .ib-pos-acel { grid-column: 2; grid-row: 2 / span 2; }
        .ib-pos-rodagem { grid-column: 1; grid-row: 3; }
        .ib-split { display: grid; grid-template-columns: 300px 1fr; gap: 18px; margin-bottom: 18px; align-items: start; }
        .ib-cards3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 11px; }
        .ib-cards4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 11px; }
        .ib-select { min-width: 360px; max-width: 100%; }

        /* Tablet / telas médias */
        @media (max-width: 900px) {
          .ib-layout { grid-template-columns: 1fr; }
          .ib-pos-comp, .ib-pos-nota, .ib-pos-viagem, .ib-pos-acel, .ib-pos-rodagem {
            grid-column: auto; grid-row: auto;
          }
          .ib-split { grid-template-columns: 1fr; }
          .ib-cards4 { grid-template-columns: repeat(2, 1fr); }
        }
        /* Celular */
        @media (max-width: 640px) {
          .ib-page { padding: 12px; }
          .ib-cards3 { grid-template-columns: repeat(2, 1fr); }
          .ib-select { min-width: 0; width: 100%; }
          .ib-header { flex-wrap: wrap; gap: 12px; }
        }
        @media (max-width: 420px) {
          .ib-cards3, .ib-cards4 { grid-template-columns: 1fr; }
        }
      `}</style>

      <div style={{
        maxWidth: 1120, margin: "0 auto", background: "#FFFFFF", border: "1px solid #E2E4E9",
        borderRadius: 18, boxShadow: "0 12px 40px rgba(30,32,40,.10)", overflow: "hidden",
      }}>
        {/* Cabeçalho */}
        <div className="ib-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 24px", borderBottom: "1px solid #EDEFF2", position: "relative", zIndex: 30 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <LogoInfobridge height={38} />
              <div style={{ borderLeft: "1px solid #E2E4E9", paddingLeft: 14 }}>
                <p style={{ fontSize: 8, letterSpacing: 2.4, color: VINHO, textTransform: "uppercase", margin: 0 }}>Infobridge</p>
                <h1 style={{ fontSize: 16, fontWeight: 700, color: "#1F2024", margin: "2px 0 0" }}>Info Análise</h1>
              </div>
            </div>

            {/* Navegação (mesma lógica do menu de Cadastros) */}
            <nav style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: 6 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: VINHO, background: "#F6F2F2", fontWeight: 600, padding: "8px 12px", borderRadius: 9 }}>
                <i className="ti ti-chart-dots" aria-hidden style={{ fontSize: 16 }} />Info Análise
              </span>

              <a href="/mapa-ao-vivo" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "#5A5D65", textDecoration: "none", fontWeight: 500, padding: "8px 12px", borderRadius: 9 }}>
                <i className="ti ti-map-2" aria-hidden style={{ fontSize: 16 }} />Mapa ao vivo
              </a>
              {ehGestorOuAdmin() && (
                <a href="/usuarios" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "#5A5D65", textDecoration: "none", fontWeight: 500, padding: "8px 12px", borderRadius: 9 }}>
                  <i className="ti ti-users" aria-hidden style={{ fontSize: 16 }} />Usuários
                </a>
              )}
              {ehAdminTotal() && (
                <a href="/empresas" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "#5A5D65", textDecoration: "none", fontWeight: 500, padding: "8px 12px", borderRadius: 9 }}>
                  <i className="ti ti-building-warehouse" aria-hidden style={{ fontSize: 16 }} />Empresas
                </a>
              )}

              <div style={{ position: "relative" }}>
                <button onClick={() => setMenuAberto((a) => !a)} aria-haspopup="menu" aria-expanded={menuAberto}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "#5A5D65", background: menuAberto ? "#EFF0F3" : "transparent", border: "none", fontWeight: 500, padding: "8px 12px", borderRadius: 9, cursor: "pointer", fontFamily: SANS }}>
                  <i className="ti ti-folder" aria-hidden style={{ fontSize: 16 }} />Cadastros
                  <i className={`ti ${menuAberto ? "ti-chevron-up" : "ti-chevron-down"}`} aria-hidden style={{ fontSize: 14, opacity: 0.7 }} />
                </button>

                {menuAberto && (
                  <div role="menu" style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 40, width: 248, background: "#FFFFFF", border: "1px solid #E7E9ED", borderRadius: 13, boxShadow: "0 14px 38px rgba(30,32,40,.16)", padding: 6 }}>
                    {[
                      { href: "/cadastros", icon: "ti-id-badge-2", bg: "#F4EDED", cor: VINHO, titulo: "Motoristas", desc: "Criar, buscar e vincular" },
                      { href: "/cadastros?tela=vei", icon: "ti-truck", bg: "#EEF0F6", cor: AZUL, titulo: "Veículos", desc: "Frota e quem dirige cada um" },
                    ].map((it) => (
                      <a key={it.href} href={it.href} role="menuitem"
                        style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 11px", borderRadius: 10, textDecoration: "none" }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "#F6F2F2")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                        <span style={{ flexShrink: 0, width: 34, height: 34, borderRadius: 9, background: it.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <i className={`ti ${it.icon}`} aria-hidden style={{ fontSize: 17, color: it.cor }} />
                        </span>
                        <span style={{ flex: 1 }}>
                          <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#1F2024" }}>{it.titulo}</span>
                          <span style={{ display: "block", fontSize: 11, color: "#8A8D96", marginTop: 1 }}>{it.desc}</span>
                        </span>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </nav>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ width: 32, height: 32, borderRadius: "50%", background: "#F4EDED", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <i className="ti ti-user" aria-hidden style={{ fontSize: 17, color: VINHO }} />
            </span>
            <span style={{ fontSize: 13, color: "#33363D", fontWeight: 500 }}>{nomeUsuario || "Administrador"}</span>
            {token && <BotaoTrocarSenha token={token} />}
            <button onClick={() => { limparSessao(); setToken(null); }}
              style={{ display: "flex", alignItems: "center", gap: 6, background: "#FFFFFF", border: "1px solid #DDE0E6", borderRadius: 9, padding: "7px 12px", fontSize: 13, color: "#5A5D65", cursor: "pointer", fontFamily: SANS }}>
              <i className="ti ti-logout" aria-hidden style={{ fontSize: 15 }} /> Sair
            </button>
          </div>
        </div>

        {/* Backdrop de clique-fora do menu */}
        {menuAberto && <div onClick={() => setMenuAberto(false)} style={{ position: "fixed", inset: 0, zIndex: 25, background: "transparent" }} />}

        {/* Faixa de filtros: seletor à esquerda, chips de identificação à direita */}
        <div className="ib-filtros" style={{ background: "#F6F7F9", padding: "14px 24px", borderBottom: "1px solid #EDEFF2", display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            {/* Filtro 1: Motorista */}
            <div>
              <label htmlFor="ib-motorista" style={{ fontSize: 11, color: "#6B6E76", textTransform: "uppercase", letterSpacing: 1.2, display: "block", marginBottom: 6 }}>Motorista</label>
              <select
                id="ib-motorista"
                value={motoristaSel}
                onChange={(e) => trocarMotorista(e.target.value)}
                className="ib-select"
                style={{ background: "#FFFFFF", border: "1px solid #E2E4E9", borderRadius: 10, padding: "9px 12px", fontSize: 13, color: "#1F2024", fontFamily: SANS, minWidth: 210 }}
              >
                {motoristasOpc.length === 0 && <option value="">—</option>}
                {motoristasOpc.map((m) => (
                  <option key={m.id} value={m.id}>{m.nome}</option>
                ))}
              </select>
            </div>

            {/* Filtro 2: Período */}
            <div>
              <label htmlFor="ib-periodo" style={{ fontSize: 11, color: "#6B6E76", textTransform: "uppercase", letterSpacing: 1.2, display: "block", marginBottom: 6 }}>Período</label>
              <select
                id="ib-periodo"
                value={periodoAtivo}
                onChange={(e) => setPeriodoSel(e.target.value)}
                className="ib-select"
                style={{ background: "#FFFFFF", border: "1px solid #E2E4E9", borderRadius: 10, padding: "9px 12px", fontSize: 13, color: "#1F2024", fontFamily: SANS, minWidth: 210 }}
              >
                {periodosOpc.length === 0 && <option value="">—</option>}
                {periodosOpc.map((p) => (
                  <option key={p.key} value={p.key}>{mesLabel(p.inicio)} (até {ddmm(p.fim)})</option>
                ))}
              </select>
            </div>
          </div>

          {d && (
            <div className="ib-chips" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <ChipInfo icone="ti-truck" rotulo="Placa" valor={d.veiculo?.placa ?? "—"} />
              <ChipInfo icone="ti-id-badge-2" rotulo="Motorista" valor={d.motorista?.nome ?? "—"} />
              <ChipInfo icone="ti-calendar" rotulo="Período" valor={`${ddmm(d.periodoInicio)} → ${ddmm(d.periodoFim)}`} />
            </div>
          )}
        </div>

        {/* Conteúdo */}
        <div style={{ background: "#F6F7F9", padding: 24 }}>
          {carregando && <div style={{ textAlign: "center", padding: 80, color: "#6B6E76" }}>Carregando dados...</div>}
          {erro && <div role="alert" style={{ background: TINT.vermelho, border: `1px solid ${VERMELHO}33`, borderRadius: 12, padding: 16, color: VERMELHO, fontSize: 14, marginBottom: 20 }}>{erro}</div>}

          {!carregando && !d && !erro && (
            <div style={{ textAlign: "center", padding: 80, color: "#6B6E76" }}>
              <p style={{ fontSize: 18, margin: "0 0 8px", color: "#5A5D65" }}>Nenhum indicador encontrado</p>
              <p style={{ fontSize: 14, margin: 0 }}>Os dados aparecem após o worker de telemetria processar as viagens.</p>
            </div>
          )}

          {d && semDados && <AvisoSemDados />}

          {d && (
            <div className="ib-layout">
              {/* Comportamento de Condução — esquerda, linha 1 */}
              <div className="ib-pos-comp">
                <TituloSecao icone="ti-steering-wheel">Comportamento de Condução</TituloSecao>
                <div className="ib-cards3">
                  <CardComportamento nome="Faixa verde" pct={num(d.percFaixaVerdeInicial)} pol="maior" semDados={semDados} />
                  <CardComportamento nome="Aproveitamento de embalo" pct={num(d.percEmbalo)} pol="maior" semDados={semDados} />
                  <CardComportamento nome="Motor ligado parado" pct={num(d.percMotorOcioso)} pol="menor" semDados={semDados} />
                  <CardComportamento nome="Acelerando acima do verde" pct={num(d.percAcelCritico)} pol="menor" semDados={semDados} />
                  <CardComportamento nome="Excesso de velocidade" pct={num(d.percExcessoVelocidade)} pol="menor" semDados={semDados} />
                  <CardComportamento nome="Faixa verde total" pct={num(d.percFaixaVerdeInicial) + num(d.percFaixaVerdeFinal)} pol="maior" semDados={semDados} />
                  <CardComportamento nome="Faixa verde final" pct={num(d.percFaixaVerdeFinal)} pol="maior" semDados={semDados} />
                  <CardComportamento nome="Freio motor" pct={num(d.percFreioMotorOk)} pol="maior" semDados={semDados} />
                  <CardMovimento movimentoS={num(d.tempoMovimentoS)} paradoS={num(d.tempoParadoS)} semDados={semDados} />
                </div>
              </div>

              {/* Nota de Desempenho — direita, linha 1 (alinhada ao Comportamento) */}
              <div className="ib-pos-nota" style={{ background: "#FFFFFF", border: "1px solid #E7E9ED", borderRadius: 14, padding: 20, boxShadow: "0 1px 3px rgba(30,32,40,.04)" }}>
                <TituloSecao icone="ti-gauge">Nota de Desempenho</TituloSecao>
                <div style={{ display: "flex", justifyContent: "center", margin: "4px 0 12px" }}>
                  <Gauge nota={Math.round(num(d.notaDesempenho))} semDados={semDados} />
                </div>
                <div style={{ borderTop: "1px solid #EDEFF2", paddingTop: 12, display: "flex", flexDirection: "column", gap: 7 }}>
                  {[
                    ["Marca", d.veiculo?.marca], ["Ano", d.veiculo?.anoFabricacao],
                    ["Frota", d.veiculo?.frota], ["Modelo", d.veiculo?.modelo],
                  ].map(([k, v]) => (
                    <div key={String(k)} style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                      <span style={{ fontSize: 12, color: "#6B6E76" }}>{k}</span>
                      <span style={{ fontSize: 12, color: "#33363D", fontWeight: 700, textAlign: "right" }}>{v ?? "—"}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Dados da Viagem — esquerda, linha 2 */}
              <div className="ib-pos-viagem">
                <TituloSecao icone="ti-route">Dados da Viagem</TituloSecao>
                <div className="ib-cards4">
                  <CardStat icone="ti-map-pin" rotulo="Km total" valor={`${num(d.kmTotal).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} km`} />
                  <CardStat icone="ti-brand-speedtest" rotulo="Velocidade média" valor={`${num(d.velocidadeMediaKmh).toFixed(1)} km/h`} />
                  <CardStat icone="ti-droplet" rotulo="Consumo total" valor={`${num(d.consumoTotalLitros).toFixed(1)} L`} />
                  <CardStat icone="ti-trending-up" rotulo="Média km/L" valor={`${num(d.mediaKmL).toFixed(2)} km/L`} />
                </div>
              </div>

              {/* Pressão do Acelerador — direita, linha 2 (alinhada a Dados da Viagem) */}
              <div className="ib-pos-acel" style={{ background: "#FFFFFF", border: "1px solid #E7E9ED", borderRadius: 14, padding: 20, boxShadow: "0 1px 3px rgba(30,32,40,.04)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", position: "relative" }}>
                  <TituloSecao>Pressão do Acelerador</TituloSecao>
                  <button
                    type="button"
                    aria-label="Legenda de cores: verde bom, amarelo atenção, vermelho crítico"
                    aria-expanded={tooltipAcel}
                    style={{ background: "none", border: "none", padding: 0, cursor: "pointer", position: "relative", marginTop: -8, color: "#B4B7BE", lineHeight: 1 }}
                    onMouseEnter={() => setTooltipAcel(true)}
                    onMouseLeave={() => setTooltipAcel(false)}
                    onFocus={() => setTooltipAcel(true)}
                    onBlur={() => setTooltipAcel(false)}
                    onClick={() => setTooltipAcel(v => !v)}
                    onKeyDown={(e) => { if (e.key === "Escape") setTooltipAcel(false); }}
                  >
                    <i className="ti ti-info-circle" aria-hidden style={{ fontSize: 16 }} />
                    {tooltipAcel && (
                      <div role="tooltip" style={{
                        position: "absolute", top: 22, right: 0, zIndex: 20, background: "#1F2024", color: "#fff",
                        borderRadius: 10, padding: "11px 12px", fontSize: 12, width: 178, lineHeight: 1.5,
                        boxShadow: "0 10px 30px rgba(0,0,0,.25)", animation: "fadeUp .15s ease", textAlign: "left",
                      }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                          <span style={{ display: "flex", alignItems: "center", gap: 8 }}><i className="ti ti-circle-check-filled" aria-hidden style={{ fontSize: 14, color: VERDE }} />Verde — Bom</span>
                          <span style={{ display: "flex", alignItems: "center", gap: 8 }}><i className="ti ti-alert-triangle-filled" aria-hidden style={{ fontSize: 14, color: AMARELO }} />Amarelo — Atenção</span>
                          <span style={{ display: "flex", alignItems: "center", gap: 8 }}><i className="ti ti-alert-octagon-filled" aria-hidden style={{ fontSize: 14, color: VERMELHO }} />Vermelho — Crítico</span>
                        </div>
                      </div>
                    )}
                  </button>
                </div>
                <div style={{ marginTop: 6 }}>
                  <LinhaAcel nome="Ideal" valor={num(d.percAcelIdeal)} cor={VERDE} />
                  <LinhaAcel nome="Atenção" valor={num(d.percAcelAtencao)} cor={AMARELO} />
                  <LinhaAcel nome="Crítico" valor={num(d.percAcelCritico)} cor={VERMELHO} />
                </div>
              </div>

              {/* Rodagem & Frenagem — esquerda, linha 3 */}
              <div className="ib-pos-rodagem">
                <TituloSecao icone="ti-disc">Rodagem & Frenagem</TituloSecao>
                <div className="ib-cards4">
                  <CardStat icone="ti-refresh" rotulo="Odômetro" valor={`${num(d.odometroFinalKm).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} km`} />
                  <CardStat icone="ti-alert-triangle" chipBg={TINT.amarelo} chipCor={AMARELO}
                    rotulo="Freadas alta vel." valor={String(d.frenagenAltaVelocidade ?? 0)} />
                  <CardStat icone="ti-alert-circle" chipBg={TINT.vermelho} chipCor={VERMELHO}
                    rotulo="Freadas totais" valor={String(d.frenagensTotais ?? 0)} />
                  <CardStat icone="ti-percentage" rotulo="Freadas / 100 km" valor={num(d.frenagensPor100km).toFixed(1)} />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Rodapé */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 24px", borderTop: "1px solid #EDEFF2", background: "#FFFFFF" }}>
          <span style={{ fontSize: 12, color: "#6B6E76" }}>Atualizado em {hoje}</span>
          <span style={{ fontSize: 12, color: "#6B6E76" }}>
            <span style={{ color: VINHO, fontWeight: 600 }}>INFOBRIDGE</span> · Transformando dados em economia · © 2026
          </span>
        </div>
      </div>
    </div>
  );
}
