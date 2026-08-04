"""Moteur de garde-fous pour les scripts de remédiation.

Règle non négociable (brief section 5) : toute action qui modifie le système
exige une confirmation utilisateur explicite, sauf pour un très petit nombre
d'actions non destructives et réversibles inscrites sur la whitelist
`AUTO_APPROVED`. Rien n'est jamais exécuté "à l'insu" de l'utilisateur : même
les actions auto-approuvées sont journalisées et affichées dans le bandeau de
session actif.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class RiskLevel(str, Enum):
    SAFE = "safe"
    MODERATE = "moderate"
    DESTRUCTIVE = "destructive"


class ScriptCategory(str, Enum):
    CACHE_CLEANUP = "cache_cleanup"
    NETWORK_REPAIR = "network_repair"
    DRIVER_UPDATE = "driver_update"
    REGISTRY_EDIT = "registry_edit"
    SOFTWARE_UNINSTALL = "software_uninstall"
    SERVICE_RESTART = "service_restart"


@dataclass(frozen=True)
class ScriptDefinition:
    id: str
    category: ScriptCategory
    risk_level: RiskLevel
    reversible: bool
    # Seules les actions SAFE + reversible peuvent être auto-approuvées.
    # Tout le reste requiert TOUJOURS une confirmation explicite, quel que
    # soit ce que l'appelant demande.
    auto_approved: bool


# Whitelist des scripts connus du système. Toute action absente de ce
# catalogue est traitée comme DESTRUCTIVE par défaut (fail closed).
SCRIPT_CATALOG: dict[str, ScriptDefinition] = {
    "clear_temp_cache": ScriptDefinition(
        id="clear_temp_cache",
        category=ScriptCategory.CACHE_CLEANUP,
        risk_level=RiskLevel.SAFE,
        reversible=True,
        auto_approved=True,
    ),
    "flush_dns_cache": ScriptDefinition(
        id="flush_dns_cache",
        category=ScriptCategory.NETWORK_REPAIR,
        risk_level=RiskLevel.SAFE,
        reversible=True,
        auto_approved=True,
    ),
    "restart_network_adapter": ScriptDefinition(
        id="restart_network_adapter",
        category=ScriptCategory.NETWORK_REPAIR,
        risk_level=RiskLevel.MODERATE,
        reversible=True,
        auto_approved=False,
    ),
    "restart_service": ScriptDefinition(
        id="restart_service",
        category=ScriptCategory.SERVICE_RESTART,
        risk_level=RiskLevel.MODERATE,
        reversible=True,
        auto_approved=False,
    ),
    "update_driver": ScriptDefinition(
        id="update_driver",
        category=ScriptCategory.DRIVER_UPDATE,
        risk_level=RiskLevel.MODERATE,
        reversible=False,
        auto_approved=False,
    ),
    "edit_registry_key": ScriptDefinition(
        id="edit_registry_key",
        category=ScriptCategory.REGISTRY_EDIT,
        risk_level=RiskLevel.DESTRUCTIVE,
        reversible=False,
        auto_approved=False,
    ),
    "uninstall_software": ScriptDefinition(
        id="uninstall_software",
        category=ScriptCategory.SOFTWARE_UNINSTALL,
        risk_level=RiskLevel.DESTRUCTIVE,
        reversible=False,
        auto_approved=False,
    ),
}


@dataclass(frozen=True)
class Decision:
    script_id: str
    allowed: bool
    requires_confirmation: bool
    reason: str


def evaluate(script_id: str, *, user_confirmed: bool) -> Decision:
    """Décide si un script peut s'exécuter.

    Fail closed : un script inconnu est toujours refusé, jamais auto-approuvé
    par défaut.
    """
    definition = SCRIPT_CATALOG.get(script_id)

    if definition is None:
        return Decision(
            script_id=script_id,
            allowed=False,
            requires_confirmation=True,
            reason="Script inconnu — absent de la whitelist, refusé par défaut.",
        )

    if definition.auto_approved and not definition.reversible:
        # Garde-fou défensif : une action non réversible ne peut jamais être
        # marquée auto_approved, même par erreur de configuration du catalogue.
        raise ValueError(
            f"Configuration invalide pour {script_id}: action non réversible "
            "ne peut pas être auto-approuvée."
        )

    if definition.auto_approved:
        return Decision(
            script_id=script_id,
            allowed=True,
            requires_confirmation=False,
            reason="Action non destructive et réversible — auto-approuvée.",
        )

    if user_confirmed:
        return Decision(
            script_id=script_id,
            allowed=True,
            requires_confirmation=True,
            reason="Confirmation utilisateur explicite reçue.",
        )

    return Decision(
        script_id=script_id,
        allowed=False,
        requires_confirmation=True,
        reason=(
            f"Action de risque '{definition.risk_level.value}' — "
            "confirmation utilisateur requise avant exécution."
        ),
    )
