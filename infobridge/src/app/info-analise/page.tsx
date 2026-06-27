"use client";

import { useState, useEffect, useCallback } from "react";
import { apiLogin, apiFetch, salvarSessao, carregarSessao, limparSessao } from "@/lib/api";

// ── Paleta ────────────────────────────────────────────────────
const VINHO = "#6E1414";
const VERDE = "#16A34A";
const AMARELO = "#D97706";
const VERMELHO = "#DC2626";
const TINT = { verde: "#F0FAF3", amarelo: "#FEF7EC", vermelho: "#FDF1F1" };

const MONO = "'IBM Plex Mono', ui-monospace, monospace";
const SANS = "'IBM Plex Sans', system-ui, sans-serif";

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

// Chip de identificação (pílula) usado na faixa de filtros
function ChipInfo({ icone, rotulo, valor }: { icone: string; rotulo: string; valor: string }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 7, background: "#FFFFFF",
      border: "1px solid #E7E9ED", borderRadius: 999, padding: "8px 14px", fontSize: 13,
      boxShadow: "0 1px 3px rgba(30,32,40,.04)",
    }}>
      <i className={`ti ${icone}`} style={{ fontSize: 16, color: VINHO }} />
      <span style={{ color: "#8A8D96" }}>{rotulo}</span>
      <span style={{ color: "#33363D", fontWeight: 700 }}>{valor}</span>
    </span>
  );
}

// Cor semântica uniforme pelo valor exibido (≥70 bom, ≥40 atenção, <40 crítico)
function corPorValor(pct: number): string {
  if (pct >= 70) return VERDE;
  if (pct >= 40) return AMARELO;
  return VERMELHO;
}
function tintPorValor(pct: number): string {
  if (pct >= 70) return TINT.verde;
  if (pct >= 40) return TINT.amarelo;
  return TINT.vermelho;
}

// ── Medidor circular de nota ──────────────────────────────────
function Gauge({ nota }: { nota: number }) {
  const cor = corPorValor(nota);
  const label = nota >= 70 ? "Ótimo" : nota >= 40 ? "Regular" : "Crítico";
  const r = 54, c = 2 * Math.PI * r;
  return (
    <svg width="150" height="150" viewBox="0 0 150 150">
      <circle cx="75" cy="75" r={r} fill="none" stroke="#EDEFF2" strokeWidth="12" />
      <circle cx="75" cy="75" r={r} fill="none" stroke={cor} strokeWidth="12"
        strokeDasharray={`${(nota / 100) * c} ${c}`} strokeLinecap="round"
        transform="rotate(-90 75 75)" />
      <text x="75" y="72" textAnchor="middle" dominantBaseline="central"
        fill={cor} fontSize="34" fontWeight="700" style={{ fontFamily: MONO }}>{nota}</text>
      <text x="75" y="100" textAnchor="middle" fill="#8A8D96" fontSize="12"
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
function CardComportamento({ nome, pct, icone, forcarVerde }: {
  nome: string; pct: number; icone?: string; forcarVerde?: boolean;
}) {
  const valor = forcarVerde ? 100 : pct;
  const cor = forcarVerde ? VERDE : corPorValor(valor);
  return (
    <div style={{
      background: "#FFFFFF", border: "1px solid #E7E9ED", borderRadius: 13,
      padding: "14px 15px", boxShadow: `inset 3px 0 0 0 ${cor}, 0 1px 3px rgba(30,32,40,.04)`,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontFamily: MONO, fontSize: 24, fontWeight: 600, color: cor, fontFeatureSettings: "'tnum'" }}>
          {valor.toFixed(forcarVerde ? 0 : 1)} %
        </span>
        {icone && <i className={`ti ${icone}`} style={{ fontSize: 18, color: cor }} />}
      </div>
      <Segmentos pct={valor} cor={cor} />
      <span style={{ fontSize: 13, color: "#3A3D44", fontWeight: 500 }}>{nome}</span>
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
        <i className={`ti ${icone}`} style={{ fontSize: 18, color: chipCor ?? VINHO }} />
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
      color: "#8A8D96", margin: "0 0 12px", display: "flex", alignItems: "center", gap: 7,
    }}>
      {icone && <i className={`ti ${icone}`} style={{ fontSize: 15, color: VINHO }} />}
      {children}
    </h2>
  );
}

