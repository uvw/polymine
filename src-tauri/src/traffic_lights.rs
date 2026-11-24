//! Lets `AppKit` center the macOS traffic lights on the toolbar, which doubles as
//! the title bar. An empty `NSToolbar` in the unified compact style makes the
//! title bar 40 pt tall, the height of `--toolbar-height` in `ui/src/app.css`,
//! and `AppKit` centers the buttons in it on every layout pass. Buttons moved by
//! hand don't hold: a live resize lays the title bar out again every frame.
#![allow(
    unsafe_code,
    reason = "the window's toolbar is only reachable through raw AppKit calls"
)]

use objc2_app_kit::{NSTitlebarSeparatorStyle, NSToolbar, NSWindow, NSWindowToolbarStyle};
use objc2_foundation::MainThreadMarker;

/// Gives the window an empty compact toolbar, so `AppKit` lays the title bar out
/// at the toolbar's height. Call it on the main thread before the window shows.
pub fn install(window: &tauri::Window) {
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    let Ok(pointer) = window.ns_window() else {
        return;
    };
    // SAFETY: Tauri hands back this window's live `NSWindow`, and the marker
    // above proves this runs on the main thread, where AppKit may be used.
    let ns_window = unsafe { &*pointer.cast::<NSWindow>() };
    let toolbar = NSToolbar::new(mtm);
    ns_window.setToolbar(Some(&toolbar));
    ns_window.setToolbarStyle(NSWindowToolbarStyle::UnifiedCompact);
    ns_window.setTitlebarSeparatorStyle(NSTitlebarSeparatorStyle::None);
}
