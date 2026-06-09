"use client";

import { useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import type { ChatMessagePayload } from "@/lib/types";

export default function ChatPanel({
  socket,
  selfId,
}: {
  socket: Socket;
  selfId: string;
}) {
  const [messages, setMessages] = useState<ChatMessagePayload[]>([]);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onMessage = (msg: ChatMessagePayload) =>
      setMessages((prev) => [...prev, msg]);
    socket.on("chat:message", onMessage);
    return () => {
      socket.off("chat:message", onMessage);
    };
  }, [socket]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  function send() {
    const text = draft.trim();
    if (!text) return;
    socket.emit("chat:send", { text });
    setDraft("");
  }

  return (
    <div className="flex min-h-64 flex-1 flex-col rounded-2xl bg-zinc-900 p-3">
      <p className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Chat</p>

      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto pr-1">
        {messages.length === 0 && (
          <p className="text-sm text-zinc-600">
            Messages are translated automatically.
          </p>
        )}
        {messages.map((msg, i) => {
          const mine = msg.from === selfId;
          return (
            <div
              key={i}
              className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                mine ? "ml-auto bg-indigo-600/80" : "bg-zinc-800"
              }`}
            >
              {/* The recipient reads the translation; the sender sees the
                  original (plus what was delivered, for transparency). */}
              {mine ? (
                <>
                  <p>{msg.original}</p>
                  {msg.translated && (
                    <p className="mt-1 text-xs text-zinc-300/70">
                      → {msg.translated}
                    </p>
                  )}
                </>
              ) : (
                <>
                  <p>{msg.translated ?? msg.original}</p>
                  {msg.translated && (
                    <p className="mt-1 text-xs text-zinc-400/70">
                      ({msg.original})
                    </p>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-2 flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Type a message…"
          className="flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500"
        />
        <button
          onClick={send}
          className="rounded-lg bg-indigo-600 px-4 text-sm font-semibold hover:bg-indigo-500"
        >
          Send
        </button>
      </div>
    </div>
  );
}
