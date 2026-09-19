import { NextResponse } from "next/server";
import { createRoom } from "@/lib/store";

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name : "";
  const code = createRoom(name);
  return NextResponse.json({ code });
}
