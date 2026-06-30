// Logo Infobridge — marca oficial (PNG com fundo transparente).
// - variante "mark" (ponte + caminhão): cabeçalhos.
// - variante "full" (mark + tagline "Transformando dados em economia."): login.
// Escala pela altura; usa a versão branca sobre fundos escuros.

const VINHO = "#6E1414";

export default function LogoInfobridge({
  height = 34, cor = VINHO, variante = "mark",
}: { height?: number; cor?: string; variante?: "mark" | "full" }) {
  const branco = ["#fff", "#ffffff", "white"].includes(cor.toLowerCase());
  const base = variante === "full" ? "logo-full" : "logo-mark";
  const src = `/${base}${branco ? "-branco" : ""}.png`;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="Infobridge" style={{ height, width: "auto", display: "block" }} />
  );
}
