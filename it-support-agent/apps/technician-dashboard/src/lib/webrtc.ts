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

/**
 * Côté technicien : initie la connexion WebRTC (offer), reçoit le flux vidéo
 * de l'écran du client et envoie les événements clavier/souris via le
 * DataChannel "input". Symétrique de `apps/desktop/src/lib/webrtc.ts`.
 */
export class RemoteControlViewer {
  private pc: RTCPeerConnection | null = null;
  private ws: WebSocket | null = null;
  private inputChannel: RTCDataChannel | null = null;
  private sessionId: string;

  public onTrack: (stream: MediaStream) => void = () => {};
  public onConnectionStateChange: (state: RTCPeerConnectionState) => void = () => {};

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  async connect(): Promise<void> {
    const iceServers = await fetchIceServers();
    this.pc = new RTCPeerConnection({ iceServers });

    this.pc.ontrack = (event) => {
      this.onTrack(event.streams[0]);
    };

    this.pc.onconnectionstatechange = () => {
      if (this.pc) this.onConnectionStateChange(this.pc.connectionState);
    };

    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.send({ type: "ice-candidate", candidate: event.candidate });
      }
    };

    this.pc.addTransceiver("video", { direction: "recvonly" });
    this.inputChannel = this.pc.createDataChannel("input");

    this.ws = new WebSocket(`${WS_URL}/ws/session/${this.sessionId}?role=technician`);

    await new Promise<void>((resolve, reject) => {
      if (!this.ws) return reject(new Error("no websocket"));
      this.ws.onopen = () => resolve();
      this.ws.onerror = () => reject(new Error("websocket connection failed"));
    });

    this.ws.onmessage = async (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "answer") {
        await this.pc?.setRemoteDescription(message.sdp);
      } else if (message.type === "ice-candidate") {
        await this.pc?.addIceCandidate(message.candidate);
      }
    };

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    this.send({ type: "offer", sdp: offer });
  }

  sendMouseMove(x: number, y: number): void {
    this.sendInputEvent({ type: "input-event", kind: "mouse-move", x, y });
  }

  sendMouseClick(button: "left" | "right" | "middle"): void {
    this.sendInputEvent({ type: "input-event", kind: "mouse-click", button });
  }

  sendKey(key: string): void {
    this.sendInputEvent({ type: "input-event", kind: "key", key });
  }

  private sendInputEvent(payload: object): void {
    // Envoyé directement via le DataChannel P2P (plus rapide que de
    // repasser par le WebSocket de signaling, qui ne relaie que la
    // négociation) une fois la connexion établie.
    if (this.inputChannel?.readyState === "open") {
      this.inputChannel.send(JSON.stringify(payload));
    }
  }

  private send(message: object): void {
    this.ws?.send(JSON.stringify(message));
  }

  disconnect(): void {
    this.pc?.close();
    this.ws?.close();
  }
}
