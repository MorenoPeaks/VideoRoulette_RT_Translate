import { SERVER_URL } from "./config";

export interface TranscriptEvent {
  /** "source" = what the partner said, "translated" = what you hear. */
  kind: "source" | "translated";
  text: string;
  /** True when this delta completes an utterance. */
  done: boolean;
}

export interface TranslationSession {
  stop(): void;
}

export interface TranslationCallbacks {
  onTranslatedTrack(track: MediaStreamTrack): void;
  onTranscript?(event: TranscriptEvent): void;
  onError?(error: Error): void;
}

/**
 * Abstraction over the realtime voice translation engine so the provider can
 * be swapped (e.g. DeepL Voice once it ships voice preservation, Azure, …)
 * without touching the call UI.
 */
export interface TranslationProvider {
  /**
   * Starts translating `sourceTrack` (the partner's microphone) into
   * `targetLanguage` (the language the local user wants to hear).
   */
  start(
    sourceTrack: MediaStreamTrack,
    targetLanguage: string,
    callbacks: TranslationCallbacks,
  ): Promise<TranslationSession>;
}

const OPENAI_CALLS_URL = "https://api.openai.com/v1/realtime/translations/calls";

interface RealtimeEvent {
  type?: string;
  delta?: string;
  text?: string;
  transcript?: string;
}

/**
 * OpenAI gpt-realtime-translate over a sidecar WebRTC connection, following
 * the official "Build Live Translation Apps" cookbook pattern: the listener's
 * browser pipes the remote speaker's audio track to OpenAI and receives the
 * translated audio back as a remote track. The model auto-detects the spoken
 * language and adapts the translated voice to the speaker's tone and timbre
 * (dynamic voice adaptation), so gender is preserved automatically.
 *
 * Authentication uses an ephemeral client secret minted by our server; the
 * real API key never reaches the browser.
 */
export class OpenAIRealtimeTranslation implements TranslationProvider {
  async start(
    sourceTrack: MediaStreamTrack,
    targetLanguage: string,
    callbacks: TranslationCallbacks,
  ): Promise<TranslationSession> {
    const secretRes = await fetch(`${SERVER_URL}/api/translation-secret`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: targetLanguage }),
    });
    if (!secretRes.ok) {
      throw new Error(`failed to obtain translation secret: ${secretRes.status}`);
    }
    const secret = (await secretRes.json()) as { value?: string; client_secret?: { value?: string } };
    const ephemeralKey = secret.value ?? secret.client_secret?.value;
    if (!ephemeralKey) {
      throw new Error("translation secret response did not contain a key");
    }

    const pc = new RTCPeerConnection();
    let stopped = false;

    pc.ontrack = (event) => {
      if (!stopped) callbacks.onTranslatedTrack(event.track);
    };

    const events = pc.createDataChannel("oai-events");
    events.onmessage = (msg) => {
      if (stopped || !callbacks.onTranscript) return;
      try {
        const event = JSON.parse(msg.data as string) as RealtimeEvent;
        const type = event.type ?? "";
        const text = event.delta ?? event.text ?? event.transcript ?? "";
        if (!type.includes("transcript") || !text) return;
        const kind: TranscriptEvent["kind"] = type.includes("input")
          ? "source"
          : "translated";
        callbacks.onTranscript({ kind, text, done: type.endsWith(".done") });
      } catch {
        // ignore non-JSON payloads
      }
    };

    pc.addTrack(sourceTrack);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const sdpRes = await fetch(
      `${OPENAI_CALLS_URL}?model=gpt-realtime-translate`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ephemeralKey}`,
          "Content-Type": "application/sdp",
        },
        body: offer.sdp,
      },
    );
    if (!sdpRes.ok) {
      pc.close();
      throw new Error(`translation call setup failed: ${sdpRes.status}`);
    }
    await pc.setRemoteDescription({ type: "answer", sdp: await sdpRes.text() });

    pc.onconnectionstatechange = () => {
      if (
        !stopped &&
        (pc.connectionState === "failed" || pc.connectionState === "disconnected")
      ) {
        callbacks.onError?.(new Error(`translation connection ${pc.connectionState}`));
      }
    };

    return {
      stop() {
        stopped = true;
        events.close();
        pc.close();
      },
    };
  }
}
