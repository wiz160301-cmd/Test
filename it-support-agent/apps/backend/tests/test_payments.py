import hashlib
import hmac
import json
import time

from app.core.config import settings
from app.models.payment import Payment, PaymentStatus


def _sign(payload: bytes, secret: str) -> str:
    """Reproduit le schéma de signature webhook Stripe (t=...,v1=...) sans
    dépendre d'un compte Stripe réel — c'est exactement ce que
    stripe.Webhook.construct_event vérifie côté serveur."""
    timestamp = str(int(time.time()))
    signed_payload = f"{timestamp}.{payload.decode()}"
    signature = hmac.new(secret.encode(), signed_payload.encode(), hashlib.sha256).hexdigest()
    return f"t={timestamp},v1={signature}"


def test_checkout_fails_without_stripe_configured(client):
    res = client.post("/api/sessions", json={})
    session_id = res.json()["id"]

    res = client.post("/api/payments/checkout", json={"session_id": session_id})
    assert res.status_code == 503


def test_webhook_fails_without_secret_configured(client):
    res = client.post("/api/payments/webhook", content=b"{}", headers={"stripe-signature": "t=1,v1=bad"})
    assert res.status_code == 503


def test_webhook_rejects_invalid_signature(client, monkeypatch):
    monkeypatch.setattr(settings, "stripe_webhook_secret", "whsec_test_secret")

    res = client.post(
        "/api/payments/webhook",
        content=b'{"type": "checkout.session.completed"}',
        headers={"stripe-signature": "t=1,v1=deadbeef"},
    )
    assert res.status_code == 400


def test_webhook_marks_payment_paid_on_valid_signature(client, db_session, monkeypatch):
    monkeypatch.setattr(settings, "stripe_webhook_secret", "whsec_test_secret")

    res = client.post("/api/sessions", json={})
    session_id = res.json()["id"]

    payment = Payment(
        session_id=session_id,
        stripe_checkout_session_id="cs_test_123",
        amount_cents=4900,
        status=PaymentStatus.PENDING,
    )
    db_session.add(payment)
    db_session.commit()

    event_payload = json.dumps(
        {
            "type": "checkout.session.completed",
            "data": {"object": {"id": "cs_test_123"}},
        }
    ).encode()

    signature = _sign(event_payload, "whsec_test_secret")

    res = client.post(
        "/api/payments/webhook",
        content=event_payload,
        headers={"stripe-signature": signature, "content-type": "application/json"},
    )
    assert res.status_code == 200

    db_session.refresh(payment)
    assert payment.status == PaymentStatus.PAID
