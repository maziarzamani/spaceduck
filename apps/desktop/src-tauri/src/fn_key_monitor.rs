use core_graphics::event::{
    CGEvent, CGEventFlags, CGEventTap, CGEventTapLocation, CGEventTapOptions,
    CGEventTapPlacement, CGEventType,
};
use core_foundation::runloop::{kCFRunLoopDefaultMode, CFRunLoop};
use std::sync::atomic::{AtomicBool, AtomicU8, AtomicPtr, Ordering};
use tauri::Emitter;

static FN_IS_DOWN: AtomicBool = AtomicBool::new(false);
/// 0 = not recording, 1 = chat mode (focused), 2 = global mode (background)
static RECORDING_MODE: AtomicU8 = AtomicU8::new(0);
/// Stored mach port so the callback can re-enable the tap when macOS disables it.
static TAP_PORT: AtomicPtr<std::ffi::c_void> = AtomicPtr::new(std::ptr::null_mut());

extern "C" {
    fn CGEventTapEnable(tap: *mut std::ffi::c_void, enable: bool);
}

/// Start a CGEventTap on the current thread that monitors Fn key press/release.
/// Emits high-level dictation commands based on window focus state at press time.
/// Uses HID-level tap to intercept Fn/Globe before macOS routes it to the emoji picker.
/// Requires both Accessibility and Input Monitoring permissions.
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
        CGEventTapLocation::HID,
        CGEventTapPlacement::HeadInsertEventTap,
        CGEventTapOptions::ListenOnly,
        vec![CGEventType::FlagsChanged],
        move |_proxy, event_type, event: &CGEvent| -> Option<CGEvent> {
            let raw_type = unsafe { std::mem::transmute::<CGEventType, u32>(event_type) };

            if raw_type == 0xFFFFFFFE || raw_type == 0xFFFFFFFF {
                log::warn!("CGEventTap was disabled (type=0x{:X}), re-enabling", raw_type);
                let port = TAP_PORT.load(Ordering::SeqCst);
                if !port.is_null() {
                    unsafe { CGEventTapEnable(port, true); }
                }
                return None;
            }

            let flags = event.get_flags();
            let fn_down = flags.contains(CGEventFlags::CGEventFlagSecondaryFn);
            let was_down = FN_IS_DOWN.load(Ordering::SeqCst);

            if fn_down && !was_down {
                FN_IS_DOWN.store(true, Ordering::SeqCst);

                let main_window_is_key: bool = unsafe {
                    let cls = objc2::runtime::AnyClass::get("NSApplication").unwrap();
                    let app: *mut objc2::runtime::AnyObject = objc2::msg_send![cls, sharedApplication];
                    let key_win: *mut objc2::runtime::AnyObject = objc2::msg_send![app, keyWindow];
                    if key_win.is_null() {
                        false
                    } else {
                        let title: *mut objc2::runtime::AnyObject = objc2::msg_send![key_win, title];
                        if title.is_null() {
                            false
                        } else {
                            let utf8: *const u8 = objc2::msg_send![title, UTF8String];
                            if utf8.is_null() {
                                false
                            } else {
                                let s = std::ffi::CStr::from_ptr(utf8 as *const std::ffi::c_char).to_string_lossy();
                                s == "spaceduck"
                            }
                        }
                    }
                };

                if main_window_is_key {
                    RECORDING_MODE.store(1, Ordering::SeqCst);
                    let _ = handle.emit("dictation:start-chat", ());
                } else {
                    RECORDING_MODE.store(2, Ordering::SeqCst);
                    crate::reposition_pill_near_dock(&handle);
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
        use core_foundation::base::TCFType;
        let raw_port = tap.mach_port.as_concrete_TypeRef() as *mut std::ffi::c_void;
        TAP_PORT.store(raw_port, Ordering::SeqCst);

        let source = tap
            .mach_port
            .create_runloop_source(0)
            .map_err(|_| "Failed to create run loop source".to_string())?;
        CFRunLoop::get_current().add_source(&source, kCFRunLoopDefaultMode);
        tap.enable();

        loop {
            let result = CFRunLoop::run_in_mode(kCFRunLoopDefaultMode, std::time::Duration::from_secs(5), false);
            tap.enable();
            if matches!(result, core_foundation::runloop::CFRunLoopRunResult::Finished) { break; }
        }
    }

    Err("CFRunLoop exited unexpectedly".to_string())
}
