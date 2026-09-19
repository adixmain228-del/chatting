"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const inputClass =
  "w-full bg-ink border border-white/10 rounded-chip px-4 py-3 text-paper placeholder:text-muted/60 text-base outline-none focus:border-signal transition-colors";

const buttonClass =
  "w-full bg-signal hover:bg-signal2 disabled:opacity-50 disabled:cursor-not-allowed text-ink font-bold py-3 rounded-chip transition-colors touch-manipulation";

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-xs text-muted mb-1.5">{label}</span>
      {children}
    </label>
  );
}

export default function HomePage() {
  const router = useRouter();
  const [mode, setMode] = useState("create");
  const [roomName, setRoomName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleCreate(e) {
    e.preventDefault();
    setError("");
    if (!displayName.trim()) {
      setError("Введи своё имя");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: roomName }),
      });
      const data = await res.json();
      if (!data.code) throw new Error("no_code");
      localStorage.setItem(`chat:name:${data.code}`, displayName.trim());
      router.push(`/room/${data.code}`);
    } catch {
      setError("Не получилось создать комнату. Попробуй ещё раз.");
      setLoading(false);
    }
  }

  async function handleJoin(e) {
    e.preventDefault();
    setError("");
    const code = joinCode.trim().toUpperCase();
    if (!code) {
      setError("Введи код комнаты");
      return;
    }
    if (!displayName.trim()) {
      setError("Введи своё имя");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/rooms/${code}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: displayName.trim() }),
      });
      if (res.status === 404) {
        setError("Комната с таким кодом не найдена");
        setLoading(false);
        return;
      }
      const data = await res.json();
      if (!data.ok) throw new Error("join_failed");
      localStorage.setItem(`chat:name:${code}`, displayName.trim());
      router.push(`/room/${code}`);
    } catch {
      setError("Не получилось войти. Попробуй ещё раз.");
      setLoading(false);
    }
  }

  return (
    <main className="min-h-dvh flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-10 text-center">
          <p className="font-mono text-xs tracking-[0.3em] text-signal uppercase mb-3">
            канал связи
          </p>
          <h1 className="font-display text-4xl sm:text-5xl font-semibold leading-tight">
            Позывной
          </h1>
          <p className="mt-3 text-muted text-sm leading-relaxed">
            Открой комнату, дай друзьям код — и общайтесь.
            <br />
            Без регистрации, без базы данных, просто чат.
          </p>
        </div>

        <div className="bg-surface border border-white/5 rounded-chip overflow-hidden">
          <div className="grid grid-cols-2 font-mono text-xs tracking-wide uppercase">
            <button
              type="button"
              onClick={() => {
                setMode("create");
                setError("");
              }}
              className={`py-3 transition-colors touch-manipulation ${
                mode === "create"
                  ? "bg-signal text-ink font-bold"
                  : "text-muted hover:text-paper"
              }`}
            >
              Создать
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("join");
                setError("");
              }}
              className={`py-3 transition-colors touch-manipulation ${
                mode === "join"
                  ? "bg-signal text-ink font-bold"
                  : "text-muted hover:text-paper"
              }`}
            >
              Войти по коду
            </button>
          </div>

          <div className="p-6 sm:p-7">
            {mode === "create" ? (
              <form onSubmit={handleCreate} className="space-y-4">
                <Field label="Название комнаты (необязательно)">
                  <input
                    value={roomName}
                    onChange={(e) => setRoomName(e.target.value)}
                    placeholder="Пятничные посиделки"
                    maxLength={40}
                    autoComplete="off"
                    enterKeyHint="next"
                    className={inputClass}
                  />
                </Field>
                <Field label="Твоё имя">
                  <input
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Как тебя видят друзья"
                    maxLength={24}
                    autoComplete="off"
                    enterKeyHint="go"
                    className={inputClass}
                  />
                </Field>
                {error && <p className="text-danger text-sm">{error}</p>}
                <button type="submit" disabled={loading} className={buttonClass}>
                  {loading ? "Создаём…" : "Создать комнату"}
                </button>
              </form>
            ) : (
              <form onSubmit={handleJoin} className="space-y-4">
                <Field label="Код комнаты">
                  <input
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                    placeholder="XK4P9L"
                    maxLength={6}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="characters"
                    spellCheck="false"
                    enterKeyHint="next"
                    className={`${inputClass} font-mono tracking-[0.3em] text-center text-lg`}
                  />
                </Field>
                <Field label="Твоё имя">
                  <input
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Как тебя видят друзья"
                    maxLength={24}
                    autoComplete="off"
                    enterKeyHint="go"
                    className={inputClass}
                  />
                </Field>
                {error && <p className="text-danger text-sm">{error}</p>}
                <button type="submit" disabled={loading} className={buttonClass}>
                  {loading ? "Входим…" : "Войти в комнату"}
                </button>
              </form>
            )}
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-muted">
          Сообщения хранятся только в памяти сервера — это прототип для узкого круга.
        </p>
      </div>
    </main>
  );
}
