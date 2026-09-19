import { NextResponse } from "next/server";
import { getRoomInfo, getOnlineUsers, normalizeCode } from "@/lib/store";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  // Обе команды не зависят друг от друга — запускаем параллельно вместо
  // очереди из двух последовательных обращений к Redis.
  const [info, onlineUsers] = await Promise.all([
    getRoomInfo(params.code),
    getOnlineUsers(params.code),
  ]);

  if (!info) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({
    code: normalizeCode(params.code),
    name: info.name,
    onlineUsers,
  });
}
