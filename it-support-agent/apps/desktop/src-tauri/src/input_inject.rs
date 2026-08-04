use enigo::{Button, Coordinate, Enigo, Keyboard, Mouse, Settings};
use serde::Deserialize;
use std::sync::Mutex;
use tauri::State;

use crate::audit::AuditLogState;

/// État partagé qui n'autorise l'injection d'input QUE pour la session ayant
/// explicitement reçu le consentement (voir `sessions.give_consent` côté
/// backend, qui est le seul chemin qui fait passer une session en ACTIVE).
///
/// La connexion WebRTC elle-même est déjà protégée côté serveur : le
/// WebSocket de signaling refuse toute connexion tant que la session n'est
/// pas ACTIVE. Ce verrou local est une seconde barrière : même une commande
/// `inject_*` appelée par erreur (ou par un code compromis dans la webview)
/// pour un `session_id` qui ne correspond pas à la session active en cours
/// est bloquée et journalisée comme tentative refusée.
pub struct RemoteControlState {
    active_session_id: Mutex<Option<String>>,
}

impl Default for RemoteControlState {
    fn default() -> Self {
        Self { active_session_id: Mutex::new(None) }
    }
}

#[tauri::command]
pub fn set_remote_control_session(
    state: State<RemoteControlState>,
    audit_state: State<AuditLogState>,
    session_id: Option<String>,
) {
    let mut guard = state.active_session_id.lock().unwrap();
    *guard = session_id.clone();

    audit_state.append(
        session_id.as_deref().unwrap_or("none"),
        "user",
        "remote_control_local_state_changed",
        serde_json::json!({ "active": session_id.is_some() }),
    );
}

fn authorize(state: &State<RemoteControlState>, session_id: &str) -> bool {
    let guard = state.active_session_id.lock().unwrap();
    guard.as_deref() == Some(session_id)
}

#[derive(Deserialize)]
pub struct MouseMoveEvent {
    pub x: i32,
    pub y: i32,
}

#[derive(Deserialize)]
pub struct MouseClickEvent {
    pub button: String, // "left" | "right" | "middle"
}

#[derive(Deserialize)]
pub struct KeyEvent {
    pub key: String,
}

fn parse_button(button: &str) -> Button {
    match button {
        "right" => Button::Right,
        "middle" => Button::Middle,
        _ => Button::Left,
    }
}

#[tauri::command]
pub fn inject_mouse_move(
    state: State<RemoteControlState>,
    audit_state: State<AuditLogState>,
    session_id: String,
    event: MouseMoveEvent,
) -> Result<(), String> {
    if !authorize(&state, &session_id) {
        audit_state.append(
            &session_id,
            "technician",
            "input_injection_rejected",
            serde_json::json!({ "reason": "session not authorized locally", "kind": "mouse-move" }),
        );
        return Err("Session non autorisée pour le remote control local".into());
    }

    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
    enigo
        .move_mouse(event.x, event.y, Coordinate::Abs)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn inject_mouse_click(
    state: State<RemoteControlState>,
    audit_state: State<AuditLogState>,
    session_id: String,
    event: MouseClickEvent,
) -> Result<(), String> {
    if !authorize(&state, &session_id) {
        audit_state.append(
            &session_id,
            "technician",
            "input_injection_rejected",
            serde_json::json!({ "reason": "session not authorized locally", "kind": "mouse-click" }),
        );
        return Err("Session non autorisée pour le remote control local".into());
    }

    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
    let button = parse_button(&event.button);
    enigo
        .button(button, enigo::Direction::Click)
        .map_err(|e| e.to_string())?;

    audit_state.append(
        &session_id,
        "technician",
        "input_injected",
        serde_json::json!({ "kind": "mouse-click", "button": event.button }),
    );
    Ok(())
}

#[tauri::command]
pub fn inject_key_event(
    state: State<RemoteControlState>,
    audit_state: State<AuditLogState>,
    session_id: String,
    event: KeyEvent,
) -> Result<(), String> {
    if !authorize(&state, &session_id) {
        audit_state.append(
            &session_id,
            "technician",
            "input_injection_rejected",
            serde_json::json!({ "reason": "session not authorized locally", "kind": "key" }),
        );
        return Err("Session non autorisée pour le remote control local".into());
    }

    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
    enigo
        .text(&event.key)
        .map_err(|e| e.to_string())?;

    audit_state.append(
        &session_id,
        "technician",
        "input_injected",
        serde_json::json!({ "kind": "key", "key": event.key }),
    );
    Ok(())
}
