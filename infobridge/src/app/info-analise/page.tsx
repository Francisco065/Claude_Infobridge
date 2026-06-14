"use client";

import { useState } from "react";

// ── Tipos ─────────────────────────────────────────────────────
interface IndicadorData {
  veiculo: { placa: string; marca: string; ano: number; frota: string; modelo: string };
  motorista: string;
  periodo: { inicio: string; fim: string };
  nota: number;
  indicadores: {
    faixaVerde: number;
    faixaVerdeTempo: string;
    embalo: number;
    embaloTempo: string;
    motorOcioso: number;
    motorOciosoTempo: string;
    acelAcimaMedioTempo: string;
    acelAcimaVerde: number;
    excessoVelocidade: number;
    excessoVelocidadeTempo: string;
    faixaVerdeTotalPerc: number;
    faixaVerdeTotalTempo: string;
    faixaVerdeFinalPerc: number;
    faixaVerdeFinalTempo: string;
    freioMotor: number;
    freioMotorTempo: string;
    emMovimento: number;
    emMovimentoTempo: string;
  };
  acelerador: { ideal: number; atencao: number; critico: number };
  estatisticas: {
    kmTotal: number;
    velocidadeMedia: number;
    consumoTotal: number;
    mediaKml: number;
    odometro: number;
    frenadasAltaVelocidade: number;
    frenadasTotais: number;
    frenadasPor100km: number;
  };
}

// ── Dados simulados (conectar à API /api/v1/indicadores) ──────
const MOCK: IndicadorData = {
  veiculo: { placa: "INOVA_2082", marca: "IVECO", ano: 2014, frota: "600", modelo: "IVECO/STRALIS 600S44T" },
  motorista: "William Muniz Batista",
  periodo: { inicio: "01/06/2026 00:00", fim: "01/06/2026 23:59" },
  nota: 100,
  indicadores: {
    faixaVerde: 96, faixaVerdeTempo: "07:41:54",
    embalo: 28, embaloTempo: "02:15:40",
    motorOcioso: 1, motorOciosoTempo: "00:06:00",
    acelAcimaVerde: 0, acelAcimaMedioTempo: "00:00:49",
    excessoVelocidade: 0, excessoVelocidadeTempo: "00:00:00",
    faixaVerdeTotalPerc: 100, faixaVerdeTotalTempo: "08:01:54",
    faixaVerdeFinalPerc: 4, faixaVerdeFinalTempo: "00:21:00",
    freioMotor: 5, freioMotorTempo: "00:26:01",
    emMovimento: 99, emMovimentoTempo: "08:00:30",
  },
  acelerador: { ideal: 54.63, atencao: 36.28, critico: 9.09 },
  estatisticas: {
    kmTotal: 407.27, velocidadeMedia: 52.1, consumoTotal: 172.5,
    mediaKml: 2.36, odometro: 1028739.45, frenadasAltaVelocidade: 10,
    frenadasTotais: 59, frenadasPor100km: 14.5,
  },
};

// ── Helpers de cor ────────────────────────────────────────────
function notaCor(nota: number) {
  if (nota >= 80) return { text: "text-green-400", ring: "#22c55e", label: "Ótimo" };
  if (nota >= 60) return { text: "text-yellow-400", ring: "#eab308", label: "Regular" };
  return { text: "text-red-400", ring: "#ef4444", label: "Crítico" };
}

function percCor(valor: number, inverso = false) {
  const bom = inverso ? valor <= 5 : valor >= 80;
  const medio = inverso ? valor <= 15 : valor >= 50;
  if (bom) return "text-green-400";
  if (medio) return "text-yellow-400";
  return "text-red-400";
}

function acessoCor(valor: number) {
  // Para motor ocioso, excesso de velocidade, acel acima verde — menos é melhor
  if (valor === 0) return "text-green-400";
  if (valor <= 3) return "text-yellow-400";
  return "text-red-400";
}

// ── Gauge circular SVG ────────────────────────────────────────
function GaugeCircular({ nota }: { nota: number }) {
  const cor = notaCor(nota);
  const r = 52;
  const circunf = 2 * Math.PI * r;
  const preenchido = (nota / 100) * circunf;

  return (
    <div className="flex flex-col items-center">
      <svg width="140" height="140" viewBox="0 0 140 140">
        <circle cx="70" cy="70" r={r} fill="none" stroke="#1f2937" strokeWidth="12" />
        <circle
          cx="70" cy="70" r={r} fill="none"
          stroke={cor.ring} strokeWidth="12"
          strokeDasharray={`${preenchido} ${circunf}`}
          strokeLinecap="round"
          transform="rotate(-90 70 70)"
        />
        <text x="70" y="70" textAnchor="middle" dominantBaseline="central"
          fill={cor.ring} fontSize="28" fontWeight="bold">{nota}</text>
        <text x="70" y="94" textAnchor="middle" fill="#9ca3af" fontSize="11">{cor.label}</text>
      </svg>
    </div>
  );
}

