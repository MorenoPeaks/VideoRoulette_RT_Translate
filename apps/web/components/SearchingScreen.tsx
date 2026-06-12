"use client";

import { useEffect, useRef } from "react";

/**
 * Shown while waiting for a match: the user's own camera fills the screen
 * (like in a call) with a searching indicator on top, so the app never sits
 * on an empty page. The preview stream is local only — nothing is
 * transmitted until a partner is found and the call starts.
 */
export default function SearchingScreen({ onCancel }: { onCancel: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let disposed = false;
    navigator.mediaDevices
      .getUserMedia({ video: true })
      .then((s) => {
        if (disposed) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        if (videoRef.current) videoRef.current.srcObject = s;
      })
      .catch(() => {
        // No camera yet (or permission pending): the spinner alone is fine.
      });
    return () => {
      disposed = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="relative min-h-screen p-3">
      <div className="relative h-[calc(100vh-1.5rem)] overflow-hidden rounded-2xl bg-zinc-900">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="h-full w-full -scale-x-100 object-cover"
        />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 bg-black/50">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent" />
          <p className="text-lg text-zinc-100">Looking for someone to talk to…</p>
          <button
            onClick={onCancel}
            className="rounded-lg border border-zinc-500 bg-black/40 px-4 py-2 text-sm hover:bg-zinc-800"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
