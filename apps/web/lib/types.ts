export interface MatchFoundPayload {
  roomName: string;
  token: string;
  livekitUrl: string;
  self: { identity: string };
  partner: { identity: string; nickname: string; language: string };
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
