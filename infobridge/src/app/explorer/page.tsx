"use client";

import { useState } from "react";

const ENDPOINTS = [
  { label: "Login", path: "/seguranca/logon", needsToken: false, hasBody: true },
  { label: "Lista de Veículos", path: "/veiculos", needsToken: true, hasBody: false },
  { label: "Última Posição", path: "/posicoes/ultimaPosicao", needsToken: true, hasBody: false },
  { label: "Dados Novos (online)", path: "/integracao/dados_novos", needsToken: true, hasBody: false },
  { label: "Lista de Motoristas", path: "/motoristas", needsToken: true, hasBody: false },
  { label: "Lista de Eventos", path: "/info/eventos", needsToken: true, hasBody: false },
  { label: "Lista de Componentes", path: "/info/componentes", needsToken: true, hasBody: false },
];

export default function ExplorerPage() {
  const [token, setToken] = useState("");
  const [selectedEndpoint, setSelectedEndpoint] = useState(ENDPOINTS[0]);
  const [body, setBody] = useState(
    JSON.stringify({ username: "", password: "", appid: "" }, null, 2)
  );
  const [result, setResult] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function call() {
    setLoading(true);
    setError("");
    setResult(null);

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["x-mp-token"] = token;

      const apiPath = selectedEndpoint.path.replace(/^\/seguranca\/logon/, "/api/multiportal/seguranca/logon");
      const proxyPath = "/api/multiportal" + selectedEndpoint.path;

      const res = await fetch(proxyPath, {
        method: "POST",
        headers,
        body: selectedEndpoint.hasBody ? body : undefined,
      });

      const data = await res.json();
      setResult(data);

      // Auto-capture token on login
      if (selectedEndpoint.path === "/seguranca/logon" && data?.object?.token) {
        setToken(data.object.token);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6 font-mono">
      <h1 className="text-2xl font-bold mb-6 text-emerald-400">Multiportal API Explorer</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left panel */}
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Endpoint</label>
            <select
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm"
              onChange={(e) => {
                const ep = ENDPOINTS[Number(e.target.value)];
                setSelectedEndpoint(ep);
                if (ep.path === "/seguranca/logon") {
                  setBody(JSON.stringify({ username: "", password: "", appid: "" }, null, 2));
                }
              }}
            >
              {ENDPOINTS.map((ep, i) => (
                <option key={ep.path} value={i}>{ep.label} — {ep.path}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Token (preenchido automaticamente após login)</label>
            <input
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-xs"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Cole o token aqui ou faça login primeiro"
            />
          </div>

          {selectedEndpoint.hasBody && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">Body (JSON)</label>
              <textarea
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-xs h-40 resize-none"
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </div>
          )}

          <button
            onClick={call}
            disabled={loading}
            className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded px-4 py-2 text-sm font-bold transition-colors"
          >
            {loading ? "Aguardando..." : "Executar POST"}
          </button>

          {error && (
            <div className="bg-red-900/40 border border-red-700 rounded p-3 text-xs text-red-300">
              {error}
            </div>
          )}
        </div>

        {/* Right panel */}
        <div>
          <label className="block text-xs text-gray-400 mb-1">Resposta</label>
          <pre className="bg-gray-900 border border-gray-700 rounded p-4 text-xs overflow-auto h-[500px] whitespace-pre-wrap">
            {result ? JSON.stringify(result, null, 2) : "— aguardando chamada —"}
          </pre>
        </div>
      </div>
    </div>
  );
}
