# 🎲 VideoRoulette RT Translate

Random video chat (Chatroulette-style) with **real-time AI voice translation**:
each person speaks their own language and hears the other person **already
translated**, with a voice matched to the speaker's declared gender.

## Features

- **Random matchmaking**: press *Start*, get paired with the first other user
  waiting (FIFO queue). *Next* drops the room and re-queues. While searching,
  your own camera fills the screen as a local-only preview.
- **Two voice engines**, switchable live during the call:
  - **Stable voice** (default): `gpt-realtime-2` prompted as a simultaneous
    interpreter with a fixed voice chosen from the speaker's declared gender
    — Cedar (male) / Marin (female). Consistent voice, utterance-by-utterance
    pacing.
  - **Adaptive (fastest)**: `gpt-realtime-translate` — translates while the
    speaker is still talking (lowest latency); the voice imitates the
    speaker but can drift between utterances.
- **26 output languages** including Eastern European ones (Ukrainian, Polish,
  Czech, Slovak, Romanian, Hungarian, Bulgarian, Croatian, Serbian, Greek,
  Turkish). The adaptive engine officially supports 13 of them; choosing any
  other language auto-switches to the stable-voice engine. Input language is
  always auto-detected.
- **Live language switch** mid-call: restarts the voice session, retargets
  chat translation and updates the partner's UI.
- **Audio modes**: *Translated* (default), *Original*, or *Both* (original at
  5% under the translation, interpreter-style).
- **Transcript panel**: scrolling sidebar with the translated lines (last
  100), partial line shown in italics.
- **Translated text chat**: recipient sees the translation with the original
  underneath.
- **Call controls**: mute mic, camera on/off, front/back camera flip (mobile).
- **Security**: the OpenAI API key never reaches the browser — the server
  mints short-lived client secrets, only for sockets in an active match.
- **Swappable provider**: engines sit behind a `TranslationProvider`
  interface (`apps/web/lib/translation.ts`); a third engine (e.g.
  Palabra.ai, DeepL Voice) can be added without touching the UI.

## Architecture

```
┌─────────────┐   Socket.io    ┌──────────────────────┐
│  Web app    │◄──────────────►│ Server (Node.js)      │
│  (Next.js)  │  matchmaking,  │ - FIFO matching queue │
│   static    │  chat          │ - LiveKit tokens      │
│   export    │                │ - chat translation    │
│   served by │                │ - OpenAI ephemeral    │
│   server ───┼───────────────►│   client secrets      │
└──────┬──────┘                └──────────────────────┘
       │ WebRTC (camera + mic)
       ▼
┌──────────────────────────┐     ┌─────────────────────────────┐
│ LiveKit (SFU)            │     │ OpenAI Realtime API          │
│ 1 room per matched pair  │     │ gpt-realtime-translate or    │
└──────────────────────────┘     │ gpt-realtime-2 (fixed voice) │
       ▲                          └─────────────────────────────┘
       └── each browser pipes the ──────▲
           partner's audio track into a
           sidecar WebRTC session and plays
           the translated track instead
```

The listener's browser opens the sidecar session (the official
[OpenAI live-translation pattern](https://developers.openai.com/api/docs/guides/realtime-translation)),
so each user controls their own target language and engine.

## Project layout

```
apps/
├── server/   # Express + Socket.io: matchmaking, LiveKit tokens,
│             # chat translation, ephemeral client secrets, serves web build
└── web/      # Next.js (static export) + Tailwind: lobby, searching
              # preview, call screen, translation sidecar
docker-compose.yml   # local LiveKit server for development
render.yaml          # Render Blueprint (single free web service)
```

Key files:

- `apps/server/src/index.ts` — socket events (`queue:join`, `match:found`,
  `language:change`, `chat:send`, …), match state, secret endpoint
- `apps/server/src/openai.ts` — adaptive + fixed-voice session minting,
  chat translation
- `apps/web/components/CallScreen.tsx` — call UI, engines, controls
- `apps/web/lib/translation.ts` — `TranslationProvider` + OpenAI WebRTC
  sidecar implementation
- `apps/web/lib/languages.ts` — language roster (`adaptive` flag per
  language)

## Getting started (local)

Requirements: Node.js ≥ 20, an OpenAI API key, LiveKit (Cloud free tier or
Docker).

```bash
npm install
cp .env.example apps/server/.env          # then edit the secrets
echo "NEXT_PUBLIC_SERVER_URL=http://localhost:4000" > apps/web/.env.local
docker compose up -d                      # local LiveKit (or use LiveKit Cloud)
npm run dev
```

Open <http://localhost:3000> in two browser windows, pick two different
languages, press *Start* in both.

## Deploy to Render (one service, free tier)

`render.yaml` deploys server + web UI as a single free web service.

1. <https://render.com> → **New** → **Blueprint** → connect this repository,
   select the branch containing `render.yaml`
2. Fill in the secrets when prompted: `OPENAI_API_KEY`, `LIVEKIT_URL`
   (must be `wss://…`), `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`
3. Live at `https://<service-name>.onrender.com`

Diagnostics:

- `GET /health` → `{ ok, waiting, activeUsers, openai, livekitUrl }`
- Server logs print the LiveKit URL/API key (never the secret) and each
  minted translation secret (engine/voice/language)
- In-call, the red badge shows the exact translation failure reason, and the
  sidebar shows which voice is used for the partner

Free-tier note: the service spins down when idle — first visit after a pause
takes up to a minute.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | server (`:4000`) + web app (`:3000`) in watch mode |
| `npm run build` | production build (server `dist/` + web static `out/`) |
| `npm test` | unit tests (matchmaking queue) |
| `npm run lint` | typecheck all workspaces |

## Running costs (estimates)

- Adaptive engine: ~$0.034/min per direction → **≈ $0.07 per conversation
  minute** with both sides translated; fixed-voice engine is priced as
  regular Realtime API audio
- LiveKit Cloud free tier covers MVP usage; chat translation is negligible
- Set a monthly spending limit in the OpenAI dashboard

## Out of scope so far (required before any public launch)

1. **Content moderation** — automatic NSFW frame detection with disconnect/
   ban, report/block buttons, age verification (the lack of which is what
   shut Omegle down)
2. **Authentication / per-user limits** — today anyone with the URL spends
   the owner's OpenAI credit
3. Interest/region matching filters, custom domain, Redis-backed queue for
   horizontal scaling, native mobile apps, third translation engine
   (Palabra.ai trial)
