use tauri::Emitter;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_clipboard_manager::ClipboardExt;

#[cfg(target_os = "macos")]
mod fn_key_monitor;

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

#[tauri::command]
fn paste_transcription(app: tauri::AppHandle, text: String) -> Result<(), String> {
    app.clipboard()
        .write_text(&text)
        .map_err(|e| format!("Clipboard write failed: {e}"))?;

    std::thread::sleep(std::time::Duration::from_millis(50));

    simulate_paste().map_err(|e| format!("Paste simulation failed: {e}"))
}

fn simulate_paste() -> Result<(), String> {
    use enigo::{Enigo, Key, Keyboard, Direction, Settings};

    let mut enigo = Enigo::new(&Settings::default())
        .map_err(|e| format!("Failed to create enigo instance: {e}"))?;

    #[cfg(target_os = "macos")]
    {
        enigo.key(Key::Meta, Direction::Press)
            .map_err(|e| e.to_string())?;
        enigo.key(Key::Unicode('v'), Direction::Click)
            .map_err(|e| e.to_string())?;
        enigo.key(Key::Meta, Direction::Release)
            .map_err(|e| e.to_string())?;
    }

    #[cfg(not(target_os = "macos"))]
    {
        enigo.key(Key::Control, Direction::Press)
            .map_err(|e| e.to_string())?;
        enigo.key(Key::Unicode('v'), Direction::Click)
            .map_err(|e| e.to_string())?;
        enigo.key(Key::Control, Direction::Release)
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            let handle = app.handle().clone();
            try_spawn_sidecar(&handle);

            #[cfg(target_os = "macos")]
            {
                let monitor_handle = app.handle().clone();
                std::thread::spawn(move || {
                    if let Err(e) = fn_key_monitor::start(monitor_handle) {
                        log::error!("Fn key monitor failed: {e}");
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![paste_transcription])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
