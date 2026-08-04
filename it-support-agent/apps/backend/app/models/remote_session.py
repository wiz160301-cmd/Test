import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Enum, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class SessionStatus(str, enum.Enum):
    PENDING = "pending"  # créée, en attente de connexion technicien/client
    ACTIVE = "active"  # remote control en cours, consentement donné
    ENDED = "ended"


class RemoteSession(Base):
    """Session de support : diagnostic + (optionnel) remote control.

    Le même `id` sert d'identifiant WebRTC (signaling), de clé de
    corrélation pour l'audit log, et de référence pour le paiement associé.
    """

    __tablename__ = "remote_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    client_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    technician_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    status: Mapped[SessionStatus] = mapped_column(Enum(SessionStatus), default=SessionStatus.PENDING)
    consent_given: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
