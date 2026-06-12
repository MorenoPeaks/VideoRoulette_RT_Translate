"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  LocalVideoTrack,
  Room,
  RoomEvent,
  Track,
  createLocalTracks,
  type LocalTrack,
  type RemoteTrack,
  type RemoteTrackPublication,
} from "livekit-client";
import type { Socket } from "socket.io-client";
import ChatPanel from "@/components/ChatPanel";
import { languageLabel, OUTPUT_LANGUAGES, supportsAdaptive } from "@/lib/languages";
import {
  OpenAIRealtimeTranslation,
  type EngineConfig,
  type TranslationSession,
} from "@/lib/translation";
import type { AudioMode, MatchFoundPayload, VoiceEngine } from "@/lib/types";

type TranslationStatus = "idle" | "connecting" | "active" | "error";

/** Volumes for (original, translated) tracks per audio mode. */
const VOLUMES: Record<AudioMode, [number, number]> = {
  translated: [0, 1],
  original: [1, 0],
  both: [0.05, 1], // interpreter style: original barely audible underneath
};

/** Imperative call controls owned by the connection effect. */
interface CallControls {
  toggleMic(): Promise<void>;
  toggleCam(): Promise<void>;
  flipCamera(): Promise<void>;
  restartTranslation(): void;
}

