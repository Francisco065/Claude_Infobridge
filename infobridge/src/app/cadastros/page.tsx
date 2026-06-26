"use client";

import { useState, useEffect, useCallback } from "react";
import { apiLogin, apiFetch, apiPost, salvarSessao, carregarSessao, limparSessao } from "@/lib/api";

type Motorista = {
  id: string;
  nome: string;
  cpf?: string;
  cnh?: string;
  ativo?: boolean;
};

type Veiculo = {
  id: string;
  placa?: string;
  marca?: string;
  modelo?: string;
  frota?: string;
};

// ── Tela de login (mesmo padrão da Info Analise) ──────────────
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
            <p className="text-white font-bold">Cadastros</p>
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

  // Form: vínculo
  const [motoristaSel, setMotoristaSel] = useState("");
  const [veiculoSel, setVeiculoSel] = useState("");
  const [salvandoVinc, setSalvandoVinc] = useState(false);

  const sair = useCallback(() => {
    limparSessao();
    setToken(null);
  }, []);

  const carregar = useCallback(async (tk: string) => {
    setCarregando(true); setErro("");
    try {
      const [m, v] = await Promise.all([
        apiFetch<{ dados: Motorista[] }>("/motoristas?limite=100", tk),
        apiFetch<{ dados: Veiculo[] }>("/veiculos?limite=100", tk),
      ]);
      setMotoristas(m.dados ?? []);
      setVeiculos(v.dados ?? []);
    } catch (e: any) {
      const msg = e?.message ?? "Erro ao carregar cadastros";
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
      carregar(sessao.token);
    }
  }, [carregar]);

  function handleLogin(tk: string, nome: string) {
    salvarSessao(tk, nome);
    setToken(tk); setNomeUsuario(nome);
    carregar(tk);
  }

  async function criarMotorista(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setSalvandoMoto(true); setErro(""); setAviso("");
    try {
      const body: Record<string, string> = { nome };
      if (cpf.trim()) body.cpf = cpf.trim();
      if (cnh.trim()) body.cnh = cnh.trim();
      const novo = await apiPost<Motorista>("/motoristas", token, body);
      setAviso(`Motorista "${novo.nome}" criado.`);
      setNome(""); setCpf(""); setCnh("");
      await carregar(token);
    } catch (e: any) {
      setErro(e?.message ?? "Erro ao criar motorista");
    } finally {
      setSalvandoMoto(false);
    }
  }

  async function vincular(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !motoristaSel || !veiculoSel) return;
    setSalvandoVinc(true); setErro(""); setAviso("");
    try {
      await apiPost(`/motoristas/${motoristaSel}/vincular`, token, { veiculoId: veiculoSel });
      const m = motoristas.find(x => x.id === motoristaSel)?.nome ?? "Motorista";
      const v = veiculos.find(x => x.id === veiculoSel)?.placa ?? "veículo";
      setAviso(`${m} vinculado ao veículo ${v}. A telemetria a partir de agora será atribuída a ele.`);
      setMotoristaSel(""); setVeiculoSel("");
    } catch (e: any) {
      setErro(e?.message ?? "Erro ao vincular");
    } finally {
      setSalvandoVinc(false);
    }
  }

  if (!token) return <LoginForm onLogin={handleLogin} />;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="bg-emerald-500 text-black font-black text-lg px-3 py-1 rounded-lg">INFO</div>
          <div>
            <p className="text-xs text-emerald-400 uppercase tracking-widest">Infobridge</p>
            <h1 className="text-xl font-bold">Cadastros — Motoristas e Vínculos</h1>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <a href="/info-analise" className="text-xs text-emerald-400 hover:text-emerald-300">📊 Info Analise</a>
          <span className="text-xs text-gray-400">👤 {nomeUsuario}</span>
          <button onClick={sair}
            className="text-xs text-gray-500 hover:text-red-400 transition-colors">Sair</button>
        </div>
      </div>

      {erro && <div className="bg-red-900/30 border border-red-700 rounded-xl p-4 text-red-300 text-sm mb-4">{erro}</div>}
      {aviso && <div className="bg-emerald-900/30 border border-emerald-700 rounded-xl p-4 text-emerald-300 text-sm mb-4">{aviso}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Coluna esquerda: criar motorista + vínculo ── */}
        <div className="space-y-6">
          {/* Novo motorista */}
          <div className="bg-gray-900 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">Novo Motorista</h2>
            <form onSubmit={criarMotorista} className="space-y-3">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Nome *</label>
                <input className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                  value={nome} onChange={e => setNome(e.target.value)} required minLength={3} placeholder="Carlos Andrade" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">CPF (11 dígitos)</label>
                  <input className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                    value={cpf} onChange={e => setCpf(e.target.value.replace(/\D/g, ""))} maxLength={11} placeholder="opcional" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">CNH</label>
                  <input className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                    value={cnh} onChange={e => setCnh(e.target.value)} placeholder="opcional" />
                </div>
              </div>
              <button className="w-full bg-emerald-600 hover:bg-emerald-500 rounded-lg py-2 text-sm font-bold transition-colors disabled:opacity-50"
                disabled={salvandoMoto}>{salvandoMoto ? "Salvando..." : "Criar motorista"}</button>
            </form>
          </div>

          {/* Vincular motorista ao veículo */}
          <div className="bg-gray-900 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-1">Vincular motorista ao veículo</h2>
            <p className="text-xs text-gray-500 mb-4">O vínculo passa a valer a partir de agora. A telemetria coletada após o vínculo será atribuída ao motorista.</p>
            <form onSubmit={vincular} className="space-y-3">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Motorista</label>
                <select className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                  value={motoristaSel} onChange={e => setMotoristaSel(e.target.value)} required>
                  <option value="">Selecione…</option>
                  {motoristas.map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Veículo</label>
                <select className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                  value={veiculoSel} onChange={e => setVeiculoSel(e.target.value)} required>
                  <option value="">Selecione…</option>
                  {veiculos.map(v => (
                    <option key={v.id} value={v.id}>
                      {v.placa ?? "(sem placa)"}{v.modelo ? ` — ${v.modelo}` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <button className="w-full bg-emerald-600 hover:bg-emerald-500 rounded-lg py-2 text-sm font-bold transition-colors disabled:opacity-50"
                disabled={salvandoVinc || !motoristaSel || !veiculoSel}>{salvandoVinc ? "Vinculando..." : "Vincular"}</button>
            </form>
          </div>
        </div>

        {/* ── Coluna direita: listas ── */}
        <div className="space-y-6">
          <div className="bg-gray-900 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Motoristas ({motoristas.length})</h2>
              <button onClick={() => token && carregar(token)} className="text-xs text-gray-500 hover:text-emerald-400">↻ Atualizar</button>
            </div>
            {carregando ? (
              <p className="text-sm text-gray-500">Carregando…</p>
            ) : motoristas.length === 0 ? (
              <p className="text-sm text-gray-500">Nenhum motorista cadastrado ainda.</p>
            ) : (
              <ul className="divide-y divide-gray-800">
                {motoristas.map(m => (
                  <li key={m.id} className="py-2 flex items-center justify-between">
                    <span className="text-sm text-white">{m.nome}</span>
                    <span className="text-xs text-gray-500">{m.cpf ?? "—"}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="bg-gray-900 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">Veículos ({veiculos.length})</h2>
            {carregando ? (
              <p className="text-sm text-gray-500">Carregando…</p>
            ) : veiculos.length === 0 ? (
              <p className="text-sm text-gray-500">Nenhum veículo cadastrado ainda.</p>
            ) : (
              <ul className="divide-y divide-gray-800">
                {veiculos.map(v => (
                  <li key={v.id} className="py-2 flex items-center justify-between">
                    <span className="text-sm text-white">{v.placa ?? "(sem placa)"}</span>
                    <span className="text-xs text-gray-500">{v.modelo ?? v.marca ?? "—"}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <div className="flex gap-6 text-xs text-gray-500 border-t border-gray-800 pt-4 mt-6">
        <span className="ml-auto">Infobridge © 2026</span>
      </div>
    </div>
  );
}
