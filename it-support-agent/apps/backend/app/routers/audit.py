from dataclasses import asdict

from fastapi import APIRouter

from app.core.audit import audit_log

router = APIRouter(prefix="/api/audit", tags=["audit"])


@router.get("/{session_id}")
def get_session_audit(session_id: str) -> dict:
    entries = audit_log.entries_for_session(session_id)
    return {
        "session_id": session_id,
        "entries": [asdict(e) for e in entries],
        "chain_valid": audit_log.verify_chain(),
    }
