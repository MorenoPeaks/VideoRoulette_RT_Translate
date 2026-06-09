import { AccessToken } from "livekit-server-sdk";

export interface LiveKitConfig {
  url: string;
  apiKey: string;
  apiSecret: string;
}

export function loadLiveKitConfig(): LiveKitConfig {
  const url = process.env.LIVEKIT_URL ?? "ws://localhost:7880";
  const apiKey = process.env.LIVEKIT_API_KEY ?? "devkey";
  const apiSecret =
    process.env.LIVEKIT_API_SECRET ?? "devsecret_devsecret_devsecret_32";
  return { url, apiKey, apiSecret };
}

export async function createRoomToken(
  config: LiveKitConfig,
  roomName: string,
  identity: string,
  nickname: string,
  language: string,
): Promise<string> {
  const token = new AccessToken(config.apiKey, config.apiSecret, {
    identity,
    name: nickname,
    metadata: JSON.stringify({ language }),
    ttl: "2h",
  });
  token.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });
  return token.toJwt();
}
