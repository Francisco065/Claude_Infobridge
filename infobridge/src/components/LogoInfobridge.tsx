// Logo Infobridge — marca vetorial (ponte suspensa + caminhão).
// SVG com fundo transparente; escala pela altura e cor configurável
// (use cor="#fff" sobre fundos escuros). Usada em todas as telas e no login.

const VINHO = "#6E1414";

export default function LogoInfobridge({ height = 34, cor = VINHO }: { height?: number; cor?: string }) {
  return (
    <svg height={height} viewBox="0 0 120 80" fill="none" role="img" aria-label="Infobridge">
      <g stroke={cor} strokeLinecap="round" strokeLinejoin="round" fill="none">
        {/* torres */}
        <line x1="42" y1="8" x2="42" y2="60" strokeWidth="3.6" />
        <line x1="78" y1="8" x2="78" y2="60" strokeWidth="3.6" />
        {/* cabo superior (entre as torres) */}
        <path d="M42 9 Q60 15 78 9" strokeWidth="2.4" />
        {/* cabo principal (catenária central) */}
        <path d="M42 9 Q60 92 78 9" strokeWidth="2.8" />
        {/* pendurais */}
        <g strokeWidth="1.3">
          <line x1="46.3" y1="25.7" x2="46.3" y2="60" />
          <line x1="51" y1="39.5" x2="51" y2="60" />
          <line x1="60" y1="50" x2="60" y2="60" />
          <line x1="69" y1="39.5" x2="69" y2="60" />
          <line x1="73.7" y1="25.7" x2="73.7" y2="60" />
        </g>
        {/* cabos laterais (leque até o tabuleiro) */}
        <g strokeWidth="1.3">
          <line x1="42" y1="9" x2="10" y2="60" />
          <line x1="42" y1="9" x2="22" y2="60" />
          <line x1="42" y1="9" x2="33" y2="60" />
          <line x1="78" y1="9" x2="110" y2="60" />
          <line x1="78" y1="9" x2="98" y2="60" />
          <line x1="78" y1="9" x2="87" y2="60" />
        </g>
        {/* tabuleiro */}
        <line x1="6" y1="60" x2="114" y2="60" strokeWidth="3.4" />
      </g>
      {/* caminhão (vista frontal) */}
      <g fill={cor}>
        <rect x="51" y="40" width="18" height="18" rx="2.5" />
        <rect x="54.5" y="34" width="11" height="8" rx="2" />
        <circle cx="55" cy="58.5" r="3.1" />
        <circle cx="65" cy="58.5" r="3.1" />
      </g>
    </svg>
  );
}
