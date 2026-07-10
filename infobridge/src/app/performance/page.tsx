"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  apiFetch, salvarSessao, carregarSessao, limparSessao, podeAcessar, primeiraTelaPermitida,
} from "@/lib/api";
import LoginForm from "@/components/LoginForm";
import SemAcesso from "@/components/SemAcesso";
import BotaoTrocarSenha from "@/components/BotaoTrocarSenha";
import LogoInfobridge from "@/components/LogoInfobridge";
import MenuNavegacao from "@/components/MenuNavegacao";

// ── Paleta / tipografia (idêntica ao handoff) ─────────────────
const VINHO = "#6E1414", AZUL = "#2563EB", VERDE = "#16A34A", AMBAR = "#D97706";
const VERMELHO = "#DC2626", CINZA = "#C7CAD1";
const SANS = "'IBM Plex Sans', system-ui, sans-serif";
const MONO = "'IBM Plex Mono', ui-monospace, monospace";

type Veiculo = { placa: string; modelo: string; motorista: string | null; cor: string };
type Dia = {
  date: string; km: number; avgSpeed: number; maxSpeed: number;
  ignMovingMin: number; ignIdleMin: number; ignOffMin: number;
  brakesTotal: number; brakesHigh: number; fuelL: number | null;
};
type Evento = { type: "start" | "end" | "stop" | "speed" | "brake"; idx: number; label: string; time: string };
type Rota = { pontos: [number, number][]; eventos: Evento[] };
type Resumo = {
  registros: number; km: number; consumo: number | null; mediaKmL: number | null;
  velMedia: number; velMax: number; frenagens: number; frenagensAlta: number;
  frenagensBruscas: number; percOcioso: number; tempoMovS: number; tempoParadoS: number;
};

const EVENTO_ICONE: Record<string, { icon: string; bg: string; cor: string }> = {
  start: { icon: "ti-flag-3", bg: "#E7F6EC", cor: "#16A34A" },
  end:   { icon: "ti-flag-2", bg: "#F4EDED", cor: "#6E1414" },
  stop:  { icon: "ti-clock-pause", bg: "#EEF0F3", cor: "#6B6E76" },
  speed: { icon: "ti-alert-triangle", bg: "#FEF7EC", cor: "#D97706" },
  brake: { icon: "ti-octagon", bg: "#FDF1F1", cor: "#DC2626" },
};

const pad2 = (n: number) => String(n).padStart(2, "0");
const ddmm = (iso: string) => { const [, m, d] = iso.split("-"); return `${d}/${m}`; };
const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

