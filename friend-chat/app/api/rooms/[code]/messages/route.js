import { NextResponse } from "next/server";
import {
  addMessage,
  getMessagesSince,
  getRoomInfo,
  getOnlineUsers,
  touchUser,
} from "@/lib/store";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const { searchParams } = new URL(request.url);
  const since = Number(searchParams.get("since") || 0);
  const username = searchParams.get("username") || "";
  // Клиент шлёт heartbeat=1 не на каждый опрос, а раз в несколько секунд —
  // так мы не пишем "последний раз онлайн" в Redis на каждый тик поллинга.
  const heartbeat = searchParams.get("heartbeat") === "1";

  // Все обращения к хранилищу не зависят друг от друга — выполняем их
  // параллельно, а не по очереди. Это главный выигрыш по времени выполнения
  // функции: суммарная задержка равна самому долгому запросу, а не их сумме.
  const [info, messages, onlineUsers] = await Promise.all([
    getRoomInfo(params.code),
    getMessagesSince(params.code, since),
    getOnlineUsers(params.code),
    heartbeat && username ? touchUser(params.code, username) : Promise.resolve(),
  ]);

  if (!info) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({
    messages: messages || [],
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
