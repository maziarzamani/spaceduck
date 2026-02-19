use tauri::Emitter;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;

fn try_spawn_sidecar(handle: &tauri::AppHandle) {
    let sidecar = match handle.shell().sidecar("spaceduck-server") {
        Ok(cmd) => cmd,
        Err(e) => {
            log::warn!("Could not create sidecar command: {e}. Is the gateway already running?");
            return;
        }
    };

    let (mut rx, _child) = match sidecar.spawn() {
        Ok(pair) => pair,
        Err(e) => {
            log::warn!("Could not spawn sidecar: {e}. Is the gateway already running?");
            return;
        }
    };

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
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let handle = app.handle().clone();
            try_spawn_sidecar(&handle);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
