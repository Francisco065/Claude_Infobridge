import { NextResponse } from "next/server";

export async function GET() {
  const backendUrl = process.env.BACKEND_URL ?? "";
  const nextPublic = process.env.NEXT_PUBLIC_API_URL ?? "";

  if (!backendUrl) {
    return NextResponse.json({
      ok: false,
      erro: "BACKEND_URL não definida",
      NEXT_PUBLIC_API_URL: nextPublic || "(vazia)",
    });
  }

  try {
    const res = await fetch(`${backendUrl}/health`, { signal: AbortSignal.timeout(5000) });
    return NextResponse.json({
      ok: true,
      BACKEND_URL: backendUrl,
      healthStatus: res.status,
    });
  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      BACKEND_URL: backendUrl,
      erro: e?.message,
    });
  }
}
