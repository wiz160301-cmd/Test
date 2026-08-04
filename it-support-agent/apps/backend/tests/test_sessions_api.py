from app.models.payment import Payment, PaymentStatus
from app.models.remote_session import RemoteSession


def test_create_session_starts_pending_and_unpaid(client):
    res = client.post("/api/sessions", json={})
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "pending"
    assert body["paid"] is False
    assert body["consent_given"] is False


def test_consent_requires_payment(client):
    res = client.post("/api/sessions", json={})
    session_id = res.json()["id"]

    res = client.post(f"/api/sessions/{session_id}/consent")
    assert res.status_code == 402


def test_consent_succeeds_once_paid(client, db_session):
    res = client.post("/api/sessions", json={})
    session_id = res.json()["id"]

    db_session.add(Payment(session_id=session_id, amount_cents=4900, status=PaymentStatus.PAID))
    db_session.commit()

    res = client.post(f"/api/sessions/{session_id}/consent")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "active"
    assert body["consent_given"] is True


def test_claim_pending_session(client):
    res = client.post("/api/sessions", json={})
    session_id = res.json()["id"]

    res = client.post(f"/api/sessions/{session_id}/claim", params={"technician_user_id": "tech-1"})
    assert res.status_code == 200
    assert res.json()["technician_user_id"] == "tech-1"


def test_cannot_claim_already_claimed_session(client):
    res = client.post("/api/sessions", json={})
    session_id = res.json()["id"]

    client.post(f"/api/sessions/{session_id}/claim", params={"technician_user_id": "tech-1"})
    res = client.post(f"/api/sessions/{session_id}/claim", params={"technician_user_id": "tech-2"})
    assert res.status_code == 409


def test_get_session_by_id(client):
    res = client.post("/api/sessions", json={})
    session_id = res.json()["id"]

    res = client.get(f"/api/sessions/{session_id}")
    assert res.status_code == 200
    assert res.json()["id"] == session_id


def test_get_unknown_session_returns_404(client):
    res = client.get("/api/sessions/does-not-exist")
    assert res.status_code == 404


def test_end_session(client):
    res = client.post("/api/sessions", json={})
    session_id = res.json()["id"]

    res = client.post(f"/api/sessions/{session_id}/end")
    assert res.status_code == 200
    assert res.json()["status"] == "ended"
