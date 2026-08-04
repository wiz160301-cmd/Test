mod audit;
mod guardrails;
mod input_inject;
mod scripts;
mod system_info;

use audit::AuditLogState;
use input_inject::RemoteControlState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            app.manage(AuditLogState::new(app.handle()));
            app.manage(RemoteControlState::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            system_info::collect_system_info,
            scripts::evaluate_script,
            scripts::execute_script,
            audit::append_audit_entry,
            input_inject::set_remote_control_session,
            input_inject::inject_mouse_move,
            input_inject::inject_mouse_click,
            input_inject::inject_key_event,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