// ── Logotipo Infobridge (marca ponte + caminhão, em vinho) ────
function LogoInfobridge({ height = 38 }: { height?: number }) {
  return (
    <svg height={height} viewBox="0 0 120 76" fill="none" aria-label="Infobridge">
      <g stroke={VINHO} strokeWidth="3.4" strokeLinecap="round" fill="none">
        {/* torres */}
        <line x1="40" y1="10" x2="40" y2="60" />
        <line x1="80" y1="10" x2="80" y2="60" />
        {/* cabo principal (catenária central) */}
        <path d="M40 12 Q60 40 80 12" />
        {/* cabos laterais até o tabuleiro */}
        <path d="M40 12 Q20 42 6 60" />
        <path d="M80 12 Q100 42 114 60" />
        {/* pendurais */}
        <line x1="50" y1="20" x2="50" y2="60" strokeWidth="1.6" />
        <line x1="60" y1="26" x2="60" y2="60" strokeWidth="1.6" />
        <line x1="70" y1="20" x2="70" y2="60" strokeWidth="1.6" />
        <line x1="26" y1="33" x2="26" y2="60" strokeWidth="1.6" />
        <line x1="94" y1="33" x2="94" y2="60" strokeWidth="1.6" />
        {/* tabuleiro */}
        <line x1="5" y1="60" x2="115" y2="60" />
      </g>
      {/* caminhão central */}
      <g fill={VINHO}>
        <rect x="52" y="40" width="16" height="14" rx="2.5" />
        <rect x="64" y="44" width="6" height="10" rx="1.5" />
        <circle cx="56" cy="56" r="3" />
        <circle cx="66" cy="56" r="3" />
      </g>
    </svg>
  );
}

