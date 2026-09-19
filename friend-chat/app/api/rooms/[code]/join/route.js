import { NextResponse } from "next/server";
import { joinRoom, getOnlineUsers, getRoomInfo } from "@/lib/store";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  const body = await request.json().catch(() => ({}));
  const username = typeof body.username === "string" ? body.username : "";

  if (!username.trim()) {
    return NextResponse.json({ error: "invalid_name" }, { status: 400 });
  }

  const joined = await joinRoom(params.code, username);
  if (!joined) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const [info, onlineUsers] = await Promise.all([
    getRoomInfo(params.code),
    getOnlineUsers(params.code),
  ]);

  return NextResponse.json({
    ok: true,
    name: info?.name || "",
    onlineUsers,
  });
}
