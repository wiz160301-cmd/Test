from app.core.audit import AuditLog


def test_chain_valid_after_appends():
    log = AuditLog()
    log.append(session_id="s1", actor="ai", action="diagnose", details={"note": "cpu ok"})
    log.append(session_id="s1", actor="user", action="confirm", details={"script_id": "clear_temp_cache"})
    assert log.verify_chain() is True


def test_tampering_breaks_chain():
    log = AuditLog()
    log.append(session_id="s1", actor="ai", action="diagnose", details={"note": "cpu ok"})
    log.append(session_id="s1", actor="user", action="confirm", details={"script_id": "clear_temp_cache"})

    # Simule une altération a posteriori d'une entrée (ne devrait jamais
    # arriver en prod grâce aux permissions append-only côté DB, mais on
    # vérifie que la détection fonctionne si ça arrivait).
    log._entries[0].details["note"] = "tampered"  # type: ignore[attr-defined]

    assert log.verify_chain() is False


def test_entries_scoped_to_session():
    log = AuditLog()
    log.append(session_id="s1", actor="ai", action="diagnose", details={})
    log.append(session_id="s2", actor="ai", action="diagnose", details={})

    assert len(log.entries_for_session("s1")) == 1
    assert len(log.entries_for_session("s2")) == 1
