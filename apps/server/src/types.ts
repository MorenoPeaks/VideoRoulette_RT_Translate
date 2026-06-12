export type Gender = "male" | "female";

export interface UserProfile {
  socketId: string;
  nickname: string;
  /** BCP-47-ish language code the user wants to HEAR (e.g. "it", "en"). */
  language: string;
  /** Drives the fixed translated voice the partner hears. */
  gender: Gender;
}

export interface ActiveMatch {
  roomName: string;
  partnerId: string;
  self: UserProfile;
}

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
