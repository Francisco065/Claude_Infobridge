// Configuração ÚNICA das camadas de mapa (Leaflet).
//
// O modo "Mapa" usava a CARTO (basemaps.cartocdn.com/light_all), que passou a
// EXIGIR chave: os tiles voltavam marcados com "API KEY REQUIRED" por cima de
// toda a tela. O modo "Satélite" usa a Esri e continuou funcionando. Como a
// Esri já é uma dependência comprovadamente ativa aqui, o padrão do "Mapa"
// passou para o basemap de ruas da Esri — mesmo host, sem chave, sem marca
// d'água.
//
// Antes, as URLs estavam escritas à mão em 4 pontos de 2 páginas e já tinham
// divergido: o Mapa ao vivo declarava atribuição e o da Performance não
// declarava nenhuma — omissão que viola os termos de uso dos provedores.
//
// Tudo é configurável por ambiente; para um provedor que exija chave, use o
// marcador {key} na URL:
//   NEXT_PUBLIC_TILE_URL_ROADMAP=https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key={key}
//   NEXT_PUBLIC_TILE_KEY=sua_chave
//   NEXT_PUBLIC_TILE_ATTR_ROADMAP=© MapTiler © OpenStreetMap
//
// ATENÇÃO: variáveis NEXT_PUBLIC_* são embutidas no BUILD do Next.js, não
// lidas em tempo de execução — depois de alterá-las é preciso reconstruir e
// republicar o frontend para que passem a valer.

export type TipoMapa = "roadmap" | "satellite";

const PADRAO_ROADMAP   = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}";
const PADRAO_SATELLITE = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

const CHAVE = process.env.NEXT_PUBLIC_TILE_KEY ?? "";

const URLS: Record<TipoMapa, string> = {
  roadmap:   process.env.NEXT_PUBLIC_TILE_URL_ROADMAP   || PADRAO_ROADMAP,
  satellite: process.env.NEXT_PUBLIC_TILE_URL_SATELLITE || PADRAO_SATELLITE,
};

const ATRIBUICOES: Record<TipoMapa, string> = {
  roadmap:   process.env.NEXT_PUBLIC_TILE_ATTR_ROADMAP   || "© Esri · © OpenStreetMap",
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
  const url = urlTile(tipo);
  const opcoes: Record<string, unknown> = {
    maxZoom: 19,
    attribution: atribuicao(tipo),
    // subdomains só faz sentido quando a URL tem o marcador {s} (CARTO, OSM).
    // Endpoints da Esri não usam — derivar da URL evita quebrar ao trocar de
    // provedor por variável de ambiente.
    ...(url.includes("{s}") ? { subdomains: "abcd" } : {}),
    ...extra,
  };
  return L.tileLayer(url, opcoes);
}
