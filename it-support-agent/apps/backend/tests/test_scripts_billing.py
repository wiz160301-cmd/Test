from app.models.payment import Payment, PaymentStatus


def test_free_auto_approved_script_does_not_require_payment(client):
    res = client.post("/api/sessions", json={})
    session_id = res.json()["id"]

    res = client.post(
        "/api/scripts/evaluate",
        json={"session_id": session_id, "script_id": "clear_temp_cache", "user_confirmed": False},
    )
    assert res.status_code == 200


def test_moderate_script_requires_payment_before_confirmation_flow(client):
    res = client.post("/api/sessions", json={})
    session_id = res.json()["id"]

    res = client.post(
        "/api/scripts/evaluate",
        json={"session_id": session_id, "script_id": "restart_network_adapter", "user_confirmed": True},
    )
    assert res.status_code == 402


def test_moderate_script_allowed_after_payment_and_confirmation(client, db_session):
    res = client.post("/api/sessions", json={})
    session_id = res.json()["id"]

    db_session.add(Payment(session_id=session_id, amount_cents=4900, status=PaymentStatus.PAID))
    db_session.commit()

    res = client.post(
        "/api/scripts/evaluate",
        json={"session_id": session_id, "script_id": "restart_network_adapter", "user_confirmed": True},
    )
    assert res.status_code == 200
