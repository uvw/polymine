//! The system accent color, as `0xRRGGBB`, for themes that tint with it.

/// The accent color the player picked in the system settings, or `None` where
/// the platform has none or it can't be read.
pub fn system_accent() -> Option<u32> {
    read()
}

#[cfg(target_os = "windows")]
fn read() -> Option<u32> {
    use windows::UI::ViewManagement::{UIColorType, UISettings};
    let color = UISettings::new()
        .ok()?
        .GetColorValue(UIColorType::Accent)
        .ok()?;
    Some(pack(color.R, color.G, color.B))
}

#[cfg(target_os = "macos")]
fn read() -> Option<u32> {
    use objc2_app_kit::{NSColor, NSColorSpace};
    // The accent is a dynamic color in no fixed color space; sRGB gives the
    // components the web uses.
    let color =
        NSColor::controlAccentColor().colorUsingColorSpace(&NSColorSpace::sRGBColorSpace())?;
    #[allow(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "clamped to 0..=255 first"
    )]
    let channel = |value: f64| (value.clamp(0.0, 1.0) * 255.0).round() as u8;
    Some(pack(
        channel(color.redComponent()),
        channel(color.greenComponent()),
        channel(color.blueComponent()),
    ))
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn read() -> Option<u32> {
    None
}

#[cfg_attr(
    not(any(target_os = "windows", target_os = "macos")),
    allow(dead_code, reason = "Linux reads no accent")
)]
fn pack(r: u8, g: u8, b: u8) -> u32 {
    (u32::from(r) << 16) | (u32::from(g) << 8) | u32::from(b)
}

/// The accent color now, for the UI to refresh when the window regains focus.
#[tauri::command]
#[specta::specta]
pub fn get_accent() -> Result<Option<u32>, crate::error::AppError> {
    crate::guard::command("get_accent", || Ok(system_accent()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn packs_channels_as_rgb() {
        assert_eq!(pack(0x12, 0x34, 0x56), 0x0012_3456);
    }
}
