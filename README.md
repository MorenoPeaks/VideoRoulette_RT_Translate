# 🎲 VideoRoulette RT Translate

Random video chat (Chatroulette-style) with **real-time AI voice translation**:
each person speaks their own language and hears the other person **already
translated**, with a voice that matches the speaker's tone and gender.

## How it works

```
┌─────────────┐   Socket.io    ┌──────────────────────┐
│  Web app    │◄──────────────►│ Server (Node.js)      │
│  (Next.js)  │  matchmaking,  │ - FIFO matching queue │
│             │  chat          │ - LiveKit tokens      │
│             │                │ - chat translation    │
│             │                │ - OpenAI ephemeral    │
│             │                │   client secrets      │
└──────┬──────┘                └──────────────────────┘
       │ WebRTC (camera + mic)
       ▼
┌──────────────────────────┐     ┌─────────────────────────────┐
│ LiveKit (SFU)            │     │ OpenAI Realtime Translation  │
│ 1 room per matched pair  │     │ (gpt-realtime-translate)     │
└──────────────────────────┘     └─────────────────────────────┘
       ▲                                ▲
       └── each browser pipes the ──────┘
           partner's audio track to a sidecar
           WebRTC session and plays back the
           translated track instead of the original
```

- **Matchmaking**: Omegle-style — press *Start*, the first two users waiting
  are paired into a fresh LiveKit room. *Next* drops the room and re-queues.
- **Voice translation**: the listener's browser opens a sidecar WebRTC
  connection to OpenAI's Realtime Translation API
  (the official [live translation cookbook pattern](https://developers.openai.com/api/docs/guides/realtime-translation)),
  feeds it the partner's audio track and receives the translated audio as a
  remote track. The spoken language is auto-detected; the output language is
  whatever the listener chose in the lobby.
- **Gender-matched voice**: `gpt-realtime-translate` uses *dynamic voice
  adaptation* — the translated voice follows the speaker's tone, pitch and
  timbre, so a male speaker is heard with a male-sounding voice and a female
  speaker with a female-sounding voice, automatically.
- **Audio modes**: hear *Translated* (default), *Original*, or *Both*
  (original at low volume, interpreter-style). Live subtitles of the
  translation are shown over the video.
- **Text chat**: messages are translated server-side with a cheap text model;
  the recipient sees the translation with the original underneath.
- **Security**: the OpenAI API key never reaches the browser — the server
  mints short-lived ephemeral client secrets per translation session.
- **Swappable provider**: the engine sits behind a `TranslationProvider`
  interface (`apps/web/lib/translation.ts`) so it can be swapped for DeepL
  Voice, Azure Speech Translation, etc. without touching the UI.

## Project layout

```
apps/
├── server/   # Express + Socket.io: matchmaking, LiveKit tokens, chat translation
└── web/      # Next.js + Tailwind: lobby, call screen, translation sidecar
docker-compose.yml   # local LiveKit server for development
```

## Getting started

Requirements: Node.js ≥ 20, an OpenAI API key with access to
`gpt-realtime-translate`, and LiveKit (Cloud free tier or Docker).

```bash
npm install

# 1. configure secrets
cp .env.example apps/server/.env          # then edit OPENAI_API_KEY etc.
echo "NEXT_PUBLIC_SERVER_URL=http://localhost:4000" > apps/web/.env.local

# 2. start LiveKit (skip if using LiveKit Cloud — set LIVEKIT_* accordingly)
docker compose up -d

# 3. run server + web app
npm run dev
```

Open <http://localhost:3000> in **two browser windows** (or two devices),
pick two different languages, press *Start* in both — you'll be matched and
each side hears the other translated.

## Deploy to Render (one service, free tier)

The repo ships a [Render Blueprint](https://render.com/docs/blueprint-spec)
(`render.yaml`) that deploys the matchmaking server **and** the web UI as a
single free web service (the server serves the statically exported Next.js
app, so everything runs on one URL with no CORS setup).

1. Create a free account at <https://render.com>
2. Dashboard → **New** → **Blueprint** → connect this GitHub repository and
   select the branch containing `render.yaml`
3. When prompted, paste the secret env vars: `OPENAI_API_KEY`, `LIVEKIT_URL`,
   `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`
4. Deploy. Your app is live at `https://<service-name>.onrender.com`

Note: free-tier services spin down when idle — the first visit after a pause
takes up to a minute to wake up.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | server (`:4000`) + web app (`:3000`) in watch mode |
| `npm run build` | production build of both workspaces |
| `npm test` | unit tests (matchmaking queue) |
| `npm run lint` | typecheck all workspaces |

## Running costs (estimates)

- Voice translation: ~$0.034/min per direction → **≈ $0.07 per conversation
  minute** with both sides translated
- LiveKit Cloud free tier covers MVP usage; chat translation cost is negligible

## Out of scope for this MVP (required before any public launch)

User authentication, **content moderation** (automatic NSFW frame detection,
report/block, age verification — the lack of which is what shut Omegle down),
interest/region filters, Redis-backed queue for horizontal scaling, native
mobile apps.
