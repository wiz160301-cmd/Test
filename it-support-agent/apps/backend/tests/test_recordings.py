import hashlib

from app.core.audit import audit_log


def test_upload_chunk_returns_checksum_and_appends_audit_entry(client, tmp_path, monkeypatch):
    from app.routers import recordings

    monkeypatch.setattr(recordings, "RECORDINGS_DIR", tmp_path)

    res = client.post("/api/sessions", json={})
    session_id = res.json()["id"]

    content = b"fake-webm-bytes"
    res = client.post(
        f"/api/recordings/{session_id}/chunk",
        params={"chunk_index": 0},
        files={"file": ("0.webm", content, "video/webm")},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["chunk_index"] == 0
    assert body["sha256"] == hashlib.sha256(content).hexdigest()

    entries = audit_log.entries_for_session(session_id)
    recording_entries = [e for e in entries if e.action == "screen_recording_chunk"]
    assert len(recording_entries) == 1
    assert recording_entries[0].details["sha256"] == body["sha256"]

    assert (tmp_path / session_id / "000000.webm").read_bytes() == content
