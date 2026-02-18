use tauri::Emitter;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;

const SERVER_URL: &str = "http://localhost:3000";
const POLL_INTERVAL_MS: u64 = 200;
const MAX_WAIT_MS: u64 = 15_000;

async fn wait_for_server() -> bool {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(500))
        .build()
        .unwrap();

    let start = std::time::Instant::now();
    while start.elapsed().as_millis() < MAX_WAIT_MS as u128 {
        if client.get(SERVER_URL).send().await.is_ok() {
            return true;
        }
        tokio::time::sleep(std::time::Duration::from_millis(POLL_INTERVAL_MS)).await;
    }
    false
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let handle = app.handle().clone();

            let sidecar = handle
                .shell()
                .sidecar("binaries/spaceduck-server")
                .expect("failed to create sidecar command");

            let (mut rx, _child) = sidecar
                .spawn()
                .expect("failed to spawn sidecar");

            let log_handle = handle.clone();
            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            let msg = String::from_utf8_lossy(&line);
                            log::info!("[sidecar stdout] {}", msg);
                        }
                        CommandEvent::Stderr(line) => {
                            let msg = String::from_utf8_lossy(&line);
                            log::warn!("[sidecar stderr] {}", msg);
                        }
                        CommandEvent::Terminated(status) => {
                            log::error!("[sidecar] terminated with {:?}", status);
                            let _ = log_handle.emit("sidecar-terminated", ());
                            break;
                        }
                        _ => {}
                    }
                }
            });

            let nav_handle = handle.clone();
            tauri::async_runtime::spawn(async move {
                if wait_for_server().await {
                    log::info!("Server ready, navigating to {}", SERVER_URL);
                    if let Some(window) = nav_handle.get_webview_window("main") {
                        let url: tauri::Url = SERVER_URL.parse().unwrap();
                        let _ = window.navigate(url);
                    }
                } else {
                    log::error!("Server failed to start within {}ms", MAX_WAIT_MS);
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
