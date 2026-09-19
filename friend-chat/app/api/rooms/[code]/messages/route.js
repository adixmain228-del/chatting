import { NextResponse } from "next/server";
import {
  addMessage,
  getMessagesSince,
  getRoom,
  getOnlineUsers,
  touchUser,
} from "@/lib/store";

export async function GET(request, { params }) {
  const { searchParams } = new URL(request.url);
  const since = Number(searchParams.get("since") || 0);
  const username = searchParams.get("username") || "";

  const room = getRoom(params.code);
  if (!room) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (username) touchUser(params.code, username);

  const messages = getMessagesSince(params.code, since) || [];

  return NextResponse.json({
    messages,
    onlineUsers: getOnlineUsers(room),
    serverTime: Date.now(),
  });
}

export async function POST(request, { params }) {
  const body = await request.json().catch(() => ({}));
  const username = typeof body.username === "string" ? body.username : "";
  const text = typeof body.text === "string" ? body.text : "";

  if (!username.trim() || !text.trim()) {
    return NextResponse.json({ error: "invalid_message" }, { status: 400 });
  }

  const room = getRoom(params.code);
  if (!room) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const message = addMessage(params.code, username, text);
  return NextResponse.json({ message });
}
