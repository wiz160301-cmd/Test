import stripe
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session as DBSession

from app.core.audit import audit_log
from app.core.config import settings
from app.db.session import get_db
from app.models.payment import Payment, PaymentStatus
from app.models.remote_session import RemoteSession

router = APIRouter(prefix="/api/payments", tags=["payments"])


class CreateCheckoutRequest(BaseModel):
    session_id: str


class CreateCheckoutResponse(BaseModel):
    checkout_url: str
    payment_id: str


@router.post("/checkout", response_model=CreateCheckoutResponse)
def create_checkout(request: CreateCheckoutRequest, db: DBSession = Depends(get_db)) -> CreateCheckoutResponse:
    """Crée une session de paiement Stripe pour l'intervention associée à une
    session de support (brief : freemium — diagnostic gratuit, intervention
    payante). Nécessite STRIPE_SECRET_KEY renseigné côté déploiement ; sans
    clé, échoue explicitement plutôt que de simuler un paiement réussi."""
    if not settings.stripe_secret_key:
        raise HTTPException(status_code=503, detail="Stripe non configuré (STRIPE_SECRET_KEY manquant)")

    remote_session = db.query(RemoteSession).filter(RemoteSession.id == request.session_id).first()
    if remote_session is None:
        raise HTTPException(status_code=404, detail="Session introuvable")

    stripe.api_key = settings.stripe_secret_key

    checkout_session = stripe.checkout.Session.create(
        mode="payment",
        line_items=[
            {
                "price_data": {
                    "currency": settings.intervention_currency,
                    "product_data": {"name": "Intervention support IT"},
                    "unit_amount": settings.intervention_price_cents,
                },
                "quantity": 1,
            }
        ],
        success_url=settings.frontend_success_url,
        cancel_url=settings.frontend_cancel_url,
        metadata={"session_id": request.session_id},
    )

    payment = Payment(
        session_id=request.session_id,
        stripe_checkout_session_id=checkout_session.id,
        amount_cents=settings.intervention_price_cents,
        currency=settings.intervention_currency,
        status=PaymentStatus.PENDING,
    )
    db.add(payment)
    db.commit()
    db.refresh(payment)

    audit_log.append(
        session_id=request.session_id,
        actor="user",
        action="checkout_created",
        details={"payment_id": payment.id, "amount_cents": payment.amount_cents},
    )

    return CreateCheckoutResponse(checkout_url=checkout_session.url, payment_id=payment.id)


@router.post("/webhook")
async def stripe_webhook(request: Request, db: DBSession = Depends(get_db)) -> dict:
    """Endpoint appelé par Stripe (jamais par le client). La vérification de
    signature est ce qui empêche quiconque de forger un paiement réussi sans
    passer par Stripe."""
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature", "")

    if not settings.stripe_webhook_secret:
        raise HTTPException(status_code=503, detail="Webhook Stripe non configuré")

    try:
        event = stripe.Webhook.construct_event(payload, sig_header, settings.stripe_webhook_secret)
    except (ValueError, stripe.SignatureVerificationError) as exc:
        raise HTTPException(status_code=400, detail=f"Webhook invalide: {exc}") from exc

    if event["type"] == "checkout.session.completed":
        checkout_session = event["data"]["object"]
        payment = (
            db.query(Payment)
            .filter(Payment.stripe_checkout_session_id == checkout_session["id"])
            .first()
        )
        if payment is not None:
            payment.status = PaymentStatus.PAID
            db.commit()
            audit_log.append(
                session_id=payment.session_id,
                actor="stripe",
                action="payment_confirmed",
                details={"payment_id": payment.id},
            )

    return {"received": True}
