import { NextResponse } from "next/server";
import { getRoomInfo, getOnlineUsers, normalizeCode } from "@/lib/store";

export async function GET(request, { params }) {
  const info = await getRoomInfo(params.code);
  if (!info) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const onlineUsers = await getOnlineUsers(params.code);
  return NextResponse.json({
    code: normalizeCode(params.code),
    name: info.name,
    onlineUsers,
  });
}