export default function CallScreen({
  match,
  myLanguage,
  socket,
  onNext,
  onHangUp,
  onLanguageChange,
}: {
  match: MatchFoundPayload;
  myLanguage: string;
  socket: Socket;
  onNext: () => void;
  onHangUp: () => void;
  onLanguageChange: (language: string) => void;
}) {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const originalAudioRef = useRef<HTMLAudioElement>(null);
  const translatedAudioRef = useRef<HTMLAudioElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<CallControls | null>(null);

  const [audioMode, setAudioMode] = useState<AudioMode>("translated");
  const [translationStatus, setTranslationStatus] =
    useState<TranslationStatus>("idle");
  const [transcriptLines, setTranscriptLines] = useState<string[]>([]);
  const [partialLine, setPartialLine] = useState("");
  const [partnerLeft, setPartnerLeft] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);
  const [translationError, setTranslationError] = useState<string | null>(null);
  const [listenLanguage, setListenLanguage] = useState(myLanguage);
  const [partnerLanguage, setPartnerLanguage] = useState(match.partner.language);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [voiceEngine, setVoiceEngine] = useState<VoiceEngine>("fixed-voice");
  const voiceEngineRef = useRef<VoiceEngine>(voiceEngine);

  // Single source of truth for element volumes. Track handlers run inside a
  // long-lived effect closure, so they read the mode through a ref instead of
  // capturing a stale `audioMode`.
  const audioModeRef = useRef<AudioMode>(audioMode);
  const applyVolumes = useCallback(() => {
    const [originalVol, translatedVol] = VOLUMES[audioModeRef.current];
    if (originalAudioRef.current) originalAudioRef.current.volume = originalVol;
    if (translatedAudioRef.current)
      translatedAudioRef.current.volume = translatedVol;
  }, []);
  useEffect(() => {
    audioModeRef.current = audioMode;
    applyVolumes();
  }, [audioMode, applyVolumes]);

  // The translation session lives in the effect; it reads the target
  // language through this ref so a mid-call switch takes effect on restart.
  const listenLanguageRef = useRef(listenLanguage);

  // Keep the transcript pinned to the latest line.
  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight });
  }, [transcriptLines, partialLine]);

  useEffect(() => {
    const room = new Room();
    let translationSession: TranslationSession | null = null;
    let translationStarting = false;
    let localTracks: LocalTrack[] = [];
    let lastAudioTrack: MediaStreamTrack | null = null;
    let facingMode: "user" | "environment" = "user";
    let disposed = false;
    let subtitleBuffer = "";

    // The voice that replaces the partner's: their declared gender drives it.
    const fixedVoice = match.partner.gender === "female" ? "marin" : "cedar";

    async function startTranslation(sourceTrack: MediaStreamTrack) {
      // One session per call: TrackSubscribed can fire more than once for
      // the same audio (event + the post-connect catch-up loop below).
      if (translationStarting || translationSession) return;
      translationStarting = true;
      setTranslationStatus("connecting");
      const engineConfig: EngineConfig =
        voiceEngineRef.current === "fixed-voice"
          ? { engine: "fixed-voice", voice: fixedVoice }
          : { engine: "adaptive" };
      const provider = new OpenAIRealtimeTranslation(
        match.self.identity,
        engineConfig,
      );
      try {
        translationSession = await provider.start(
          sourceTrack,
          listenLanguageRef.current,
          {
            onTranslatedTrack(track) {
              if (disposed || !translatedAudioRef.current) return;
              translatedAudioRef.current.srcObject = new MediaStream([track]);
              applyVolumes();
              void translatedAudioRef.current.play().catch(() => undefined);
              setTranslationStatus("active");
              setTranslationError(null);
            },
            onTranscript(event) {
              if (disposed || event.kind !== "translated") return;
              if (event.done) {
                // Done events usually carry the full transcript; fall back
                // to the accumulated deltas when they don't.
                const line = event.text || subtitleBuffer;
                subtitleBuffer = "";
                setPartialLine("");
                if (line.trim()) {
                  setTranscriptLines((prev) => [...prev.slice(-99), line]);
                }
              } else {
                subtitleBuffer += event.text;
                setPartialLine(subtitleBuffer);
              }
            },
            onError(err) {
              if (disposed) return;
              setTranslationStatus("error");
              setTranslationError(err.message);
            },
          },
        );
        if (disposed) translationSession.stop();
      } catch (err) {
        console.error("translation start failed:", err);
        translationStarting = false;
        if (!disposed) {
          setTranslationStatus("error");
          setTranslationError(err instanceof Error ? err.message : String(err));
        }
      }
    }

    function handleRemoteTrack(
      track: RemoteTrack,
      _pub: RemoteTrackPublication,
    ) {
      if (track.kind === Track.Kind.Video && remoteVideoRef.current) {
        track.attach(remoteVideoRef.current);
      }
      if (track.kind === Track.Kind.Audio && originalAudioRef.current) {
        track.attach(originalAudioRef.current);
        applyVolumes();
        lastAudioTrack = track.mediaStreamTrack;
        void startTranslation(track.mediaStreamTrack);
      }
    }

    async function connect() {
      room.on(RoomEvent.TrackSubscribed, handleRemoteTrack);
      room.on(RoomEvent.ParticipantDisconnected, () => setPartnerLeft(true));
      // A rejoin (dev-mode double mount, brief network blip) must clear the
      // "partner left" overlay instead of leaving it stuck on screen.
      room.on(RoomEvent.ParticipantConnected, () => setPartnerLeft(false));

      // Acquire camera/mic for the local preview WITHOUT publishing —
      // publishing requires an established room connection, which comes next.
      try {
        localTracks = await createLocalTracks({ audio: true, video: true });
        const videoTrack = localTracks.find((t) => t.kind === Track.Kind.Video);
        if (videoTrack && localVideoRef.current) {
          videoTrack.attach(localVideoRef.current);
        }
      } catch (err) {
        console.error("camera/microphone error:", err);
        if (!disposed)
          setCallError(
            "Camera or microphone unavailable. Check that no other app is using them and that you allowed access.",
          );
        return;
      }
      if (disposed) return;

      // Now join the room and publish the tracks. A wrong/unreachable
      // LIVEKIT_URL is the usual failure here (e.g. an insecure ws:// URL on
      // an https:// site, or the server's LiveKit env vars not set), so
      // surface the real reason.
      try {
        await room.connect(match.livekitUrl, match.token);
        for (const track of localTracks) {
          await room.localParticipant.publishTrack(track);
        }
        // Tracks published before we attached the listener:
        for (const participant of room.remoteParticipants.values()) {
          for (const pub of participant.trackPublications.values()) {
            if (pub.track) handleRemoteTrack(pub.track as RemoteTrack, pub as RemoteTrackPublication);
          }
        }
      } catch (err) {
        console.error("failed to join the call:", err, "url:", match.livekitUrl);
        if (!disposed) {
          const insecure = match.livekitUrl.startsWith("ws://");
          setCallError(
            insecure
              ? "Server misconfigured: LIVEKIT_URL must be a wss:// address. Check the env vars on your host."
              : `Could not connect to the video server (${match.livekitUrl}). ${
                  err instanceof Error ? err.message : ""
                }`,
          );
        }
      }
    }

    controlsRef.current = {
      async toggleMic() {
        const mic = localTracks.find((t) => t.kind === Track.Kind.Audio);
        if (!mic) return;
        if (mic.isMuted) await mic.unmute();
        else await mic.mute();
        setMicOn(!mic.isMuted);
      },
      async toggleCam() {
        const cam = localTracks.find((t) => t.kind === Track.Kind.Video);
        if (!cam) return;
        if (cam.isMuted) await cam.unmute();
        else await cam.mute();
        setCamOn(!cam.isMuted);
      },
      async flipCamera() {
        const cam = localTracks.find((t) => t.kind === Track.Kind.Video);
        if (!(cam instanceof LocalVideoTrack)) return;
        facingMode = facingMode === "user" ? "environment" : "user";
        try {
          await cam.restartTrack({ facingMode });
        } catch (err) {
          // Single-camera devices (most desktops) can't flip; revert quietly.
          facingMode = facingMode === "user" ? "environment" : "user";
          console.warn("camera flip unavailable:", err);
        }
      },
      restartTranslation() {
        translationSession?.stop();
        translationSession = null;
        translationStarting = false;
        subtitleBuffer = "";
        setPartialLine("");
        setTranslationError(null);
        setTranslationStatus("idle");
        if (lastAudioTrack) void startTranslation(lastAudioTrack);
      },
    };

    void connect();

    const onPartnerLeft = () => setPartnerLeft(true);
    const onPartnerLanguage = (data: { language?: string }) => {
      if (typeof data?.language === "string") setPartnerLanguage(data.language);
    };
    socket.on("partner:left", onPartnerLeft);
    socket.on("partner:language", onPartnerLanguage);

    return () => {
      disposed = true;
      controlsRef.current = null;
      socket.off("partner:left", onPartnerLeft);
      socket.off("partner:language", onPartnerLanguage);
      translationSession?.stop();
      for (const track of localTracks) track.stop();
      void room.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match.roomName]);

  function changeVoiceEngine(engine: VoiceEngine) {
    if (engine === voiceEngine) return;
    // The adaptive engine only outputs its 13 supported languages.
    if (engine === "adaptive" && !supportsAdaptive(listenLanguageRef.current)) return;
    setVoiceEngine(engine);
    voiceEngineRef.current = engine;
    controlsRef.current?.restartTranslation();
  }

  function changeListenLanguage(language: string) {
    setListenLanguage(language);
    listenLanguageRef.current = language;
    // Languages outside the adaptive engine's roster force the fixed voice.
    if (!supportsAdaptive(language) && voiceEngineRef.current === "adaptive") {
      setVoiceEngine("fixed-voice");
      voiceEngineRef.current = "fixed-voice";
    }
    socket.emit("language:change", { language });
    onLanguageChange(language);
    // Restart the translation session so the new language takes effect now.
    controlsRef.current?.restartTranslation();
  }

  const statusBadge: Record<TranslationStatus, { text: string; cls: string }> = {
    idle: { text: "waiting for partner audio", cls: "bg-zinc-700" },
    connecting: { text: "connecting translation…", cls: "bg-amber-600" },
    active: { text: "live translation on", cls: "bg-emerald-600" },
    error: { text: "translation unavailable — original audio", cls: "bg-red-700" },
  };

  return (
    <div className="flex min-h-screen flex-col gap-3 p-3 lg:flex-row">
      {/* Hidden audio sinks: partner's original voice and its translation. */}
      <audio ref={originalAudioRef} autoPlay />
      <audio ref={translatedAudioRef} autoPlay />

      <section className="relative flex-1 overflow-hidden rounded-2xl bg-zinc-900">
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="h-full max-h-[calc(100vh-1.5rem)] min-h-64 w-full object-cover"
        />

        {/* Partner info + translation status */}
        <div className="absolute left-3 top-3 flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-black/60 px-3 py-1 text-sm">
            {match.partner.nickname} · hears {languageLabel(partnerLanguage)}
          </span>
          <span
            className={`rounded-full px-3 py-1 text-xs text-white ${statusBadge[translationStatus].cls}`}
          >
            {statusBadge[translationStatus].text}
          </span>
          {translationError && (
            <span className="rounded-full bg-black/70 px-3 py-1 text-xs text-red-300">
              {translationError}
            </span>
          )}
        </div>

        {/* Cam/mic controls: left-aligned on mobile so they never hide
            behind the local preview in the bottom-right corner. */}
        <div className="absolute bottom-3 left-3 flex gap-2 lg:left-1/2 lg:-translate-x-1/2">
          <button
            onClick={() => void controlsRef.current?.toggleMic()}
            title={micOn ? "Mute microphone" : "Unmute microphone"}
            className={`h-12 w-12 rounded-full text-xl backdrop-blur ${
              micOn ? "bg-black/60 hover:bg-black/80" : "bg-red-700 hover:bg-red-600"
            }`}
          >
            {micOn ? "🎙️" : "🔇"}
          </button>
          <button
            onClick={() => void controlsRef.current?.toggleCam()}
            title={camOn ? "Turn camera off" : "Turn camera on"}
            className={`h-12 w-12 rounded-full text-xl backdrop-blur ${
              camOn ? "bg-black/60 hover:bg-black/80" : "bg-red-700 hover:bg-red-600"
            }`}
          >
            {camOn ? "📷" : "🚫"}
          </button>
          <button
            onClick={() => void controlsRef.current?.flipCamera()}
            title="Switch camera (front/back)"
            className="h-12 w-12 rounded-full bg-black/60 text-xl backdrop-blur hover:bg-black/80"
          >
            🔄
          </button>
        </div>

        {/* Local preview */}
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          className="absolute bottom-3 right-3 h-20 w-28 rounded-xl border border-zinc-700 object-cover shadow-lg lg:h-28 lg:w-40"
        />

        {/* Partner left overlay */}
        {(partnerLeft || callError) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/80">
            <p className="px-6 text-center text-xl">
              {callError ?? "Your partner left the chat."}
            </p>
            <div className="flex gap-3">
              <button
                onClick={onNext}
                className="rounded-lg bg-indigo-600 px-5 py-2.5 font-semibold hover:bg-indigo-500"
              >
                Find next →
              </button>
              <button
                onClick={onHangUp}
                className="rounded-lg border border-zinc-600 px-5 py-2.5 hover:bg-zinc-800"
              >
                Home
              </button>
            </div>
          </div>
        )}
      </section>

      <aside className="flex w-full flex-col gap-3 lg:w-96">
        {/* Language + audio mode */}
        <div className="rounded-2xl bg-zinc-900 p-3">
          <label className="mb-2 flex items-center justify-between gap-2 text-xs uppercase tracking-wide text-zinc-500">
            Partner audio · you hear
            <select
              value={listenLanguage}
              onChange={(e) => changeListenLanguage(e.target.value)}
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm normal-case tracking-normal text-zinc-100 outline-none focus:border-indigo-500"
            >
              {OUTPUT_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.flag} {l.label}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-3 gap-2 text-sm">
            {(
              [
                ["translated", "Translated"],
                ["original", "Original"],
                ["both", "Both"],
              ] as [AudioMode, string][]
            ).map(([mode, label]) => (
              <button
                key={mode}
                onClick={() => setAudioMode(mode)}
                className={`rounded-lg px-2 py-2 ${
                  audioMode === mode
                    ? "bg-indigo-600 font-semibold"
                    : "bg-zinc-800 hover:bg-zinc-700"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="mb-2 mt-3 text-xs uppercase tracking-wide text-zinc-500">
            Voice engine
          </p>
          <div className="grid grid-cols-2 gap-2 text-sm">
            {(
              [
                ["fixed-voice", "Stable voice"],
                ["adaptive", "Adaptive (fastest)"],
              ] as [VoiceEngine, string][]
            ).map(([engine, label]) => {
              const unavailable =
                engine === "adaptive" && !supportsAdaptive(listenLanguage);
              return (
                <button
                  key={engine}
                  onClick={() => changeVoiceEngine(engine)}
                  disabled={unavailable}
                  title={
                    unavailable
                      ? "The adaptive engine does not support this language"
                      : undefined
                  }
                  className={`rounded-lg px-2 py-2 ${
                    voiceEngine === engine
                      ? "bg-indigo-600 font-semibold"
                      : unavailable
                        ? "cursor-not-allowed bg-zinc-800/40 text-zinc-600"
                        : "bg-zinc-800 hover:bg-zinc-700"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
          {/* Shows exactly which voice this client is using for the partner,
              so a gender mismatch (e.g. a stale client that never sent its
              gender) is visible at a glance. */}
          <p className="mt-2 text-xs text-zinc-500">
            {voiceEngine === "fixed-voice"
              ? match.partner.gender === "female"
                ? "Voice for your partner: Marin (female 👩)"
                : "Voice for your partner: Cedar (male 👨)"
              : "Voice imitates the speaker (may vary between sentences)"}
          </p>
        </div>

        {/* Live transcript of the translation */}
        <div className="rounded-2xl bg-zinc-900 p-3">
          <p className="mb-2 text-xs uppercase tracking-wide text-zinc-500">
            Transcript
          </p>
          <div
            ref={transcriptRef}
            className="nice-scrollbar h-48 space-y-1 overflow-y-scroll pr-2 text-sm"
          >
            {transcriptLines.length === 0 && !partialLine && (
              <p className="text-zinc-600">
                What your partner says appears here, translated.
              </p>
            )}
            {transcriptLines.map((line, i) => (
              <p key={i} className="text-zinc-200">
                {line}
              </p>
            ))}
            {partialLine && <p className="italic text-zinc-400">{partialLine}…</p>}
          </div>
        </div>

        <ChatPanel socket={socket} selfId={match.self.identity} />

        <div className="flex gap-2">
          <button
            onClick={onNext}
            className="flex-1 rounded-xl bg-indigo-600 py-3 font-semibold hover:bg-indigo-500"
          >
            Next →
          </button>
          <button
            onClick={onHangUp}
            className="flex-1 rounded-xl bg-red-700 py-3 font-semibold hover:bg-red-600"
          >
            Stop
          </button>
        </div>
      </aside>
    </div>
  );
}
