// Хранилище комнат и сообщений.
//
// ВАЖНО: на Vercel каждый route.js разворачивается как отдельная serverless-функция
// со своей собственной памятью процесса. Из-за этого простое хранение в памяти
// (globalThis) НЕ подходит для продакшена: комната, созданная в одной функции
// (POST /api/rooms), не видна другой функции (POST /api/rooms/[code]/join) —
// именно это вызывало ошибку "комната не найдена" и пропадающие сообщения.
//
// Поэтому здесь два режима:
//  1) Если в проекте подключён Redis через Vercel Marketplace (Storage → Browse
//     Storage → Upstash — см. README) — используется он через REST-клиент
//     @upstash/redis. Данные общие для всех функций и переживают "холодные" старты.
//  2) Если Redis не настроен (например, при локальной разработке `npm run dev`,
//     где всё работает в одном процессе) — используется резервное хранилище
//     в памяти. На Vercel без Redis оно ломается по причине выше.
//
// Оптимизация для бесплатного плана: там, где это не критично для консистентности
// (обновление "последний раз онлайн", запись сообщения), несколько команд Redis
// объединены в один pipeline-запрос вместо нескольких последовательных обращений —
// это меньше сетевых round-trip'ов и короче время выполнения функции.

import { Redis } from "@upstash/redis";

// Интеграция Upstash на Vercel может прописать переменные под двумя разными
// именами в зависимости от того, как она была подключена — проверяем оба варианта.
const KV_URL =
  process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN =
  process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const USE_KV = Boolean(KV_URL && KV_TOKEN);
const kv = USE_KV ? new Redis({ url: KV_URL, token: KV_TOKEN }) : null;

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // без 0/O и 1/I
const MAX_MESSAGES_PER_ROOM = 300;
const ONLINE_TIMEOUT_MS = 20_000;
const ROOM_TTL_SECONDS = 60 * 60 * 24; // 24 часа без активности — комната истекает
const TRIM_CHANCE = 0.05; // подрезаем историю не на каждом сообщении, а изредка

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
    // Читаем напрямую, без предварительной проверки существования комнаты:
    // hgetall на отсутствующий ключ просто вернёт пусто, ошибки не будет.
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
    // Одна пачка команд вместо трёх последовательных обращений к Redis —
    // это один сетевой round-trip вместо трёх. Проверку существования комнаты
    // намеренно не делаем здесь: это "пульс" присутствия, а не создание данных,
    // и EXPIRE/HSET на уже истёкший ключ просто ничего не делают, без ошибок.
    const usersKey = `room:${c}:users`;
    const metaKey = `room:${c}:meta`;
    const pipeline = kv.pipeline();
    pipeline.hset(usersKey, { [username]: Date.now() });
    pipeline.expire(usersKey, ROOM_TTL_SECONDS);
    pipeline.expire(metaKey, ROOM_TTL_SECONDS);
    await pipeline.exec();
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
    const pipeline = kv.pipeline();
    pipeline.zadd(key, { score: message.ts, member: JSON.stringify(message) });
    pipeline.expire(key, ROOM_TTL_SECONDS);
    await pipeline.exec();

    // Подрезаем историю не на каждом сообщении, а с вероятностью TRIM_CHANCE —
    // лишние 300-е сообщение подождёт следующего раза, зато экономим обращения.
    if (Math.random() < TRIM_CHANCE) {
      const count = await kv.zcard(key);
      if (count > MAX_MESSAGES_PER_ROOM) {
        await kv.zremrangebyrank(key, 0, count - MAX_MESSAGES_PER_ROOM - 1);
      }
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

  const message = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    username,
    text: cleanText,
    ts: Date.now(),
  };

  // Обновление присутствия и запись сообщения не зависят друг от друга —
  // запускаем параллельно вместо очереди из двух последовательных запросов.
  const [saved] = await Promise.all([
    pushMessage(c, message),
    touchUser(c, username),
  ]);

  return saved;
}

export async function getMessagesSince(code, since = 0) {
  const c = normalizeCode(code);

  if (USE_KV) {
    // Без предварительной проверки существования — zrange на отсутствующий
    // ключ безопасно вернёт пустой массив.
    const raw = await kv.zrange(`room:${c}:messages`, since + 1, "+inf", {
      byScore: true,
    });
    return (raw || []).map((item) =>
      typeof item === "string" ? JSON.parse(item) : item
    );
  }

  const room = getMemoryStore().rooms.get(c);
  if (!room) return [];
  return room.messages.filter((m) => m.ts > since);
}
