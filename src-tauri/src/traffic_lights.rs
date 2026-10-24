//! Keeps the macOS traffic lights centered on the toolbar, which doubles as the
//! title bar. `AppKit` puts them back in its own title bar whenever it lays the
//! title bar out again: when the window shows, takes focus, resizes, or leaves
//! full screen. tao re-applies its inset only from a `drawRect:` that never runs
//! under the webview, so the shell moves them after each of those events.
#![allow(
    unsafe_code,
    reason = "the title bar container is only reachable through raw AppKit calls"
)]

use objc2_app_kit::{NSWindow, NSWindowButton};
use objc2_foundation::{MainThreadMarker, NSPoint};

/// `--toolbar-height` in `ui/src/app.css`.
const TOOLBAR_HEIGHT: f64 = 40.0;
/// The close button's left edge. The macOS padding of `.start` in
/// `ui/src/components/TopBar.svelte` leaves room for the buttons.
const LEFT: f64 = 18.0;

/// How long `AppKit` takes to finish the title bar layout that follows showing
/// or focusing the window, measured with a margin on macOS 26.
const SETTLE: std::time::Duration = std::time::Duration::from_millis(80);

/// Centers the traffic lights now and again once `AppKit`'s own layout pass,
/// which runs after the event, has settled.
pub fn center_after_layout(window: &tauri::Window) {
    center(window);
    let window = window.clone();
    std::thread::spawn(move || {
        std::thread::sleep(SETTLE);
        let target = window.clone();
        let _ = window.run_on_main_thread(move || center(&target));
    });
}

/// Moves the traffic lights to the middle of the toolbar.
pub fn center(window: &tauri::Window) {
    if MainThreadMarker::new().is_none() || window.is_fullscreen().unwrap_or(false) {
        return;
    }
    let Ok(pointer) = window.ns_window() else {
        return;
    };
    // SAFETY: Tauri hands back this window's live `NSWindow`, and the marker
    // above proves this runs on the main thread, where AppKit may be used.
    let ns_window = unsafe { &*pointer.cast::<NSWindow>() };
    let [Some(close), Some(minimize), Some(zoom)] = [
        NSWindowButton::CloseButton,
        NSWindowButton::MiniaturizeButton,
        NSWindowButton::ZoomButton,
    ]
    .map(|kind| ns_window.standardWindowButton(kind)) else {
        return;
    };
    // SAFETY: `superview` is unsafe only because AppKit may return a private
    // subclass; both views are used through the plain `NSView` interface.
    let Some(bar) = (unsafe { close.superview() }) else {
        return;
    };
    // SAFETY: as above.
    let Some(container) = (unsafe { bar.superview() }) else {
        return;
    };

    // The container is anchored to the window's top edge; views count up from
    // the bottom.
    let mut frame = container.frame();
    frame.size.height = TOOLBAR_HEIGHT;
    frame.origin.y = ns_window.frame().size.height - TOOLBAR_HEIGHT;
    container.setFrame(frame);
    let mut bar_frame = bar.frame();
    bar_frame.origin = NSPoint::new(0.0, 0.0);
    bar_frame.size = frame.size;
    bar.setFrame(bar_frame);

    let spacing = minimize.frame().origin.x - close.frame().origin.x;
    for (button, step) in [close, minimize, zoom].iter().zip([0.0, 1.0, 2.0]) {
        let height = button.frame().size.height;
        button.setFrameOrigin(NSPoint::new(
            LEFT + step * spacing,
            (TOOLBAR_HEIGHT - height) / 2.0,
        ));
    }
}
