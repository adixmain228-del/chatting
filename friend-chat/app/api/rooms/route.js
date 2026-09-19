import { NextResponse } from "next/server";
import { createRoom } from "@/lib/store";

// Edge runtime — легче и быстрее обычных serverless-функций, а REST-клиент
// Upstash как раз рассчитан на работу через fetch, без постоянных соединений.
export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name : "";
  const code = await createRoom(name);
  return NextResponse.json({ code });
}
