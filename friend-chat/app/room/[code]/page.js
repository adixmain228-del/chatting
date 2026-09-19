"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";

const POLL_INTERVAL_MS = 2000;

function CenteredMessage({ text, action }) {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 text-center">
      <p className="text-muted">{text}</p>
      {action}
    </main>
  );
}

function MessageBubble({ message, mine }) {
  const time = new Date(message.ts).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[75%] rounded-chip px-4 py-2.5 ${
          mine ? "bg-signal text-ink" : "bg-surface2 text-paper"
        }`}
      >
        {!mine && (
          <p className="text-xs font-mono opacity-70 mb-0.5">{message.username}</p>
        )}
        <p className="text-sm whitespace-pre-wrap break-words">{message.text}</p>
        <p
          className={`text-[10px] font-mono mt-1 text-right ${
            mine ? "text-ink/60" : "text-muted"
          }`}
        >
          {time}
        </p>
      </div>
    </div>
  );
}

export default function RoomPage() {
  const params = useParams();
  const router = useRouter();
  const code = (params.code || "").toString().toUpperCase();

  const [status, setStatus] = useState("loading"); // loading | needs-name | ready | not-found
  const [roomName, setRoomName] = useState("");
  const [username, setUsername] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [joinError, setJoinError] = useState("");
  const [messages, setMessages] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [draft, setDraft] = useState("");
  const [copyState, setCopyState] = useState("idle");

  const lastTsRef = useRef(0);
  const scrollRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      const storedName =
        typeof window !== "undefined"
          ? localStorage.getItem(`chat:name:${code}`)
          : null;

      const res = await fetch(`/api/rooms/${code}`);
      if (cancelled) return;

      if (res.status === 404) {
        setStatus("not-found");
        return;
      }

      const data = await res.json();
      setRoomName(data.name);
      setOnlineUsers(data.onlineUsers || []);
      setUsername(storedName || "");
      setStatus(storedName ? "ready" : "needs-name");
    }

    init();
    return () => {
      cancelled = true;
    };
  }, [code]);

  const fetchMessages = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/rooms/${code}/messages?since=${lastTsRef.current}&username=${encodeURIComponent(
          username
        )}`
      );
      if (!res.ok) return;
      const data = await res.json();
      if (data.messages?.length) {
        setMessages((prev) => [...prev, ...data.messages]);
        lastTsRef.current = data.messages[data.messages.length - 1].ts;
      }
      if (data.onlineUsers) setOnlineUsers(data.onlineUsers);
    } catch {
      // молча пробуем на следующем тике опроса
    }
  }, [code, username]);

  useEffect(() => {
    if (status !== "ready" || !username) return undefined;
    fetchMessages();
    const id = setInterval(fetchMessages, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [status, username, fetchMessages]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  async function handleJoin(e) {
    e.preventDefault();
    setJoinError("");
    const name = nameInput.trim();
    if (!name) {
      setJoinError("Введи своё имя");
      return;
    }
    const res = await fetch(`/api/rooms/${code}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: name }),
    });
    if (res.status === 404) {
      setStatus("not-found");
      return;
    }
    const data = await res.json();
    if (!data.ok) {
      setJoinError("Не получилось войти, попробуй другое имя");
      return;
    }
    localStorage.setItem(`chat:name:${code}`, name);
    setUsername(name);
    setOnlineUsers(data.onlineUsers || []);
    setStatus("ready");
  }

  async function handleSend(e) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    try {
      const res = await fetch(`/api/rooms/${code}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, text }),
      });
      const data = await res.json();
      if (data.message) {
        setMessages((prev) => [...prev, data.message]);
        lastTsRef.current = data.message.ts;
      }
    } catch {
      setDraft(text);
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(code).then(() => {
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 1500);
    });
  }

  if (status === "loading") {
    return <CenteredMessage text="Настраиваем канал…" />;
  }

  if (status === "not-found") {
    return (
      <CenteredMessage
        text={`Комната ${code} не найдена или закрылась`}
        action={
          <button
            onClick={() => router.push("/")}
            className="mt-4 text-signal underline underline-offset-4"
          >
            Вернуться на главную
          </button>
        }
      />
    );
  }

  if (status === "needs-name") {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <form
          onSubmit={handleJoin}
          className="w-full max-w-sm bg-surface border border-white/5 rounded-chip p-7"
        >
          <p className="font-mono text-xs tracking-[0.3em] text-signal uppercase mb-2">
            канал {code}
          </p>
          <h1 className="font-display text-2xl mb-4">{roomName || "Чат"}</h1>
          <label className="block mb-4">
            <span className="block text-xs text-muted mb-1.5">Как тебя зовут?</span>
            <input
              autoFocus
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              maxLength={24}
              className="w-full bg-ink border border-white/10 rounded-chip px-4 py-3 text-paper text-sm outline-none focus:border-signal"
            />
          </label>
          {joinError && <p className="text-danger text-sm mb-3">{joinError}</p>}
          <button
            type="submit"
            className="w-full bg-signal hover:bg-signal2 text-ink font-bold py-3 rounded-chip transition-colors"
          >
            Войти в чат
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="h-screen flex flex-col">
      <header className="border-b border-white/5 px-4 sm:px-6 py-4 flex items-center justify-between gap-4 bg-surface/60">
        <div className="min-w-0">
          <h1 className="font-display text-lg truncate">{roomName}</h1>
          <p className="text-xs text-muted truncate">
            {onlineUsers.length} на связи
            {onlineUsers.length > 0 && `: ${onlineUsers.join(", ")}`}
          </p>
        </div>
        <button
          onClick={handleCopy}
          className="shrink-0 font-mono text-xs tracking-[0.2em] uppercase bg-ink border border-white/10 rounded-chip px-3 py-2 hover:border-signal transition-colors"
        >
          {copyState === "copied" ? "Скопировано" : `Код: ${code}`}
        </button>
      </header>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto scrollbar-thin px-4 sm:px-6 py-4 space-y-3"
      >
        {messages.length === 0 && (
          <p className="text-muted text-sm text-center mt-10">
            Пока тихо. Напиши первым.
          </p>
        )}
        {messages.map((m) =>
          m.system ? (
            <p key={m.id} className="text-center text-xs text-muted font-mono">
              {m.text}
            </p>
          ) : (
            <MessageBubble key={m.id} message={m} mine={m.username === username} />
          )
        )}
      </div>

      <form
        onSubmit={handleSend}
        className="border-t border-white/5 p-3 sm:p-4 flex gap-2 bg-surface/60"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Сообщение…"
          maxLength={2000}
          className="flex-1 bg-ink border border-white/10 rounded-chip px-4 py-3 text-paper text-sm outline-none focus:border-signal"
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          className="bg-signal disabled:opacity-40 hover:bg-signal2 text-ink font-bold px-5 rounded-chip transition-colors"
        >
          Отправить
        </button>
      </form>
    </main>
  );
}
