import pytest

from app.core.guardrails import SCRIPT_CATALOG, ScriptDefinition, evaluate, RiskLevel, ScriptCategory


def test_unknown_script_is_refused_by_default():
    decision = evaluate("some_made_up_script", user_confirmed=True)
    assert decision.allowed is False
    assert decision.requires_confirmation is True


def test_auto_approved_script_runs_without_confirmation():
    decision = evaluate("clear_temp_cache", user_confirmed=False)
    assert decision.allowed is True
    assert decision.requires_confirmation is False


def test_moderate_risk_script_blocked_without_confirmation():
    decision = evaluate("restart_network_adapter", user_confirmed=False)
    assert decision.allowed is False
    assert decision.requires_confirmation is True


def test_moderate_risk_script_allowed_with_confirmation():
    decision = evaluate("restart_network_adapter", user_confirmed=True)
    assert decision.allowed is True
    assert decision.requires_confirmation is True


def test_destructive_script_always_blocked_without_confirmation():
    for script_id, definition in SCRIPT_CATALOG.items():
        if definition.risk_level == RiskLevel.DESTRUCTIVE:
            decision = evaluate(script_id, user_confirmed=False)
            assert decision.allowed is False, script_id


def test_destructive_script_never_auto_approved():
    for definition in SCRIPT_CATALOG.values():
        if definition.risk_level == RiskLevel.DESTRUCTIVE:
            assert definition.auto_approved is False


def test_non_reversible_action_cannot_be_marked_auto_approved():
    """Garde-fou de configuration : même une erreur d'écriture dans le
    catalogue ne doit jamais laisser passer une action irréversible sans
    confirmation."""
    bad_definition = ScriptDefinition(
        id="bad_config_example",
        category=ScriptCategory.REGISTRY_EDIT,
        risk_level=RiskLevel.SAFE,
        reversible=False,
        auto_approved=True,
    )
    SCRIPT_CATALOG["bad_config_example"] = bad_definition
    try:
        with pytest.raises(ValueError):
            evaluate("bad_config_example", user_confirmed=False)
    finally:
        del SCRIPT_CATALOG["bad_config_example"]


def test_full_catalog_has_no_auto_approved_non_reversible_entries():
    for script_id, definition in SCRIPT_CATALOG.items():
        if definition.auto_approved:
            assert definition.reversible, f"{script_id} viole la règle non négociable"
