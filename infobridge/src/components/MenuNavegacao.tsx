"use client";

import { useState } from "react";
import { podeAcessar, ehAdminTotal, ehGestorOuAdmin } from "@/lib/api";

const VINHO = "#6E1414";
const AZUL = "#27508F";
const SANS = "'IBM Plex Sans', system-ui, sans-serif";

type Chave = "cadastros" | "empresas" | "usuarios" | "mapa-ao-vivo" | "info-analise";

const pill = (ativo: boolean): React.CSSProperties => ({
  display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13,
  color: ativo ? VINHO : "#5A5D65", background: ativo ? "#F6F2F2" : "transparent",
  fontWeight: ativo ? 600 : 500, padding: "8px 12px", borderRadius: 9,
  textDecoration: "none", border: "none", cursor: "pointer", fontFamily: SANS, whiteSpace: "nowrap",
});

const itemDrop: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 9, padding: "9px 10px", borderRadius: 8,
  textDecoration: "none", color: "#33363D", fontSize: 13, fontWeight: 500,
};

/**
 * Menu de navegação padrão — mesma ordem e estilo em todas as telas:
 * Cadastros (dropdown) · Empresas · Usuários · Mapa ao vivo · Info Análise.
 * Cada item só aparece conforme a permissão do usuário; o item atual fica destacado.
 */
export default function MenuNavegacao({ atual }: { atual: Chave }) {
  const [cadAberto, setCadAberto] = useState(false);

  const Item = ({ chave, href, icone, label }: { chave: Chave; href: string; icone: string; label: string }) =>
    atual === chave ? (
      <span style={pill(true)}><i className={`ti ${icone}`} aria-hidden="true" style={{ fontSize: 16 }} />{label}</span>
    ) : (
      <a href={href} style={pill(false)}><i className={`ti ${icone}`} aria-hidden="true" style={{ fontSize: 16 }} />{label}</a>
    );

  return (
    <nav style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "nowrap" }}>
      {/* 1. Cadastros — sempre dropdown */}
      {podeAcessar("cadastros") && (
        <div style={{ position: "relative" }}>
          <button
            onClick={() => setCadAberto((v) => !v)}
            aria-haspopup="menu" aria-expanded={cadAberto}
            style={{ ...pill(atual === "cadastros"), background: cadAberto ? "#EFF0F3" : (atual === "cadastros" ? "#F6F2F2" : "transparent") }}
          >
            <i className="ti ti-folder" aria-hidden="true" style={{ fontSize: 16 }} />Cadastros
            <i className={`ti ${cadAberto ? "ti-chevron-up" : "ti-chevron-down"}`} aria-hidden="true" style={{ fontSize: 14, opacity: 0.7 }} />
          </button>
          {cadAberto && (
            <>
              <div onClick={() => setCadAberto(false)} style={{ position: "fixed", inset: 0, zIndex: 25, background: "transparent" }} />
              <div role="menu" style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 40, width: 200, background: "#FFFFFF", border: "1px solid #E7E9ED", borderRadius: 12, boxShadow: "0 14px 38px rgba(30,32,40,.16)", padding: 6 }}>
                <a href="/cadastros" role="menuitem" style={itemDrop}>
                  <i className="ti ti-id-badge-2" aria-hidden="true" style={{ fontSize: 16, color: VINHO }} />Motoristas
                </a>
                <a href="/cadastros?tela=vei" role="menuitem" style={itemDrop}>
                  <i className="ti ti-truck" aria-hidden="true" style={{ fontSize: 16, color: AZUL }} />Veículos
                </a>
              </div>
            </>
          )}
        </div>
      )}

      {/* 2. Empresas */}
      {ehAdminTotal() && <Item chave="empresas" href="/empresas" icone="ti-building-warehouse" label="Empresas" />}

      {/* 3. Usuários */}
      {ehGestorOuAdmin() && <Item chave="usuarios" href="/usuarios" icone="ti-users" label="Usuários" />}

      {/* 4. Mapa ao vivo */}
      {podeAcessar("mapa-ao-vivo") && <Item chave="mapa-ao-vivo" href="/mapa-ao-vivo" icone="ti-map-2" label="Mapa ao vivo" />}

      {/* 5. Info Análise */}
      {podeAcessar("info-analise") && <Item chave="info-analise" href="/info-analise" icone="ti-chart-dots" label="Info Análise" />}
    </nav>
  );
}
