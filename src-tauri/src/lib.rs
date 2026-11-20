pub mod appupdate;
mod commands;
mod util;

use commands::{network, security, system, testing};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|_app| {
            #[cfg(debug_assertions)]
            {
                // Surface backend logs in the terminal during development.
                let _ = env_logger_init();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // System
            appupdate::update_current_version,
            appupdate::update_check,
            appupdate::update_install,
            appupdate::update_restart,
            system::list_processes,
            system::kill_processes,
            system::system_stats,
            system::ram_snapshot,
            system::list_ports,
            system::kill_port,
            system::disk_targets,
            system::clean_disk,
            system::inspect_bundle,
            system::clear_quarantine,
            system::reveal_in_finder,
            system::app_data_dir,
            system::sample_screen_pixel,
            system::open_privacy_settings,
            system::scan_caches,
            system::clean_cache_paths,
            system::scan_large_files,
            system::trash_paths,
            system::request_location_permission,
            // Network
            network::wifi_scan,
            network::bluetooth_devices,
            network::start_lan_scan,
            network::dns_query,
            network::start_ping,
            network::traceroute,
            network::start_speed_test,
            network::find_subdomains,
            network::list_maps,
            network::load_map,
            network::save_map,
            network::delete_map,
            network::capture_point_scans,
            // Security
            security::analyze_headers,
            security::inspect_tls,
            security::hash_text,
            security::hash_file,
            security::password_strength,
            security::generate_password,
            security::check_pwned,
            // Testing
            testing::send_http_request,
        ])
        .run(tauri::generate_context!())
        .expect("error while running shift-tools");
}

#[cfg(debug_assertions)]
fn env_logger_init() -> Result<(), Box<dyn std::error::Error>> {
    // tauri's own logging is enabled through the `log` crate; keep this light.
    Ok(())
}
