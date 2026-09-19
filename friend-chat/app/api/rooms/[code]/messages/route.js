import { NextResponse } from "next/server";
import {
  addMessage,
  getMessagesSince,
  getRoomInfo,
  getOnlineUsers,
  touchUser,
} from "@/lib/store";

export async function GET(request, { params }) {
  const { searchParams } = new URL(request.url);
  const since = Number(searchParams.get("since") || 0);
  const username = searchParams.get("username") || "";

  const info = await getRoomInfo(params.code);
  if (!info) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (username) await touchUser(params.code, username);

  const messages = (await getMessagesSince(params.code, since)) || [];
  const onlineUsers = await getOnlineUsers(params.code);

  return NextResponse.json({
    messages,
    onlineUsers,
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

  const message = await addMessage(params.code, username, text);
  if (!message) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ message });
}
