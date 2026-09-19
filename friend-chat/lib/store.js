// Простое хранилище "в памяти" — без базы данных.
// Живёт, пока жив процесс сервера (на Vercel — пока тёплый инстанс функции).
// Для прототипа в кругу друзей этого достаточно: комнаты и сообщения
// пропадут при передеплое или после долгого простоя, это ожидаемо.

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // без 0/O и 1/I, чтобы код было легко продиктовать
const MAX_MESSAGES_PER_ROOM = 300;
const ONLINE_TIMEOUT_MS = 20_000; // не было пинга 20 секунд — считаем оффлайн
const ROOM_TTL_MS = 1000 * 60 * 60 * 24; // комната без активности сутки — удаляется

function getStore() {
  if (!globalThis.__friendChatStore) {
    globalThis.__friendChatStore = { rooms: new Map() };
  }
  return globalThis.__friendChatStore;
}

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

function lastActivity(room) {
  if (room.messages.length === 0) return room.createdAt;
  return room.messages[room.messages.length - 1].ts;
}

function cleanupRooms() {
  const store = getStore();
  const now = Date.now();
  for (const [code, room] of store.rooms.entries()) {
    if (now - lastActivity(room) > ROOM_TTL_MS) {
      store.rooms.delete(code);
    }
  }
}

function trimMessages(room) {
  if (room.messages.length > MAX_MESSAGES_PER_ROOM) {
    room.messages = room.messages.slice(-MAX_MESSAGES_PER_ROOM);
  }
}

export function createRoom(name) {
  const store = getStore();
  cleanupRooms();

  let code;
  do {
    code = generateCode();
  } while (store.rooms.has(code));

  store.rooms.set(code, {
    name: (name || "").trim().slice(0, 40) || "Без названия",
    createdAt: Date.now(),
    users: {},
    messages: [],
  });

  return code;
}

export function getRoom(code) {
  cleanupRooms();
  return getStore().rooms.get(normalizeCode(code));
}

export function getOnlineUsers(room) {
  const now = Date.now();
  return Object.entries(room.users)
    .filter(([, info]) => now - info.lastSeen < ONLINE_TIMEOUT_MS)
    .map(([name]) => name);
}

export function touchUser(code, username) {
  const room = getRoom(code);
  if (!room || !username) return null;
  if (!room.users[username]) {
    room.users[username] = { lastSeen: Date.now() };
  } else {
    room.users[username].lastSeen = Date.now();
  }
  return room;
}

export function joinRoom(code, username) {
  const room = getRoom(code);
  if (!room) return null;

  const cleanName = username.trim().slice(0, 24);
  if (!cleanName) return null;

  const isNew = !room.users[cleanName];
  room.users[cleanName] = { lastSeen: Date.now() };

  if (isNew) {
    room.messages.push({
      id: `${Date.now()}-sys-${Math.random().toString(36).slice(2, 7)}`,
      system: true,
      username: null,
      text: `${cleanName} присоединил${cleanName.endsWith("а") ? "ась" : "ся"} к чату`,
      ts: Date.now(),
    });
    trimMessages(room);
  }

  return room;
}

export function addMessage(code, username, text) {
  const room = getRoom(code);
  if (!room) return null;

  const cleanText = (text || "").trim().slice(0, 2000);
  if (!cleanText || !username) return null;

  touchUser(code, username);

  const message = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    username,
    text: cleanText,
    ts: Date.now(),
  };

  room.messages.push(message);
  trimMessages(room);

  return message;
}

export function getMessagesSince(code, since = 0) {
  const room = getRoom(code);
  if (!room) return null;
  return room.messages.filter((m) => m.ts > since);
}
