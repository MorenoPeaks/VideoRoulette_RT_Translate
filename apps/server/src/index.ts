import "dotenv/config";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import { Server } from "socket.io";
import { MatchmakingQueue } from "./matchmaking.js";
import { createRoomToken, loadLiveKitConfig } from "./livekit.js";
import { createTranslationClientSecret, translateText } from "./openai.js";
import type {
  ActiveMatch,
  ChatMessagePayload,
  MatchFoundPayload,
  UserProfile,
} from "./types.js";

const PORT = Number(process.env.PORT ?? 4000);
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:3000";

const app = express();
app.use(cors({ origin: WEB_ORIGIN }));
app.use(express.json());

// In production the statically exported web app (apps/web/out) is served by
// this same server: one deployable service, same origin for socket + API.
const webDist = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../web/out",
);
if (existsSync(webDist)) {
  app.use(express.static(webDist));
}

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: WEB_ORIGIN } });

const livekit = loadLiveKitConfig();
const queue = new MatchmakingQueue();
/** socketId -> active match state */
const matches = new Map<string, ActiveMatch>();

/** Language codes come from the client; never forward arbitrary strings. */
const LANGUAGE_RE = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;

function isConnected(socketId: string): boolean {
  return io.sockets.sockets.has(socketId);
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, waiting: queue.size, activeUsers: matches.size });
});

/**
 * The browser of the LISTENER calls this to obtain an ephemeral OpenAI
 * client secret for a Realtime Translation WebRTC session in its language.
 * Secrets cost money to use, so only sockets currently in an active match
 * may request one (the client sends its own socket id as proof).
 */
app.post("/api/translation-secret", async (req, res) => {
  const language = typeof req.body?.language === "string" ? req.body.language : "";
  const socketId = typeof req.body?.socketId === "string" ? req.body.socketId : "";
  if (!LANGUAGE_RE.test(language)) {
    res.status(400).json({ error: "invalid language code" });
    return;
  }
  if (!matches.has(socketId) || !isConnected(socketId)) {
    res.status(403).json({ error: "not in an active call" });
    return;
  }
  const result = await createTranslationClientSecret(language);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json(result.data);
});

async function pairUsers(a: UserProfile, b: UserProfile): Promise<void> {
  const roomName = `vr-${randomUUID().slice(0, 8)}`;
  const [tokenA, tokenB] = await Promise.all([
    createRoomToken(livekit, roomName, a.socketId, a.nickname, a.language),
    createRoomToken(livekit, roomName, b.socketId, b.nickname, b.language),
  ]);

  // A socket may have disconnected while we were creating tokens; pairing it
  // anyway would strand the survivor in an empty room with no partner:left.
  const aAlive = isConnected(a.socketId);
  const bAlive = isConnected(b.socketId);
  if (!aAlive || !bAlive) {
    const survivor = aAlive ? a : bAlive ? b : null;
    if (survivor) requeue(survivor);
    return;
  }

  matches.set(a.socketId, { roomName, partnerId: b.socketId, self: a });
  matches.set(b.socketId, { roomName, partnerId: a.socketId, self: b });

  const payloadFor = (
    self: UserProfile,
    token: string,
    partner: UserProfile,
  ): MatchFoundPayload => ({
    roomName,
    token,
    livekitUrl: livekit.url,
    self: { identity: self.socketId },
    partner: {
      identity: partner.socketId,
      nickname: partner.nickname,
      language: partner.language,
    },
  });

  io.to(a.socketId).emit("match:found", payloadFor(a, tokenA, b));
  io.to(b.socketId).emit("match:found", payloadFor(b, tokenB, a));
  console.log(
    `matched ${a.nickname} (${a.language}) <-> ${b.nickname} (${b.language}) in ${roomName}`,
  );
}

/** Puts a user in the queue, pairing immediately when possible. */
function requeue(user: UserProfile): void {
  const pair = queue.join(user);
  if (!pair) {
    io.to(user.socketId).emit("queue:waiting");
    return;
  }
  void pairUsers(pair[0], pair[1]).catch((err) => {
    console.error("failed to create match:", err);
    for (const u of pair) {
      matches.delete(u.socketId);
      io.to(u.socketId).emit("queue:error", {
        error: "Failed to create the room, please retry",
      });
    }
  });
}

/** Tears down the match for `socketId`, notifying the partner. */
function leaveMatch(socketId: string, notifyPartner: boolean): void {
  const match = matches.get(socketId);
  if (!match) return;
  matches.delete(socketId);
  const partnerMatch = matches.get(match.partnerId);
  if (partnerMatch && partnerMatch.partnerId === socketId) {
    matches.delete(match.partnerId);
    if (notifyPartner) {
      io.to(match.partnerId).emit("partner:left");
    }
  }
}

io.on("connection", (socket) => {
  socket.on("queue:join", (data: { nickname?: string; language?: string }) => {
    const language = typeof data?.language === "string" ? data.language : "";
    if (!LANGUAGE_RE.test(language)) {
      socket.emit("queue:error", { error: "invalid language code" });
      return;
    }
    const nickname =
      typeof data?.nickname === "string" && data.nickname.trim()
        ? data.nickname.trim().slice(0, 24)
        : "Anonymous";

    // Joining the queue implies leaving any current match ("Next").
    leaveMatch(socket.id, true);
    requeue({ socketId: socket.id, nickname, language });
  });

  socket.on("queue:leave", () => {
    queue.remove(socket.id);
  });

  // "Next" / hang up: leave the current room; the client decides whether to
  // re-join the queue afterwards.
  socket.on("match:leave", () => {
    leaveMatch(socket.id, true);
  });

  socket.on("chat:send", async (data: { text?: string }) => {
    const match = matches.get(socket.id);
    const text = typeof data?.text === "string" ? data.text.trim().slice(0, 1000) : "";
    if (!match || !text) return;
    const partner = matches.get(match.partnerId);
    if (!partner) return;

    const translated = await translateText(text, partner.self.language);
    const payload: ChatMessagePayload = {
      from: socket.id,
      nickname: match.self.nickname,
      original: text,
      translated,
      sourceLanguage: match.self.language,
      targetLanguage: partner.self.language,
      sentAt: Date.now(),
    };
    io.to(match.partnerId).emit("chat:message", payload);
    socket.emit("chat:message", payload);
  });

  socket.on("disconnect", () => {
    queue.remove(socket.id);
    leaveMatch(socket.id, true);
  });
});

httpServer.listen(PORT, () => {
  console.log(`matchmaking server listening on :${PORT}`);
  // Log the URL and API key (not the secret) so the LiveKit credentials can
  // be cross-checked against the project in the LiveKit Cloud dashboard —
  // the API key must belong to the same project as the URL.
  console.log(`LiveKit URL: ${livekit.url}`);
  console.log(`LiveKit API key: ${livekit.apiKey}`);
  console.log(
    `OpenAI key: ${process.env.OPENAI_API_KEY ? "configured" : "MISSING (translation disabled)"}`,
  );
});
