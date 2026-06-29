"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  apiFetch, podeAcessar,
  salvarSessao, carregarSessao, limparSessao,
} from "@/lib/api";
import LoginForm from "@/components/LoginForm";

// ── Paleta / tipografia (mesmo sistema da Info Análise / Cadastros) ──
const VINHO = "#6E1414";
const SANS = "'IBM Plex Sans', system-ui, sans-serif";
const MONO = "'IBM Plex Mono', ui-monospace, monospace";

// ── Regra de status operacional ───────────────────────────────
// RISCO_PANE_SECA é DERIVADO: combustível < 15% sobrepõe o status de base.
const LIMIAR_PANE_SECA = 15;

const STATUS = {
  EM_MOVIMENTO:        { label: "Em movimento",        color: "#16A34A", bg: "#E7F6EC" },
  MOTOR_LIGADO_PARADO: { label: "Motor ligado parado", color: "#C2820E", bg: "#FBF3E2" },
  MOTOR_DESLIGADO:     { label: "Motor desligado",     color: "#6B6E76", bg: "#EEF0F3" },
  RISCO_PANE_SECA:     { label: "Risco de pane seca",  color: "#C0392B", bg: "#F9E9E7" },
  SEM_MOTORISTA:       { label: "Sem motorista",       color: "#94A3B8", bg: "#F1F4F8" },
} as const;
type StatusKey = keyof typeof STATUS;
const ORDEM: StatusKey[] = ["EM_MOVIMENTO", "MOTOR_LIGADO_PARADO", "MOTOR_DESLIGADO", "RISCO_PANE_SECA", "SEM_MOTORISTA"];

// ── Tipos (leitura defensiva — o backend pode variar os nomes) ──
type Veiculo = {
  id: string;
  placa?: string;
  marca?: string;
  modelo?: string;
  frota?: string;
  grupoId?: string | null;
  grupoNome?: string | null;
  motorista?: { id?: string; nome?: string } | string | null;
  // telemetria (pode vir aninhada em `telemetria` — normalizamos abaixo)
  status?: string | null;
  combustivel?: number | null;
  velocidade?: number | null;
  rpm?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  ultimaComunicacao?: string | null;
  telemetria?: Partial<Veiculo> | null;
};

type Grupo = { id: string; nome: string; veiculos: VeiculoNorm[] };

type VeiculoNorm = {
  id: string;
  placa: string;
  modelo: string;
  frota: string;
  grupoId: string;
  grupoNome: string;
  motorista: string | null;
  statusBase: StatusKey;
  fuel: number | null;
  vel: number;
  rpm: number;
  lat: number | null;
  lng: number | null;
  ultima: string;
};

// ── Helpers ───────────────────────────────────────────────────
const iniciais = (n?: string | null) =>
  n ? n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() : "—";

// ISO "2026-06-29T15:02:51.000Z" → "29/06/2026 12:02" (fuso de São Paulo)
const fmtDataBR = (iso?: string | null): string => {
  if (!iso || iso === "—") return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).replace(",", "");
};

