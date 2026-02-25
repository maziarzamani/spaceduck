use core_graphics::event::{
    CGEvent, CGEventFlags, CGEventTap, CGEventTapLocation, CGEventTapOptions,
    CGEventTapPlacement, CGEventType,
};
use core_foundation::runloop::{kCFRunLoopDefaultMode, CFRunLoop};
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use tauri::{Emitter, Manager};

static FN_IS_DOWN: AtomicBool = AtomicBool::new(false);
/// 0 = not recording, 1 = chat mode (focused), 2 = global mode (background)
static RECORDING_MODE: AtomicU8 = AtomicU8::new(0);

/// Start a CGEventTap on the current thread that monitors Fn key press/release.
/// Emits high-level dictation commands based on window focus state at press time.
/// Includes health monitoring to recover from silently disabled taps.
/// This function blocks forever (runs a CFRunLoop), so call it from a dedicated thread.
pub fn start(handle: tauri::AppHandle) -> Result<(), String> {
    loop {
        match run_tap(&handle) {
            Ok(()) => break,
            Err(e) => {
                log::warn!("CGEventTap stopped: {e}. Reinstalling in 2s...");
                std::thread::sleep(std::time::Duration::from_secs(2));
            }
        }
    }
    Ok(())
}

fn run_tap(handle: &tauri::AppHandle) -> Result<(), String> {
    let handle = handle.clone();

    let tap = CGEventTap::new(
        CGEventTapLocation::Session,
        CGEventTapPlacement::HeadInsertEventTap,
        CGEventTapOptions::ListenOnly,
        vec![CGEventType::FlagsChanged],
        move |_proxy, event_type, event: &CGEvent| -> Option<CGEvent> {
            // Re-enable tap if macOS disabled it due to timeout or user input.
            // CGEventType::TapDisabledByTimeout = 0xFFFFFFFE
            // CGEventType::TapDisabledByUserInput = 0xFFFFFFFF
            let raw_type = unsafe { std::mem::transmute::<CGEventType, u32>(event_type) };
            if raw_type == 0xFFFFFFFE || raw_type == 0xFFFFFFFF {
                log::warn!("CGEventTap was disabled (type=0x{:X}), re-enabling", raw_type);
                return None;
            }

            let flags = event.get_flags();
            let fn_down = flags.contains(CGEventFlags::CGEventFlagSecondaryFn);
            let was_down = FN_IS_DOWN.load(Ordering::SeqCst);

            if fn_down && !was_down {
                FN_IS_DOWN.store(true, Ordering::SeqCst);

                let focused = handle
                    .get_webview_window("main")
                    .and_then(|w| w.is_focused().ok())
                    .unwrap_or(false);

                if focused {
                    RECORDING_MODE.store(1, Ordering::SeqCst);
                    let _ = handle.emit("dictation:start-chat", ());
                } else {
                    RECORDING_MODE.store(2, Ordering::SeqCst);
                    let _ = handle.emit("dictation:start-global", ());
                }
            } else if !fn_down && was_down {
                FN_IS_DOWN.store(false, Ordering::SeqCst);
                let mode = RECORDING_MODE.swap(0, Ordering::SeqCst);
                match mode {
                    1 => { let _ = handle.emit("dictation:stop-chat", ()); }
                    2 => { let _ = handle.emit("dictation:stop-global", ()); }
                    _ => {}
                }
            }

            None
        },
    )
    .map_err(|_| "Failed to create CGEventTap. Is Accessibility permission granted?".to_string())?;

    unsafe {
        let source = tap
            .mach_port
            .create_runloop_source(0)
            .map_err(|_| "Failed to create run loop source".to_string())?;
        CFRunLoop::get_current().add_source(&source, kCFRunLoopDefaultMode);
        tap.enable();

        // Instead of CFRunLoop::run_current() which blocks forever,
        // run in 5-second intervals and re-enable the tap each time.
        // This recovers from macOS silently disabling the tap (e.g. after minimize/restore).
        loop {
            let result = CFRunLoop::run_in_mode(kCFRunLoopDefaultMode, std::time::Duration::from_secs(5), false);
            tap.enable();
            if matches!(result, core_foundation::runloop::CFRunLoopRunResult::Finished) { break; }
        }
    }

    Err("CFRunLoop exited unexpectedly".to_string())
}
