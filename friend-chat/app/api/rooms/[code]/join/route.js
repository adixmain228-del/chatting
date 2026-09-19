import { NextResponse } from "next/server";
import { joinRoom, getOnlineUsers } from "@/lib/store";

export async function POST(request, { params }) {
  const body = await request.json().catch(() => ({}));
  const username = typeof body.username === "string" ? body.username : "";

  if (!username.trim()) {
    return NextResponse.json({ error: "invalid_name" }, { status: 400 });
  }

  const room = joinRoom(params.code, username);
  if (!room) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    name: room.name,
    onlineUsers: getOnlineUsers(room),
  });
}
