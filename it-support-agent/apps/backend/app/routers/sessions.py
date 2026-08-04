from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session as DBSession

from app.core.audit import audit_log
from app.core.billing import session_is_paid
from app.db.session import get_db
from app.models.remote_session import RemoteSession, SessionStatus

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


class CreateSessionRequest(BaseModel):
    client_user_id: str | None = None


class SessionOut(BaseModel):
    id: str
    status: SessionStatus
    consent_given: bool
    technician_user_id: str | None
    paid: bool

    class Config:
        from_attributes = True


def _to_out(db: DBSession, session: RemoteSession) -> SessionOut:
    return SessionOut(
        id=session.id,
        status=session.status,
        consent_given=session.consent_given,
        technician_user_id=session.technician_user_id,
        paid=session_is_paid(db, session.id),
    )


@router.post("", response_model=SessionOut)
def create_session(request: CreateSessionRequest, db: DBSession = Depends(get_db)) -> SessionOut:
    session = RemoteSession(client_user_id=request.client_user_id)
    db.add(session)
    db.commit()
    db.refresh(session)

    audit_log.append(
        session_id=session.id, actor="user", action="session_created", details={}
    )
    return _to_out(db, session)


@router.get("/pending", response_model=list[SessionOut])
def list_pending_sessions(db: DBSession = Depends(get_db)) -> list[SessionOut]:
    """Dashboard technicien : sessions en attente de prise en charge."""
    sessions = db.query(RemoteSession).filter(RemoteSession.status == SessionStatus.PENDING).all()
    return [_to_out(db, s) for s in sessions]


@router.get("/active", response_model=list[SessionOut])
def list_active_sessions(technician_user_id: str, db: DBSession = Depends(get_db)) -> list[SessionOut]:
    """Dashboard technicien : supervision multi-session (brief MVP #6)."""
    sessions = (
        db.query(RemoteSession)
        .filter(
            RemoteSession.status == SessionStatus.ACTIVE,
            RemoteSession.technician_user_id == technician_user_id,
        )
        .all()
    )
    return [_to_out(db, s) for s in sessions]


@router.get("/{session_id}", response_model=SessionOut)
def get_session(session_id: str, db: DBSession = Depends(get_db)) -> SessionOut:
    session = db.query(RemoteSession).filter(RemoteSession.id == session_id).first()
    if session is None:
        raise HTTPException(status_code=404, detail="Session introuvable")
    return _to_out(db, session)


@router.post("/{session_id}/claim", response_model=SessionOut)
def claim_session(session_id: str, technician_user_id: str, db: DBSession = Depends(get_db)) -> SessionOut:
    session = db.query(RemoteSession).filter(RemoteSession.id == session_id).first()
    if session is None:
        raise HTTPException(status_code=404, detail="Session introuvable")
    if session.status != SessionStatus.PENDING or session.technician_user_id is not None:
        raise HTTPException(status_code=409, detail="Session déjà prise en charge ou terminée")

    session.technician_user_id = technician_user_id
    db.commit()
    db.refresh(session)

    audit_log.append(
        session_id=session.id,
        actor="technician",
        action="session_claimed",
        details={"technician_user_id": technician_user_id},
    )
    return _to_out(db, session)


@router.post("/{session_id}/consent", response_model=SessionOut)
def give_consent(session_id: str, db: DBSession = Depends(get_db)) -> SessionOut:
    """Le client donne son consentement explicite au remote control — condition
    nécessaire (mais pas suffisante : le paiement l'est aussi) pour activer
    la session (brief section 5 : consentement explicite affiché à l'écran)."""
    session = db.query(RemoteSession).filter(RemoteSession.id == session_id).first()
    if session is None:
        raise HTTPException(status_code=404, detail="Session introuvable")

    if not session_is_paid(db, session_id):
        raise HTTPException(status_code=402, detail="Intervention non payée pour cette session")

    session.consent_given = True
    session.status = SessionStatus.ACTIVE
    db.commit()
    db.refresh(session)

    audit_log.append(session_id=session.id, actor="user", action="remote_control_consent_given", details={})
    return _to_out(db, session)


@router.post("/{session_id}/end", response_model=SessionOut)
def end_session(session_id: str, actor: str = "user", db: DBSession = Depends(get_db)) -> SessionOut:
    from datetime import datetime, timezone

    session = db.query(RemoteSession).filter(RemoteSession.id == session_id).first()
    if session is None:
        raise HTTPException(status_code=404, detail="Session introuvable")

    session.status = SessionStatus.ENDED
    session.ended_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(session)

    audit_log.append(session_id=session.id, actor=actor, action="session_ended", details={})
    return _to_out(db, session)
