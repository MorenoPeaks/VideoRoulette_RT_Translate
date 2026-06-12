export type Gender = "male" | "female";

export interface MatchFoundPayload {
  roomName: string;
  token: string;
  livekitUrl: string;
  self: { identity: string };
  partner: {
    identity: string;
    nickname: string;
    language: string;
    gender: Gender;
  };
}

export interface ChatMessagePayload {
  from: string;
  nickname: string;
  original: string;
  translated: string | null;
  sourceLanguage: string;
  targetLanguage: string;
  sentAt: number;
}

/** What the user hears from their partner. */
export type AudioMode = "translated" | "original" | "both";

/**
 * Voice engine for the translation:
 * - "adaptive": gpt-realtime-translate — lowest latency, voice imitates the
 *   speaker but can drift between utterances
 * - "fixed-voice": gpt-realtime-2 as interpreter — constant voice picked
 *   from the speaker's declared gender, utterance-by-utterance pacing
 */
export type VoiceEngine = "adaptive" | "fixed-voice";
