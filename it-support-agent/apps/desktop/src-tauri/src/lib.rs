mod audit;
mod guardrails;
mod scripts;
mod system_info;

use audit::AuditLogState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            app.manage(AuditLogState::new(app.handle()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            system_info::collect_system_info,
            scripts::evaluate_script,
            scripts::execute_script,
            audit::append_audit_entry,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