// ── Card de indicador ─────────────────────────────────────────
function CardIndicador({
  label, perc, tempo, corFn,
}: {
  label: string; perc: number; tempo: string; corFn: (v: number) => string;
}) {
  return (
    <div className="bg-gray-800 rounded-xl p-4 flex flex-col gap-1">
      <span className={`text-2xl font-bold ${corFn(perc)}`}>{perc} %</span>
      <span className="text-xs text-gray-400">{tempo}</span>
      <div className="flex gap-0.5 mt-1">
        {[1, 2, 3, 4, 5].map((i) => (
          <span key={i} className={`text-xs ${perc >= i * 20 ? corFn(perc) : "text-gray-600"}`}>★</span>
        ))}
      </div>
      <span className="text-xs text-gray-300 mt-1">{label}</span>
    </div>
  );
}

// ── Barra do acelerador ───────────────────────────────────────
function BarraAcelerador({ ideal, atencao, critico }: { ideal: number; atencao: number; critico: number }) {
  return (
    <div className="bg-gray-800 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-gray-300 mb-4">Uso Pressão do Acelerador</h3>
      <div className="flex gap-2 h-32 items-end mb-3">
        <div className="flex flex-col items-center gap-1 flex-1">
          <span className="text-green-400 text-sm font-bold">{ideal}%</span>
          <div className="w-full bg-green-500 rounded-t" style={{ height: `${ideal}%`, minHeight: 4 }} />
        </div>
        <div className="flex flex-col items-center gap-1 flex-1">
          <span className="text-yellow-400 text-sm font-bold">{atencao}%</span>
          <div className="w-full bg-yellow-500 rounded-t" style={{ height: `${atencao}%`, minHeight: 4 }} />
        </div>
        <div className="flex flex-col items-center gap-1 flex-1">
          <span className="text-red-400 text-sm font-bold">{critico}%</span>
          <div className="w-full bg-red-500 rounded-t" style={{ height: `${critico * 2}%`, minHeight: 4 }} />
        </div>
      </div>
      <div className="flex gap-4 text-xs text-gray-400">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> Ideal</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-500 inline-block" /> Atenção</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> Crítico</span>
      </div>
    </div>
  );
}

