// Хранилище комнат и сообщений.
//
// ВАЖНО: на Vercel каждый route.js разворачивается как отдельная serverless-функция
// со своей собственной памятью процесса. Из-за этого простое хранение в памяти
// (globalThis) НЕ подходит для продакшена: комната, созданная в одной функции
// (POST /api/rooms), не видна другой функции (POST /api/rooms/[code]/join) —
// именно это вызывало ошибку "комната не найдена" и пропадающие сообщения.
//
// Поэтому здесь два режима:
//  1) Если в проекте подключено бесплатное хранилище Vercel KV (Storage → Create
//     Database → KV в панели Vercel) — используется оно. Данные общие для всех
//     функций и переживают "холодные" старты.
//  2) Если KV не настроено (например, при локальной разработке `npm run dev`,
//     где всё работает в одном процессе) — используется резервное хранилище
//     в памяти. На Vercel без KV оно ломается по причине выше, поэтому для
//     деплоя KV обязателен — подробности в README.md.

import { kv } from "@vercel/kv";

const USE_KV = Boolean(
  process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN
);

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // без 0/O и 1/I
const MAX_MESSAGES_PER_ROOM = 300;
const ONLINE_TIMEOUT_MS = 20_000;
const ROOM_TTL_SECONDS = 60 * 60 * 24; // 24 часа без активности — комната истекает

export function normalizeCode(code) {
  return (code || "").toString().trim().toUpperCase();
}

export function generateCode(length = 6) {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

// ---------- Резервное хранилище в памяти (для локальной разработки) ----------

function getMemoryStore() {
  if (!globalThis.__friendChatStore) {
    globalThis.__friendChatStore = { rooms: new Map() };
  }
  return globalThis.__friendChatStore;
}

function memLastActivity(room) {
  if (room.messages.length === 0) return room.createdAt;
  return room.messages[room.messages.length - 1].ts;
}

function memCleanup() {
  const store = getMemoryStore();
  const now = Date.now();
  for (const [code, room] of store.rooms.entries()) {
    if (now - memLastActivity(room) > ROOM_TTL_SECONDS * 1000) {
      store.rooms.delete(code);
    }
  }
}

function memTrim(room) {
  if (room.messages.length > MAX_MESSAGES_PER_ROOM) {
    room.messages = room.messages.slice(-MAX_MESSAGES_PER_ROOM);
  }
}

// ---------- Публичное API хранилища (используется API-роутами) ----------

export async function createRoom(name) {
  const cleanName = (name || "").trim().slice(0, 40) || "Без названия";

  if (USE_KV) {
    let code;
    do {
      code = generateCode();
    } while (await kv.exists(`room:${code}:meta`));

    await kv.hset(`room:${code}:meta`, { name: cleanName, createdAt: Date.now() });
    await kv.expire(`room:${code}:meta`, ROOM_TTL_SECONDS);
    return code;
  }

  memCleanup();
  const store = getMemoryStore();
  let code;
  do {
    code = generateCode();
  } while (store.rooms.has(code));
  store.rooms.set(code, {
    name: cleanName,
    createdAt: Date.now(),
    users: {},
    messages: [],
  });
  return code;
}

export async function roomExists(code) {
  const c = normalizeCode(code);
  if (USE_KV) {
    return Boolean(await kv.exists(`room:${c}:meta`));
  }
  memCleanup();
  return getMemoryStore().rooms.has(c);
}

export async function getRoomInfo(code) {
  const c = normalizeCode(code);

  if (USE_KV) {
    const meta = await kv.hgetall(`room:${c}:meta`);
    if (!meta || !meta.name) return null;
    return { name: meta.name, createdAt: Number(meta.createdAt) };
  }

  memCleanup();
  const room = getMemoryStore().rooms.get(c);
  if (!room) return null;
  return { name: room.name, createdAt: room.createdAt };
}

export async function getOnlineUsers(code) {
  const c = normalizeCode(code);
  const now = Date.now();

  if (USE_KV) {
    const users = (await kv.hgetall(`room:${c}:users`)) || {};
    return Object.entries(users)
      .filter(([, lastSeen]) => now - Number(lastSeen) < ONLINE_TIMEOUT_MS)
      .map(([name]) => name);
  }

  const room = getMemoryStore().rooms.get(c);
  if (!room) return [];
  return Object.entries(room.users)
    .filter(([, info]) => now - info.lastSeen < ONLINE_TIMEOUT_MS)
    .map(([name]) => name);
}

async function getUsersRaw(code) {
  const c = normalizeCode(code);
  if (USE_KV) {
    return (await kv.hgetall(`room:${c}:users`)) || {};
  }
  const room = getMemoryStore().rooms.get(c);
  return room ? room.users : {};
}

export async function touchUser(code, username) {
  const c = normalizeCode(code);
  if (!username) return;

  if (USE_KV) {
    if (!(await roomExists(c))) return;
    await kv.hset(`room:${c}:users`, { [username]: Date.now() });
    await kv.expire(`room:${c}:users`, ROOM_TTL_SECONDS);
    await kv.expire(`room:${c}:meta`, ROOM_TTL_SECONDS);
    return;
  }

  const room = getMemoryStore().rooms.get(c);
  if (!room) return;
  if (!room.users[username]) {
    room.users[username] = { lastSeen: Date.now() };
  } else {
    room.users[username].lastSeen = Date.now();
  }
}

async function pushMessage(code, message) {
  const c = normalizeCode(code);

  if (USE_KV) {
    const key = `room:${c}:messages`;
    await kv.zadd(key, { score: message.ts, member: JSON.stringify(message) });
    await kv.expire(key, ROOM_TTL_SECONDS);
    const count = await kv.zcard(key);
    if (count > MAX_MESSAGES_PER_ROOM) {
      await kv.zremrangebyrank(key, 0, count - MAX_MESSAGES_PER_ROOM - 1);
    }
    return message;
  }

  const room = getMemoryStore().rooms.get(c);
  if (!room) return null;
  room.messages.push(message);
  memTrim(room);
  return message;
}

export async function joinRoom(code, username) {
  const c = normalizeCode(code);
  const cleanName = (username || "").trim().slice(0, 24);
  if (!cleanName) return null;
  if (!(await roomExists(c))) return null;

  const usersRaw = await getUsersRaw(c);
  const isNew = !Object.prototype.hasOwnProperty.call(usersRaw, cleanName);

  await touchUser(c, cleanName);

  if (isNew) {
    await pushMessage(c, {
      id: `${Date.now()}-sys-${Math.random().toString(36).slice(2, 7)}`,
      system: true,
      username: null,
      text: `${cleanName} присоединил${cleanName.endsWith("а") ? "ась" : "ся"} к чату`,
      ts: Date.now(),
    });
  }

  return true;
}

export async function addMessage(code, username, text) {
  const c = normalizeCode(code);
  const cleanText = (text || "").trim().slice(0, 2000);
  if (!cleanText || !username) return null;
  if (!(await roomExists(c))) return null;

  await touchUser(c, username);

  const message = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    username,
    text: cleanText,
    ts: Date.now(),
  };

  return pushMessage(c, message);
}

export async function getMessagesSince(code, since = 0) {
  const c = normalizeCode(code);

  if (USE_KV) {
    if (!(await roomExists(c))) return null;
    const raw = await kv.zrange(`room:${c}:messages`, since + 1, "+inf", {
      byScore: true,
    });
    return (raw || []).map((item) =>
      typeof item === "string" ? JSON.parse(item) : item
    );
  }

  const room = getMemoryStore().rooms.get(c);
  if (!room) return null;
  return room.messages.filter((m) => m.ts > since);
}
