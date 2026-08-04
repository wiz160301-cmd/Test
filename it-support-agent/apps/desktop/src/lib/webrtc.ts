import { invoke } from "@tauri-apps/api/core";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? "http://localhost:8000";
const WS_URL = BACKEND_URL.replace(/^http/, "ws");

interface IceServersResponse {
  iceServers: RTCIceServer[];
}

async function fetchIceServers(): Promise<RTCIceServer[]> {
  const res = await fetch(`${BACKEND_URL}/api/webrtc/ice-servers`);
  if (!res.ok) return [];
  const body: IceServersResponse = await res.json();
  return body.iceServers;
}

interface InputEventMessage {
  type: "input-event";
  kind: "mouse-move" | "mouse-click" | "key";
  [key: string]: unknown;
}

/**
 * Côté desktop (client) : partage l'écran de l'utilisateur avec le
 * technicien et applique localement les événements d'entrée reçus via le
 * DataChannel, chacun passé par `enigo` côté Rust (garde-fou local, voir
 * `input_inject.rs`).
 *
 * Le flux vidéo lui-même est P2P chiffré (DTLS-SRTP, natif WebRTC) — il ne
 * transite jamais par le backend, qui ne relaie que la négociation SDP/ICE.
 */
export class RemoteControlClient {
  private pc: RTCPeerConnection | null = null;
  private ws: WebSocket | null = null;
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunkIndex = 0;
  private sessionId: string;
  public onStateChange: (state: "idle" | "connecting" | "streaming" | "ended") => void = () => {};

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  async start(): Promise<void> {
    this.onStateChange("connecting");

    const iceServers = await fetchIceServers();
    this.pc = new RTCPeerConnection({ iceServers });

    this.pc.ondatachannel = (event) => {
      if (event.channel.label === "input") {
        event.channel.onmessage = (msg) => this.handleInputEvent(msg.data);
      }
    };

    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.send({ type: "ice-candidate", candidate: event.candidate });
      }
    };

    this.ws = new WebSocket(`${WS_URL}/ws/session/${this.sessionId}?role=client`);

    this.ws.onmessage = async (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "offer") {
        await this.handleOffer(message);
      } else if (message.type === "ice-candidate") {
        await this.pc?.addIceCandidate(message.candidate);
      }
    };

    this.ws.onclose = () => {
      this.onStateChange("ended");
    };

    await invoke("set_remote_control_session", { sessionId: this.sessionId });
  }

  private async handleOffer(message: { sdp: RTCSessionDescriptionInit }): Promise<void> {
    if (!this.pc) return;

    this.stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    for (const track of this.stream.getTracks()) {
      this.pc.addTrack(track, this.stream);
    }

    await this.pc.setRemoteDescription(message.sdp);
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    this.send({ type: "answer", sdp: answer });

    this.startRecording(this.stream);
    this.onStateChange("streaming");
  }

  /**
   * Enregistre l'écran partagé par tranches de 10s et les envoie au backend
   * au fur et à mesure (brief : "enregistrement de session pour audit").
   * Chaque chunk devient une entrée de la chaîne d'audit hash-chaînée
   * (voir `app/routers/recordings.py`) — falsifier la vidéo après coup casse
   * la chaîne exactement comme falsifier une entrée d'action.
   */
  private startRecording(stream: MediaStream): void {
    if (typeof MediaRecorder === "undefined") return;

    this.recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8" });
    this.recorder.ondataavailable = async (event) => {
      if (event.data.size === 0) return;
      const chunkIndex = this.chunkIndex++;
      const formData = new FormData();
      formData.append("file", event.data, `${chunkIndex}.webm`);
      try {
        await fetch(`${BACKEND_URL}/api/recordings/${this.sessionId}/chunk?chunk_index=${chunkIndex}`, {
          method: "POST",
          body: formData,
        });
      } catch (err) {
        console.error("Failed to upload recording chunk:", err);
      }
    };
    this.recorder.start(10_000);
  }

  private async handleInputEvent(raw: string): Promise<void> {
    const message: InputEventMessage = JSON.parse(raw);

    try {
      if (message.kind === "mouse-move") {
        await invoke("inject_mouse_move", {
          sessionId: this.sessionId,
          event: { x: message.x, y: message.y },
        });
      } else if (message.kind === "mouse-click") {
        await invoke("inject_mouse_click", {
          sessionId: this.sessionId,
          event: { button: message.button },
        });
      } else if (message.kind === "key") {
        await invoke("inject_key_event", {
          sessionId: this.sessionId,
          event: { key: message.key },
        });
      }
    } catch (err) {
      console.error("Input injection refused:", err);
    }
  }

  private send(message: object): void {
    this.ws?.send(JSON.stringify(message));
  }

  async stop(): Promise<void> {
    if (this.recorder?.state === "recording") this.recorder.stop();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.pc?.close();
    this.ws?.close();
    await invoke("set_remote_control_session", { sessionId: null });
    this.onStateChange("idle");
  }
}
