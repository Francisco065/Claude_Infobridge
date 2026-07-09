import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.BACKEND_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "";

// Repassa a requisição ao backend preservando: método, query string, corpo,
// status HTTP real e um corpo JSON sempre parseável (nunca quebra em 204/HTML).
async function repassar(req: NextRequest, path: string[], method: string) {
  if (!API_URL) {
    return NextResponse.json({ mensagem: "BACKEND_URL não configurada no servidor" }, { status: 500 });
  }

  const target = `${API_URL}/api/v1/${path.join("/")}${req.nextUrl.search}`;
  const headers: Record<string, string> = {};
  const auth = req.headers.get("authorization");
  if (auth) headers["authorization"] = auth;

  let body: string | undefined;
  if (method !== "GET" && method !== "DELETE") {
    body = await req.text();
    headers["Content-Type"] = "application/json";
  }

  let res: Response;
  try {
    res = await fetch(target, { method, headers, body });
  } catch (e: any) {
    return NextResponse.json({ mensagem: `Erro ao conectar com API: ${e?.message}` }, { status: 502 });
  }

  // Sem corpo (204/205 ou vazio): devolve o STATUS REAL, sem forçar 200.
  const text = await res.text();
  if (!text) return new NextResponse(null, { status: res.status });

  // Tenta JSON; se vier HTML/erro de gateway, embrulha preservando o status.
  try {
    return NextResponse.json(JSON.parse(text), { status: res.status });
  } catch {
    return NextResponse.json({ mensagem: text.slice(0, 500) }, { status: res.status });
  }
}

type Ctx = { params: Promise<{ path: string[] }> };
export async function GET(req: NextRequest, { params }: Ctx)    { return repassar(req, (await params).path, "GET"); }
export async function POST(req: NextRequest, { params }: Ctx)   { return repassar(req, (await params).path, "POST"); }
export async function PATCH(req: NextRequest, { params }: Ctx)  { return repassar(req, (await params).path, "PATCH"); }
export async function PUT(req: NextRequest, { params }: Ctx)    { return repassar(req, (await params).path, "PUT"); }
export async function DELETE(req: NextRequest, { params }: Ctx) { return repassar(req, (await params).path, "DELETE"); }
