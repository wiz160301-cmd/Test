use crate::audit::AuditLogState;
use crate::guardrails::{evaluate, Decision};
use tauri::State;

/// Résultat d'une tentative d'exécution, distinct de la `Decision` de
/// garde-fous : `Decision` dit "est-ce permis", `ExecutionResult` dit
/// "qu'est-il arrivé quand on a essayé".
#[derive(serde::Serialize)]
pub struct ExecutionResult {
    pub decision: Decision,
    pub executed: bool,
    pub output: String,
}

/// Seules les actions SAFE + reversible du catalogue ont une implémentation
/// réelle dans ce prototype. Les actions à risque modéré/destructif
/// (redémarrage de service, édition de registre, désinstallation...)
/// nécessitent une implémentation spécifique par OS revue par un technicien
/// avant d'être branchées ici — volontairement non fait dans ce prototype
/// pour ne pas exposer d'exécution système non auditée.
fn run_safe_action(script_id: &str) -> String {
    match script_id {
        "clear_temp_cache" => {
            let dir = std::env::temp_dir();
            let mut cleared = 0u32;
            if let Ok(entries) = std::fs::read_dir(&dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    let result = if path.is_dir() {
                        std::fs::remove_dir_all(&path)
                    } else {
                        std::fs::remove_file(&path)
                    };
                    if result.is_ok() {
                        cleared += 1;
                    }
                }
            }
            format!("{} élément(s) supprimé(s) de {}", cleared, dir.display())
        }
        "flush_dns_cache" => {
            let result = if cfg!(target_os = "windows") {
                std::process::Command::new("ipconfig").arg("/flushdns").output()
            } else if cfg!(target_os = "macos") {
                std::process::Command::new("dscacheutil").arg("-flushcache").output()
            } else {
                std::process::Command::new("resolvectl").arg("flush-caches").output()
            };
            match result {
                Ok(output) => String::from_utf8_lossy(&output.stdout).to_string(),
                Err(e) => format!("Échec : {e}"),
            }
        }
        other => format!("Aucune implémentation réelle pour '{other}' dans ce prototype."),
    }
}

#[tauri::command]
pub fn evaluate_script(script_id: String, user_confirmed: bool) -> Decision {
    evaluate(&script_id, user_confirmed)
}

#[tauri::command]
pub fn execute_script(
    audit_state: State<AuditLogState>,
    session_id: String,
    actor: String,
    script_id: String,
    user_confirmed: bool,
) -> ExecutionResult {
    let decision = evaluate(&script_id, user_confirmed);

    let executed = decision.allowed;
    let output = if executed {
        run_safe_action(&script_id)
    } else {
        String::new()
    };

    audit_state.append(
        &session_id,
        &actor,
        "script_execution_attempt",
        serde_json::json!({
            "script_id": script_id,
            "user_confirmed": user_confirmed,
            "allowed": decision.allowed,
            "reason": decision.reason,
            "executed": executed,
        }),
    );

    ExecutionResult { decision, executed, output }
}
