use serde::Serialize;
use std::collections::HashMap;

/// Miroir Rust du catalogue de garde-fous côté backend (`app/core/guardrails.py`).
///
/// Défense en profondeur : le backend évalue déjà une requête de script via
/// `/api/scripts/evaluate`, mais c'est CE module, côté client, qui a le
/// dernier mot avant qu'une commande système ne soit réellement lancée. Un
/// backend compromis ou une réponse réseau altérée ne doit jamais suffire à
/// faire exécuter une action destructive sans confirmation locale.
#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
pub enum RiskLevel {
    Safe,
    Moderate,
    Destructive,
}

#[derive(Clone, Copy)]
pub struct ScriptDefinition {
    pub risk_level: RiskLevel,
    pub reversible: bool,
    pub auto_approved: bool,
}

pub fn catalog() -> HashMap<&'static str, ScriptDefinition> {
    let mut map = HashMap::new();
    map.insert(
        "clear_temp_cache",
        ScriptDefinition { risk_level: RiskLevel::Safe, reversible: true, auto_approved: true },
    );
    map.insert(
        "flush_dns_cache",
        ScriptDefinition { risk_level: RiskLevel::Safe, reversible: true, auto_approved: true },
    );
    map.insert(
        "restart_network_adapter",
        ScriptDefinition { risk_level: RiskLevel::Moderate, reversible: true, auto_approved: false },
    );
    map.insert(
        "restart_service",
        ScriptDefinition { risk_level: RiskLevel::Moderate, reversible: true, auto_approved: false },
    );
    map.insert(
        "update_driver",
        ScriptDefinition { risk_level: RiskLevel::Moderate, reversible: false, auto_approved: false },
    );
    map.insert(
        "edit_registry_key",
        ScriptDefinition { risk_level: RiskLevel::Destructive, reversible: false, auto_approved: false },
    );
    map.insert(
        "uninstall_software",
        ScriptDefinition { risk_level: RiskLevel::Destructive, reversible: false, auto_approved: false },
    );
    map
}

#[derive(Serialize)]
pub struct Decision {
    pub allowed: bool,
    pub requires_confirmation: bool,
    pub reason: String,
    pub risk_level: Option<RiskLevel>,
    pub reversible: Option<bool>,
}

pub fn evaluate(script_id: &str, user_confirmed: bool) -> Decision {
    let catalog = catalog();
    let Some(definition) = catalog.get(script_id) else {
        return Decision {
            allowed: false,
            requires_confirmation: true,
            reason: "Script inconnu — absent de la whitelist locale, refusé par défaut.".into(),
            risk_level: None,
            reversible: None,
        };
    };

    // Même garde-fou défensif que côté Python : une action non réversible ne
    // peut jamais être auto-approuvée, quelle que soit la config.
    if definition.auto_approved && !definition.reversible {
        return Decision {
            allowed: false,
            requires_confirmation: true,
            reason: "Configuration invalide détectée localement : action non réversible marquée auto-approuvée. Exécution bloquée.".into(),
            risk_level: Some(definition.risk_level),
            reversible: Some(definition.reversible),
        };
    }

    if definition.auto_approved {
        return Decision {
            allowed: true,
            requires_confirmation: false,
            reason: "Action non destructive et réversible — auto-approuvée.".into(),
            risk_level: Some(definition.risk_level),
            reversible: Some(definition.reversible),
        };
    }

    if user_confirmed {
        return Decision {
            allowed: true,
            requires_confirmation: true,
            reason: "Confirmation utilisateur explicite reçue localement.".into(),
            risk_level: Some(definition.risk_level),
            reversible: Some(definition.reversible),
        };
    }

    Decision {
        allowed: false,
        requires_confirmation: true,
        reason: "Confirmation utilisateur requise avant exécution.".into(),
        risk_level: Some(definition.risk_level),
        reversible: Some(definition.reversible),
    }
}
