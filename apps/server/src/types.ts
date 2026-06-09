export interface UserProfile {
  socketId: string;
  nickname: string;
  /** BCP-47-ish language code the user wants to HEAR (e.g. "it", "en"). */
  language: string;
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
