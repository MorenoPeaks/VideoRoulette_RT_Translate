"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Room,
  RoomEvent,
  Track,
  type RemoteTrack,
  type RemoteTrackPublication,
} from "livekit-client";
import type { Socket } from "socket.io-client";
import ChatPanel from "@/components/ChatPanel";
import { languageLabel } from "@/lib/languages";
import {
  OpenAIRealtimeTranslation,
  type TranslationSession,
} from "@/lib/translation";
import type { AudioMode, MatchFoundPayload } from "@/lib/types";

type TranslationStatus = "idle" | "connecting" | "active" | "error";

/** Volumes for (original, translated) tracks per audio mode. */
const VOLUMES: Record<AudioMode, [number, number]> = {
  translated: [0, 1],
  original: [1, 0],
  both: [0.2, 1], // interpreter style: original quietly in the background
};

export default function CallScreen({
  match,
  myLanguage,
  socket,
  onNext,
  onHangUp,
}: {
  match: MatchFoundPayload;
  myLanguage: string;
  socket: Socket;
  onNext: () => void;
  onHangUp: () => void;
}) {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const originalAudioRef = useRef<HTMLAudioElement>(null);
  const translatedAudioRef = useRef<HTMLAudioElement>(null);

  const [audioMode, setAudioMode] = useState<AudioMode>("translated");
  const [translationStatus, setTranslationStatus] =
    useState<TranslationStatus>("idle");
  const [subtitle, setSubtitle] = useState("");
  const [partnerLeft, setPartnerLeft] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);

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

  useEffect(() => {
    const room = new Room();
    let translationSession: TranslationSession | null = null;
    let translationStarting = false;
    let disposed = false;
    const provider = new OpenAIRealtimeTranslation(match.self.identity);
    let subtitleBuffer = "";

    async function startTranslation(sourceTrack: MediaStreamTrack) {
      // One session per call: TrackSubscribed can fire more than once for
      // the same audio (event + the post-connect catch-up loop below).
      if (translationStarting || translationSession) return;
      translationStarting = true;
      setTranslationStatus("connecting");
      try {
        translationSession = await provider.start(sourceTrack, myLanguage, {
          onTranslatedTrack(track) {
            if (disposed || !translatedAudioRef.current) return;
            translatedAudioRef.current.srcObject = new MediaStream([track]);
            applyVolumes();
            void translatedAudioRef.current.play().catch(() => undefined);
            setTranslationStatus("active");
          },
          onTranscript(event) {
            if (disposed || event.kind !== "translated") return;
            if (event.done) {
              // Done events usually carry the full transcript; fall back to
              // the accumulated deltas when they don't.
              setSubtitle(event.text || subtitleBuffer);
              subtitleBuffer = "";
            } else {
              subtitleBuffer += event.text;
              setSubtitle(subtitleBuffer);
            }
          },
          onError() {
            if (!disposed) setTranslationStatus("error");
          },
        });
        if (disposed) translationSession.stop();
      } catch (err) {
        console.error("translation start failed:", err);
        translationStarting = false;
        if (!disposed) setTranslationStatus("error");
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
        void startTranslation(track.mediaStreamTrack);
      }
    }

    async function connect() {
      room.on(RoomEvent.TrackSubscribed, handleRemoteTrack);
      room.on(RoomEvent.ParticipantDisconnected, () => setPartnerLeft(true));
      // A rejoin (dev-mode double mount, brief network blip) must clear the
      // "partner left" overlay instead of leaving it stuck on screen.
      room.on(RoomEvent.ParticipantConnected, () => setPartnerLeft(false));

      try {
        await room.connect(match.livekitUrl, match.token);
        await room.localParticipant.enableCameraAndMicrophone();
        const camPub = room.localParticipant.getTrackPublication(
          Track.Source.Camera,
        );
        if (camPub?.track && localVideoRef.current) {
          camPub.track.attach(localVideoRef.current);
        }
        // Tracks published before we attached the listener:
        for (const participant of room.remoteParticipants.values()) {
          for (const pub of participant.trackPublications.values()) {
            if (pub.track) handleRemoteTrack(pub.track as RemoteTrack, pub as RemoteTrackPublication);
          }
        }
      } catch (err) {
        console.error("failed to join the call:", err);
        if (!disposed) setCallError("Could not join the call (camera/mic or connection problem).");
      }
    }

    void connect();

    const onPartnerLeft = () => setPartnerLeft(true);
    socket.on("partner:left", onPartnerLeft);

    return () => {
      disposed = true;
      socket.off("partner:left", onPartnerLeft);
      translationSession?.stop();
      void room.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match.roomName]);

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
          className="h-full max-h-[calc(100vh-1.5rem)] w-full object-cover"
        />

        {/* Partner info + translation status */}
        <div className="absolute left-3 top-3 flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-black/60 px-3 py-1 text-sm">
            {match.partner.nickname} · hears {languageLabel(match.partner.language)}
          </span>
          <span
            className={`rounded-full px-3 py-1 text-xs text-white ${statusBadge[translationStatus].cls}`}
          >
            {statusBadge[translationStatus].text}
          </span>
        </div>

        {/* Local preview */}
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          className="absolute bottom-3 right-3 h-28 w-40 rounded-xl border border-zinc-700 object-cover shadow-lg"
        />

        {/* Subtitles */}
        {subtitle && (
          <p className="absolute bottom-3 left-1/2 max-w-[70%] -translate-x-1/2 rounded-lg bg-black/70 px-4 py-2 text-center text-lg">
            {subtitle}
          </p>
        )}

        {/* Partner left overlay */}
        {(partnerLeft || callError) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/80">
            <p className="text-xl">
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
        {/* Audio mode */}
        <div className="rounded-2xl bg-zinc-900 p-3">
          <p className="mb-2 text-xs uppercase tracking-wide text-zinc-500">
            Partner audio · you hear {languageLabel(myLanguage)}
          </p>
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
