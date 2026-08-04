"""Gating freemium (brief : diagnostic gratuit, intervention payante).

Le chat de diagnostic (`/api/chat`) reste toujours gratuit et n'appelle
jamais ce module. Tout ce qui modifie le système (remédiation à risque
modéré/destructif) ou lance un remote control réel exige un `Payment` au
statut PAID rattaché à la session — vérifié ici, jamais côté client.
"""

from sqlalchemy.orm import Session as DBSession

from app.core.config import settings
from app.models.payment import Payment, PaymentStatus


def session_is_paid(db: DBSession, session_id: str) -> bool:
    if not settings.freemium_enabled:
        return True

    payment = (
        db.query(Payment)
        .filter(Payment.session_id == session_id, Payment.status == PaymentStatus.PAID)
        .first()
    )
    return payment is not None
