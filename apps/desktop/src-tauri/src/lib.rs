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

#[cfg(target_os = "macos")]
fn make_window_transparent(window: &tauri::WebviewWindow) {
    use cocoa::appkit::{NSColor, NSWindow};
    use cocoa::base::{id, nil};

    let ns_window = window.ns_window().unwrap() as id;
    unsafe {
        ns_window.setOpaque_(cocoa::base::NO);
        let clear = NSColor::clearColor(nil);
        ns_window.setBackgroundColor_(clear);
    }

    window.with_webview(|platform_webview| {
        unsafe {
            let wk_view: *mut objc2::runtime::AnyObject = platform_webview.inner().cast();
            let _: () = objc2::msg_send![wk_view, _setDrawsBackground: false];
        }
    }).unwrap_or_else(|e| log::error!("Failed to set webview transparency: {e}"));
}

#[cfg(target_os = "macos")]
pub fn reposition_pill_near_dock(app: &tauri::AppHandle) {
    use cocoa::appkit::NSScreen;
    use cocoa::base::{id, nil};
    use tauri::Manager;

    let pill = match app.get_webview_window("dictation") {
        Some(w) => w,
        None => return,
    };

    let pill_w = 280.0_f64;
    let pill_h = 48.0_f64;

    unsafe {
        let mouse_loc: cocoa::foundation::NSPoint = cocoa::appkit::NSEvent::mouseLocation(nil);

        let screens = NSScreen::screens(nil);
        let count: usize = cocoa::foundation::NSArray::count(screens) as usize;

        let mut target_frame = None;

        for i in 0..count {
            let scr: id = cocoa::foundation::NSArray::objectAtIndex(screens, i as u64);
            let frame = NSScreen::frame(scr);
            let contains = mouse_loc.x >= frame.origin.x
                && mouse_loc.x <= frame.origin.x + frame.size.width
                && mouse_loc.y >= frame.origin.y
                && mouse_loc.y <= frame.origin.y + frame.size.height;
            if contains {
                target_frame = Some(frame);
                break;
            }
        }

        if target_frame.is_none() {
            let scr = NSScreen::mainScreen(nil);
            if scr != nil {
                target_frame = Some(NSScreen::frame(scr));
            }
        }

        if let Some(frame) = target_frame {
            let x = (frame.size.width - pill_w) / 2.0 + frame.origin.x;
            let bottom_gap = 100.0;
            let y = frame.origin.y + bottom_gap;

            // Find the true primary screen (origin 0,0) — NOT mainScreen which follows focus
            let screen_h_total = {
                let mut h = frame.size.height;
                for i in 0..count {
                    let scr: id = cocoa::foundation::NSArray::objectAtIndex(screens, i as u64);
                    let f = NSScreen::frame(scr);
                    if f.origin.x == 0.0 && f.origin.y == 0.0 {
                        h = f.size.height;
                        break;
                    }
                }
                h
            };
            let tauri_y = screen_h_total - y - pill_h;

            let _ = pill.set_position(tauri::LogicalPosition::new(x, tauri_y));
        }
    }
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

            // Create floating dictation pill window
            {
                let url = if cfg!(debug_assertions) {
                    tauri::WebviewUrl::External("http://localhost:1420/?window=dictation".parse().unwrap())
                } else {
                    tauri::WebviewUrl::App("index.html?window=dictation".into())
                };

                let pill_w = 280.0_f64;
                let pill_h = 48.0_f64;

                #[allow(unused_mut)]
                let mut builder = tauri::WebviewWindowBuilder::new(app, "dictation", url)
                    .title("Dictation")
                    .inner_size(pill_w, pill_h)
                    .resizable(false)
                    .decorations(false)
                    .always_on_top(true)
                    .skip_taskbar(true)
                    .shadow(false)
                    .focused(false)
                    .visible(true);

                #[cfg(not(target_os = "macos"))]
                if let Some(monitor) = app.primary_monitor().ok().flatten() {
                    let size = monitor.size();
                    let scale = monitor.scale_factor();
                    let screen_w = size.width as f64 / scale;
                    let screen_h = size.height as f64 / scale;
                    let x = (screen_w - pill_w) / 2.0;
                    let y = screen_h - pill_h - 80.0;
                    builder = builder.position(x, y);
                }

                let pill = builder
                    .build()
                    .map_err(|e| {
                        log::error!("Failed to create dictation pill window: {e}");
                        e
                    })
                    .ok();

                #[cfg(target_os = "macos")]
                if let Some(ref _pill) = pill {
                    make_window_transparent(_pill);
                    reposition_pill_near_dock(app.handle());
                }

                let _ = pill;
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![paste_transcription])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
