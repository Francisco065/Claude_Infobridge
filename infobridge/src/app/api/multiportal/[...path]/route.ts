import { NextResponse } from "next/server";

const BASE_URL = "http://apiv1.multiportal.com.br:9870";

// Generic proxy: forwards POST to Multiportal API
export async function POST(
  req: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const apiPath = "/" + path.join("/");
  const body = await req.text();
  const token = req.headers.get("x-mp-token") ?? "";

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token && { token }),
  };

  // Forward extra Multiportal headers
  const mpHeaders = ["dataInicial", "dataFinal", "nome", "id"];
  for (const h of mpHeaders) {
    const v = req.headers.get(`x-mp-${h}`);
    if (v) headers[h] = v;
  }

  const res = await fetch(`${BASE_URL}${apiPath}`, {
    method: "POST",
    headers,
    body: body || undefined,
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
