import "dotenv/config";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
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

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: WEB_ORIGIN } });

const livekit = loadLiveKitConfig();
const queue = new MatchmakingQueue();
/** socketId -> active match state */
const matches = new Map<string, ActiveMatch>();

app.get("/health", (_req, res) => {
  res.json({ ok: true, waiting: queue.size, activeUsers: matches.size });
});

/**
 * The browser of the LISTENER calls this to obtain an ephemeral OpenAI
 * client secret for a Realtime Translation WebRTC session in its language.
 */
app.post("/api/translation-secret", async (req, res) => {
  const language = typeof req.body?.language === "string" ? req.body.language : "";
  if (!language) {
    res.status(400).json({ error: "language is required" });
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
  socket.on("queue:join", async (data: { nickname?: string; language?: string }) => {
    const language = typeof data?.language === "string" ? data.language : "";
    if (!language) {
      socket.emit("queue:error", { error: "language is required" });
      return;
    }
    const nickname =
      typeof data?.nickname === "string" && data.nickname.trim()
        ? data.nickname.trim().slice(0, 24)
        : "Anonymous";

    leaveMatch(socket.id, true);
    const pair = queue.join({ socketId: socket.id, nickname, language });
    if (pair) {
      try {
        await pairUsers(pair[0], pair[1]);
      } catch (err) {
        console.error("failed to create match:", err);
        for (const u of pair) {
          matches.delete(u.socketId);
          io.to(u.socketId).emit("queue:error", {
            error: "Failed to create the room, please retry",
          });
        }
      }
    } else {
      socket.emit("queue:waiting");
    }
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
  console.log(`LiveKit: ${livekit.url}`);
  console.log(
    `OpenAI key: ${process.env.OPENAI_API_KEY ? "configured" : "MISSING (translation disabled)"}`,
  );
});
