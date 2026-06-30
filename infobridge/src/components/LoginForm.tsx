"use client";

import { useState, useRef, useEffect } from "react";
import { apiLogin, apiSolicitarReset, apiPost } from "@/lib/api";

const senhaForte = (s: string) => /^(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#$%^&*]).{8,}$/.test(s);

/* ────────────────────────────────────────────────────────────────────────
 * LoginForm — tela de autenticação compartilhada do Infobridge.
 *
 * Substitui as três cópias divergentes de `LoginForm` que existiam dentro de
 * info-analise/page.tsx, cadastros/page.tsx e mapa-ao-vivo/page.tsx.
 *
 * Melhorias frente à versão antiga:
 *   • Anel de foco visível nos campos (era `outline:none` sem substituto — A11y).
 *   • Mostrar/ocultar senha, autofocus no e-mail e aviso de Caps Ligado.
 *   • Título estável ("Entrar no Sistema") — não muda conforme a tela de destino.
 *   • Painel de marca lateral (some no mobile) dando identidade à tela.
 *   • Botão com spinner + aria-busy; erro com role="alert".
 *
 * Mantém o contrato original: `onLogin(token, nome)` é chamado no sucesso.
 * Fontes (IBM Plex) e ícones (Tabler) já vêm do layout.tsx global.
 * ──────────────────────────────────────────────────────────────────────── */

const VINHO = "#6E1414";
const VERMELHO = "#C0392B";
const SANS = "'IBM Plex Sans', system-ui, sans-serif";

// Logo Infobridge em cor configurável (branco no painel escuro).
function LogoInfobridge({ height = 40, cor = VINHO }: { height?: number; cor?: string }) {
  return (
    <svg height={height} viewBox="0 0 120 76" fill="none" aria-label="Infobridge">
      <g stroke={cor} strokeWidth="3.4" strokeLinecap="round" fill="none">
        <line x1="40" y1="10" x2="40" y2="60" />
        <line x1="80" y1="10" x2="80" y2="60" />
        <path d="M40 12 Q60 40 80 12" />
        <path d="M40 12 Q20 42 6 60" />
        <path d="M80 12 Q100 42 114 60" />
        <line x1="50" y1="20" x2="50" y2="60" strokeWidth="1.6" />
        <line x1="60" y1="26" x2="60" y2="60" strokeWidth="1.6" />
        <line x1="70" y1="20" x2="70" y2="60" strokeWidth="1.6" />
        <line x1="26" y1="33" x2="26" y2="60" strokeWidth="1.6" />
        <line x1="94" y1="33" x2="94" y2="60" strokeWidth="1.6" />
        <line x1="5" y1="60" x2="115" y2="60" />
      </g>
      <g fill={cor}>
        <rect x="52" y="40" width="16" height="14" rx="2.5" />
        <rect x="64" y="44" width="6" height="10" rx="1.5" />
        <circle cx="56" cy="56" r="3" />
        <circle cx="66" cy="56" r="3" />
      </g>
    </svg>
  );
}

type Props = {
  onLogin: (token: string, nome: string) => void;
  /** Título estável da tela. Default: "Entrar no Sistema". */
  titulo?: string;
  /** Eyebrow acima do título. Default: "Acesse sua conta". */
  subtitulo?: string;
  /** E-mail de suporte para o link "Esqueci minha senha". */
  emailSuporte?: string;
};

export default function LoginForm({
  onLogin,
  titulo = "Entrar no Sistema",
  subtitulo = "Acesse sua conta",
  emailSuporte = "suporte@infobridge.com.br",
}: Props) {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [erro, setErro] = useState("");
  const [info, setInfo] = useState("");
  const [carregando, setCarregando] = useState(false);
  const emailRef = useRef<HTMLInputElement | null>(null);

  // Troca obrigatória de senha (senha provisória)
  const [trocar, setTrocar] = useState<{ token: string; nome: string; senhaAtual: string } | null>(null);
  const [novaSenha, setNovaSenha] = useState("");
  const [confirma, setConfirma] = useState("");

  // Foco inicial no e-mail.
  useEffect(() => { emailRef.current?.focus(); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setCarregando(true);
    setErro(""); setInfo("");
    try {
      const { accessToken, usuario } = await apiLogin(email, senha);
      if (usuario.precisaTrocarSenha) {
        setTrocar({ token: accessToken, nome: usuario.nome, senhaAtual: senha });
      } else {
        onLogin(accessToken, usuario.nome);
      }
    } catch (e: any) {
      setErro(e?.message ?? "Erro ao conectar com o servidor.");
    } finally {
      setCarregando(false);
    }
  }

  async function esqueciSenha() {
    setErro(""); setInfo("");
    if (!email) { setErro("Informe o e-mail para recuperar a senha."); return; }
    try {
      await apiSolicitarReset(email);
      setInfo("Se o e-mail existir, a senha provisória Infobridge@2026 foi definida. Entre com ela — será exigida a troca da senha.");
    } catch {
      setInfo("Se o e-mail existir, a senha provisória Infobridge@2026 foi definida. Entre com ela — será exigida a troca da senha.");
    }
  }

  async function confirmarTroca(e: React.FormEvent) {
    e.preventDefault();
    if (!trocar) return;
    setErro("");
    if (!senhaForte(novaSenha)) { setErro("Senha fraca: 8+ caracteres com maiúscula, número e símbolo (!@#$%^&*)."); return; }
    if (novaSenha !== confirma) { setErro("As senhas não conferem."); return; }
    setCarregando(true);
    try {
      await apiPost("/auth/alterar-senha", trocar.token, { senhaAtual: trocar.senhaAtual, novaSenha });
      onLogin(trocar.token, trocar.nome);
    } catch (e: any) {
      setErro(e?.message ?? "Erro ao trocar a senha.");
    } finally {
      setCarregando(false);
    }
  }

  function detectarCaps(e: React.KeyboardEvent<HTMLInputElement>) {
    if (typeof e.getModifierState === "function") {
      setCapsLock(e.getModifierState("CapsLock"));
    }
  }

  const input: React.CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    background: "#F6F7F9",
    border: "1px solid #E2E4E9",
    borderRadius: 10,
    padding: "10px 12px",
    fontSize: 14,
    color: "#1F2024",
    fontFamily: SANS,
    outline: "none",
  };
  const label: React.CSSProperties = {
    fontSize: 12,
    color: "#5A5D65",
    fontWeight: 500,
    display: "block",
    marginBottom: 5,
  };

  // Tela de troca obrigatória de senha (senha provisória)
  if (trocar) {
    return (
      <div style={{ minHeight: "100vh", background: "#E9EBEF", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: SANS }}>
        <div style={{ background: "#FFFFFF", border: "1px solid #E2E4E9", borderRadius: 18, boxShadow: "0 12px 40px rgba(30,32,40,.10)", padding: 32, width: "100%", maxWidth: 400 }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: "#1F2024", margin: "0 0 6px" }}>Defina uma nova senha</h1>
          <p style={{ fontSize: 13, color: "#5A5D65", margin: "0 0 18px" }}>Sua senha é provisória. Crie uma nova para continuar, <b>{trocar.nome}</b>.</p>
          <form onSubmit={confirmarTroca} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={label}>Nova senha</label>
              <input type="password" autoComplete="new-password" style={input} value={novaSenha} onChange={(e) => setNovaSenha(e.target.value)} placeholder="8+ com maiúscula, número e símbolo" required />
            </div>
            <div>
              <label style={label}>Confirmar nova senha</label>
              <input type="password" autoComplete="new-password" style={input} value={confirma} onChange={(e) => setConfirma(e.target.value)} required />
            </div>
            {erro && <p role="alert" aria-live="assertive" style={{ color: VERMELHO, fontSize: 12, margin: 0 }}>{erro}</p>}
            <button disabled={carregando} style={{ width: "100%", background: VINHO, color: "#fff", borderRadius: 10, padding: 11, fontSize: 14, fontWeight: 600, border: "none", cursor: carregando ? "default" : "pointer", opacity: carregando ? 0.6 : 1, fontFamily: SANS }}>
              {carregando ? "Salvando…" : "Salvar e entrar"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#E9EBEF",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        fontFamily: SANS,
      }}
    >
      {/* Estilos que não cabem inline: foco, spinner e responsividade. */}
      <style>{`
        .lf-input { transition: border-color .15s, box-shadow .15s, background .15s; }
        .lf-input:focus {
          border-color: ${VINHO};
          background: #fff;
          box-shadow: 0 0 0 3px rgba(110,20,20,.14);
        }
        .lf-icon-btn:hover { background: #F4EDED; }
        .lf-link:hover { text-decoration: underline; }
        .lf-submit:not(:disabled):hover { filter: brightness(1.07); }
        @keyframes lf-spin { to { transform: rotate(360deg); } }
        .lf-spin { animation: lf-spin .7s linear infinite; }
        .lf-card { width: 100%; max-width: 760px; }
        .lf-brand { flex: 0 0 44%; }
        @media (max-width: 640px) {
          .lf-card { max-width: 400px; }
          .lf-brand { display: none !important; }
        }
      `}</style>

      <div
        className="lf-card"
        style={{
          display: "flex",
          background: "#FFFFFF",
          border: "1px solid #E2E4E9",
          borderRadius: 18,
          boxShadow: "0 12px 40px rgba(30,32,40,.10)",
          overflow: "hidden",
        }}
      >
        {/* ── Painel de marca (oculto no mobile) ── */}
        <div
          className="lf-brand"
          style={{
            position: "relative",
            background: "linear-gradient(155deg,#5A1010 0%,#7A1818 55%,#8C2222 100%)",
            padding: "34px 30px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            overflow: "hidden",
          }}
        >
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              opacity: 0.1,
              backgroundImage: "radial-gradient(circle at 80% 12%, #fff 0, transparent 42%)",
            }}
          />
          <div style={{ position: "relative" }}>
            <LogoInfobridge height={42} cor="#fff" />
          </div>
          <div style={{ position: "relative" }}>
            <div
              style={{
                fontSize: 10,
                letterSpacing: 2.6,
                textTransform: "uppercase",
                color: "rgba(255,255,255,.72)",
                fontWeight: 700,
              }}
            >
              Infobridge
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#fff", marginTop: 7, lineHeight: 1.25 }}>
              Telemetria que vira economia
            </div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,.8)", marginTop: 10, lineHeight: 1.55 }}>
              Monitore frota, condução e custos da operação num só lugar.
            </div>
          </div>
        </div>

        {/* ── Formulário ── */}
        <div
          style={{
            flex: 1,
            padding: "36px 34px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          }}
        >
          <div style={{ marginBottom: 22 }}>
            <div
              style={{
                fontSize: 10,
                letterSpacing: 2.4,
                color: VINHO,
                textTransform: "uppercase",
                fontWeight: 700,
              }}
            >
              {subtitulo}
            </div>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: "#1F2024", margin: "4px 0 0" }}>{titulo}</h1>
          </div>

          <form onSubmit={submit} aria-busy={carregando} style={{ display: "flex", flexDirection: "column", gap: 15 }}>
            {/* E-mail */}
            <div>
              <label htmlFor="lf-email" style={label}>E-mail</label>
              <div style={{ position: "relative" }}>
                <i
                  className="ti ti-mail"
                  aria-hidden="true"
                  style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", fontSize: 16, color: "#9A9DA4" }}
                />
                <input
                  id="lf-email"
                  ref={emailRef}
                  className="lf-input"
                  style={{ ...input, paddingLeft: 36 }}
                  type="email"
                  autoComplete="email"
                  placeholder="voce@empresa.com.br"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyUp={detectarCaps}
                  required
                />
              </div>
            </div>

            {/* Senha */}
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
                <label htmlFor="lf-senha" style={{ ...label, marginBottom: 0 }}>Senha</label>
                <button
                  type="button"
                  onClick={esqueciSenha}
                  className="lf-link"
                  style={{ fontSize: 11.5, color: VINHO, background: "none", border: "none", cursor: "pointer", fontWeight: 600, padding: 0, fontFamily: SANS }}
                >
                  Esqueci minha senha
                </button>
              </div>
              <div style={{ position: "relative" }}>
                <i
                  className="ti ti-lock"
                  aria-hidden="true"
                  style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", fontSize: 16, color: "#9A9DA4" }}
                />
                <input
                  id="lf-senha"
                  className="lf-input"
                  style={{ ...input, padding: "10px 38px 10px 36px" }}
                  type={mostrarSenha ? "text" : "password"}
                  autoComplete="current-password"
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  onKeyUp={detectarCaps}
                  onKeyDown={detectarCaps}
                  required
                />
                <button
                  type="button"
                  className="lf-icon-btn"
                  aria-label={mostrarSenha ? "Ocultar senha" : "Mostrar senha"}
                  aria-pressed={mostrarSenha}
                  onClick={() => setMostrarSenha((v) => !v)}
                  style={{
                    position: "absolute",
                    right: 6,
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "#7C808A",
                    padding: 5,
                    borderRadius: 7,
                    display: "flex",
                    lineHeight: 0,
                  }}
                >
                  <i className={`ti ${mostrarSenha ? "ti-eye-off" : "ti-eye"}`} aria-hidden="true" style={{ fontSize: 16 }} />
                </button>
              </div>
              {capsLock && (
                <span
                  role="status"
                  style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "#B45309", marginTop: 5 }}
                >
                  <i className="ti ti-arrow-big-up-lines" aria-hidden="true" style={{ fontSize: 13 }} />
                  Caps Lock está ligado
                </span>
              )}
            </div>

            {erro && (
              <p role="alert" aria-live="assertive" style={{ display: "flex", alignItems: "center", gap: 6, color: VERMELHO, fontSize: 12.5, margin: 0 }}>
                <i className="ti ti-alert-triangle" aria-hidden="true" style={{ fontSize: 15 }} />
                {erro}
              </p>
            )}
            {info && (
              <p role="status" style={{ display: "flex", alignItems: "flex-start", gap: 6, color: "#15803D", fontSize: 12.5, margin: 0, lineHeight: 1.5 }}>
                <i className="ti ti-info-circle" aria-hidden="true" style={{ fontSize: 15, marginTop: 1 }} />
                {info}
              </p>
            )}

            <button
              type="submit"
              className="lf-submit"
              disabled={carregando}
              style={{
                width: "100%",
                background: VINHO,
                color: "#fff",
                borderRadius: 10,
                padding: "11px",
                fontSize: 14,
                fontWeight: 600,
                border: "none",
                cursor: carregando ? "default" : "pointer",
                opacity: carregando ? 0.7 : 1,
                fontFamily: SANS,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                marginTop: 3,
              }}
            >
              {carregando ? (
                <>
                  <i className="ti ti-loader-2 lf-spin" aria-hidden="true" style={{ fontSize: 16 }} />
                  Entrando…
                </>
              ) : (
                <>
                  Entrar
                  <i className="ti ti-arrow-right" aria-hidden="true" style={{ fontSize: 16 }} />
                </>
              )}
            </button>
          </form>

          <div style={{ marginTop: 20, textAlign: "center", fontSize: 11, color: "#9A9DA4" }}>
            Transformando dados em economia · © 2026
          </div>
        </div>
      </div>
    </div>
  );
}
