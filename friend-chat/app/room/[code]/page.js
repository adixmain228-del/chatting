"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { accentColorForName, avatarColorForName, initialsForName } from "@/lib/color";

const POLL_INTERVAL_MS = 2500; // как часто спрашиваем новые сообщения, пока вкладка активна
const HEARTBEAT_INTERVAL_MS = 8000; // как часто обновляем "в сети" — реже, чем сам поллинг
const GROUP_GAP_MS = 5 * 60 * 1000; // сообщения одного автора ближе этого времени схлопываются визуально

function CenteredMessage({ text, action }) {
  return (
    <main className="min-h-dvh flex flex-col items-center justify-center px-4 text-center">
      <p className="text-muted">{text}</p>
      {action}
    </main>
  );
}

function MessageBubble({ message, mine, showMeta }) {
  const time = new Date(message.ts).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });

  if (mine) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[82%] sm:max-w-[70%] rounded-chip px-4 py-2.5 bg-signal text-ink">
          <p className="text-sm whitespace-pre-wrap break-words">{message.text}</p>
          <p className="text-[10px] font-mono mt-1 text-right text-ink/60">{time}</p>
        </div>
      </div>
    );
  }

  const accent = accentColorForName(message.username);
  const avatarBg = avatarColorForName(message.username);

  return (
    <div className="flex items-end gap-2 justify-start">
      <div
        className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-paper ${
          showMeta ? "" : "invisible"
        }`}
        style={{ backgroundColor: avatarBg }}
        aria-hidden={!showMeta}
      >
        {initialsForName(message.username)}
      </div>
      <div
        className="max-w-[82%] sm:max-w-[70%] rounded-chip px-4 py-2.5 bg-surface2 text-paper border-l-2"
        style={{ borderColor: accent }}
      >
        {showMeta && (
          <p className="text-xs font-mono mb-0.5" style={{ color: accent }}>
            {message.username}
          </p>
        )}
        <p className="text-sm whitespace-pre-wrap break-words">{message.text}</p>
        <p className="text-[10px] font-mono mt-1 text-right text-muted">{time}</p>
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
  const lastHeartbeatRef = useRef(0);
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
      const now = Date.now();
      // "Пульс" присутствия шлём не на каждый опрос сообщений, а раз в
      // HEARTBEAT_INTERVAL_MS — экономит запись в Redis на большинстве тиков.
      const sendHeartbeat = now - lastHeartbeatRef.current > HEARTBEAT_INTERVAL_MS;
      const url =
        `/api/rooms/${code}/messages?since=${lastTsRef.current}` +
        `&username=${encodeURIComponent(username)}` +
        (sendHeartbeat ? "&heartbeat=1" : "");

      const res = await fetch(url);
      if (!res.ok) return;
      if (sendHeartbeat) lastHeartbeatRef.current = now;

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

  // Опрос идёт, только пока вкладка видима — свёрнутая или фоновая вкладка
  // не тратит запросы впустую. При возврате на вкладку сразу подтягиваем
  // пропущенное и запускаем опрос заново.
  useEffect(() => {
    if (status !== "ready" || !username) return undefined;

    let intervalId = null;

    function start() {
      if (intervalId) return;
      fetchMessages();
      intervalId = setInterval(fetchMessages, POLL_INTERVAL_MS);
    }

    function stop() {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    }

    function handleVisibility() {
      if (document.hidden) {
        stop();
      } else {
        start();
      }
    }

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
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
            className="mt-4 text-signal underline underline-offset-4 touch-manipulation"
          >
            Вернуться на главную
          </button>
        }
      />
    );
  }

  if (status === "needs-name") {
    return (
      <main className="min-h-dvh flex items-center justify-center px-4">
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
              autoComplete="off"
              enterKeyHint="go"
              className="w-full bg-ink border border-white/10 rounded-chip px-4 py-3 text-paper text-base outline-none focus:border-signal"
            />
          </label>
          {joinError && <p className="text-danger text-sm mb-3">{joinError}</p>}
          <button
            type="submit"
            className="w-full bg-signal hover:bg-signal2 text-ink font-bold py-3 rounded-chip transition-colors touch-manipulation"
          >
            Войти в чат
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="h-dvh flex flex-col">
      <header className="border-b border-white/5 px-4 sm:px-6 pt-[max(1rem,env(safe-area-inset-top))] pb-3 flex flex-col gap-2 bg-surface/60 backdrop-blur-sm">
        <div className="flex items-center justify-between gap-4">
          <h1 className="font-display text-lg truncate">{roomName}</h1>
          <button
            onClick={handleCopy}
            className="shrink-0 font-mono text-xs tracking-[0.2em] uppercase bg-ink border border-white/10 rounded-chip px-3 py-2 hover:border-signal transition-colors touch-manipulation"
          >
            {copyState === "copied" ? "Скопировано" : `Код: ${code}`}
          </button>
        </div>
        {onlineUsers.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-thin -mx-1 px-1">
            {onlineUsers.map((u) => (
              <span
                key={u}
                className="shrink-0 flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-full bg-ink/60 border border-white/5"
              >
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{
                    backgroundColor: u === username ? "#3DDC97" : accentColorForName(u),
                  }}
                />
                {u}
              </span>
            ))}
          </div>
        )}
      </header>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto overscroll-contain scrollbar-thin px-4 sm:px-6 py-4 space-y-2"
      >
        {messages.length === 0 && (
          <p className="text-muted text-sm text-center mt-10">
            Пока тихо. Напиши первым.
          </p>
        )}
        {messages.map((m, idx) => {
          if (m.system) {
            return (
              <p key={m.id} className="text-center text-xs text-muted font-mono">
                {m.text}
              </p>
            );
          }
          const prev = messages[idx - 1];
          const showMeta =
            !prev ||
            prev.system ||
            prev.username !== m.username ||
            m.ts - prev.ts > GROUP_GAP_MS;
          return (
            <MessageBubble
              key={m.id}
              message={m}
              mine={m.username === username}
              showMeta={showMeta}
            />
          );
        })}
      </div>

      <form
        onSubmit={handleSend}
        className="border-t border-white/5 p-3 sm:p-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] flex gap-2 bg-surface/60"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Сообщение…"
          maxLength={2000}
          autoComplete="off"
          enterKeyHint="send"
          className="flex-1 bg-ink border border-white/10 rounded-chip px-4 py-3 text-paper text-base outline-none focus:border-signal"
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          className="bg-signal disabled:opacity-40 hover:bg-signal2 text-ink font-bold px-5 rounded-chip transition-colors touch-manipulation"
        >
          Отправить
        </button>
      </form>
    </main>
  );
}
