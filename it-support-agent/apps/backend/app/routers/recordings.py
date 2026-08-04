"""Réception des chunks d'enregistrement vidéo de session (brief : "prise en
main à distance ... avec enregistrement de session pour audit").

Chaque chunk est stocké sur disque (répertoire local pour le prototype — à
remplacer par un stockage objet S3-compatible en production) et référencé
dans le journal d'audit hash-chaîné existant, de sorte que la vidéo
elle-même devient partie de la chaîne vérifiable : falsifier un chunk après
coup casse `verify_chain()` exactement comme falsifier une entrée d'action.
"""

import hashlib
from pathlib import Path

from fastapi import APIRouter, UploadFile

from app.core.audit import audit_log

router = APIRouter(prefix="/api/recordings", tags=["recordings"])

RECORDINGS_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "recordings"


@router.post("/{session_id}/chunk")
async def upload_chunk(session_id: str, chunk_index: int, file: UploadFile) -> dict:
    session_dir = RECORDINGS_DIR / session_id
    session_dir.mkdir(parents=True, exist_ok=True)

    content = await file.read()
    chunk_path = session_dir / f"{chunk_index:06d}.webm"
    chunk_path.write_bytes(content)

    checksum = hashlib.sha256(content).hexdigest()

    audit_log.append(
        session_id=session_id,
        actor="system",
        action="screen_recording_chunk",
        details={"chunk_index": chunk_index, "size_bytes": len(content), "sha256": checksum},
    )

    return {"chunk_index": chunk_index, "sha256": checksum}
