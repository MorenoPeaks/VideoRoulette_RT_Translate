"use client";

import { useState } from "react";
import { OUTPUT_LANGUAGES } from "@/lib/languages";

export default function Lobby({
  onStart,
  error,
  initialProfile,
}: {
  onStart: (nickname: string, language: string) => void;
  error: string | null;
  initialProfile: { nickname: string; language: string } | null;
}) {
  const [nickname, setNickname] = useState(initialProfile?.nickname ?? "");
  const [language, setLanguage] = useState(initialProfile?.language ?? "en");

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 px-4">
      <div className="text-center">
        <h1 className="text-4xl font-bold tracking-tight">
          🎲 VideoRoulette <span className="text-indigo-400">RT Translate</span>
        </h1>
        <p className="mt-3 max-w-md text-zinc-400">
          Meet a random stranger. Speak your language — they hear theirs.
          Real-time AI voice translation, with a voice that matches the speaker.
        </p>
      </div>

      <form
        className="flex w-full max-w-sm flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          onStart(nickname, language);
        }}
      >
        <label className="flex flex-col gap-1 text-sm text-zinc-300">
          Nickname (optional)
          <input
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            maxLength={24}
            placeholder="Anonymous"
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-base outline-none focus:border-indigo-500"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-zinc-300">
          I want to hear
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-base outline-none focus:border-indigo-500"
          >
            {OUTPUT_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.flag} {l.label}
              </option>
            ))}
          </select>
        </label>

        <button
          type="submit"
          className="mt-2 rounded-lg bg-indigo-600 px-4 py-3 text-lg font-semibold hover:bg-indigo-500"
        >
          Start
        </button>

        {error && <p className="text-center text-sm text-red-400">{error}</p>}
      </form>

      <p className="max-w-md text-center text-xs text-zinc-600">
        You speak in any language — the model auto-detects it. The setting above
        is the language you will hear your partner in.
      </p>
    </div>
  );
}
