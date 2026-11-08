//! Startup failures the player can see. A Windows release build has no
//! console, so an error printed there reaches nobody.

/// Reports `message` and ends the process with `code`. Release builds on
/// Windows also show it in a message box.
pub fn exit(message: &str, code: i32) -> ! {
    eprintln!("polymine: {message}");
    #[cfg(target_os = "windows")]
    if !cfg!(debug_assertions) {
        message_box::show(message);
    }
    std::process::exit(code)
}

/// Ends the process after Tauri failed to build the app. On Windows that's
/// most often a missing webview runtime, so the message names it.
pub fn start_failed(error: &tauri::Error) -> ! {
    let hint = if cfg!(target_os = "windows") {
        "\n\nPolymine needs the Microsoft Edge WebView2 Runtime, which Windows 11 includes."
    } else {
        ""
    };
    exit(&format!("Polymine couldn't start: {error}{hint}"), 1)
}

#[cfg(target_os = "windows")]
#[allow(unsafe_code, reason = "showing a message box needs a Win32 call")]
mod message_box {
    use windows::Win32::UI::WindowsAndMessaging::{MB_ICONERROR, MB_OK, MessageBoxW};
    use windows::core::HSTRING;

    pub fn show(message: &str) {
        // SAFETY: both strings outlive the call, and a box with no owner
        // window needs nothing else.
        unsafe {
            MessageBoxW(
                None,
                &HSTRING::from(message),
                &HSTRING::from("Polymine"),
                MB_OK | MB_ICONERROR,
            );
        }
    }
}
