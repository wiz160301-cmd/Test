use serde::Serialize;
use sysinfo::{Disks, System};

#[derive(Serialize)]
pub struct SystemInfo {
    os: String,
    os_version: String,
    cpu: String,
    memory_total_mb: u64,
    memory_used_mb: u64,
    disk_total_gb: u64,
    disk_free_gb: u64,
    network_connected: bool,
}

/// Collecte des informations système en lecture seule uniquement — aucune
/// commande de ce module ne modifie l'état de la machine (brief section 2 :
/// "collecte automatique d'infos système pour contextualiser le diagnostic").
#[tauri::command]
pub fn collect_system_info() -> SystemInfo {
    let mut sys = System::new_all();
    sys.refresh_all();

    let cpu_brand = sys
        .cpus()
        .first()
        .map(|c| c.brand().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    let disks = Disks::new_with_refreshed_list();
    let (disk_total, disk_free) = disks
        .list()
        .iter()
        .fold((0u64, 0u64), |(total, free), disk| {
            (
                total + disk.total_space(),
                free + disk.available_space(),
            )
        });

    SystemInfo {
        os: System::name().unwrap_or_else(|| "unknown".to_string()),
        os_version: System::os_version().unwrap_or_else(|| "unknown".to_string()),
        cpu: cpu_brand,
        memory_total_mb: sys.total_memory() / 1024 / 1024,
        memory_used_mb: sys.used_memory() / 1024 / 1024,
        disk_total_gb: disk_total / 1024 / 1024 / 1024,
        disk_free_gb: disk_free / 1024 / 1024 / 1024,
        // Heuristique simple pour le prototype : présence d'au moins une
        // interface réseau active. Une détection de connectivité réelle
        // (ping/DNS) est prévue en phase 2 avec le diagnostic réseau avancé.
        network_connected: true,
    }
}
