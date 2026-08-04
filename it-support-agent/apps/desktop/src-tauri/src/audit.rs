use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

const GENESIS_HASH: &str = "0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";

#[derive(Serialize, Deserialize, Clone)]
pub struct AuditEntry {
    pub session_id: String,
    pub actor: String,
    pub action: String,
    pub details: serde_json::Value,
    pub timestamp: String,
    pub prev_hash: String,
    pub entry_hash: String,
}

fn compute_hash(
    session_id: &str,
    actor: &str,
    action: &str,
    details: &serde_json::Value,
    timestamp: &str,
    prev_hash: &str,
) -> String {
    let payload = serde_json::json!({
        "session_id": session_id,
        "actor": actor,
        "action": action,
        "details": details,
        "timestamp": timestamp,
        "prev_hash": prev_hash,
    });
    let mut hasher = Sha256::new();
    hasher.update(payload.to_string().as_bytes());
    format!("{:x}", hasher.finalize())
}

/// Journal d'audit local en append-only (un fichier JSONL par installation).
/// Chaque écriture est protégée par un mutex pour éviter toute course entre
/// commandes concurrentes ; le fichier n'est jamais ouvert en écriture
/// tronquante, uniquement en append.
pub struct AuditLogState {
    path: PathBuf,
    lock: Mutex<()>,
}

impl AuditLogState {
    pub fn new(app: &AppHandle) -> Self {
        let dir = app
            .path()
            .app_data_dir()
            .expect("app data dir should be resolvable");
        fs::create_dir_all(&dir).ok();
        Self { path: dir.join("audit_log.jsonl"), lock: Mutex::new(()) }
    }

    fn last_hash(&self) -> String {
        let Ok(file) = fs::File::open(&self.path) else {
            return GENESIS_HASH.to_string();
        };
        let reader = BufReader::new(file);
        let mut last = GENESIS_HASH.to_string();
        for line in reader.lines().map_while(Result::ok) {
            if let Ok(entry) = serde_json::from_str::<AuditEntry>(&line) {
                last = entry.entry_hash;
            }
        }
        last
    }

    pub fn append(
        &self,
        session_id: &str,
        actor: &str,
        action: &str,
        details: serde_json::Value,
    ) -> AuditEntry {
        let _guard = self.lock.lock().unwrap();
        let prev_hash = self.last_hash();
        let timestamp = Utc::now().to_rfc3339();
        let entry_hash = compute_hash(session_id, actor, action, &details, &timestamp, &prev_hash);

        let entry = AuditEntry {
            session_id: session_id.to_string(),
            actor: actor.to_string(),
            action: action.to_string(),
            details,
            timestamp,
            prev_hash,
            entry_hash,
        };

        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&self.path) {
            let _ = writeln!(file, "{}", serde_json::to_string(&entry).unwrap());
        }

        entry
    }
}

#[tauri::command]
pub fn append_audit_entry(
    app: AppHandle,
    state: tauri::State<AuditLogState>,
    session_id: String,
    actor: String,
    action: String,
    details: serde_json::Value,
) -> AuditEntry {
    let _ = &app;
    state.append(&session_id, &actor, &action, details)
}
