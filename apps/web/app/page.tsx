"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import Lobby from "@/components/Lobby";
import CallScreen from "@/components/CallScreen";
import SearchingScreen from "@/components/SearchingScreen";
import { SERVER_URL } from "@/lib/config";
import type { MatchFoundPayload } from "@/lib/types";

type Stage =
  | { name: "lobby" }
  | { name: "searching" }
  | { name: "call"; match: MatchFoundPayload };

export default function Home() {
  const socketRef = useRef<Socket | null>(null);
  const [stage, setStage] = useState<Stage>({ name: "lobby" });
  const [profile, setProfile] = useState<{ nickname: string; language: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const socket = io(SERVER_URL);
    socketRef.current = socket;

    socket.on("match:found", (match: MatchFoundPayload) => {
      setError(null);
      setStage({ name: "call", match });
    });
    socket.on("queue:error", (data: { error?: string }) => {
      setError(data?.error ?? "Something went wrong");
      setStage({ name: "lobby" });
    });
    socket.on("connect_error", () => {
      setError("Cannot reach the server. Is it running?");
    });
    socket.on("connect", () => setError(null));

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  const startSearch = useCallback((nickname: string, language: string) => {
    setProfile({ nickname, language });
    setError(null);
    setStage({ name: "searching" });
    socketRef.current?.emit("queue:join", { nickname, language });
  }, []);

  const cancelSearch = useCallback(() => {
    socketRef.current?.emit("queue:leave");
    setStage({ name: "lobby" });
  }, []);

  // "Next": a single queue:join is enough — the server leaves the current
  // match (notifying the partner) before re-queueing us.
  const nextPartner = useCallback(() => {
    if (!profile) return;
    setStage({ name: "searching" });
    socketRef.current?.emit("queue:join", profile);
  }, [profile]);

  const hangUp = useCallback(() => {
    socketRef.current?.emit("match:leave");
    setStage({ name: "lobby" });
  }, []);

  return (
    <main className="min-h-screen">
      {stage.name === "lobby" && (
        <Lobby onStart={startSearch} error={error} initialProfile={profile} />
      )}

      {stage.name === "searching" && <SearchingScreen onCancel={cancelSearch} />}

      {stage.name === "call" && profile && socketRef.current && (
        <CallScreen
          key={stage.match.roomName}
          match={stage.match}
          myLanguage={profile.language}
          socket={socketRef.current}
          onNext={nextPartner}
          onHangUp={hangUp}
        />
      )}
    </main>
  );
}
