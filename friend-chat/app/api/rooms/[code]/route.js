import { NextResponse } from "next/server";
import { getRoom, getOnlineUsers, normalizeCode } from "@/lib/store";

export async function GET(request, { params }) {
  const room = getRoom(params.code);
  if (!room) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({
    code: normalizeCode(params.code),
    name: room.name,
    onlineUsers: getOnlineUsers(room),
  });
}
