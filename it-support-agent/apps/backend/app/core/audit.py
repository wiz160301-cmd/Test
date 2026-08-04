"""Audit log horodaté et non modifiable (brief section 5).

Chaque entrée référence le hash de l'entrée précédente (chaînage type
blockchain simplifié) : toute modification ou suppression a posteriori d'une
entrée casse la chaîne et est détectable par `verify_chain`.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone

GENESIS_HASH = "0" * 64


@dataclass(frozen=True)
class AuditEntry:
    session_id: str
    actor: str  # "ai" | "technician" | "user"
    action: str
    details: dict
    timestamp: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    prev_hash: str = GENESIS_HASH
    entry_hash: str = ""

    def compute_hash(self) -> str:
        payload = {
            "session_id": self.session_id,
            "actor": self.actor,
            "action": self.action,
            "details": self.details,
            "timestamp": self.timestamp,
            "prev_hash": self.prev_hash,
        }
        digest = hashlib.sha256(
            json.dumps(payload, sort_keys=True, default=str).encode("utf-8")
        )
        return digest.hexdigest()


class AuditLog:
    """Journal en mémoire pour le prototype.

    En production, `entries` est backé par une table PostgreSQL en append-only
    (INSERT uniquement, aucun UPDATE/DELETE autorisé au niveau des permissions
    DB), avec le même schéma de chaînage de hash.
    """

    def __init__(self) -> None:
        self._entries: list[AuditEntry] = []

    def append(self, *, session_id: str, actor: str, action: str, details: dict) -> AuditEntry:
        prev_hash = self._entries[-1].entry_hash if self._entries else GENESIS_HASH
        entry = AuditEntry(
            session_id=session_id,
            actor=actor,
            action=action,
            details=details,
            prev_hash=prev_hash,
        )
        entry = AuditEntry(**{**asdict(entry), "entry_hash": entry.compute_hash()})
        self._entries.append(entry)
        return entry

    def entries_for_session(self, session_id: str) -> list[AuditEntry]:
        return [e for e in self._entries if e.session_id == session_id]

    def verify_chain(self) -> bool:
        """Retourne False si une entrée a été altérée ou retirée de la chaîne."""
        prev_hash = GENESIS_HASH
        for entry in self._entries:
            if entry.prev_hash != prev_hash:
                return False
            recomputed = entry.compute_hash()
            if recomputed != entry.entry_hash:
                return False
            prev_hash = entry.entry_hash
        return True


audit_log = AuditLog()
