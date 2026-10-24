//! Platform facts the UI needs to look native: which OS it runs on, and whether
//! the window got a system backdrop material behind the transparent webview.

use serde::{Deserialize, Serialize};
use tauri::{State, WebviewWindow};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum Platform {
    Windows,
    Macos,
    Linux,
}

#[derive(Clone, Debug, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Environment {
    pub platform: Platform,
    /// True when Mica (Windows 11) or vibrancy (macOS) sits behind the window.
    /// Without it the UI must paint an opaque background, since the window
    /// itself is transparent.
    pub material: bool,
    /// The instance's name, or `None` for the default instance.
    pub instance: Option<String>,
    /// The system accent color as `0xRRGGBB`, when the platform has one.
    pub accent: Option<u32>,
}

impl Environment {
    pub fn current(material: bool, instance: Option<String>) -> Self {
        let platform = if cfg!(target_os = "windows") {
            Platform::Windows
        } else if cfg!(target_os = "macos") {
            Platform::Macos
        } else {
            Platform::Linux
        };
        Self {
            platform,
            material,
            instance,
            accent: crate::accent::system_accent(),
        }
    }
}

/// Applies the platform's backdrop material and reports whether it took.
/// Mica needs Windows 11; Windows 10 and Linux get none.
pub fn apply_material(window: &WebviewWindow) -> bool {
    #[cfg(target_os = "windows")]
    let result = window_vibrancy::apply_mica(window, None);
    #[cfg(target_os = "macos")]
    let result = window_vibrancy::apply_vibrancy(
        window,
        window_vibrancy::NSVisualEffectMaterial::Sidebar,
        Some(window_vibrancy::NSVisualEffectState::FollowsWindowActiveState),
        None,
    );
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let result: Result<(), String> = {
        let _ = window;
        Err("no backdrop material on this platform".to_owned())
    };

    match result {
        Ok(()) => true,
        Err(e) => {
            log::info!("window material unavailable, using an opaque background: {e}");
            false
        }
    }
}

/// Switches the window between its default material and a frosted blur of
/// what's behind it: a lightly tinted Acrylic on Windows and the matching
/// under-window material on macOS, the clearest `AppKit` offers. Returns
/// whether the platform took it.
#[tauri::command]
#[specta::specta]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri injects command arguments by value"
)]
pub fn set_material(window: WebviewWindow, frosted: bool) -> bool {
    #[cfg(target_os = "windows")]
    let result = if frosted {
        let _ = window_vibrancy::clear_mica(&window);
        window_vibrancy::apply_acrylic(&window, Some((24, 26, 32, 96)))
    } else {
        let _ = window_vibrancy::clear_acrylic(&window);
        window_vibrancy::apply_mica(&window, None)
    };
    // Applying adds another effect view on top of the last one, so clear it.
    #[cfg(target_os = "macos")]
    let result = window_vibrancy::clear_vibrancy(&window).and_then(|_| {
        window_vibrancy::apply_vibrancy(
            &window,
            if frosted {
                window_vibrancy::NSVisualEffectMaterial::UnderWindowBackground
            } else {
                window_vibrancy::NSVisualEffectMaterial::Sidebar
            },
            Some(window_vibrancy::NSVisualEffectState::FollowsWindowActiveState),
            None,
        )
    });
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let result: Result<(), String> = {
        let _ = (&window, frosted);
        Err("no backdrop material on this platform".to_owned())
    };
    result
        .map_err(|e| log::info!("window material unavailable: {e}"))
        .is_ok()
}

/// The platform, the backdrop material, the instance, and the accent color
/// as they were at startup.
#[tauri::command]
#[specta::specta]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri injects command arguments by value"
)]
pub fn get_environment(environment: State<'_, Environment>) -> Environment {
    environment.inner().clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_the_build_platform_and_material() {
        let environment = Environment::current(true, Some("lab".into()));
        let expected = if cfg!(target_os = "windows") {
            Platform::Windows
        } else if cfg!(target_os = "macos") {
            Platform::Macos
        } else {
            Platform::Linux
        };
        assert_eq!(environment.platform, expected);
        assert!(environment.material);
        let json = serde_json::to_string(&environment).unwrap();
        assert!(json.contains("\"material\":true"));
        assert!(json.contains("\"instance\":\"lab\""));
    }
}
