from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session as DBSession

from app.core.audit import audit_log
from app.core.billing import session_is_paid
from app.core.guardrails import SCRIPT_CATALOG, evaluate
from app.db.session import get_db

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
def evaluate_script(
    request: ScriptEvaluateRequest, db: DBSession = Depends(get_db)
) -> ScriptEvaluateResponse:
    """Point de passage obligé avant toute exécution côté desktop.

    Le client Tauri appelle ce endpoint puis rejoue localement la même
    évaluation (défense en profondeur) avant d'exécuter quoi que ce soit.
    Chaque évaluation, approuvée ou refusée, est journalisée.

    Gating freemium : une action non auto-approuvée (remédiation = "intervention"
    au sens du brief) exige un paiement PAID rattaché à la session, en plus de
    la confirmation utilisateur. Le diagnostic et les actions SAFE
    auto-approuvées restent gratuits.
    """
    definition = SCRIPT_CATALOG.get(request.script_id)
    if definition is not None and not definition.auto_approved and not session_is_paid(db, request.session_id):
        audit_log.append(
            session_id=request.session_id,
            actor=request.actor,
            action="script_evaluation",
            details={
                "script_id": request.script_id,
                "allowed": False,
                "reason": "payment_required",
            },
        )
        raise HTTPException(
            status_code=402,
            detail={"requires_confirmation": True, "reason": "Intervention payante non réglée pour cette session."},
        )

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
