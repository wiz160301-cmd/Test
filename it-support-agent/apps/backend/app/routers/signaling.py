"""Relais de signaling WebRTC (SDP offer/answer, ICE candidates) entre le
client (app desktop) et le technicien (dashboard).

Aucun flux vidéo/input ne transite par ce serveur : une fois la connexion
WebRTC P2P établie (DTLS-SRTP), écran et événements d'entrée voyagent
directement entre les deux pairs. Ce endpoint ne fait que relayer les
messages de négociation, et refuse de le faire tant que la session n'est
pas ACTIVE (donc payée + consentement donné — voir `sessions.give_consent`).
"""

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session as DBSession

from app.core.audit import audit_log
from app.db.session import get_db
from app.models.remote_session import RemoteSession, SessionStatus

router = APIRouter()


class SignalingHub:
    def __init__(self) -> None:
        self._connections: dict[str, dict[str, WebSocket]] = {}

    async def connect(self, session_id: str, role: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections.setdefault(session_id, {})[role] = websocket

    def disconnect(self, session_id: str, role: str) -> None:
        peers = self._connections.get(session_id)
        if peers and role in peers:
            del peers[role]
            if not peers:
                del self._connections[session_id]

    async def relay(self, session_id: str, from_role: str, message: dict) -> None:
        peers = self._connections.get(session_id, {})
        to_role = "technician" if from_role == "client" else "client"
        peer = peers.get(to_role)
        if peer is not None:
            await peer.send_json(message)


hub = SignalingHub()


def _session_is_active(db: DBSession, session_id: str) -> bool:
    session = db.query(RemoteSession).filter(RemoteSession.id == session_id).first()
    return session is not None and session.status == SessionStatus.ACTIVE


@router.websocket("/ws/session/{session_id}")
async def signaling_endpoint(
    websocket: WebSocket, session_id: str, role: str, db: DBSession = Depends(get_db)
) -> None:
    if role not in ("client", "technician"):
        await websocket.close(code=4000, reason="role invalide")
        return

    if not _session_is_active(db, session_id):
        await websocket.close(code=4003, reason="session non active (consentement/paiement requis)")
        return

    await hub.connect(session_id, role, websocket)
    audit_log.append(
        session_id=session_id,
        actor=role,
        action="signaling_connected",
        details={},
    )

    try:
        while True:
            message = await websocket.receive_json()
            msg_type = message.get("type")

            if msg_type in ("offer", "answer", "ice-candidate"):
                await hub.relay(session_id, role, message)
            elif msg_type == "input-event":
                # Événement clavier/souris envoyé par le technicien ; relayé
                # au client qui l'injectera localement via `enigo` — jamais
                # exécuté côté serveur.
                await hub.relay(session_id, role, message)
                audit_log.append(
                    session_id=session_id,
                    actor=role,
                    action="input_event_relayed",
                    details={"kind": message.get("kind")},
                )
            elif msg_type == "chat":
                await hub.relay(session_id, role, message)
    except WebSocketDisconnect:
        pass
    finally:
        hub.disconnect(session_id, role)
        audit_log.append(
            session_id=session_id,
            actor=role,
            action="signaling_disconnected",
            details={},
        )