// ── Tela de login (tema claro) ────────────────────────────────
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
            <p style={{ fontSize: 16, fontWeight: 700, color: "#1F2024", margin: "2px 0 0" }}>Info Análise</p>
          </div>
        </div>
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={{ fontSize: 12, color: "#5A5D65", display: "block", marginBottom: 5 }}>E-mail</label>
            <input style={input} type="email" value={email} onChange={e => setEmail(e.target.value)} required />
          </div>
          <div>
            <label style={{ fontSize: 12, color: "#5A5D65", display: "block", marginBottom: 5 }}>Senha</label>
            <input style={input} type="password" value={senha} onChange={e => setSenha(e.target.value)} required />
          </div>
          {erro && <p style={{ color: VERMELHO, fontSize: 12, margin: 0 }}>{erro}</p>}
          <button style={{ width: "100%", background: VINHO, color: "#fff", borderRadius: 10, padding: "11px", fontSize: 14, fontWeight: 600, border: "none", cursor: "pointer", opacity: carregando ? 0.6 : 1 }}
            disabled={carregando}>{carregando ? "Entrando..." : "Entrar"}</button>
        </form>
      </div>
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────
export default function InfoAnalisePage() {
  const [token, setToken] = useState<string | null>(null);
  const [nomeUsuario, setNomeUsuario] = useState("");
  const [indicadores, setIndicadores] = useState<any[]>([]);
  const [selecionado, setSelecionado] = useState<any | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");
  const [tooltipAcel, setTooltipAcel] = useState(false);

  const buscarIndicadores = useCallback(async (tk: string) => {
    setCarregando(true); setErro("");
    try {
      const res = await apiFetch<{ dados: any[] }>("/indicadores?limite=50", tk);
      setIndicadores(res.dados ?? []);
      if (res.dados?.length) setSelecionado(res.dados[0]);
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

  const d = selecionado;
  const hoje = new Date().toLocaleDateString("pt-BR");

  return (
    <div className="ib-page" style={{ minHeight: "100vh", background: "#E9EBEF", fontFamily: SANS }}>
      {/* estilos globais auxiliares (ícones + animação do tooltip) */}
      <style>{`
        .ti { font-family: 'tabler-icons' !important; font-style: normal; }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(4px);} to { opacity: 1; transform: translateY(0);} }

        /* Layout responsivo */
        .ib-page { padding: 30px; }
        .ib-layout { display: grid; grid-template-columns: 1fr 300px; gap: 18px; align-items: start; }
        .ib-main { display: flex; flex-direction: column; gap: 18px; }
        .ib-side { display: flex; flex-direction: column; gap: 18px; }
        .ib-split { display: grid; grid-template-columns: 300px 1fr; gap: 18px; margin-bottom: 18px; align-items: start; }
        .ib-cards3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 11px; }
        .ib-cards4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 11px; }
        .ib-select { min-width: 360px; max-width: 100%; }

        /* Tablet / telas médias */
        @media (max-width: 900px) {
          .ib-layout { grid-template-columns: 1fr; }
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
        <div className="ib-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 24px", borderBottom: "1px solid #EDEFF2" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <LogoInfobridge height={38} />
            <div style={{ borderLeft: "1px solid #E2E4E9", paddingLeft: 14 }}>
              <p style={{ fontSize: 8, letterSpacing: 2.4, color: VINHO, textTransform: "uppercase", margin: 0 }}>Infobridge</p>
              <h1 style={{ fontSize: 16, fontWeight: 700, color: "#1F2024", margin: "2px 0 0" }}>Info Análise</h1>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ width: 32, height: 32, borderRadius: "50%", background: "#F4EDED", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <i className="ti ti-user" style={{ fontSize: 17, color: VINHO }} />
            </span>
            <span style={{ fontSize: 13, color: "#33363D", fontWeight: 500 }}>{nomeUsuario || "Administrador"}</span>
            <button onClick={() => { limparSessao(); setToken(null); }}
              style={{ display: "flex", alignItems: "center", gap: 6, background: "#FFFFFF", border: "1px solid #DDE0E6", borderRadius: 9, padding: "7px 12px", fontSize: 13, color: "#5A5D65", cursor: "pointer", fontFamily: SANS }}>
              <i className="ti ti-logout" style={{ fontSize: 15 }} /> Sair
            </button>
          </div>
        </div>

        {/* Faixa de filtros: seletor à esquerda, chips de identificação à direita */}
        <div className="ib-filtros" style={{ background: "#F6F7F9", padding: "14px 24px", borderBottom: "1px solid #EDEFF2", display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div>
            <label style={{ fontSize: 11, color: "#8A8D96", textTransform: "uppercase", letterSpacing: 1.2, display: "block", marginBottom: 6 }}>Período</label>
            <select
              value={selecionado ? indicadores.indexOf(selecionado) : 0}
              onChange={e => setSelecionado(indicadores[Number(e.target.value)])}
              className="ib-select"
              style={{ background: "#FFFFFF", border: "1px solid #E2E4E9", borderRadius: 10, padding: "9px 12px", fontSize: 13, color: "#1F2024", fontFamily: SANS }}
            >
              {indicadores.length === 0 && <option>—</option>}
              {indicadores.map((ind, i) => (
                <option key={ind.id} value={i}>
                  {ind.motorista?.nome ?? "—"} — {ind.periodoInicio} a {ind.periodoFim}
                </option>
              ))}
            </select>
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
          {carregando && <div style={{ textAlign: "center", padding: 80, color: "#8A8D96" }}>Carregando dados...</div>}
          {erro && <div style={{ background: TINT.vermelho, border: `1px solid ${VERMELHO}33`, borderRadius: 12, padding: 16, color: VERMELHO, fontSize: 14, marginBottom: 20 }}>{erro}</div>}

          {!carregando && !d && !erro && (
            <div style={{ textAlign: "center", padding: 80, color: "#8A8D96" }}>
              <p style={{ fontSize: 18, margin: "0 0 8px", color: "#5A5D65" }}>Nenhum indicador encontrado</p>
              <p style={{ fontSize: 14, margin: 0 }}>Os dados aparecem após o worker de telemetria processar as viagens.</p>
            </div>
          )}

          {d && (
            <div className="ib-layout">
              {/* Coluna principal (esquerda): cartões */}
              <div className="ib-main">
                {/* Comportamento de condução — 3×3 */}
                <div>
                  <TituloSecao icone="ti-steering-wheel">Comportamento de Condução</TituloSecao>
                  <div className="ib-cards3">
                    <CardComportamento nome="Faixa verde" pct={num(d.percFaixaVerdeInicial)} icone="ti-gauge" />
                    <CardComportamento nome="Aproveitamento de embalo" pct={num(d.percEmbalo)} icone="ti-brand-speedtest" />
                    <CardComportamento nome="Motor ligado parado" pct={num(d.percMotorOcioso)} icone="ti-steering-wheel" />
                    <CardComportamento nome="Acelerando acima do verde" pct={num(d.percAcelCritico)} icone="ti-trending-up" />
                    <CardComportamento nome="Excesso de velocidade" pct={num(d.percExcessoVelocidade)} icone="ti-brand-speedtest" />
                    <CardComportamento nome="Faixa verde total" pct={num(d.percFaixaVerdeInicial) + num(d.percFaixaVerdeFinal)} icone="ti-gauge" />
                    <CardComportamento nome="Faixa verde final" pct={num(d.percFaixaVerdeFinal)} icone="ti-gauge" />
                    <CardComportamento nome="Freio motor" pct={num(d.percFreioMotorOk)} icone="ti-disc" />
                    <CardComportamento nome="Em movimento" pct={100} forcarVerde icone="ti-circle-check-filled" />
                  </div>
                </div>

                {/* Dados da viagem */}
                <div>
                  <TituloSecao icone="ti-route">Dados da Viagem</TituloSecao>
                  <div className="ib-cards4">
                    <CardStat icone="ti-map-pin" rotulo="Km total" valor={`${num(d.kmTotal).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} km`} />
                    <CardStat icone="ti-brand-speedtest" rotulo="Velocidade média" valor={`${num(d.velocidadeMediaKmh).toFixed(1)} km/h`} />
                    <CardStat icone="ti-droplet" rotulo="Consumo total" valor={`${num(d.consumoTotalLitros).toFixed(1)} L`} />
                    <CardStat icone="ti-trending-up" rotulo="Média km/L" valor={`${num(d.mediaKmL).toFixed(2)} km/L`} />
                    <CardStat icone="ti-refresh" rotulo="Odômetro" valor={`${num(d.odometroFinalKm).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} km`} />
                  </div>
                </div>

                {/* Rodagem & Frenagem */}
                <div>
                  <TituloSecao icone="ti-disc">Rodagem & Frenagem</TituloSecao>
                  <div className="ib-cards4">
                    <CardStat icone="ti-alert-triangle" chipBg={TINT.amarelo} chipCor={AMARELO}
                      rotulo="Freadas alta vel." valor={String(d.frenagenAltaVelocidade ?? 0)} />
                    <CardStat icone="ti-alert-circle" chipBg={TINT.vermelho} chipCor={VERMELHO}
                      rotulo="Freadas totais" valor={String(d.frenagensTotais ?? 0)} />
                    <CardStat icone="ti-percentage" rotulo="Freadas / 100 km" valor={num(d.frenagensPor100km).toFixed(1)} />
                  </div>
                </div>
              </div>

              {/* Coluna lateral (direita): Nota + Pressão do Acelerador */}
              <div className="ib-side">
                {/* Nota + dados do veículo */}
                <div style={{ background: "#FFFFFF", border: "1px solid #E7E9ED", borderRadius: 14, padding: 20, boxShadow: "0 1px 3px rgba(30,32,40,.04)" }}>
                  <TituloSecao icone="ti-gauge">Nota de Desempenho</TituloSecao>
                  <div style={{ display: "flex", justifyContent: "center", margin: "4px 0 12px" }}>
                    <Gauge nota={Math.round(num(d.notaDesempenho))} />
                  </div>
                  <div style={{ borderTop: "1px solid #EDEFF2", paddingTop: 12, display: "flex", flexDirection: "column", gap: 7 }}>
                    {[
                      ["Marca", d.veiculo?.marca], ["Ano", d.veiculo?.anoFabricacao],
                      ["Frota", d.veiculo?.frota], ["Modelo", d.veiculo?.modelo],
                    ].map(([k, v]) => (
                      <div key={String(k)} style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                        <span style={{ fontSize: 12, color: "#8A8D96" }}>{k}</span>
                        <span style={{ fontSize: 12, color: "#33363D", fontWeight: 700, textAlign: "right" }}>{v ?? "—"}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Pressão do acelerador */}
                <div style={{ background: "#FFFFFF", border: "1px solid #E7E9ED", borderRadius: 14, padding: 20, boxShadow: "0 1px 3px rgba(30,32,40,.04)" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", position: "relative" }}>
                    <TituloSecao>Pressão do Acelerador</TituloSecao>
                    <span
                      style={{ cursor: "pointer", position: "relative", marginTop: -8 }}
                      onMouseEnter={() => setTooltipAcel(true)}
                      onMouseLeave={() => setTooltipAcel(false)}
                      onClick={() => setTooltipAcel(v => !v)}
                    >
                      <i className="ti ti-info-circle" style={{ fontSize: 16, color: "#B4B7BE" }} />
                      {tooltipAcel && (
                        <div style={{
                          position: "absolute", top: 22, right: 0, zIndex: 20, background: "#1F2024", color: "#fff",
                          borderRadius: 10, padding: "10px 12px", fontSize: 12, width: 168, lineHeight: 1.7,
                          boxShadow: "0 10px 30px rgba(0,0,0,.25)", animation: "fadeUp .15s ease",
                        }}>
                          🟢 Verde — Bom<br />🟡 Amarelo — Atenção<br />🔴 Vermelho — Crítico
                        </div>
                      )}
                    </span>
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <LinhaAcel nome="Ideal" valor={num(d.percAcelIdeal)} cor={VERDE} />
                    <LinhaAcel nome="Atenção" valor={num(d.percAcelAtencao)} cor={AMARELO} />
                    <LinhaAcel nome="Crítico" valor={num(d.percAcelCritico)} cor={VERMELHO} />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Rodapé */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 24px", borderTop: "1px solid #EDEFF2", background: "#FFFFFF" }}>
          <span style={{ fontSize: 12, color: "#8A8D96" }}>Atualizado em {hoje}</span>
          <span style={{ fontSize: 12, color: "#8A8D96" }}>
            <span style={{ color: VINHO, fontWeight: 600 }}>INFOBRIDGE</span> · Transformando dados em economia · © 2026
          </span>
        </div>
      </div>
    </div>
  );
}