// ── Card / eyebrow ────────────────────────────────────────────
const card: React.CSSProperties = { background: "#FFFFFF", border: "1px solid #E7E9ED", borderRadius: 14, boxShadow: "0 1px 3px rgba(30,32,40,.04)" };
function Eyebrow({ icone, children }: { icone: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 14 }}>
      <i className={`ti ${icone}`} aria-hidden style={{ fontSize: 15, color: "#A4A7AE" }} />
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.4, textTransform: "uppercase", color: "#8A8D96" }}>{children}</span>
    </div>
  );
}
// Toggle segmentado
function Seg({ opcoes, valor, onSel }: { opcoes: { v: string; label: string }[]; valor: string; onSel: (v: string) => void }) {
  return (
    <div style={{ display: "inline-flex", background: "#F1F3F6", borderRadius: 11, padding: 3, gap: 2 }}>
      {opcoes.map((o) => (
        <button key={o.v} onClick={() => onSel(o.v)}
          style={{ background: valor === o.v ? "#FFFFFF" : "transparent", color: valor === o.v ? VINHO : "#5A5D65", padding: "8px 15px", fontSize: 12.5, fontWeight: 600, borderRadius: 9, border: "none", cursor: "pointer", fontFamily: SANS, boxShadow: valor === o.v ? "0 1px 2px rgba(30,32,40,.08)" : "none" }}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
const selBase: React.CSSProperties = { background: "#FFFFFF", border: "1px solid #E2E4E9", borderRadius: 9, padding: "8px 10px", fontSize: 12.5, color: "#1F2024", fontFamily: SANS, cursor: "pointer" };
function Chip({ icone, rotulo, valor }: { icone: string; rotulo: string; valor: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "#F6F7F9", border: "1px solid #E2E4E9", borderRadius: 100, padding: "6px 13px", fontSize: 12 }}>
      <i className={`ti ${icone}`} aria-hidden style={{ fontSize: 14, color: VINHO }} />
      <span style={{ color: "#8A8D96" }}>{rotulo}</span>
      <span style={{ color: "#1F2024", fontWeight: 700, fontFamily: MONO }}>{valor}</span>
    </span>
  );
}

// ── Leaflet sob demanda (mesmo padrão do Mapa ao vivo) ────────
function useLeaflet() {
  const [pronto, setPronto] = useState<boolean>(typeof window !== "undefined" && !!(window as any).L);
  useEffect(() => {
    if (typeof window === "undefined" || (window as any).L) { if ((window as any).L) setPronto(true); return; }
    if (!document.getElementById("leaflet-css")) {
      const link = document.createElement("link"); link.id = "leaflet-css"; link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"; document.head.appendChild(link);
    }
    const ex = document.getElementById("leaflet-js") as HTMLScriptElement | null;
    if (ex) { ex.addEventListener("load", () => setPronto(true)); return; }
    const s = document.createElement("script"); s.id = "leaflet-js"; s.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    s.onload = () => setPronto(true); document.body.appendChild(s);
  }, []);
  return pronto;
}

export default function PerformancePage() {
  const [token, setToken] = useState<string | null>(null);
  const [nomeUsuario, setNomeUsuario] = useState("");
  const [veiculos, setVeiculos] = useState<Veiculo[]>([]);
  const [diario, setDiario] = useState<Record<string, Dia[]>>({});
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  // Estado (espelha o handoff)
  const [viewMode, setViewMode] = useState<"frota" | "veiculo">("frota");
  const [periodMode, setPeriodMode] = useState<"atual" | "fechado">("atual");
  const hoje = useMemo(() => new Date(), []);
  const [rangeStart, setRangeStart] = useState(1);
  const [rangeEnd, setRangeEnd] = useState(hoje.getDate());
  const [closedMonthKey, setClosedMonthKey] = useState("");
  const [selectedPlate, setSelectedPlate] = useState("");
  const [kmFuelScope, setKmFuelScope] = useState("TOTAL");
  const [mapType, setMapType] = useState<"roadmap" | "satellite">("roadmap");
  const [showLabels, setShowLabels] = useState(false);
  const [mapSelectedPlates, setMapSelectedPlates] = useState<string[]>([]);
  const [mapEventsOn, setMapEventsOn] = useState({ start: true, end: true, stop: true, speed: true, brake: true });
  const [rotas, setRotas] = useState<Record<string, Rota>>({});
  const [notaReal, setNotaReal] = useState<number | null>(null);
  const [resumo, setResumo] = useState<Resumo | null>(null);

  const leafletPronto = useLeaflet();
  const mapDivRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const layerRef = useRef<any>(null);
  const tileRef = useRef<any>(null);

  // Meses fechados (6 últimos)
  const mesesFechados = useMemo(() => {
    const out: { key: string; label: string; start: string; end: string }[] = [];
    for (let i = 1; i <= 6; i++) {
      const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
      const y = d.getFullYear(), m = d.getMonth();
      const start = `${y}-${pad2(m + 1)}-01`;
      const end = `${y}-${pad2(m + 1)}-${pad2(new Date(y, m + 1, 0).getDate())}`;
      out.push({ key: `${y}-${pad2(m + 1)}`, label: `${MESES[m]} ${y}`, start, end });
    }
    return out;
  }, [hoje]);

  // Período efetivo (de/ate + label)
  const periodo = useMemo(() => {
    if (periodMode === "fechado") {
      const mf = mesesFechados.find((m) => m.key === closedMonthKey) ?? mesesFechados[0];
      return { de: mf.start, ate: mf.end, label: `${mf.label} (fechado)` };
    }
    const y = hoje.getFullYear(), m = hoje.getMonth();
    const a = Math.min(rangeStart, rangeEnd), b = Math.max(rangeStart, rangeEnd);
    const de = `${y}-${pad2(m + 1)}-${pad2(a)}`, ate = `${y}-${pad2(m + 1)}-${pad2(b)}`;
    return { de, ate, label: `${ddmm(de)} → ${ddmm(ate)} (mês atual)` };
  }, [periodMode, closedMonthKey, mesesFechados, rangeStart, rangeEnd, hoje]);

  const carregarBase = useCallback(async (tk: string) => {
    try {
      const vs = await apiFetch<Veiculo[]>("/performance/veiculos", tk);
      setVeiculos(Array.isArray(vs) ? vs : []);
      if (vs?.[0] && !selectedPlate) setSelectedPlate(vs[0].placa);
    } catch (e: any) {
      if (/401|403/.test(e?.message || "")) { limparSessao(); setToken(null); }
      else setErro(e?.message ?? "Erro ao carregar veículos");
    }
  }, [selectedPlate]);

  const carregarDiario = useCallback(async (tk: string) => {
    setCarregando(true); setErro("");
    try {
      const d = await apiFetch<Record<string, Dia[]>>(`/performance/diario?de=${periodo.de}&ate=${periodo.ate}`, tk);
      setDiario(d ?? {});
    } catch (e: any) {
      if (/401|403/.test(e?.message || "")) { limparSessao(); setToken(null); }
      else setErro(e?.message ?? "Erro ao carregar dados");
    } finally { setCarregando(false); }
  }, [periodo.de, periodo.ate]);

  useEffect(() => {
    const s = carregarSessao();
    if (s?.token) { setToken(s.token); setNomeUsuario(s.nome); if (podeAcessar("info-analise")) carregarBase(s.token); }
    else setCarregando(false);
  }, [carregarBase]);
  useEffect(() => { if (token && podeAcessar("info-analise")) carregarDiario(token); }, [token, carregarDiario]);

  function handleLogin(tk: string, nome: string) {
    salvarSessao(tk, nome); setToken(tk); setNomeUsuario(nome);
    if (podeAcessar("info-analise")) { carregarBase(tk); carregarDiario(tk); }
  }

  // ── Dias do período (eixo X) ────────────────────────────────
  const dias = useMemo(() => {
    const [y1, m1, d1] = periodo.de.split("-").map(Number);
    const [, , d2] = periodo.ate.split("-").map(Number);
    const out: string[] = [];
    for (let d = d1; d <= d2; d++) out.push(`${y1}-${pad2(m1)}-${pad2(d)}`);
    return out;
  }, [periodo.de, periodo.ate]);

  // Métricas por dia no escopo (frota inteira ou placa selecionada)
  const placasEscopo = useMemo(
    () => (viewMode === "veiculo" && selectedPlate ? [selectedPlate] : veiculos.map((v) => v.placa)),
    [viewMode, selectedPlate, veiculos],
  );
  const porDia = useMemo(() => {
    const base = dias.map((date) => {
      let km = 0, fuel = 0, temFuel = false, movMin = 0, idleMin = 0, offMin = 0, brakesT = 0, brakesH = 0;
      let velSum = 0, velCount = 0, velMax = 0;
      for (const placa of placasEscopo) {
        const r = (diario[placa] ?? []).find((x) => x.date === date);
        if (!r) continue;
        km += r.km; if (r.fuelL != null) { fuel += r.fuelL; temFuel = true; }
        movMin += r.ignMovingMin; idleMin += r.ignIdleMin; offMin += r.ignOffMin;
        brakesT += r.brakesTotal; brakesH += r.brakesHigh;
        if (r.avgSpeed > 0) { velSum += r.avgSpeed; velCount++; }
        velMax = Math.max(velMax, r.maxSpeed);
      }
      return { date, km: +km.toFixed(1), fuelRaw: temFuel ? +fuel.toFixed(1) : null, temFuel, ignMovingMin: movMin, ignIdleMin: idleMin, ignOffMin: offMin, brakesTotal: brakesT, brakesHigh: brakesH, avgSpeed: velCount ? +(velSum / velCount).toFixed(1) : 0, maxSpeed: velMax };
    });
    // Combustível: a fonte OFICIAL é o indicador mensal (mesma da Info Análise).
    // O total do período (resumo.consumo) é distribuído por dia proporcionalmente
    // ao km rodado — assim o somatório dos dias bate exatamente com a Info Análise
    // e todos os dias com rodagem exibem valor. Sem resumo, cai para a estimativa
    // por queda de nível calculada na telemetria.
    const totalTelemetria = base.reduce((s, d) => s + (d.fuelRaw ?? 0), 0);
    const totalOficial = resumo?.consumo ?? null;
    const totalFuel = totalOficial != null ? totalOficial : totalTelemetria;
    const totalKm = base.reduce((s, d) => s + d.km, 0);
    const temFuelPeriodo = totalOficial != null || base.some((d) => d.temFuel);
    return base.map((d) => ({
      ...d,
      fuelL: !temFuelPeriodo || totalFuel <= 0
        ? (temFuelPeriodo ? 0 : null)
        : totalKm > 0
          ? +((totalFuel * d.km) / totalKm).toFixed(1)
          : (d.fuelRaw ?? 0),
    }));
  }, [dias, placasEscopo, diario, resumo]);

  // KPIs agregados — quando há indicador oficial (Info Análise), usa-o como
  // fonte da verdade para km, combustível, média km/L, velocidades e frenagens;
  // caso contrário cai para os valores derivados da telemetria diária.
  const kpi = useMemo(() => {
    if (resumo && resumo.registros > 0) {
      return {
        km: Math.round(resumo.km),
        fuel: resumo.consumo != null ? +resumo.consumo.toFixed(1) : 0,
        consumo: resumo.mediaKmL ?? 0,
        velMedia: +resumo.velMedia.toFixed(1),
        velMax: Math.round(resumo.velMax),
        brakes: resumo.frenagens,
        brakesHigh: resumo.frenagensAlta,
      };
    }
    const km = porDia.reduce((s, d) => s + d.km, 0);
    const fuel = porDia.reduce((s, d) => s + (d.fuelL ?? 0), 0);
    const avg = porDia.filter((d) => d.avgSpeed > 0);
    return {
      km: +km.toFixed(0), fuel: +fuel.toFixed(1), consumo: fuel > 0 ? +(km / fuel).toFixed(2) : 0,
      velMedia: avg.length ? +(avg.reduce((s, d) => s + d.avgSpeed, 0) / avg.length).toFixed(1) : 0,
      velMax: porDia.reduce((s, d) => Math.max(s, d.maxSpeed), 0),
      brakes: porDia.reduce((s, d) => s + d.brakesTotal, 0),
      brakesHigh: porDia.reduce((s, d) => s + d.brakesHigh, 0),
    };
  }, [porDia, resumo]);

  // ── Rotas para o mapa ───────────────────────────────────────
  const placasMapa = viewMode === "veiculo" ? (selectedPlate ? [selectedPlate] : []) : mapSelectedPlates;
  useEffect(() => {
    if (!token) return;
    const faltando = placasMapa.filter((p) => !rotas[p]);
    if (!faltando.length) return;
    (async () => {
      const res: Record<string, Rota> = {};
      await Promise.all(faltando.map(async (p) => {
        try { res[p] = await apiFetch<Rota>(`/performance/rota?placa=${encodeURIComponent(p)}&de=${periodo.de}&ate=${periodo.ate}`, token); }
        catch { /* ignora */ }
      }));
      setRotas((r) => ({ ...r, ...res }));
    })();
  }, [placasMapa.join(","), periodo.de, periodo.ate, token]); // eslint-disable-line

  // limpa cache de rotas ao trocar de período
  useEffect(() => { setRotas({}); }, [periodo.de, periodo.ate]);

  // Nota de desempenho OFICIAL (a mesma da Info Análise) — indicador mensal.
  const mesNota = periodMode === "fechado"
    ? (closedMonthKey || mesesFechados[0]?.key)
    : `${hoje.getFullYear()}-${pad2(hoje.getMonth() + 1)}`;
  useEffect(() => {
    if (!token || viewMode !== "veiculo" || !selectedPlate) { setNotaReal(null); return; }
    apiFetch<{ nota: number | null }>(`/performance/nota?placa=${encodeURIComponent(selectedPlate)}&mes=${mesNota}`, token)
      .then((r) => setNotaReal(r?.nota ?? null)).catch(() => setNotaReal(null));
  }, [token, viewMode, selectedPlate, mesNota]);

  // Resumo OFICIAL do período (mesma fonte da Info Análise: indicador_periodo).
  // No modo veículo filtra pela placa; no modo frota soma todos os veículos.
  useEffect(() => {
    if (!token || !podeAcessar("info-analise")) { setResumo(null); return; }
    const placaQ = viewMode === "veiculo" && selectedPlate ? `&placa=${encodeURIComponent(selectedPlate)}` : "";
    apiFetch<Resumo>(`/performance/resumo?de=${periodo.de}&ate=${periodo.ate}${placaQ}`, token)
      .then((r) => setResumo(r ?? null)).catch(() => setResumo(null));
  }, [token, periodo.de, periodo.ate, viewMode, selectedPlate]);

  const corDe = (placa: string) => veiculos.find((v) => v.placa === placa)?.cor ?? VINHO;

  // Inicializa o mapa — precisa rodar SÓ quando o <div> do mapa já está no DOM
  // (o conteúdo fica atrás do estado `carregando`/`erro`), por isso dependemos
  // também de `carregando`/`erro`/`token`.
  useEffect(() => {
    if (!leafletPronto || carregando || erro || !mapDivRef.current || mapRef.current) return;
    const L = (window as any).L;
    const map = L.map(mapDivRef.current, { zoomControl: true, attributionControl: true }).setView([-15.78, -47.92], 4);
    mapRef.current = map; layerRef.current = L.layerGroup().addTo(map);
    tileRef.current = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", { maxZoom: 19, subdomains: "abcd" }).addTo(map);
    setTimeout(() => map.invalidateSize(), 60);
  }, [leafletPronto, carregando, erro, token]);

  // Troca de tiles roadmap/satélite
  useEffect(() => {
    if (!mapRef.current) return; const L = (window as any).L;
    if (tileRef.current) mapRef.current.removeLayer(tileRef.current);
    tileRef.current = mapType === "satellite"
      ? L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19 })
      : L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", { maxZoom: 19, subdomains: "abcd" });
    tileRef.current.addTo(mapRef.current);
  }, [mapType]);

  // Desenha rotas + eventos
  const desenharMapa = useCallback(() => {
    const L = (window as any).L; const map = mapRef.current, layer = layerRef.current;
    if (!L || !map || !layer) return;
    layer.clearLayers();
    const bounds: [number, number][] = [];
    for (const placa of placasMapa) {
      const rota = rotas[placa]; if (!rota?.pontos?.length) continue;
      const cor = corDe(placa);
      const linha = L.polyline(rota.pontos, { color: cor, weight: viewMode === "veiculo" ? 4 : 3, opacity: viewMode === "veiculo" ? 0.9 : 0.7 }).addTo(layer);
      linha.bindTooltip(placa, { sticky: true, direction: "top" });
      if (viewMode === "frota") linha.on("click", () => { setSelectedPlate(placa); setViewMode("veiculo"); });
      rota.pontos.forEach((p) => bounds.push(p));
      const eventos = viewMode === "veiculo"
        ? rota.eventos.filter((e) => (mapEventsOn as any)[e.type])
        : rota.eventos.filter((e) => e.type === "start" || e.type === "end");
      for (const ev of eventos) {
        const p = rota.pontos[ev.idx]; if (!p) continue;
        const cfg = EVENTO_ICONE[ev.type];
        const icon = L.divIcon({ className: "perf-mk", html: `<div style="width:26px;height:26px;border-radius:50%;background:#fff;border:2px solid ${cfg.cor};display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(20,16,16,.3)"><i class="ti ${cfg.icon}" style="font-size:14px;color:${cfg.cor}"></i></div>`, iconSize: [26, 26], iconAnchor: [13, 13] });
        L.marker(p, { icon }).addTo(layer).bindPopup(`<b>${ev.label}</b>${ev.time ? `<br>${ev.time}` : ""}`);
      }
    }
    if (bounds.length) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
  }, [placasMapa.join(","), rotas, viewMode, mapEventsOn]); // eslint-disable-line

  useEffect(() => { desenharMapa(); setTimeout(() => mapRef.current?.invalidateSize(), 100); }, [desenharMapa, mapType, leafletPronto]);

  if (!token) return <LoginForm onLogin={handleLogin} />;
  if (!podeAcessar("info-analise")) return <SemAcesso destino={primeiraTelaPermitida()} />;

  const maxKm = Math.max(1, ...porDia.map((d) => d.km));
  const maxFuel = Math.max(1, ...porDia.map((d) => d.fuelL ?? 0));
  const maxBrake = Math.max(1, ...porDia.map((d) => d.brakesTotal));
  const passo = Math.max(1, Math.ceil(dias.length / 12));

  // Nota de desempenho: a MESMA da Info Análise (indicador mensal do backend).
  const nota = notaReal;
  const notaCor = nota == null ? "#9A9DA5" : nota >= 80 ? VERDE : nota >= 40 ? AMBAR : VERMELHO;
  const notaLabel = nota == null ? "Sem dados" : nota >= 80 ? "Excelente" : nota >= 60 ? "Regular" : nota >= 40 ? "Atenção" : "Crítico";

  const veiculoSel = veiculos.find((v) => v.placa === selectedPlate);

  // KPIs config
  const kpis = [
    { icon: "ti-map-pin", cor: VINHO, valor: `${kpi.km.toLocaleString("pt-BR")}`, un: "km", label: "Km total rodado" },
    { icon: "ti-droplet", cor: AZUL, valor: kpi.fuel ? kpi.fuel.toLocaleString("pt-BR") : "—", un: "L", label: "Combustível total" },
    { icon: "ti-trending-up", cor: VERDE, valor: kpi.consumo ? String(kpi.consumo) : "—", un: "km/L", label: "Média de consumo" },
    { icon: "ti-brand-speedtest", cor: VINHO, valor: String(kpi.velMedia), un: "km/h", label: "Velocidade média" },
    { icon: "ti-gauge", cor: VERMELHO, valor: String(kpi.velMax), un: "km/h", label: "Velocidade máxima" },
    { icon: "ti-alert-circle", cor: VERMELHO, valor: kpi.brakes.toLocaleString("pt-BR"), un: "", label: "Freadas totais" },
    { icon: "ti-alert-triangle", cor: AMBAR, valor: kpi.brakesHigh.toLocaleString("pt-BR"), un: "", label: "Freadas em alta velocidade" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#E9EBEF", fontFamily: SANS }}>
      <style>{`.ti{font-family:'tabler-icons'!important;font-style:normal} .perf-mk{background:none!important;border:none!important}
        @keyframes spin{to{transform:rotate(360deg)}}
        @media print { .no-print{display:none!important} body{background:#fff} }`}</style>

      {/* ===== HEADER ===== */}
      <header className="no-print" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#FFFFFF", padding: "0 22px", height: 60, borderBottom: "1px solid #ECEDF1", position: "sticky", top: 0, zIndex: 60 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <LogoInfobridge height={34} />
            <div style={{ borderLeft: "1px solid #E2E4E9", paddingLeft: 12 }}>
              <div style={{ fontSize: 8, letterSpacing: 2.4, color: VINHO, textTransform: "uppercase", fontWeight: 700 }}>Infobridge</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#1F2024" }}>Performance</div>
            </div>
          </div>
          <MenuNavegacao atual="performance" />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ width: 32, height: 32, borderRadius: "50%", background: "#F4EDED", display: "flex", alignItems: "center", justifyContent: "center" }}><i className="ti ti-user" aria-hidden style={{ fontSize: 17, color: VINHO }} /></span>
          <span style={{ fontSize: 13, color: "#33363D", fontWeight: 500 }}>{nomeUsuario || "Administrador"}</span>
          {token && <BotaoTrocarSenha token={token} />}
          <button onClick={() => { limparSessao(); setToken(null); }} style={{ display: "flex", alignItems: "center", gap: 6, background: "#FFFFFF", border: "1px solid #DDE0E6", borderRadius: 9, padding: "7px 12px", fontSize: 13, color: "#5A5D65", cursor: "pointer", fontFamily: SANS }}><i className="ti ti-logout" aria-hidden style={{ fontSize: 15 }} /> Sair</button>
        </div>
      </header>

      {/* ===== FILTROS ===== */}
      <div className="no-print" style={{ background: "#FFFFFF", borderBottom: "1px solid #ECEDF1", padding: "16px 22px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 14 }}>
          <div>
            <h1 style={{ fontSize: 17, fontWeight: 700, color: "#1F2024", margin: 0, display: "flex", alignItems: "center", gap: 9 }}><i className="ti ti-report-analytics" aria-hidden style={{ color: VINHO }} />Relatório de Performance</h1>
            <p style={{ fontSize: 12.5, color: "#8A8D96", margin: "3px 0 0" }}>Quilometragem, combustível, ignição, velocidade e frenagem por período</p>
          </div>
          <button onClick={() => window.print()} style={{ display: "inline-flex", alignItems: "center", gap: 8, background: VINHO, color: "#fff", border: "none", borderRadius: 9, padding: "10px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: SANS }}><i className="ti ti-file-download" aria-hidden style={{ fontSize: 16 }} />Exportar PDF</button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <Seg opcoes={[{ v: "frota", label: "Frota" }, { v: "veiculo", label: "Veículo" }]} valor={viewMode} onSel={(v) => setViewMode(v as any)} />
          {viewMode === "veiculo" && (
            <select value={selectedPlate} onChange={(e) => setSelectedPlate(e.target.value)} style={selBase}>
              {veiculos.map((v) => <option key={v.placa} value={v.placa}>{v.placa} — {v.motorista ?? "Sem motorista"}</option>)}
            </select>
          )}
          <span style={{ width: 1, height: 26, background: "#E2E4E9" }} />
          <Seg opcoes={[{ v: "atual", label: "Mês atual" }, { v: "fechado", label: "Mês fechado" }]} valor={periodMode} onSel={(v) => setPeriodMode(v as any)} />
          {periodMode === "atual" ? (
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "#5A5D65" }}>
              De <select value={rangeStart} onChange={(e) => setRangeStart(+e.target.value)} style={selBase}>{Array.from({ length: hoje.getDate() }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{pad2(d)}</option>)}</select>
              até <select value={rangeEnd} onChange={(e) => setRangeEnd(+e.target.value)} style={selBase}>{Array.from({ length: hoje.getDate() }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{pad2(d)}</option>)}</select>
            </div>
          ) : (
            <select value={closedMonthKey || mesesFechados[0]?.key} onChange={(e) => setClosedMonthKey(e.target.value)} style={selBase}>
              {mesesFechados.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
          )}
          <span style={{ width: 1, height: 26, background: "#E2E4E9" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "#5A5D65" }}>
            Rótulos <Seg opcoes={[{ v: "off", label: "Ocultar" }, { v: "on", label: "Mostrar" }]} valor={showLabels ? "on" : "off"} onSel={(v) => setShowLabels(v === "on")} />
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
          <Chip icone="ti-calendar" rotulo="Período" valor={periodo.label} />
          {viewMode === "veiculo" ? (<>
            <Chip icone="ti-truck" rotulo="Placa" valor={selectedPlate || "—"} />
            <Chip icone="ti-id-badge-2" rotulo="Motorista" valor={veiculoSel?.motorista ?? "—"} />
            <Chip icone="ti-car" rotulo="Modelo" valor={veiculoSel?.modelo ?? "—"} />
          </>) : (
            <Chip icone="ti-truck-delivery" rotulo="Veículos na frota" valor={String(veiculos.length)} />
          )}
        </div>
      </div>

      {/* ===== CONTEÚDO ===== */}
      <div style={{ padding: 22 }}>
        {carregando ? (
          <div style={{ textAlign: "center", padding: 80, color: "#6B6E76" }}>
            <i className="ti ti-loader-2" aria-hidden style={{ fontSize: 30, animation: "spin 1s linear infinite" }} />
            <div style={{ marginTop: 12, fontSize: 14 }}>Carregando dados de telemetria…</div>
          </div>
        ) : erro ? (
          <div role="alert" style={{ ...card, padding: 16, color: VERMELHO, fontSize: 13 }}>{erro}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

            {/* Nota (veículo) */}
            {viewMode === "veiculo" && (
              <div style={{ display: "grid", gridTemplateColumns: "230px 1fr", gap: 18, alignItems: "stretch" }} className="perf-nota">
                <div style={{ ...card, padding: 18, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
                  <Eyebrow icone="ti-gauge">Nota de desempenho</Eyebrow>
                  <svg width="160" height="160" viewBox="0 0 160 160">
                    <circle cx="80" cy="80" r="58" fill="none" stroke="#EDEFF2" strokeWidth="10" />
                    {nota != null && <circle cx="80" cy="80" r="58" fill="none" stroke={notaCor} strokeWidth="10" strokeLinecap="round" strokeDasharray={`${(nota / 100) * 2 * Math.PI * 58} ${2 * Math.PI * 58}`} transform="rotate(-90 80 80)" />}
                    <text x="80" y="76" textAnchor="middle" dominantBaseline="central" fill={notaCor} fontSize={nota != null && nota >= 100 ? 34 : 42} fontWeight="700" style={{ fontFamily: MONO }}>{nota == null ? "—" : nota}</text>
                    <text x="80" y="106" textAnchor="middle" fill="#6B6E76" fontSize="12">{notaLabel}</text>
                  </svg>
                  <p style={{ fontSize: 11, color: "#8A8D96", margin: "8px 0 0" }}>Referente ao período ({periodo.label})</p>
                </div>
                <div style={{ ...card, padding: 16 }}>
                  <Eyebrow icone="ti-list-details">Resumo do período — {selectedPlate}</Eyebrow>
                  <KpiGrid kpis={kpis} />
                </div>
              </div>
            )}

            {/* KPIs (frota) */}
            {viewMode === "frota" && (
              <div style={{ ...card, padding: 16 }}>
                <Eyebrow icone="ti-layout-dashboard">Resumo do período</Eyebrow>
                <KpiGrid kpis={kpis} />
              </div>
            )}

            {/* Km/dia + Combustível/dia */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: 18 }}>
              <div style={{ ...card, padding: 18 }}>
                <Eyebrow icone="ti-road">Km rodados por dia</Eyebrow>
                <Barras dados={porDia.map((d) => ({ label: ddmm(d.date), valor: d.km }))} max={maxKm} cor={VINHO} passo={passo} showLabels={showLabels} sufixo="" />
              </div>
              <div style={{ ...card, padding: 18 }}>
                <Eyebrow icone="ti-droplet">Combustível consumido por dia</Eyebrow>
                <Barras dados={porDia.map((d) => ({ label: ddmm(d.date), valor: d.fuelL ?? 0 }))} max={maxFuel} cor={AZUL} passo={passo} showLabels={showLabels} sufixo=" L" />
              </div>
            </div>

            {/* Ignição por dia */}
            <div style={{ ...card, padding: 18 }}>
              <Eyebrow icone="ti-engine">Ignição: ligada (movimento) x ligada (parado/ociosa) x desligada — por dia</Eyebrow>
              <Legenda itens={[{ cor: VERDE, label: "Em movimento" }, { cor: AMBAR, label: "Ligada, parado (ociosa)" }, { cor: CINZA, label: "Desligada" }]} />
              <div style={{ display: "flex", gap: 3, alignItems: "flex-start", marginTop: 10 }}>
                {porDia.map((d, i) => {
                  const tot = Math.max(1, d.ignMovingMin + d.ignIdleMin + d.ignOffMin);
                  const totOn = d.ignMovingMin + d.ignIdleMin;
                  return (
                    <div key={d.date} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center" }}>
                      {showLabels && totOn > 0 && <span style={{ fontSize: 8, color: "#6B6E76", fontFamily: MONO, marginBottom: 2 }}>{Math.round(totOn / 60)}h</span>}
                      <div title={`Mov: ${d.ignMovingMin}min · Ocioso: ${d.ignIdleMin}min · Deslig.: ${d.ignOffMin}min`} style={{ width: "100%", height: 150, borderRadius: 5, overflow: "hidden", display: "flex", flexDirection: "column" }}>
                        <div style={{ height: `${d.ignOffMin / tot * 100}%`, background: CINZA }} />
                        <div style={{ height: `${d.ignIdleMin / tot * 100}%`, background: AMBAR }} />
                        <div style={{ height: `${d.ignMovingMin / tot * 100}%`, background: VERDE }} />
                      </div>
                      <div style={{ fontSize: 8, color: "#9A9DA4", textAlign: "center", marginTop: 4, fontFamily: MONO }}>{i % passo === 0 ? ddmm(d.date) : ""}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Velocidade máx x média */}
            <div style={{ ...card, padding: 18 }}>
              <Eyebrow icone="ti-brand-speedtest">Velocidade máxima x média por dia</Eyebrow>
              <Legenda itens={[{ cor: VERMELHO, label: "Máxima" }, { cor: AZUL, label: "Média" }]} />
              <LinhaDupla dados={porDia.map((d) => ({ label: ddmm(d.date), a: d.maxSpeed, b: d.avgSpeed }))} corA={VERMELHO} corB={AZUL} passo={passo} showLabels={showLabels} />
            </div>

            {/* Freadas */}
            <div style={{ ...card, padding: 18 }}>
              <Eyebrow icone="ti-alert-octagon">Freadas totais x freadas em alta velocidade por dia</Eyebrow>
              <Legenda itens={[{ cor: VERMELHO, label: "Freadas totais" }, { cor: AMBAR, label: "Freadas alta velocidade" }]} />
              <div style={{ display: "flex", gap: 4, alignItems: "flex-end", height: 140, marginTop: 10 }}>
                {porDia.map((d, i) => (
                  <div key={d.date} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center" }}>
                    {showLabels && d.brakesTotal > 0 && <span style={{ fontSize: 8, color: "#6B6E76", fontFamily: MONO, marginBottom: 2 }}>{d.brakesTotal}</span>}
                    <div style={{ display: "flex", gap: 2, alignItems: "flex-end", height: 120, width: "100%", justifyContent: "center" }}>
                      <div title={`Totais: ${d.brakesTotal}`} style={{ width: "42%", height: `${d.brakesTotal / maxBrake * 100}%`, background: VERMELHO, borderRadius: "3px 3px 0 0", minHeight: d.brakesTotal ? 2 : 0 }} />
                      <div title={`Alta vel.: ${d.brakesHigh}`} style={{ width: "42%", height: `${d.brakesHigh / maxBrake * 100}%`, background: AMBAR, borderRadius: "3px 3px 0 0", minHeight: d.brakesHigh ? 2 : 0 }} />
                    </div>
                    <div style={{ fontSize: 8, color: "#9A9DA4", marginTop: 4, fontFamily: MONO }}>{i % passo === 0 ? ddmm(d.date) : ""}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Comparação combustível ocioso (frota) */}
            {viewMode === "frota" && (
              <div style={{ ...card, padding: 18 }}>
                <Eyebrow icone="ti-chart-bar">Comparação entre veículos — combustível gasto com motor ocioso</Eyebrow>
                <ComparacaoOcioso diario={diario} veiculos={veiculos} onPlaca={(p) => { setSelectedPlate(p); setViewMode("veiculo"); }} showLabels={showLabels} />
              </div>
            )}

            {/* MAPA */}
            <div style={{ ...card, padding: 18 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
                <Eyebrow icone="ti-map-2">Rastro de posições do período</Eyebrow>
                <div className="no-print"><Seg opcoes={[{ v: "roadmap", label: "Mapa" }, { v: "satellite", label: "Satélite" }]} valor={mapType} onSel={(v) => setMapType(v as any)} /></div>
              </div>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 320, position: "relative" }}>
                  <div ref={mapDivRef} style={{ height: 460, borderRadius: 12, overflow: "hidden", border: "1px solid #E7E9ED", background: "#E9EBEF" }} />
                  {viewMode === "frota" && placasMapa.length === 0 && (
                    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(233,235,239,.75)", borderRadius: 12, textAlign: "center", padding: 20 }}>
                      <div><i className="ti ti-map-search" aria-hidden style={{ fontSize: 30, color: "#8A8D96" }} /><div style={{ fontSize: 14, color: "#5A5D65", fontWeight: 600, marginTop: 8 }}>Selecione ao menos um veículo</div><div style={{ fontSize: 12, color: "#8A8D96", marginTop: 4 }}>Marque veículos na lista ao lado para desenhar as rotas.</div></div>
                    </div>
                  )}
                  {viewMode === "veiculo" && rotas[selectedPlate]?.pontos?.length ? (
                    <div style={{ position: "absolute", top: 12, left: 12, zIndex: 1000, ...card, padding: 12, width: 210, fontSize: 12 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: "#8A8D96", marginBottom: 8 }}>Resumo do trajeto · {selectedPlate}</div>
                      <ResumoTrajeto porDia={porDia} />
                    </div>
                  ) : null}
                </div>

                {/* Sidebar */}
                <div style={{ width: 266, flexShrink: 0, maxHeight: 460, overflowY: "auto" }}>
                  {viewMode === "frota" ? (<>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#33363D" }}>Filtrar veículos</span>
                      <span style={{ display: "flex", gap: 8 }}>
                        <button onClick={() => setMapSelectedPlates(veiculos.map((v) => v.placa))} style={{ background: "none", border: "none", color: VINHO, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Todos</button>
                        <button onClick={() => setMapSelectedPlates([])} style={{ background: "none", border: "none", color: "#8A8D96", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Limpar</button>
                      </span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      {veiculos.map((v) => {
                        const on = mapSelectedPlates.includes(v.placa);
                        return (
                          <label key={v.placa} style={{ display: "flex", alignItems: "center", gap: 9, padding: "7px 8px", borderRadius: 8, cursor: "pointer", background: on ? "#F6F7F9" : "transparent" }}>
                            <input type="checkbox" checked={on} onChange={() => setMapSelectedPlates((s) => on ? s.filter((p) => p !== v.placa) : [...s, v.placa])} />
                            <span style={{ width: 10, height: 10, borderRadius: "50%", background: v.cor, flexShrink: 0 }} />
                            <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, color: "#1F2024", flex: 1 }}>{v.placa}</span>
                            <i className="ti ti-chevron-right" onClick={(e) => { e.preventDefault(); setSelectedPlate(v.placa); setViewMode("veiculo"); }} style={{ fontSize: 15, color: "#B4B7BE", cursor: "pointer" }} />
                          </label>
                        );
                      })}
                    </div>
                  </>) : (<>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#33363D" }}>Eventos a exibir</span>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2, margin: "8px 0 14px" }}>
                      {[{ k: "start", label: "Início / fim" }, { k: "stop", label: "Paradas longas" }, { k: "speed", label: "Excesso de velocidade" }, { k: "brake", label: "Frenagem brusca" }].map((it) => {
                        const on = (mapEventsOn as any)[it.k];
                        return (
                          <label key={it.k} style={{ display: "flex", alignItems: "center", gap: 9, padding: "6px 8px", borderRadius: 8, cursor: "pointer" }}>
                            <input type="checkbox" checked={on} onChange={() => setMapEventsOn((m) => it.k === "start" ? ({ ...m, start: !m.start, end: !m.start }) : ({ ...m, [it.k]: !(m as any)[it.k] }))} />
                            <i className={`ti ${EVENTO_ICONE[it.k === "start" ? "start" : it.k].icon}`} style={{ fontSize: 15, color: EVENTO_ICONE[it.k === "start" ? "start" : it.k].cor }} />
                            <span style={{ fontSize: 12.5, color: "#33363D" }}>{it.label}</span>
                          </label>
                        );
                      })}
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: "#8A8D96" }}>Eventos do trajeto</span>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
                      {(rotas[selectedPlate]?.eventos ?? []).filter((e) => (mapEventsOn as any)[e.type]).map((e, i) => {
                        const cfg = EVENTO_ICONE[e.type];
                        return (
                          <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "6px 4px" }}>
                            <span style={{ width: 22, height: 22, borderRadius: "50%", background: cfg.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><i className={`ti ${cfg.icon}`} style={{ fontSize: 12, color: cfg.cor }} /></span>
                            <span style={{ minWidth: 0 }}><span style={{ display: "block", fontSize: 12, color: "#33363D" }}>{e.label}</span>{e.time && <span style={{ display: "block", fontSize: 11, color: "#9A9DA4", fontFamily: MONO }}>{e.time}</span>}</span>
                          </div>
                        );
                      })}
                      {!(rotas[selectedPlate]?.eventos?.length) && <span style={{ fontSize: 12, color: "#9A9DA4" }}>Sem posições no período.</span>}
                    </div>
                  </>)}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Subcomponentes ────────────────────────────────────────────
function KpiGrid({ kpis }: { kpis: { icon: string; cor: string; valor: string; un: string; label: string }[] }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 11 }}>
      {kpis.map((k, i) => (
        <div key={i} style={{ background: "#FFFFFF", border: "1px solid #E7E9ED", borderRadius: 13, padding: 15, display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ width: 40, height: 40, borderRadius: 11, background: `${k.cor}14`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><i className={`ti ${k.icon}`} aria-hidden style={{ fontSize: 19, color: k.cor }} /></span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#1F2024", fontFamily: MONO }}>{k.valor}{k.un && <span style={{ fontSize: 12, color: "#8A8D96", marginLeft: 3 }}>{k.un}</span>}</div>
            <div style={{ fontSize: 11.5, color: "#8A8D96", marginTop: 1 }}>{k.label}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
function Legenda({ itens }: { itens: { cor: string; label: string }[] }) {
  return (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 4 }}>
      {itens.map((it, i) => (
        <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "#6B6E76" }}><span style={{ width: 11, height: 11, borderRadius: 3, background: it.cor }} />{it.label}</span>
      ))}
    </div>
  );
}
function Barras({ dados, max, cor, passo, showLabels, sufixo }: { dados: { label: string; valor: number }[]; max: number; cor: string; passo: number; showLabels: boolean; sufixo: string }) {
  return (
    <div style={{ display: "flex", gap: 3, alignItems: "flex-end", height: 160, marginTop: 6 }}>
      {dados.map((d, i) => (
        <div key={i} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%" }}>
          {showLabels && d.valor > 0 && <span style={{ fontSize: 8, color: "#6B6E76", fontFamily: MONO, marginBottom: 2 }}>{d.valor}</span>}
          <div title={`${d.valor}${sufixo}`} style={{ width: "100%", height: `${d.valor / max * 130}px`, background: cor, borderRadius: "4px 4px 0 0", minHeight: d.valor ? 2 : 0 }} />
          <span style={{ fontSize: 8, color: "#9A9DA4", marginTop: 4, fontFamily: MONO }}>{i % passo === 0 ? d.label : ""}</span>
        </div>
      ))}
    </div>
  );
}
function LinhaDupla({ dados, corA, corB, passo, showLabels }: { dados: { label: string; a: number; b: number }[]; corA: string; corB: string; passo: number; showLabels: boolean }) {
  const max = Math.max(1, ...dados.map((d) => Math.max(d.a, d.b)));
  const W = 100, H = 140;
  const px = (i: number) => dados.length <= 1 ? 0 : (i / (dados.length - 1)) * W;
  const py = (v: number) => H - (v / max) * H;
  return (
    <div style={{ marginTop: 8, position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: 140, overflow: "visible" }}>
        {[0.25, 0.5, 0.75].map((g) => <line key={g} x1={0} x2={W} y1={H * g} y2={H * g} stroke="#EDEFF2" strokeWidth={0.5} />)}
        <polyline points={dados.map((d, i) => `${px(i)},${py(d.a)}`).join(" ")} fill="none" stroke={corA} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        <polyline points={dados.map((d, i) => `${px(i)},${py(d.b)}`).join(" ")} fill="none" stroke={corB} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </svg>
      {showLabels && dados.map((d, i) => (i % passo === 0 ? (
        <span key={`a${i}`}>
          <span style={{ position: "absolute", left: `${px(i)}%`, top: `${(py(d.a) / H) * 140 - 12}px`, transform: "translateX(-50%)", fontSize: 8, color: corA, fontFamily: MONO, whiteSpace: "nowrap" }}>{d.a}</span>
          <span style={{ position: "absolute", left: `${px(i)}%`, top: `${(py(d.b) / H) * 140 + 3}px`, transform: "translateX(-50%)", fontSize: 8, color: corB, fontFamily: MONO, whiteSpace: "nowrap" }}>{d.b}</span>
        </span>
      ) : null))}
      <div style={{ display: "flex", gap: 3, marginTop: 4 }}>
        {dados.map((d, i) => <span key={i} style={{ flex: 1, textAlign: "center", fontSize: 8, color: "#9A9DA4", fontFamily: MONO }}>{i % passo === 0 ? d.label : ""}</span>)}
      </div>
    </div>
  );
}
function ResumoTrajeto({ porDia }: { porDia: any[] }) {
  const km = porDia.reduce((s, d) => s + d.km, 0);
  const mov = porDia.reduce((s, d) => s + d.ignMovingMin, 0), idle = porDia.reduce((s, d) => s + d.ignIdleMin, 0), off = porDia.reduce((s, d) => s + d.ignOffMin, 0);
  const fuel = porDia.reduce((s, d) => s + (d.fuelL ?? 0), 0);
  const hm = (min: number) => `${Math.floor(min / 60)}h${pad2(Math.round(min % 60))}`;
  const linha = (label: string, valor: string, cor: string) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "2px 0" }}><span style={{ color: "#6B6E76" }}>{label}</span><span style={{ fontWeight: 700, fontFamily: MONO, color: cor }}>{valor}</span></div>
  );
  return (<div>
    {linha("Km rodado", `${km.toFixed(0)} km`, "#1F2024")}
    {linha("Em movimento", hm(mov), VERDE)}
    {linha("Parado", hm(off), "#6B6E76")}
    {linha("Motor ocioso", hm(idle), AMBAR)}
    <div style={{ height: 1, background: "#EDEFF2", margin: "6px 0" }} />
    {linha("Combustível", fuel ? `${fuel.toFixed(1)} L` : "—", AZUL)}
    {linha("Média km/L", fuel ? `${(km / fuel).toFixed(2)}` : "—", VERDE)}
  </div>);
}
function ComparacaoOcioso({ diario, veiculos, onPlaca, showLabels }: { diario: Record<string, any[]>; veiculos: Veiculo[]; onPlaca: (p: string) => void; showLabels: boolean }) {
  const linhas = veiculos.map((v) => {
    const rows = diario[v.placa] ?? [];
    const fuel = rows.reduce((s, d) => s + (d.fuelL ?? 0), 0);
    const idleMin = rows.reduce((s, d) => s + d.ignIdleMin, 0);
    // combustível ocioso estimado: proporção do tempo ocioso × combustível total
    const totMin = rows.reduce((s, d) => s + d.ignMovingMin + d.ignIdleMin, 0);
    const idleFuel = totMin > 0 ? +(fuel * (idleMin / totMin)).toFixed(1) : 0;
    return { placa: v.placa, cor: v.cor, fuel: +fuel.toFixed(1), idleFuel, movFuel: +(fuel - idleFuel).toFixed(1), pct: fuel > 0 ? Math.round(idleFuel / fuel * 100) : 0 };
  }).filter((l) => l.fuel > 0).sort((a, b) => b.idleFuel - a.idleFuel);
  if (!linhas.length) return <p style={{ fontSize: 12.5, color: "#8A8D96" }}>Sem consumo estimado no período (cadastre a capacidade do tanque dos veículos).</p>;
  const max = Math.max(1, ...linhas.map((l) => l.fuel));
  return (
    <div>
      <Legenda itens={[{ cor: "#4B5563", label: "Combustível em movimento" }, { cor: AMBAR, label: "Combustível ocioso" }, { cor: VERMELHO, label: "% ocioso" }]} />
      <div style={{ display: "flex", gap: 6, alignItems: "flex-end", height: 180, marginTop: 10 }}>
        {linhas.map((l) => (
          <div key={l.placa} onClick={() => onPlaca(l.placa)} title={`${l.placa} — ${l.pct}% ocioso`} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", cursor: "pointer" }}>
            {showLabels && <span style={{ fontSize: 8, color: VERMELHO, fontFamily: MONO }}>{l.pct}%</span>}
            <div style={{ width: "70%", height: `${l.fuel / max * 150}px`, borderRadius: "4px 4px 0 0", overflow: "hidden", display: "flex", flexDirection: "column", justifyContent: "flex-end", minHeight: 2 }}>
              <div style={{ height: `${l.idleFuel / l.fuel * 100}%`, background: AMBAR }} />
              <div style={{ height: `${l.movFuel / l.fuel * 100}%`, background: "#4B5563" }} />
            </div>
            <span style={{ fontSize: 8, color: "#9A9DA4", marginTop: 4, fontFamily: MONO, transform: "rotate(-45deg)", whiteSpace: "nowrap" }}>{l.placa}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
