from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.audit import audit_log
from app.core.guardrails import SCRIPT_CATALOG, evaluate

router = APIRouter(prefix="/api/scripts", tags=["scripts"])


class ScriptEvaluateRequest(BaseModel):
    session_id: str
    script_id: str
    user_confirmed: bool = False
    actor: str = "user"


class ScriptEvaluateResponse(BaseModel):
    allowed: bool
    requires_confirmation: bool
    reason: str


@router.get("/catalog")
def get_catalog() -> dict:
    """Catalogue whitelist consultable par le client avant d'afficher une action."""
    return {
        script_id: {
            "category": definition.category.value,
            "risk_level": definition.risk_level.value,
            "reversible": definition.reversible,
            "auto_approved": definition.auto_approved,
        }
        for script_id, definition in SCRIPT_CATALOG.items()
    }


@router.post("/evaluate", response_model=ScriptEvaluateResponse)
def evaluate_script(request: ScriptEvaluateRequest) -> ScriptEvaluateResponse:
    """Point de passage obligé avant toute exécution côté desktop.

    Le client Tauri appelle ce endpoint puis rejoue localement la même
    évaluation (défense en profondeur) avant d'exécuter quoi que ce soit.
    Chaque évaluation, approuvée ou refusée, est journalisée.
    """
    decision = evaluate(request.script_id, user_confirmed=request.user_confirmed)

    audit_log.append(
        session_id=request.session_id,
        actor=request.actor,
        action="script_evaluation",
        details={
            "script_id": request.script_id,
            "user_confirmed": request.user_confirmed,
            "allowed": decision.allowed,
            "reason": decision.reason,
        },
    )

    if not decision.allowed:
        raise HTTPException(
            status_code=403,
            detail={
                "requires_confirmation": decision.requires_confirmation,
                "reason": decision.reason,
            },
        )

    return ScriptEvaluateResponse(
        allowed=decision.allowed,
        requires_confirmation=decision.requires_confirmation,
        reason=decision.reason,
    )
