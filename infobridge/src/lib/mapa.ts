// Configuração ÚNICA das camadas de mapa (Leaflet).
//
// Antes, as URLs de tile estavam escritas à mão em 4 pontos de 2 páginas, e
// já tinham divergido: o Mapa ao vivo declarava atribuição e o mapa da
// Performance não declarava nenhuma — omissão que viola os termos de uso de
// CARTO/OpenStreetMap e da Esri, e é motivo comum de bloqueio pelo provedor.
//
// O provedor é configurável por ambiente. Sem nenhuma variável definida, o
// comportamento é o mesmo de hoje (CARTO + Esri, sem chave), então nada muda
// até que uma configuração seja informada.
//
// Para usar um provedor que exija chave, informe a URL com o marcador {key}:
//   NEXT_PUBLIC_TILE_URL_ROADMAP=https://api.maptiler.com/maps/streets/{z}/{x}/{y}.png?key={key}
//   NEXT_PUBLIC_TILE_KEY=sua_chave
//   NEXT_PUBLIC_TILE_ATTR_ROADMAP=© MapTiler © OpenStreetMap
//
// ATENÇÃO: variáveis NEXT_PUBLIC_* são embutidas no BUILD do Next.js, não
// lidas em tempo de execução — depois de alterá-las é preciso reconstruir e
// republicar o frontend para que passem a valer.

export type TipoMapa = "roadmap" | "satellite";

const PADRAO_ROADMAP   = "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
const PADRAO_SATELLITE = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

const CHAVE = process.env.NEXT_PUBLIC_TILE_KEY ?? "";

const URLS: Record<TipoMapa, string> = {
  roadmap:   process.env.NEXT_PUBLIC_TILE_URL_ROADMAP   || PADRAO_ROADMAP,
  satellite: process.env.NEXT_PUBLIC_TILE_URL_SATELLITE || PADRAO_SATELLITE,
};

const ATRIBUICOES: Record<TipoMapa, string> = {
  roadmap:   process.env.NEXT_PUBLIC_TILE_ATTR_ROADMAP   || "© OpenStreetMap · © CARTO",
  satellite: process.env.NEXT_PUBLIC_TILE_ATTR_SATELLITE || "© Esri",
};

/** true quando a URL configurada espera uma chave que não foi informada. */
export function chaveFaltando(tipo: TipoMapa): boolean {
  return URLS[tipo].includes("{key}") && !CHAVE;
}

/** URL do tile com a chave aplicada (quando o provedor usar {key}). */
export function urlTile(tipo: TipoMapa): string {
  return URLS[tipo].replace("{key}", CHAVE);
}

export function atribuicao(tipo: TipoMapa): string {
  return ATRIBUICOES[tipo];
}

/**
 * Cria a camada de tiles já com atribuição — obrigatória nos dois provedores.
 * `L` é o Leaflet carregado sob demanda (window.L), por isso vem como
 * parâmetro em vez de import.
 */
export function criarCamada(L: any, tipo: TipoMapa, extra: Record<string, unknown> = {}) {
  const opcoes: Record<string, unknown> = {
    maxZoom: 19,
    attribution: atribuicao(tipo),
    ...(tipo === "roadmap" ? { subdomains: "abcd" } : {}),
    ...extra,
  };
  return L.tileLayer(urlTile(tipo), opcoes);
}
