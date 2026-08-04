import pytest
from starlette.websockets import WebSocketDisconnect

from app.models.payment import Payment, PaymentStatus


def _make_active_session(client, db_session):
    res = client.post("/api/sessions", json={})
    session_id = res.json()["id"]
    db_session.add(Payment(session_id=session_id, amount_cents=4900, status=PaymentStatus.PAID))
    db_session.commit()
    client.post(f"/api/sessions/{session_id}/consent")
    return session_id


def test_pending_session_rejects_websocket(client):
    res = client.post("/api/sessions", json={})
    session_id = res.json()["id"]

    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(f"/ws/session/{session_id}?role=client"):
            pass


def test_invalid_role_rejected(client, db_session):
    session_id = _make_active_session(client, db_session)

    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(f"/ws/session/{session_id}?role=admin"):
            pass


def test_active_session_relays_offer_from_client_to_technician(client, db_session):
    session_id = _make_active_session(client, db_session)

    with client.websocket_connect(f"/ws/session/{session_id}?role=technician") as tech_ws:
        with client.websocket_connect(f"/ws/session/{session_id}?role=client") as client_ws:
            client_ws.send_json({"type": "offer", "sdp": "fake-sdp"})
            message = tech_ws.receive_json()
            assert message == {"type": "offer", "sdp": "fake-sdp"}


def test_input_event_relayed_technician_to_client(client, db_session):
    session_id = _make_active_session(client, db_session)

    with client.websocket_connect(f"/ws/session/{session_id}?role=client") as client_ws:
        with client.websocket_connect(f"/ws/session/{session_id}?role=technician") as tech_ws:
            tech_ws.send_json({"type": "input-event", "kind": "mouse-move", "x": 10, "y": 20})
            message = client_ws.receive_json()
            assert message["kind"] == "mouse-move"
