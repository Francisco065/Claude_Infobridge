const BASE_URL = "http://apiv1.multiportal.com.br:9870";

export interface HandshakeResponse {
  status: "OK" | "INVALIDO" | "EXPIRADO" | "ERRO" | "NAOPERMITIDO";
  responseMessage: string;
  object: {
    username: string | null;
    password: string | null;
    appid: string | null;
    token: string | null;
    expiration: number | null;
  };
}

export interface ApiResponse<T> {
  status: "OK" | "INVALIDO" | "EXPIRADO" | "ERRO" | "NAOPERMITIDO";
  responseMessage: string;
  object: T;
}

async function post<T>(
  path: string,
  body: Record<string, unknown> | null,
  headers: Record<string, string> = {}
): Promise<ApiResponse<T>> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  return res.json();
}

export async function login(
  username: string,
  password: string,
  appid: string
): Promise<HandshakeResponse> {
  return post("/seguranca/logon", { username, password, appid });
}

export async function listVehicles(token: string) {
  return post("/veiculos", null, { token });
}

export async function lastPosition(token: string) {
  return post("/posicoes/ultimaPosicao", null, { token });
}

export async function vehicleHistory(
  token: string,
  veiculoid: number,
  dataInicial: number,
  dataFinal: number
) {
  return post(
    "/posicoes/veiculo",
    { id: veiculoid },
    {
      token,
      dataInicial: String(dataInicial),
      dataFinal: String(dataFinal),
    }
  );
}

export async function newData(token: string) {
  return post("/integracao/dados_novos", null, { token });
}

export async function listDrivers(token: string) {
  return post("/motoristas", null, { token });
}
