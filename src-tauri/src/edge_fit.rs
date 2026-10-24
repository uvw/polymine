//! A double click on the window's edge or corner fits the window to the board
//! along that edge: a side fits the width, the top or bottom the height, and a
//! corner both. Windows would stretch the window to the screen's height on a
//! top or bottom edge; the shell takes the click instead and tells the UI,
//! which knows the board's shape.

/// The event the UI hears, with the edge or corner that was double-clicked.
#[cfg(target_os = "windows")]
pub const FIT_EVENT: &str = "fit-window";

#[cfg(target_os = "windows")]
#[derive(Clone, serde::Serialize)]
struct Fit {
    edge: &'static str,
}

/// Starts watching `window`'s edges for double clicks.
#[cfg(target_os = "windows")]
pub fn watch(window: &tauri::WebviewWindow) {
    native::install(window);
}

/// Elsewhere the system decides what an edge double click does.
#[cfg(not(target_os = "windows"))]
pub fn watch(_window: &tauri::WebviewWindow) {}

#[cfg(target_os = "windows")]
#[allow(unsafe_code, reason = "subclassing the window needs Win32 calls")]
mod native {
    use super::{FIT_EVENT, Fit};
    use tauri::Emitter;
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
    use windows::Win32::UI::WindowsAndMessaging::{
        HTBOTTOM, HTBOTTOMLEFT, HTBOTTOMRIGHT, HTLEFT, HTRIGHT, HTTOP, HTTOPLEFT, HTTOPRIGHT,
        WM_NCLBUTTONDBLCLK,
    };

    /// Tells this subclass from any other on the window.
    const SUBCLASS_ID: usize = 0xB115;

    /// The edge or corner a hit-test code names.
    pub(super) fn edge(hit: u32) -> Option<&'static str> {
        Some(match hit {
            HTLEFT => "left",
            HTRIGHT => "right",
            HTTOP => "top",
            HTBOTTOM => "bottom",
            HTTOPLEFT => "topLeft",
            HTTOPRIGHT => "topRight",
            HTBOTTOMLEFT => "bottomLeft",
            HTBOTTOMRIGHT => "bottomRight",
            _ => return None,
        })
    }

    pub(super) fn install(window: &tauri::WebviewWindow) {
        let hwnd = match window.hwnd() {
            // Tauri may build on another version of the windows crate.
            Ok(hwnd) => HWND(hwnd.0),
            Err(e) => {
                log::warn!("could not watch the window's edges: {e}");
                return;
            }
        };
        // The window lives as long as the app, so its handle is never freed.
        let data = Box::into_raw(Box::new(window.clone()));
        // SAFETY: `hwnd` is the live main window, set up on its own thread, and
        // `data` stays valid for the rest of the process.
        let installed = unsafe { SetWindowSubclass(hwnd, Some(proc), SUBCLASS_ID, data as usize) };
        if !installed.as_bool() {
            log::warn!("could not watch the window's edges");
            // SAFETY: the subclass didn't take `data`, so nothing else holds it.
            drop(unsafe { Box::from_raw(data) });
        }
    }

    unsafe extern "system" fn proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        _id: usize,
        data: usize,
    ) -> LRESULT {
        if msg == WM_NCLBUTTONDBLCLK
            && let Some(edge) = u32::try_from(wparam.0).ok().and_then(edge)
        {
            // SAFETY: `install` gave the subclass a window that is never freed.
            let window = unsafe { &*(data as *const tauri::WebviewWindow) };
            if let Err(e) = window.emit(FIT_EVENT, Fit { edge }) {
                log::warn!("could not ask the UI to fit the window: {e}");
            }
            return LRESULT(0);
        }
        // SAFETY: passes the message on unchanged, as a subclass must.
        unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
    }
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::native::edge;

    #[test]
    fn names_every_edge_and_corner_and_nothing_else() {
        let named: Vec<_> = (0..32).filter_map(edge).collect();
        assert_eq!(
            named,
            [
                "left",
                "right",
                "top",
                "topLeft",
                "topRight",
                "bottom",
                "bottomLeft",
                "bottomRight"
            ]
        );
    }
}
