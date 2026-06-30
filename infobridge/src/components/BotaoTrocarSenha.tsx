"use client";

import { useState } from "react";
import { apiPost } from "@/lib/api";

const VINHO = "#6E1414";
const VERMELHO = "#C0322B";
const SANS = "'IBM Plex Sans', system-ui, sans-serif";
const senhaForte = (s: string) => /^(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#$%^&*]).{8,}$/.test(s);

const inputBase: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", background: "#FFFFFF", border: "1px solid #E2E4E9",
  borderRadius: 10, padding: "10px 12px", fontSize: 13, color: "#1F2024", fontFamily: SANS, outline: "none",
};
const labelBase: React.CSSProperties = { fontSize: 12, color: "#5A5D65", display: "block", marginBottom: 5 };

/** Botão (ícone de chave) + popup para o usuário logado alterar a própria senha. */
export default function BotaoTrocarSenha({ token }: { token: string }) {
  const [aberto, setAberto] = useState(false);
  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [conf, setConf] = useState("");
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState(false);
  const [salvando, setSalvando] = useState(false);

  function fechar() {
    setAberto(false); setAtual(""); setNova(""); setConf(""); setErro(""); setOk(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    if (!senhaForte(nova)) { setErro("Senha fraca: 8+ caracteres com maiúscula, número e símbolo (!@#$%^&*)."); return; }
    if (nova !== conf) { setErro("As senhas não conferem."); return; }
    setSalvando(true);
    try {
      await apiPost("/auth/alterar-senha", token, { senhaAtual: atual, novaSenha: nova });
      setOk(true); setAtual(""); setNova(""); setConf("");
    } catch (e: any) { setErro(e?.message ?? "Erro ao alterar a senha."); }
    finally { setSalvando(false); }
  }

  return (
    <>
      <button onClick={() => setAberto(true)} title="Alterar minha senha" aria-label="Alterar minha senha"
        style={{ display: "flex", background: "#FFFFFF", border: "1px solid #DDE0E6", borderRadius: 9, padding: "7px 9px", color: "#5A5D65", cursor: "pointer" }}>
        <i className="ti ti-key" aria-hidden="true" style={{ fontSize: 15 }} />
      </button>

      {aberto && (
        <div onClick={fechar} style={{ position: "fixed", inset: 0, zIndex: 80, background: "rgba(24,18,18,.42)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: SANS }}>
          <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Alterar senha" style={{ width: "100%", maxWidth: 380, background: "#FFFFFF", borderRadius: 16, boxShadow: "0 24px 60px rgba(20,16,16,.32)", padding: 24 }}>
            <h3 style={{ margin: "0 0 14px", fontSize: 16, fontWeight: 700, color: "#1F2024", display: "flex", alignItems: "center", gap: 8 }}>
              <i className="ti ti-key" aria-hidden="true" style={{ color: VINHO }} />Alterar minha senha
            </h3>
            {ok ? (
              <div>
                <p role="status" style={{ fontSize: 13, color: "#15803D", margin: "0 0 16px", display: "flex", alignItems: "center", gap: 7 }}>
                  <i className="ti ti-circle-check-filled" aria-hidden="true" style={{ fontSize: 16 }} />Senha alterada com sucesso.
                </p>
                <button onClick={fechar} style={{ width: "100%", background: VINHO, color: "#fff", borderRadius: 10, padding: 11, fontSize: 14, fontWeight: 600, border: "none", cursor: "pointer", fontFamily: SANS }}>Fechar</button>
              </div>
            ) : (
              <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {erro && <div role="alert" style={{ background: "#FDF1F1", border: "1px solid #E7B0AC", borderRadius: 10, padding: 10, color: VERMELHO, fontSize: 12 }}>{erro}</div>}
                <div><label style={labelBase}>Senha atual</label><input type="password" autoComplete="current-password" style={inputBase} value={atual} onChange={(e) => setAtual(e.target.value)} required /></div>
                <div><label style={labelBase}>Nova senha</label><input type="password" autoComplete="new-password" style={inputBase} value={nova} onChange={(e) => setNova(e.target.value)} required placeholder="8+ com maiúscula, número e símbolo" /></div>
                <div><label style={labelBase}>Confirmar nova senha</label><input type="password" autoComplete="new-password" style={inputBase} value={conf} onChange={(e) => setConf(e.target.value)} required /></div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button disabled={salvando} style={{ flex: 1, background: VINHO, color: "#fff", borderRadius: 10, padding: 11, fontSize: 14, fontWeight: 600, border: "none", cursor: salvando ? "default" : "pointer", opacity: salvando ? 0.6 : 1, fontFamily: SANS }}>{salvando ? "Salvando…" : "Salvar"}</button>
                  <button type="button" onClick={fechar} style={{ background: "#FFFFFF", border: "1px solid #DDE0E6", borderRadius: 10, padding: "11px 14px", fontSize: 13, color: "#5A5D65", cursor: "pointer", fontFamily: SANS }}>Cancelar</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
