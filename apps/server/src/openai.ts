const OPENAI_BASE = "https://api.openai.com/v1";

function apiKey(): string | undefined {
  return process.env.OPENAI_API_KEY;
}

/**
 * Mints an ephemeral client secret for the Realtime Translation API so the
 * browser can open a WebRTC session directly with OpenAI without ever seeing
 * our real API key. `language` is the language the LISTENER wants to hear.
 */
export async function createTranslationClientSecret(
  language: string,
): Promise<{ ok: true; data: unknown } | { ok: false; status: number; error: string }> {
  const key = apiKey();
  if (!key) {
    return { ok: false, status: 503, error: "OPENAI_API_KEY is not configured" };
  }
  try {
    const res = await fetch(`${OPENAI_BASE}/realtime/translations/client_secrets`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        session: {
          model: "gpt-realtime-translate",
          audio: {
            input: {
              transcription: { model: "gpt-realtime-whisper" },
              noise_reduction: { type: "near_field" },
            },
            output: { language },
          },
        },
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, status: res.status, error: text };
    }
    return { ok: true, data: await res.json() };
  } catch (err) {
    console.error("client secret request failed:", err);
    return { ok: false, status: 502, error: "could not reach OpenAI" };
  }
}

/**
 * Translates a chat message with a cheap text model. Returns null when no
 * API key is configured or the call fails — the client then shows the
 * original text only.
 */
export async function translateText(
  text: string,
  targetLanguage: string,
): Promise<string | null> {
  const key = apiKey();
  if (!key) return null;
  try {
    const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        model: process.env.CHAT_TRANSLATION_MODEL ?? "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              `Translate the user's message into the language with code "${targetLanguage}". ` +
              "Keep tone and emoji. Output ONLY the translation, nothing else. " +
              "If the message is already in the target language, output it unchanged.",
          },
          { role: "user", content: text },
        ],
        temperature: 0.2,
      }),
    });
    if (!res.ok) {
      console.error("chat translation failed:", res.status, await res.text());
      return null;
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return data.choices?.[0]?.message?.content?.trim() ?? null;
  } catch (err) {
    console.error("chat translation error:", err);
    return null;
  }
}
