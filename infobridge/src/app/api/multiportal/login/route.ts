import { login } from "@/lib/multiportal/client";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const { username, password, appid } = await req.json();

  const result = await login(
    username ?? process.env.MULTIPORTAL_USER,
    password ?? process.env.MULTIPORTAL_PASS,
    appid ?? process.env.MULTIPORTAL_APPID
  );

  return NextResponse.json(result);
}
