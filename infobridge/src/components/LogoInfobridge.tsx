// Logo Infobridge — marca oficial (ponte + caminhão), PNG com fundo transparente.
// Escala pela altura; usa a versão branca sobre fundos escuros (ex.: login).

const VINHO = "#6E1414";

export default function LogoInfobridge({ height = 34, cor = VINHO }: { height?: number; cor?: string }) {
  const branco = ["#fff", "#ffffff", "white"].includes(cor.toLowerCase());
  const src = branco ? "/logo-mark-branco.png" : "/logo-mark.png";
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="Infobridge" style={{ height, width: "auto", display: "block" }} />
  );
}
