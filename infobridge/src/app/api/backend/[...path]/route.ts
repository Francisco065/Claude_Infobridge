import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.BACKEND_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const target = `${API_URL}/api/v1/${path.join("/")}`;

  const body = await req.text();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const auth = req.headers.get("authorization");
  if (auth) headers["authorization"] = auth;

  const res = await fetch(target, { method: "POST", headers, body });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const search = req.nextUrl.search;
  const target = `${API_URL}/api/v1/${path.join("/")}${search}`;

  const headers: Record<string, string> = {};
  const auth = req.headers.get("authorization");
  if (auth) headers["authorization"] = auth;

  const res = await fetch(target, { headers });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
