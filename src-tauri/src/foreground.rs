//! Whether the window is the one the player is using, for pausing on focus loss.

/// Whether `window` is in front. On Windows, Tauri's focus events follow the
/// webview, and moving or resizing the window takes focus from the webview
/// while the window stays in front, so the UI asks before it pauses.
#[tauri::command]
#[specta::specta]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri hands commands the window by value"
)]
pub fn window_in_front(window: tauri::WebviewWindow) -> Result<bool, crate::error::AppError> {
    crate::guard::command("window_in_front", || Ok(in_front(&window)))
}

#[cfg(target_os = "windows")]
#[allow(
    unsafe_code,
    reason = "reading the foreground window needs a Win32 call"
)]
fn in_front(window: &tauri::WebviewWindow) -> bool {
    use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
    // A window whose handle can't be read is taken as in front, so it never
    // pauses on a guess.
    let Ok(hwnd) = window.hwnd() else {
        return true;
    };
    // SAFETY: GetForegroundWindow takes no arguments and only reads.
    let front = unsafe { GetForegroundWindow() };
    // Tauri may build on another version of the windows crate, so compare the raw handles.
    front.0 == hwnd.0
}

#[cfg(not(target_os = "windows"))]
fn in_front(window: &tauri::WebviewWindow) -> bool {
    window.is_focused().unwrap_or(true)
}