// Link para a última localização no Google Maps
const linkGoogleMaps = (lat: number, lng: number) =>
  `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;

const nomeMotorista = (v: Veiculo): string | null => {
  const m = v.motorista;
  if (!m) return null;
  if (typeof m === "string") return m || null;
  return m.nome ?? null;
};

const corDe = (s: StatusKey) => STATUS[s].color;

// Status efetivo: a regra de pane seca tem prioridade — mas SÓ quando há dado
// de combustível. Sem o dado (null), não dispara (evita falso "pane seca").
const statusEfetivo = (v: VeiculoNorm): StatusKey =>
  v.fuel != null && v.fuel < LIMIAR_PANE_SECA ? "RISCO_PANE_SECA" : v.statusBase;

const corCombustivel = (p: number) => (p < 15 ? "#C0392B" : p < 40 ? "#C2820E" : "#16A34A");

const normalizarStatus = (s?: string | null): StatusKey => {
  const k = (s ?? "").toUpperCase().replace(/[\s-]+/g, "_");
  return (ORDEM as string[]).includes(k) ? (k as StatusKey) : "MOTOR_DESLIGADO";
};

// Normaliza um Veiculo cru da API para o formato que a UI usa.
function normalizar(v: Veiculo): VeiculoNorm {
  const t = { ...v, ...(v.telemetria ?? {}) };
  const moto = nomeMotorista(v);
  const statusBase: StatusKey = moto ? normalizarStatus(t.status) : "SEM_MOTORISTA";
  return {
    id: v.id,
    placa: v.placa ?? "(sem placa)",
    modelo: [v.marca, v.modelo].filter(Boolean).join(" ") || "Sem modelo",
    frota: v.frota ?? "",
    grupoId: v.grupoId ?? "sem-grupo",
    grupoNome: v.grupoNome ?? "Sem frota",
    motorista: moto,
    statusBase,
    fuel: Number.isFinite(t.combustivel as number) ? (t.combustivel as number) : null,
    vel: Number.isFinite(t.velocidade as number) ? (t.velocidade as number) : 0,
    rpm: Number.isFinite(t.rpm as number) ? (t.rpm as number) : 0,
    lat: Number.isFinite(t.latitude as number) ? (t.latitude as number) : null,
    lng: Number.isFinite(t.longitude as number) ? (t.longitude as number) : null,
    ultima: t.ultimaComunicacao ?? "—",
  };
}

// ── Logotipo Infobridge (mesmo de Cadastros) ──────────────────
function LogoInfobridge({ height = 34 }: { height?: number }) {
  return (
    <svg height={height} viewBox="0 0 120 76" fill="none" aria-label="Infobridge">
      <g stroke={VINHO} strokeWidth="3.4" strokeLinecap="round" fill="none">
        <line x1="40" y1="10" x2="40" y2="60" />
        <line x1="80" y1="10" x2="80" y2="60" />
        <path d="M40 12 Q60 40 80 12" />
        <path d="M40 12 Q20 42 6 60" />
        <path d="M80 12 Q100 42 114 60" />
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


// ── Carrega Leaflet (CSS + JS) sob demanda, sem chave de API ───
function useLeaflet() {
  const [pronto, setPronto] = useState<boolean>(typeof window !== "undefined" && !!(window as any).L);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if ((window as any).L) { setPronto(true); return; }
    const cssId = "leaflet-css";
    if (!document.getElementById(cssId)) {
      const link = document.createElement("link");
      link.id = cssId; link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }
    const scriptId = "leaflet-js";
    const existente = document.getElementById(scriptId) as HTMLScriptElement | null;
    if (existente) { existente.addEventListener("load", () => setPronto(true)); return; }
    const s = document.createElement("script");
    s.id = scriptId; s.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    s.onload = () => setPronto(true);
    document.body.appendChild(s);
  }, []);
  return pronto;
}

// ── Página principal ──────────────────────────────────────────
export default function MapaAoVivoPage() {
  const [token, setToken] = useState<string | null>(null);
  const [nomeUsuario, setNomeUsuario] = useState("");
  const [veiculos, setVeiculos] = useState<VeiculoNorm[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");

  // Seleção / filtros / UI
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [statusOn, setStatusOn] = useState<Record<StatusKey, boolean>>(
    () => Object.fromEntries(ORDEM.map((k) => [k, true])) as Record<StatusKey, boolean>
  );
  const [selOpen, setSelOpen] = useState(false);
  const [busca, setBusca] = useState("");
  const [popupId, setPopupId] = useState<string | null>(null);
  const [mapType, setMapType] = useState<"roadmap" | "satellite">("roadmap");
  const [secsAgo, setSecsAgo] = useState(0);

  const leafletPronto = useLeaflet();
  const mapDivRef = useRef<HTMLDivElement | null>(null);
  const mapAreaRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const layersRef = useRef<any>(null);
  const markerLayerRef = useRef<any>(null);

  const sair = useCallback(() => { limparSessao(); setToken(null); }, []);

  // ── Carregar veículos + telemetria ──────────────────────────
  const carregar = useCallback(async (tk: string) => {
    setCarregando(true); setErro("");
    try {
      // Última posição/telemetria de cada veículo (endpoint dedicado do backend).
      const v = await apiFetch<{ dados: Veiculo[] }>("/veiculos/ao-vivo", tk);
      const norm = (v.dados ?? []).map(normalizar);
      setVeiculos(norm);
      setSel((prev) => {
        const next = { ...prev };
        norm.forEach((x) => { if (next[x.id] === undefined) next[x.id] = true; });
        return next;
      });
    } catch (e: any) {
      const msg = e?.message ?? "Erro ao carregar veículos";
      if (/401|403/.test(msg)) { limparSessao(); setToken(null); }
      else setErro(msg);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    const sessao = carregarSessao();
    if (sessao?.token) {
      setToken(sessao.token); setNomeUsuario(sessao.nome); carregar(sessao.token);
    }
  }, [carregar]);

  // Poll de telemetria (30s) + relógio do "atualizado há".
  useEffect(() => {
    if (!token) return;
    const clock = setInterval(() => setSecsAgo((s) => s + 1), 1000);
    const poll = setInterval(() => { setSecsAgo(0); carregar(token); }, 30000);
    return () => { clearInterval(clock); clearInterval(poll); };
  }, [token, carregar]);

  function handleLogin(tk: string, nome: string) {
    salvarSessao(tk, nome); setToken(tk); setNomeUsuario(nome); carregar(tk);
  }

  // ── Derivados ───────────────────────────────────────────────
  const selecionados = useMemo(() => veiculos.filter((v) => sel[v.id]), [veiculos, sel]);
  const visiveis = useMemo(
    () => selecionados.filter((v) => statusOn[statusEfetivo(v)] && v.lat != null && v.lng != null),
    [selecionados, statusOn]
  );

  const grupos: Grupo[] = useMemo(() => {
    const bq = busca.trim().toLowerCase();
    const mapa = new Map<string, Grupo>();
    for (const v of veiculos) {
      if (!mapa.has(v.grupoId)) mapa.set(v.grupoId, { id: v.grupoId, nome: v.grupoNome, veiculos: [] });
      const passa = !bq || v.placa.toLowerCase().includes(bq) || v.modelo.toLowerCase().includes(bq);
      if (passa) mapa.get(v.grupoId)!.veiculos.push(v);
    }
    return [...mapa.values()].filter((g) => g.veiculos.length > 0);
  }, [veiculos, busca]);

  const semResultado = busca.trim().length > 0 && grupos.length === 0;

  const statusRows = useMemo(
    () => ORDEM.map((k) => ({ key: k, ...STATUS[k], count: selecionados.filter((v) => statusEfetivo(v) === k).length, on: statusOn[k] })),
    [selecionados, statusOn]
  );

  const movimento = visiveis.filter((v) => statusEfetivo(v) === "EM_MOVIMENTO").length;
  const temSelecao = selecionados.length > 0;
  const allOn = veiculos.length > 0 && veiculos.every((v) => sel[v.id]);

  // ── Mapa (Leaflet imperativo) ───────────────────────────────
  useEffect(() => {
    if (!leafletPronto || !mapDivRef.current || mapRef.current || !token) return;
    const L = (window as any).L;
    const blank = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
    const map = L.map(mapDivRef.current, { zoomControl: false, attributionControl: true }).setView([-15.6, -43.5], 4.3);
    L.control.zoom({ position: "bottomright" }).addTo(map);
    layersRef.current = {
      roadmap: L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", { maxZoom: 19, subdomains: "abcd", errorTileUrl: blank, attribution: "© OpenStreetMap · © CARTO" }),
      satellite: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, errorTileUrl: blank, attribution: "© Esri" }),
    };
    markerLayerRef.current = L.layerGroup();
    requestAnimationFrame(() => {
      map.invalidateSize();
      layersRef.current.roadmap.addTo(map);
      markerLayerRef.current.addTo(map);
    });
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, [leafletPronto, token]);

  // Sincroniza marcadores quando muda seleção/filtros/telemetria/popup.
  useEffect(() => {
    const L = (window as any).L;
    const map = mapRef.current;
    const layer = markerLayerRef.current;
    if (!L || !map || !layer) return;
    layer.clearLayers();
    visiveis.forEach((v) => {
      const sk = statusEfetivo(v);
      const cor = corDe(sk);
      const moving = sk === "EM_MOVIMENTO";
      const ativo = popupId === v.id;
      const html = `<div style="width:30px;height:30px;border-radius:50% 50% 50% 2px;background:#fff;border:2px solid ${cor};display:flex;align-items:center;justify-content:center;box-shadow:0 3px 8px rgba(20,16,16,.30);color:${cor};transform:rotate(-45deg);${moving ? "animation:mkpulse 1.8s infinite;" : ""}${ativo ? "outline:3px solid " + cor + "33;outline-offset:1px;" : ""}"><i class="ti ti-truck" style="font-size:15px;transform:rotate(45deg)"></i></div>`;
      const icon = L.divIcon({ html, className: "mk-wrap", iconSize: [30, 30], iconAnchor: [15, 28] });
      const mk = L.marker([v.lat, v.lng], { icon }).addTo(layer);
      mk.on("click", () => {
        setPopupId(v.id);
        map.panTo([v.lat, v.lng], { animate: true });
      });
    });
  }, [visiveis, popupId]);

  // Troca de camada (mapa/satélite).
  useEffect(() => {
    const map = mapRef.current, layers = layersRef.current;
    if (!map || !layers) return;
    (["roadmap", "satellite"] as const).forEach((k) => { if (map.hasLayer(layers[k])) map.removeLayer(layers[k]); });
    layers[mapType].addTo(map);
  }, [mapType]);

  const fitFrota = () => {
    const map = mapRef.current;
    if (!map || visiveis.length === 0) return;
    map.fitBounds(visiveis.map((v) => [v.lat, v.lng]), { padding: [70, 70], maxZoom: 7 });
  };
  const fullscreen = () => {
    const el = mapAreaRef.current; if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen?.();
    setTimeout(() => mapRef.current?.invalidateSize(), 250);
  };

  // ── Ações de seleção ────────────────────────────────────────
  const toggleVeic = (id: string) => setSel((s) => ({ ...s, [id]: !s[id] }));
  const toggleGrupo = (gid: string) => {
    const ids = veiculos.filter((v) => v.grupoId === gid).map((v) => v.id);
    const todos = ids.every((id) => sel[id]);
    setSel((s) => { const n = { ...s }; ids.forEach((id) => (n[id] = !todos)); return n; });
  };
  const toggleTodos = () => setSel(() => Object.fromEntries(veiculos.map((v) => [v.id, !allOn])));
  const limparSelecao = () => setSel(() => Object.fromEntries(veiculos.map((v) => [v.id, false])));

  if (!token) return <LoginForm onLogin={handleLogin} />;

  const liveAgo = secsAgo < 5 ? "agora" : secsAgo < 60 ? `há ${secsAgo}s` : `há ${Math.floor(secsAgo / 60)} min`;
  const pvRaw = popupId ? veiculos.find((v) => v.id === popupId) : null;
  const pv = pvRaw && sel[pvRaw.id] && statusOn[statusEfetivo(pvRaw)] ? pvRaw : null;
  const pvStatus = pv ? statusEfetivo(pv) : null;
  const tagsAll = selecionados;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden", background: "#E9EBEF", fontFamily: SANS }}>
      <style>{`
        .ti { font-family: 'tabler-icons' !important; font-style: normal; line-height: 1; }
        .leaflet-container { font-family: ${SANS}; background: #E9EBEF; }
        .leaflet-control-attribution { font-size: 9px; background: rgba(255,255,255,.7); }
        .mk-wrap { background: none !important; border: none !important; }
        @keyframes mkpulse { 0%{box-shadow:0 0 0 0 rgba(22,163,74,.45),0 3px 8px rgba(20,16,16,.3)} 70%{box-shadow:0 0 0 11px rgba(22,163,74,0),0 3px 8px rgba(20,16,16,.3)} 100%{box-shadow:0 0 0 0 rgba(22,163,74,0),0 3px 8px rgba(20,16,16,.3)} }
        @keyframes lpulse { 0%{box-shadow:0 0 0 0 rgba(22,163,74,.55)} 70%{box-shadow:0 0 0 6px rgba(22,163,74,0)} 100%{box-shadow:0 0 0 0 rgba(22,163,74,0)} }
        .map-mi:hover { background: #F7F8FA; }
      `}</style>

      {/* ===== HEADER ===== */}
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#FFFFFF", padding: "0 22px", height: 60, borderBottom: "1px solid #ECEDF1", flexShrink: 0, position: "relative", zIndex: 60 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <LogoInfobridge height={34} />
            <div style={{ borderLeft: "1px solid #E2E4E9", paddingLeft: 12 }}>
              <div style={{ fontSize: 8, letterSpacing: 2.4, color: VINHO, textTransform: "uppercase", fontWeight: 700 }}>Infobridge</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#1F2024" }}>Sistema</div>
            </div>
          </div>
          <nav style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: 6 }}>
            <a href="/info-analise" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "#5A5D65", textDecoration: "none", fontWeight: 500, padding: "8px 12px", borderRadius: 9 }}><i className="ti ti-chart-dots" aria-hidden="true" style={{ fontSize: 16 }} />Info Análise</a>
            <a href="/cadastros" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "#5A5D65", textDecoration: "none", fontWeight: 500, padding: "8px 12px", borderRadius: 9 }}><i className="ti ti-folder" aria-hidden="true" style={{ fontSize: 16 }} />Cadastros</a>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: VINHO, background: "#F6F2F2", fontWeight: 600, padding: "8px 12px", borderRadius: 9 }}><i className="ti ti-map-pin" aria-hidden="true" style={{ fontSize: 16 }} />Mapa ao vivo</span>
            {podeAcessar("usuarios") && <a href="/usuarios" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "#5A5D65", textDecoration: "none", fontWeight: 500, padding: "8px 12px", borderRadius: 9 }}><i className="ti ti-users" aria-hidden="true" style={{ fontSize: 16 }} />Usuários</a>}
          </nav>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ width: 32, height: 32, borderRadius: "50%", background: "#F4EDED", display: "flex", alignItems: "center", justifyContent: "center" }}><i className="ti ti-user" aria-hidden="true" style={{ fontSize: 17, color: VINHO }} /></span>
          <span style={{ fontSize: 13, color: "#33363D", fontWeight: 500 }}>{nomeUsuario || "Administrador"}</span>
          <button onClick={sair} style={{ display: "flex", alignItems: "center", gap: 6, background: "#FFFFFF", border: "1px solid #DDE0E6", borderRadius: 9, padding: "7px 12px", fontSize: 13, color: "#5A5D65", cursor: "pointer", fontFamily: SANS }}><i className="ti ti-logout" aria-hidden="true" style={{ fontSize: 15 }} />Sair</button>
        </div>
      </header>

      {/* ===== PAGE HEADER ===== */}
      <div style={{ background: "#FFFFFF", borderBottom: "1px solid #ECEDF1", padding: "13px 22px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap", flexShrink: 0, position: "relative", zIndex: 50 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ fontSize: 17, fontWeight: 700, color: "#1F2024", margin: 0, display: "flex", alignItems: "center", gap: 9 }}>
              <span style={{ width: 30, height: 30, borderRadius: 8, background: "#F4EDED", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><i className="ti ti-map-pin" aria-hidden="true" style={{ fontSize: 17, color: VINHO }} /></span>Mapa ao vivo
            </h1>
            <div style={{ fontSize: 12, color: "#6B6E76", marginTop: 2, paddingLeft: 39 }}>Sua frota em tempo real — status, telemetria e localização de cada veículo</div>
          </div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "#EAF6EE", border: "1px solid #C6E7D2", borderRadius: 100, padding: "5px 12px 5px 10px" }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#16A34A", animation: "lpulse 1.6s infinite" }} />
            <span style={{ fontSize: 11.5, fontWeight: 600, color: "#15803D" }}>Ao vivo</span>
            <span style={{ fontSize: 11.5, color: "#5E9E76" }}>· atualizado {liveAgo}</span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* Multi-select com busca por placa */}
          <div style={{ position: "relative", minWidth: 330 }}>
            <div onClick={() => { setSelOpen((o) => !o); setBusca(""); }} style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", border: `1.5px solid ${temSelecao ? "#D8C2C2" : "#DDE0E6"}`, borderRadius: 11, padding: "6px 56px 6px 10px", background: "#FFFFFF", cursor: "pointer", minHeight: 42, position: "relative" }}>
              {!temSelecao && <span style={{ color: "#9A9DA4", fontSize: 13 }}>Selecione veículos ou frotas…</span>}
              {tagsAll.slice(0, 5).map((v) => (
                <span key={v.id} style={{ fontFamily: MONO, display: "inline-flex", alignItems: "center", gap: 5, background: "#F1F3F6", border: "1px solid #E2E4E9", borderRadius: 7, padding: "3px 6px 3px 8px", fontSize: 11.5, fontWeight: 600, color: "#33363D" }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: corDe(statusEfetivo(v)) }} />{v.placa}
                  <button onClick={(e) => { e.stopPropagation(); toggleVeic(v.id); }} aria-label={`Remover ${v.placa}`} style={{ background: "none", border: "none", cursor: "pointer", color: "#9A9DA4", display: "flex", padding: 0, marginLeft: 1 }}><i className="ti ti-x" aria-hidden="true" style={{ fontSize: 13 }} /></button>
                </span>
              ))}
              {tagsAll.length > 5 && <span style={{ fontSize: 11.5, fontWeight: 600, color: "#6B6E76", padding: "2px 4px" }}>+{tagsAll.length - 5}</span>}
              <span style={{ position: "absolute", right: 10, top: 9, display: "flex", alignItems: "center", gap: 4 }}>
                {temSelecao && <button onClick={(e) => { e.stopPropagation(); limparSelecao(); }} aria-label="Limpar seleção" style={{ background: "none", border: "none", cursor: "pointer", color: "#9A9DA4", display: "flex", padding: 2 }}><i className="ti ti-x" aria-hidden="true" style={{ fontSize: 14 }} /></button>}
                <i className={`ti ${selOpen ? "ti-chevron-up" : "ti-chevron-down"}`} aria-hidden="true" style={{ fontSize: 15, color: "#8A8D96" }} />
              </span>
            </div>

            {selOpen && (
              <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, left: 0, zIndex: 80, background: "#FFFFFF", border: "1px solid #E7E9ED", borderRadius: 13, boxShadow: "0 16px 42px rgba(30,32,40,.18)", maxHeight: 380, overflowY: "auto", padding: 6 }}>
                <div style={{ position: "sticky", top: 0, background: "#FFFFFF", padding: "2px 2px 8px", zIndex: 2 }}>
                  <div style={{ position: "relative" }}>
                    <i className="ti ti-search" aria-hidden="true" style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", fontSize: 15, color: "#A4A7AE" }} />
                    <label htmlFor="busca-placa" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Buscar por placa</label>
                    <input id="busca-placa" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por placa…" style={{ width: "100%", boxSizing: "border-box", border: "1px solid #E2E4E9", borderRadius: 9, padding: "9px 30px 9px 32px", fontSize: 13, fontFamily: SANS, outline: "none", color: "#1F2024" }} />
                    {busca && <button onClick={() => setBusca("")} aria-label="Limpar busca" style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#9A9DA4", display: "flex", padding: 2 }}><i className="ti ti-x" aria-hidden="true" style={{ fontSize: 14 }} /></button>}
                  </div>
                </div>

                {!busca && (
                  <button onClick={toggleTodos} className="map-mi" style={{ width: "100%", display: "flex", alignItems: "center", gap: 9, background: "none", border: "none", borderRadius: 9, padding: "9px 11px", cursor: "pointer", textAlign: "left", fontFamily: SANS, borderBottom: "1px solid #EEF0F3" }}>
                    <span style={{ width: 18, height: 18, borderRadius: 5, border: `1.5px solid ${allOn ? VINHO : "#CDD1D8"}`, background: allOn ? VINHO : "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><i className="ti ti-check" aria-hidden="true" style={{ fontSize: 12, color: "#fff", opacity: allOn ? 1 : 0 }} /></span>
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "#1F2024" }}>Todos os veículos</span>
                    <span style={{ fontFamily: MONO, fontSize: 11, color: "#9A9DA4" }}>{veiculos.length}</span>
                  </button>
                )}

                {semResultado && (
                  <div style={{ padding: "20px 12px", textAlign: "center", color: "#9A9DA4", fontSize: 12.5, lineHeight: 1.5 }}>
                    <i className="ti ti-search-off" aria-hidden="true" style={{ fontSize: 22, display: "block", marginBottom: 6, color: "#C4C7CE" }} />Nenhuma placa encontrada
                  </div>
                )}

                {grupos.map((g) => {
                  const idsGrupo = veiculos.filter((v) => v.grupoId === g.id);
                  const selCount = idsGrupo.filter((v) => sel[v.id]).length;
                  const gAll = selCount === idsGrupo.length;
                  const gSome = selCount > 0 && !gAll;
                  return (
                    <div key={g.id}>
                      <button onClick={() => toggleGrupo(g.id)} className="map-mi" style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", borderRadius: 8, padding: "8px 11px", cursor: "pointer", textAlign: "left", fontFamily: SANS, marginTop: 4 }}>
                        <span style={{ width: 16, height: 16, borderRadius: 5, border: `1.5px solid ${selCount > 0 ? VINHO : "#CDD1D8"}`, background: gAll ? VINHO : gSome ? "#B98A8A" : "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><i className={`ti ${gAll ? "ti-check" : "ti-minus"}`} aria-hidden="true" style={{ fontSize: 11, color: "#fff", opacity: selCount > 0 ? 1 : 0 }} /></span>
                        <span style={{ flex: 1, fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: "#8A8D96" }}>{g.nome}</span>
                        <span style={{ fontFamily: MONO, fontSize: 10, color: "#A4A7AE", background: "#F1F3F6", borderRadius: 8, padding: "1px 6px" }}>{selCount}/{idsGrupo.length}</span>
                      </button>
                      {g.veiculos.map((v) => {
                        const on = !!sel[v.id];
                        return (
                          <button key={v.id} onClick={() => toggleVeic(v.id)} className="map-mi" style={{ width: "100%", display: "flex", alignItems: "center", gap: 9, background: on ? "#FBF8F8" : "transparent", border: "none", borderRadius: 8, padding: "8px 11px 8px 28px", cursor: "pointer", textAlign: "left", fontFamily: SANS }}>
                            <span style={{ width: 17, height: 17, borderRadius: 5, border: `1.5px solid ${on ? VINHO : "#CDD1D8"}`, background: on ? VINHO : "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><i className="ti ti-check" aria-hidden="true" style={{ fontSize: 11, color: "#fff", opacity: on ? 1 : 0 }} /></span>
                            <span style={{ width: 8, height: 8, borderRadius: "50%", background: corDe(statusEfetivo(v)), flexShrink: 0 }} />
                            <span style={{ flex: 1, minWidth: 0 }}><span style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 600, color: "#1F2024" }}>{v.placa}</span><span style={{ fontSize: 11, color: "#8A8D96", marginLeft: 7 }}>{v.modelo}</span></span>
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <button onClick={() => token && carregar(token)} title="Atualizar agora" aria-label="Atualizar agora" style={{ width: 42, height: 42, borderRadius: 11, border: "1px solid #DDE0E6", background: "#FFFFFF", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#5A5D65", flexShrink: 0 }}><i className="ti ti-refresh" aria-hidden="true" style={{ fontSize: 18 }} /></button>
        </div>
      </div>

      {selOpen && <div onClick={() => { setSelOpen(false); setBusca(""); }} style={{ position: "fixed", inset: 0, zIndex: 45, background: "transparent" }} />}

      {/* ===== BODY: filtros + mapa ===== */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden", minHeight: 0 }}>
        {temSelecao && (
          <aside style={{ width: 286, background: "#FFFFFF", borderRight: "1px solid #E7E9ED", display: "flex", flexDirection: "column", flexShrink: 0, overflowY: "auto" }}>
            <div style={{ padding: "16px 16px 12px", borderBottom: "1px solid #EEF0F3" }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.4, textTransform: "uppercase", color: "#8A8D96" }}>Veículos no mapa</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 6 }}>
                <span style={{ fontFamily: MONO, fontSize: 30, fontWeight: 700, color: "#1F2024", lineHeight: 1 }}>{visiveis.length}</span>
                <span style={{ fontSize: 12, color: "#8A8D96" }}>de {selecionados.length} selecionados</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 9, fontSize: 12, color: "#15803D", fontWeight: 600 }}><i className="ti ti-arrow-up-right" aria-hidden="true" style={{ fontSize: 15 }} />{movimento} em movimento agora</div>
            </div>

            <div style={{ padding: "14px 16px 6px", fontSize: 10, fontWeight: 700, letterSpacing: 1.4, textTransform: "uppercase", color: "#8A8D96" }}>Filtrar por status</div>
            <div style={{ fontSize: 11, color: "#9A9DA4", padding: "0 16px 10px", lineHeight: 1.5 }}>Marque os status que deseja exibir no mapa.</div>

            <div style={{ display: "flex", flexDirection: "column", padding: "0 8px" }}>
              {statusRows.map((r) => (
                <button key={r.key} onClick={() => setStatusOn((s) => ({ ...s, [r.key]: !s[r.key] }))} className="map-mi" style={{ display: "flex", alignItems: "center", gap: 11, cursor: "pointer", background: "none", border: "none", borderRadius: 9, padding: "9px 8px", fontFamily: SANS, textAlign: "left" }}>
                  <span style={{ width: 18, height: 18, borderRadius: 5, border: `1.5px solid ${r.on ? VINHO : "#CDD1D8"}`, background: r.on ? VINHO : "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><i className="ti ti-check" aria-hidden="true" style={{ fontSize: 12, color: "#fff", opacity: r.on ? 1 : 0 }} /></span>
                  <span style={{ width: 11, height: 11, borderRadius: "50%", background: r.color, flexShrink: 0, opacity: r.on ? 1 : 0.35 }} />
                  <span style={{ flex: 1, fontSize: 12.5, fontWeight: 500, color: r.on ? "#33363D" : "#A4A7AE" }}>{r.label}</span>
                  <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, color: "#9A9DA4" }}>{r.count}</span>
                </button>
              ))}
            </div>

            <div style={{ padding: "12px 16px", marginTop: 4 }}>
              <button onClick={() => { const algum = ORDEM.some((k) => statusOn[k]); setStatusOn(Object.fromEntries(ORDEM.map((k) => [k, !algum])) as Record<StatusKey, boolean>); }} style={{ width: "100%", padding: 9, border: "1px solid #DDE0E6", borderRadius: 10, background: "#FFFFFF", cursor: "pointer", fontSize: 12, color: "#5A5D65", fontFamily: SANS, fontWeight: 600 }}>{ORDEM.some((k) => statusOn[k]) ? "Desabilitar todos" : "Habilitar todos"}</button>
            </div>

            <div style={{ marginTop: "auto", padding: "14px 16px", borderTop: "1px solid #EEF0F3", display: "flex", alignItems: "flex-start", gap: 8, fontSize: 11, color: "#8A8D96", lineHeight: 1.5 }}><i className="ti ti-cloud-download" aria-hidden="true" style={{ fontSize: 15, flexShrink: 0, marginTop: 1 }} />Telemetria importada da API a cada 30s · somente leitura</div>
          </aside>
        )}

        {/* Área do mapa */}
        <div ref={mapAreaRef} style={{ flex: 1, position: "relative", minWidth: 0, background: "#E9EBEF" }}>
          <div ref={mapDivRef} style={{ position: "absolute", inset: 0, zIndex: 1 }} />

          <div style={{ position: "absolute", top: 14, left: 14, zIndex: 30, display: "flex", background: "#FFFFFF", borderRadius: 10, boxShadow: "0 2px 8px rgba(30,32,40,.16)", overflow: "hidden", border: "1px solid #E7E9ED" }}>
            <button onClick={() => setMapType("roadmap")} style={{ padding: "7px 15px", fontSize: 12.5, fontWeight: 600, border: "none", cursor: "pointer", fontFamily: SANS, background: mapType === "roadmap" ? "#F4EDED" : "#FFFFFF", color: mapType === "roadmap" ? VINHO : "#5A5D65" }}>Mapa</button>
            <button onClick={() => setMapType("satellite")} style={{ padding: "7px 15px", fontSize: 12.5, fontWeight: 600, border: "none", cursor: "pointer", fontFamily: SANS, background: mapType === "satellite" ? "#F4EDED" : "#FFFFFF", color: mapType === "satellite" ? VINHO : "#5A5D65" }}>Satélite</button>
          </div>

          <div style={{ position: "absolute", top: 14, right: 14, zIndex: 30, display: "flex", gap: 8 }}>
            <button onClick={fitFrota} title="Centralizar frota" style={{ height: 38, padding: "0 13px", borderRadius: 10, border: "1px solid #E7E9ED", background: "#FFFFFF", boxShadow: "0 2px 8px rgba(30,32,40,.16)", cursor: "pointer", display: "flex", alignItems: "center", gap: 7, color: "#5A5D65", fontFamily: SANS, fontSize: 12.5, fontWeight: 600 }}><i className="ti ti-focus-centered" aria-hidden="true" style={{ fontSize: 17 }} />Centralizar</button>
            <button onClick={fullscreen} title="Tela cheia" aria-label="Tela cheia" style={{ width: 38, height: 38, borderRadius: 10, border: "1px solid #E7E9ED", background: "#FFFFFF", boxShadow: "0 2px 8px rgba(30,32,40,.16)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#5A5D65" }}><i className="ti ti-maximize" aria-hidden="true" style={{ fontSize: 18 }} /></button>
          </div>

          {(!temSelecao || (carregando && veiculos.length === 0)) && (
            <div style={{ position: "absolute", inset: 0, zIndex: 25, background: "rgba(233,235,239,.92)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: 40, textAlign: "center" }}>
              <span style={{ width: 74, height: 74, borderRadius: "50%", background: "#FFFFFF", border: "1px solid #E2E4E9", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 16px rgba(30,32,40,.08)" }}><i className="ti ti-map-search" aria-hidden="true" style={{ fontSize: 36, color: "#B7281E" }} /></span>
              <div style={{ fontSize: 19, fontWeight: 700, color: "#1F2024" }}>{carregando ? "Carregando frota…" : "Nenhum veículo selecionado"}</div>
              {!carregando && <div style={{ fontSize: 13, color: "#6B6E76", maxWidth: 340, lineHeight: 1.55 }}>Selecione uma ou mais frotas no campo acima para visualizar a localização e o status em tempo real.</div>}
              {!carregando && <button onClick={() => setSelOpen(true)} style={{ marginTop: 4, display: "inline-flex", alignItems: "center", gap: 7, background: VINHO, color: "#fff", border: "none", borderRadius: 10, padding: "10px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: SANS }}><i className="ti ti-plus" aria-hidden="true" style={{ fontSize: 16 }} />Selecionar veículos</button>}
            </div>
          )}

          {/* Popup do veículo */}
          {pv && pvStatus && (
            <div style={{ position: "absolute", top: 16, left: "50%", transform: "translateX(-50%)", zIndex: 40, width: 340, background: "#FFFFFF", borderRadius: 15, boxShadow: "0 14px 44px rgba(20,16,16,.22)", border: "1px solid #ECEDF1", overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 11, padding: "16px 16px 13px", borderBottom: "1px solid #EEF0F3" }}>
                <span style={{ width: 40, height: 40, borderRadius: 10, background: STATUS[pvStatus].bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><i className="ti ti-truck" aria-hidden="true" style={{ fontSize: 21, color: STATUS[pvStatus].color }} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: MONO, fontSize: 17, fontWeight: 700, color: "#1F2024", letterSpacing: 0.5 }}>{pv.placa}</div>
                  <div style={{ fontSize: 11.5, color: "#8A8D96", marginTop: 1 }}>{pv.frota ? `${pv.frota} · ` : ""}{pv.modelo}</div>
                </div>
                <button onClick={() => setPopupId(null)} aria-label="Fechar" style={{ background: "none", border: "none", cursor: "pointer", color: "#9A9DA4", display: "flex", padding: 3 }}><i className="ti ti-x" aria-hidden="true" style={{ fontSize: 18 }} /></button>
              </div>
              <div style={{ padding: "13px 16px", display: "flex", flexDirection: "column", gap: 13 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: STATUS[pvStatus].bg, borderRadius: 100, padding: "4px 11px", alignSelf: "flex-start" }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: STATUS[pvStatus].color }} /><span style={{ fontSize: 12, fontWeight: 600, color: STATUS[pvStatus].color }}>{STATUS[pvStatus].label}</span></span>

                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ width: 30, height: 30, borderRadius: "50%", background: pv.motorista ? "#F4EDED" : "#F1F4F8", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, color: pv.motorista ? VINHO : "#94A3B8" }}>{iniciais(pv.motorista)}</span></span>
                  <div style={{ flex: 1, minWidth: 0, lineHeight: 1.3 }}><div style={{ fontSize: 10.5, color: "#9A9DA4" }}>Motorista</div><div style={{ fontSize: 13, fontWeight: 600, color: pv.motorista ? VINHO : "#94A3B8", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{pv.motorista ?? "Não vinculado"}</div></div>
                </div>

                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}><span style={{ fontSize: 11.5, color: "#6B6E76", display: "flex", alignItems: "center", gap: 5 }}><i className="ti ti-gas-station" aria-hidden="true" style={{ fontSize: 14 }} />Nível de combustível</span><span style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 700, color: pv.fuel == null ? "#9A9DA4" : corCombustivel(pv.fuel) }}>{pv.fuel == null ? "—" : `${pv.fuel}%`}</span></div>
                  <div style={{ height: 7, background: "#EDEFF2", borderRadius: 4, overflow: "hidden" }}><div style={{ height: "100%", borderRadius: 4, background: pv.fuel == null ? "#D6D9DE" : corCombustivel(pv.fuel), width: `${pv.fuel == null ? 0 : Math.max(0, Math.min(100, pv.fuel))}%` }} /></div>
                  {pv.fuel == null && <div style={{ fontSize: 10.5, color: "#9A9DA4", marginTop: 3 }}>Sem dado de combustível neste rastreador</div>}
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div style={{ background: "#F6F7F9", borderRadius: 10, padding: "9px 11px" }}><div style={{ fontSize: 10.5, color: "#9A9DA4", display: "flex", alignItems: "center", gap: 4 }}><i className="ti ti-gauge" aria-hidden="true" style={{ fontSize: 13 }} />Velocidade</div><div style={{ fontFamily: MONO, fontSize: 15, fontWeight: 700, color: "#1F2024", marginTop: 2 }}>{pv.vel} <span style={{ fontSize: 10, fontWeight: 500, color: "#9A9DA4" }}>km/h</span></div></div>
                  <div style={{ background: "#F6F7F9", borderRadius: 10, padding: "9px 11px" }}><div style={{ fontSize: 10.5, color: "#9A9DA4", display: "flex", alignItems: "center", gap: 4 }}><i className="ti ti-engine" aria-hidden="true" style={{ fontSize: 13 }} />RPM</div><div style={{ fontFamily: MONO, fontSize: 15, fontWeight: 700, color: "#1F2024", marginTop: 2 }}>{pv.rpm.toLocaleString("pt-BR")}</div></div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, color: "#8A8D96", flexWrap: "wrap" }}>
                  <i className="ti ti-clock" aria-hidden="true" style={{ fontSize: 14 }} />Última comunicação:{" "}
                  {pv.lat != null && pv.lng != null ? (
                    <a
                      href={linkGoogleMaps(pv.lat, pv.lng)}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Abrir a última localização no Google Maps"
                      style={{ color: "#2563EB", fontWeight: 600, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}
                    >
                      {fmtDataBR(pv.ultima)}
                      <i className="ti ti-external-link" aria-hidden="true" style={{ fontSize: 13 }} />
                    </a>
                  ) : (
                    <span style={{ color: "#5A5D65", fontWeight: 600 }}>{fmtDataBR(pv.ultima)}</span>
                  )}
                </div>
              </div>
              <a href={`/info-analise?veiculo=${encodeURIComponent(pv.id)}`} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: 11, borderTop: "1px solid #EEF0F3", background: "#FAFBFC", color: VINHO, fontSize: 13, fontWeight: 600, textDecoration: "none" }}>Ver no Info Análise<i className="ti ti-arrow-right" aria-hidden="true" style={{ fontSize: 16 }} /></a>
            </div>
          )}
        </div>
      </div>

      {erro && (
        <div role="alert" style={{ position: "fixed", bottom: 16, left: "50%", transform: "translateX(-50%)", zIndex: 90, display: "flex", alignItems: "center", gap: 10, background: "#FDF1F1", border: "1px solid #C0392B40", borderRadius: 12, padding: "11px 16px", color: "#C0392B", fontSize: 13, boxShadow: "0 8px 24px rgba(30,32,40,.14)" }}>
          <i className="ti ti-alert-triangle" aria-hidden="true" style={{ fontSize: 18 }} />{erro}
          <button onClick={() => setErro("")} aria-label="Fechar" style={{ background: "none", border: "none", cursor: "pointer", color: "#C0392B", display: "flex", padding: 2 }}><i className="ti ti-x" aria-hidden="true" style={{ fontSize: 15 }} /></button>
        </div>
      )}
    </div>
  );
}
