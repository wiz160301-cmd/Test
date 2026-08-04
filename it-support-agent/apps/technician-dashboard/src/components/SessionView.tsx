import { useEffect, useRef, useState } from "react";
import { RemoteControlViewer } from "../lib/webrtc";
import { endSession } from "../lib/api";
import { AuditLogViewer } from "./AuditLogViewer";

interface Props {
  sessionId: string;
  onClose: () => void;
}

type ConnectionState = "waiting_for_consent" | "connecting" | "connected" | "disconnected";

/**
 * Vue de session pour le technicien : réception vidéo + capture des
 * événements clavier/souris sur l'élément vidéo, relayés via le DataChannel
 * WebRTC. La connexion est retentée automatiquement tant que le client n'a
 * pas encore donné son consentement (le serveur de signaling refuse la
 * connexion tant que la session n'est pas ACTIVE, voir signaling.py).
 */
export function SessionView({ sessionId, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const viewerRef = useRef<RemoteControlViewer | null>(null);
  const [state, setState] = useState<ConnectionState>("waiting_for_consent");

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout>;

    async function attemptConnect() {
      if (cancelled) return;
      setState("connecting");
      const viewer = new RemoteControlViewer(sessionId);
      viewer.onTrack = (stream) => {
        if (videoRef.current) videoRef.current.srcObject = stream;
      };
      viewer.onConnectionStateChange = (pcState) => {
        if (pcState === "connected") setState("connected");
        if (pcState === "disconnected" || pcState === "failed" || pcState === "closed") {
          setState("disconnected");
        }
      };

      try {
        await viewer.connect();
        viewerRef.current = viewer;
      } catch {
        if (!cancelled) {
          setState("waiting_for_consent");
          retryTimer = setTimeout(attemptConnect, 3000);
        }
      }
    }

    attemptConnect();

    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      viewerRef.current?.disconnect();
    };
  }, [sessionId]);

  function handleVideoMouseMove(e: React.MouseEvent<HTMLVideoElement>) {
    const video = e.currentTarget;
    if (!video.videoWidth || !video.videoHeight) return;
    const rect = video.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * video.videoWidth);
    const y = Math.round(((e.clientY - rect.top) / rect.height) * video.videoHeight);
    viewerRef.current?.sendMouseMove(x, y);
  }

  function handleVideoClick(e: React.MouseEvent<HTMLVideoElement>) {
    const button = e.button === 2 ? "right" : e.button === 1 ? "middle" : "left";
    viewerRef.current?.sendMouseClick(button);
  }

  async function handleEndSession() {
    await endSession(sessionId);
    onClose();
  }

  return (
    <div className="session-view">
      <div className="session-view__header">
        <span>Session {sessionId.slice(0, 8)}</span>
        <span className={`session-view__status session-view__status--${state}`}>{state}</span>
        <button type="button" onClick={handleEndSession}>
          Terminer la session
        </button>
        <button type="button" onClick={onClose}>
          Retour
        </button>
      </div>

      <div className="session-view__body">
        {/* tabIndex requis pour que l'élément vidéo reçoive le focus clavier */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          tabIndex={0}
          onMouseMove={handleVideoMouseMove}
          onClick={handleVideoClick}
          onKeyDown={(e) => {
            e.preventDefault();
            viewerRef.current?.sendKey(e.key);
          }}
        />
        <AuditLogViewer sessionId={sessionId} />
      </div>
    </div>
  );
}
