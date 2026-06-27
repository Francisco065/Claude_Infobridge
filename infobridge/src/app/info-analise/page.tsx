"use client";

import { useState, useEffect, useCallback } from "react";
import { apiLogin, apiFetch, salvarSessao, carregarSessao, limparSessao } from "@/lib/api";

// ── Conversão segura para número ──────────────────────────────
// Colunas numeric do Postgres chegam como string no JSON; converter
// antes de usar .toFixed/.toLocaleString evita o crash da página.
function num(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// ── Helpers de cor ────────────────────────────────────────────
function percCor(valor: number, thresholds: [number, number]) {
  if (valor >= thresholds[0]) return "text-green-400";
  if (valor >= thresholds[1]) return "text-yellow-400";
  return "text-red-400";
}
function inversoCor(valor: number, thresholds: [number, number]) {
  if (valor <= thresholds[0]) return "text-green-400";
  if (valor <= thresholds[1]) return "text-yellow-400";
  return "text-red-400";
}
function notaCor(nota: number) {
  if (nota >= 80) return { ring: "#22c55e", label: "Ótimo", text: "text-green-400" };
  if (nota >= 60) return { ring: "#eab308", label: "Regular", text: "text-yellow-400" };
  return { ring: "#ef4444", label: "Crítico", text: "text-red-400" };
}

// ── Gauge circular ────────────────────────────────────────────
function GaugeCircular({ nota }: { nota: number }) {
  const cor = notaCor(nota);
  const r = 52, c = 2 * Math.PI * r;
  return (
    <svg width="140" height="140" viewBox="0 0 140 140">
      <circle cx="70" cy="70" r={r} fill="none" stroke="#1f2937" strokeWidth="12" />
      <circle cx="70" cy="70" r={r} fill="none" stroke={cor.ring} strokeWidth="12"
        strokeDasharray={`${(nota / 100) * c} ${c}`} strokeLinecap="round"
        transform="rotate(-90 70 70)" />
      <text x="70" y="68" textAnchor="middle" dominantBaseline="central"
        fill={cor.ring} fontSize="28" fontWeight="bold">{nota ?? "—"}</text>
      <text x="70" y="94" textAnchor="middle" fill="#9ca3af" fontSize="11">{cor.label}</text>
    </svg>
  );
}

// ── Card indicador ────────────────────────────────────────────
function CardIndicador({ label, perc, tempo, cor }: {
  label: string; perc: number; tempo?: string; cor: string;
}) {
  const estrelas = Math.round((perc / 100) * 5);
  return (
    <div className="bg-gray-800 rounded-xl p-4 flex flex-col gap-1">
      <span className={`text-2xl font-bold ${cor}`}>{perc} %</span>
      {tempo && <span className="text-xs text-gray-500">{tempo}</span>}
      <div className="flex gap-0.5 mt-1">
        {[1,2,3,4,5].map(i => (
          <span key={i} className={`text-xs ${i <= estrelas ? cor : "text-gray-700"}`}>★</span>
        ))}
      </div>
      <span className="text-xs text-gray-300 mt-1 leading-tight">{label}</span>
    </div>
  );
}

// ── Barra acelerador ──────────────────────────────────────────
function BarraAcelerador({ ideal, atencao, critico }: { ideal: number; atencao: number; critico: number }) {
  return (
    <div className="bg-gray-800 rounded-xl p-5">
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Pressão do Acelerador</h3>
      <div className="flex gap-3 h-28 items-end mb-3">
        {[
          { label: "Ideal", val: ideal, bg: "bg-green-500", text: "text-green-400" },
          { label: "Atenção", val: atencao, bg: "bg-yellow-500", text: "text-yellow-400" },
          { label: "Crítico", val: critico, bg: "bg-red-500", text: "text-red-400" },
        ].map(b => (
          <div key={b.label} className="flex flex-col items-center gap-1 flex-1">
            <span className={`${b.text} text-sm font-bold`}>{b.val?.toFixed(1)}%</span>
            <div className={`w-full ${b.bg} rounded-t`} style={{ height: `${Math.max(b.val ?? 0, 2)}%` }} />
            <span className="text-xs text-gray-500">{b.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────
function Stat({ icon, label, valor }: { icon: string; label: string; valor: string }) {
  return (
    <div className="bg-gray-800 rounded-xl p-4 flex items-center gap-3">
      <span className="text-xl">{icon}</span>
      <div>
        <p className="text-xs text-gray-500">{label}</p>
        <p className="text-white font-bold text-sm">{valor}</p>
      </div>
    </div>
  );
}

// ── Tela de login ─────────────────────────────────────────────
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

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
      <div className="bg-gray-900 rounded-2xl p-8 w-full max-w-sm">
        <div className="flex items-center gap-3 mb-8">
          <div className="bg-emerald-500 text-black font-black text-lg px-3 py-1 rounded-lg">INFO</div>
          <div>
            <p className="text-xs text-emerald-400 tracking-widest uppercase">Infobridge</p>
            <p className="text-white font-bold">Info Analise</p>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="text-xs text-gray-400 block mb-1">E-mail</label>
            <input className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
              type="email" value={email} onChange={e => setEmail(e.target.value)} required />
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Senha</label>
            <input className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
              type="password" value={senha} onChange={e => setSenha(e.target.value)} required />
          </div>
          {erro && <p className="text-red-400 text-xs">{erro}</p>}
          <button className="w-full bg-emerald-600 hover:bg-emerald-500 rounded-lg py-2 text-sm font-bold transition-colors disabled:opacity-50"
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

  const buscarIndicadores = useCallback(async (tk: string) => {
    setCarregando(true); setErro("");
    try {
      const res = await apiFetch<{ dados: any[] }>("/indicadores?limite=50", tk);
      setIndicadores(res.dados ?? []);
      if (res.dados?.length) setSelecionado(res.dados[0]);
    } catch (e: any) {
      const msg = e.message ?? "Erro ao carregar indicadores";
      // Sessão expirada/inválida: volta para o login
      if (/401|403/.test(msg)) { limparSessao(); setToken(null); }
      else setErro(msg);
    } finally {
      setCarregando(false);
    }
  }, []);

  // Restaura a sessão salva ao abrir/atualizar a página
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

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">

      {/* Cabeçalho */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="bg-emerald-500 text-black font-black text-lg px-3 py-1 rounded-lg">INFO</div>
          <div>
            <p className="text-xs text-emerald-400 uppercase tracking-widest">Infobridge</p>
            <h1 className="text-xl font-bold">Info Analise</h1>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs text-gray-400">👤 {nomeUsuario}</span>
          <button onClick={() => { limparSessao(); setToken(null); }}
            className="text-xs text-gray-500 hover:text-red-400 transition-colors">Sair</button>
        </div>
      </div>

      {/* Seletor de período */}
      {indicadores.length > 1 && (
        <div className="mb-6">
          <label className="text-xs text-gray-400 block mb-1">Período</label>
          <select
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
            onChange={e => setSelecionado(indicadores[Number(e.target.value)])}
          >
            {indicadores.map((ind, i) => (
              <option key={ind.id} value={i}>
                {ind.motorista?.nome ?? "—"} — {ind.periodoInicio} a {ind.periodoFim}
              </option>
            ))}
          </select>
        </div>
      )}

      {carregando && (
        <div className="text-center py-20 text-gray-400">Carregando dados...</div>
      )}

      {erro && (
        <div className="bg-red-900/30 border border-red-700 rounded-xl p-4 text-red-300 text-sm mb-6">{erro}</div>
      )}

      {!carregando && !d && !erro && (
        <div className="text-center py-20 text-gray-500">
          <p className="text-lg mb-2">Nenhum indicador encontrado</p>
          <p className="text-sm">Os dados aparecem após o worker de telemetria processar as viagens.</p>
        </div>
      )}

      {d && (
        <>
          {/* Linha de identificação */}
          <div className="flex flex-wrap gap-4 mb-6 bg-gray-900 rounded-xl px-5 py-3">
            <span className="text-sm"><span className="text-emerald-400">🚛</span> {d.veiculo?.placa ?? "—"}</span>
            <span className="text-sm"><span className="text-emerald-400">👤</span> {d.motorista?.nome ?? "—"}</span>
            <span className="text-sm"><span className="text-emerald-400">📅</span> {d.periodoInicio} → {d.periodoFim}</span>
          </div>

          {/* Nota + veículo + indicadores */}
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-6">
            <div className="bg-gray-900 rounded-xl p-5 flex flex-col items-center gap-4">
              <p className="text-xs text-gray-400 uppercase tracking-wider self-start">Nota de Desempenho</p>
              <GaugeCircular nota={Math.round(num(d.notaDesempenho))} />
              <div className="w-full border-t border-gray-700 pt-3 space-y-1 text-xs text-gray-400">
                <p>🚛 <span className="text-white">{d.veiculo?.marca ?? "—"}</span></p>
                <p>📅 <span className="text-white">{d.veiculo?.anoFabricacao ?? "—"}</span></p>
                <p>🔢 <span className="text-white">Frota {d.veiculo?.frota ?? "—"}</span></p>
                <p>📋 <span className="text-white text-[11px]">{d.veiculo?.modelo ?? "—"}</span></p>
              </div>
            </div>

            <div className="lg:col-span-3 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
              <CardIndicador label="Faixa verde" perc={+num(d.percFaixaVerdeInicial).toFixed(1)}
                cor={percCor(num(d.percFaixaVerdeInicial), [80, 60])} />
              <CardIndicador label="Aproveitamento de embalo" perc={+num(d.percEmbalo).toFixed(1)}
                cor={percCor(num(d.percEmbalo), [20, 10])} />
              <CardIndicador label="Motor ligado parado" perc={+num(d.percMotorOcioso).toFixed(1)}
                cor={inversoCor(num(d.percMotorOcioso), [5, 15])} />
              <CardIndicador label="Acelerando acima do verde" perc={+num(d.percAcelCritico).toFixed(1)}
                cor={inversoCor(num(d.percAcelCritico), [0, 3])} />
              <CardIndicador label="Excesso de velocidade" perc={+num(d.percExcessoVelocidade).toFixed(1)}
                cor={inversoCor(num(d.percExcessoVelocidade), [0, 1])} />
              <CardIndicador label="Faixa verde total" perc={+(num(d.percFaixaVerdeInicial) + num(d.percFaixaVerdeFinal)).toFixed(1)}
                cor={percCor(num(d.percFaixaVerdeInicial) + num(d.percFaixaVerdeFinal), [90, 70])} />
              <CardIndicador label="Faixa verde final" perc={+num(d.percFaixaVerdeFinal).toFixed(1)}
                cor={percCor(num(d.percFaixaVerdeFinal), [10, 5])} />
              <CardIndicador label="Freio motor" perc={+num(d.percFreioMotorOk).toFixed(1)}
                cor={percCor(num(d.percFreioMotorOk), [10, 3])} />
              <CardIndicador label="Em movimento" perc={+(100 - num(d.percMotorOcioso)).toFixed(1)}
                cor={percCor(100 - num(d.percMotorOcioso), [80, 60])} />
            </div>
          </div>

          {/* Acelerador + Estatísticas */}
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-6">
            <BarraAcelerador
              ideal={num(d.percAcelIdeal)}
              atencao={num(d.percAcelAtencao)}
              critico={num(d.percAcelCritico)}
            />
            <div className="lg:col-span-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat icon="📍" label="Km total" valor={`${num(d.kmTotal).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} km`} />
              <Stat icon="⚡" label="Velocidade média" valor={`${num(d.velocidadeMediaKmh).toFixed(1)} km/h`} />
              <Stat icon="⛽" label="Consumo total" valor={`${num(d.consumoTotalLitros).toFixed(1)} L`} />
              <Stat icon="📊" label="Média km/L" valor={`${num(d.mediaKmL).toFixed(2)} km/L`} />
              <Stat icon="🔄" label="Odômetro" valor={`${num(d.odometroFinalKm).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} km`} />
              <Stat icon="⚠️" label="Freadas alta vel." valor={String(d.frenagenAltaVelocidade ?? 0)} />
              <Stat icon="🛑" label="Freadas totais" valor={String(d.frenagensTotais ?? 0)} />
              <Stat icon="📉" label="Freadas / 100 km" valor={`${num(d.frenagensPor100km).toFixed(1)}`} />
            </div>
          </div>

          {/* Legenda */}
          <div className="flex gap-6 text-xs text-gray-500 border-t border-gray-800 pt-4">
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-green-500 inline-block" /> Bom</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-yellow-500 inline-block" /> Atenção</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-red-500 inline-block" /> Crítico</span>
            <span className="ml-auto">Infobridge © 2026</span>
          </div>
        </>
      )}
    </div>
  );
}
