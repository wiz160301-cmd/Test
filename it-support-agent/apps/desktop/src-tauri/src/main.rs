// Empêche une console Windows de s'ouvrir en plus de la fenêtre de l'app.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    it_support_agent_desktop_lib::run();
}