// ── Card estatística ──────────────────────────────────────────
function Stat({ icon, label, valor }: { icon: string; label: string; valor: string }) {
  return (
    <div className="bg-gray-800 rounded-xl p-4 flex items-center gap-3">
      <span className="text-2xl">{icon}</span>
      <div>
        <p className="text-xs text-gray-400">{label}</p>
        <p className="text-white font-bold text-sm">{valor}</p>
      </div>
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────
export default function InfoAnalisePage() {
  const [dados] = useState<IndicadorData>(MOCK);
  const { veiculo, motorista, periodo, nota, indicadores: ind, acelerador, estatisticas: est } = dados;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">

      {/* ── Cabeçalho ─────────────────────────────── */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="bg-emerald-500 text-black font-black text-lg px-3 py-1 rounded-lg tracking-tight">
            INFO
          </div>
          <div>
            <p className="text-xs text-emerald-400 font-semibold tracking-widest uppercase">Infobridge</p>
            <h1 className="text-xl font-bold text-white leading-tight">Info Analise</h1>
          </div>
        </div>
        <div className="text-right text-xs text-gray-400">
          <p>{periodo.inicio} — {periodo.fim}</p>
          <p className="text-gray-500 text-[11px] mt-0.5">Relatório de desempenho individual</p>
        </div>
      </div>

      {/* ── Linha de identificação ────────────────── */}
      <div className="flex flex-wrap gap-4 mb-6 bg-gray-900 rounded-xl px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="text-emerald-400">🚛</span>
          <span className="text-sm font-semibold">{veiculo.placa}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-emerald-400">👤</span>
          <span className="text-sm">{motorista}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-emerald-400">📅</span>
          <span className="text-sm">{periodo.inicio} — {periodo.fim}</span>
        </div>
      </div>

      {/* ── Nota + Veículo + Indicadores ─────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-6">

        {/* Score e dados do veículo */}
        <div className="bg-gray-900 rounded-xl p-5 flex flex-col items-center gap-4">
          <p className="text-xs text-gray-400 uppercase tracking-wider self-start">Nota de Desempenho</p>
          <GaugeCircular nota={nota} />
          <div className="w-full border-t border-gray-700 pt-3 space-y-1 text-xs text-gray-400">
            <p>🚛 <span className="text-white">{veiculo.marca}</span></p>
            <p>📅 <span className="text-white">{veiculo.ano}</span></p>
            <p>🔢 <span className="text-white">Frota {veiculo.frota}</span></p>
            <p>📋 <span className="text-white text-[11px]">{veiculo.modelo}</span></p>
          </div>
        </div>

        {/* Grade de indicadores */}
        <div className="lg:col-span-3 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
          <CardIndicador label="Faixa verde" perc={ind.faixaVerde} tempo={ind.faixaVerdeTempo}
            corFn={(v) => v >= 80 ? "text-green-400" : v >= 60 ? "text-yellow-400" : "text-red-400"} />
          <CardIndicador label="Aproveitamento de embalo" perc={ind.embalo} tempo={ind.embaloTempo}
            corFn={(v) => v >= 20 ? "text-green-400" : v >= 10 ? "text-yellow-400" : "text-red-400"} />
          <CardIndicador label="Motor ligado parado" perc={ind.motorOcioso} tempo={ind.motorOciosoTempo}
            corFn={(v) => v <= 5 ? "text-green-400" : v <= 15 ? "text-yellow-400" : "text-red-400"} />
          <CardIndicador label="Acelerando acima do verde" perc={ind.acelAcimaVerde} tempo={ind.acelAcimaMedioTempo}
            corFn={acessoCor} />
          <CardIndicador label="Excesso de velocidade" perc={ind.excessoVelocidade} tempo={ind.excessoVelocidadeTempo}
            corFn={acessoCor} />
          <CardIndicador label="Faixa verde total" perc={ind.faixaVerdeTotalPerc} tempo={ind.faixaVerdeTotalTempo}
            corFn={(v) => v >= 90 ? "text-green-400" : v >= 70 ? "text-yellow-400" : "text-red-400"} />
          <CardIndicador label="Faixa verde final" perc={ind.faixaVerdeFinalPerc} tempo={ind.faixaVerdeFinalTempo}
            corFn={(v) => v >= 10 ? "text-green-400" : "text-yellow-400"} />
          <CardIndicador label="Freio motor" perc={ind.freioMotor} tempo={ind.freioMotorTempo}
            corFn={(v) => v >= 10 ? "text-green-400" : v >= 3 ? "text-yellow-400" : "text-red-400"} />
          <CardIndicador label="Em movimento" perc={ind.emMovimento} tempo={ind.emMovimentoTempo}
            corFn={(v) => v >= 80 ? "text-green-400" : v >= 60 ? "text-yellow-400" : "text-red-400"} />
        </div>
      </div>

      {/* ── Acelerador + Estatísticas ─────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-6">

        <BarraAcelerador {...acelerador} />

        <div className="lg:col-span-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat icon="📍" label="Km total" valor={`${est.kmTotal.toLocaleString("pt-BR")} km`} />
          <Stat icon="⚡" label="Velocidade média" valor={`${est.velocidadeMedia} km/h`} />
          <Stat icon="⛽" label="Consumo total" valor={`${est.consumoTotal} L`} />
          <Stat icon="📊" label="Média computador" valor={`${est.mediaKml} km/L`} />
          <Stat icon="🔄" label="Odômetro" valor={`${est.odometro.toLocaleString("pt-BR")} km`} />
          <Stat icon="⚠️" label="Freadas alta vel." valor={String(est.frenadasAltaVelocidade)} />
          <Stat icon="🛑" label="Freadas totais" valor={String(est.frenadasTotais)} />
          <Stat icon="📉" label="Freadas / 100 km" valor={String(est.frenadasPor100km)} />
        </div>
      </div>

      {/* ── Legenda de cores ──────────────────────── */}
      <div className="flex gap-6 text-xs text-gray-400 border-t border-gray-800 pt-4">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-green-500 inline-block" /> Bom desempenho</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-yellow-500 inline-block" /> Atenção / médio</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-red-500 inline-block" /> Crítico</span>
        <span className="ml-auto text-gray-600">Infobridge © 2026</span>
      </div>
    </div>
  );
}
