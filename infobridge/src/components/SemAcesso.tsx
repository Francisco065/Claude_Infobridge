"use client";

const VINHO = "#6E1414";
const SANS = "'IBM Plex Sans', system-ui, sans-serif";

/** Tela exibida quando o usuário não tem permissão para a página atual. */
export default function SemAcesso({ destino = "/info-analise" }: { destino?: string }) {
  return (
    <div style={{ minHeight: "100vh", background: "#E9EBEF", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: SANS, padding: 24 }}>
      <div style={{ background: "#FFFFFF", border: "1px solid #E2E4E9", borderRadius: 16, padding: 32, maxWidth: 420, textAlign: "center", boxShadow: "0 12px 40px rgba(30,32,40,.10)" }}>
        <i className="ti ti-lock" aria-hidden="true" style={{ fontSize: 32, color: VINHO }} />
        <h1 style={{ fontSize: 18, fontWeight: 700, color: "#1F2024", margin: "12px 0 6px" }}>Sem acesso</h1>
        <p style={{ fontSize: 14, color: "#5A5D65", margin: "0 0 16px" }}>
          Você não tem permissão para ver esta tela. Fale com um administrador do seu acesso.
        </p>
        <a href={destino} style={{ color: VINHO, fontWeight: 600, fontSize: 14, textDecoration: "none" }}>Ir para uma tela liberada</a>
      </div>
    </div>
  );
}
