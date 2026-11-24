//! The taskbar's copy of the window icon. Tauri's `set_icon` sets the window's
//! small icon only, and Windows draws the taskbar button and Alt+Tab from the
//! big one, which would otherwise stay the program's own icon.

/// Sets the window's big icon to `rgba`, a `size` by `size` image. A failure
/// is logged and leaves the icon as it was. Other platforms have no such icon.
#[tauri::command]
#[specta::specta]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri hands commands the window and buffers by value"
)]
pub fn set_taskbar_icon(
    window: tauri::WebviewWindow,
    rgba: Vec<u8>,
    size: u32,
) -> Result<(), crate::error::AppError> {
    crate::guard::command("set_taskbar_icon", || {
        let Some(bits) = icon_bits(&rgba, size) else {
            log::warn!(
                "taskbar icon refused: {} bytes for {size} by {size}",
                rgba.len()
            );
            return Ok(());
        };
        #[cfg(target_os = "windows")]
        if let Err(e) = windows_icon::set(&window, &bits, size) {
            log::warn!("taskbar icon not set: {e}");
        }
        #[cfg(not(target_os = "windows"))]
        let _ = (window, bits);
        Ok(())
    })
}

/// What `CreateIcon` reads for a 32-bit icon.
#[cfg_attr(
    not(target_os = "windows"),
    allow(dead_code, reason = "only the Windows icon code reads the fields")
)]
struct IconBits {
    /// The pixels as BGRA, top row first.
    bgra: Vec<u8>,
    /// One bit a pixel, each row padded to 16 bits. The color's alpha decides
    /// what shows, so the mask stays clear.
    mask: Vec<u8>,
}

/// `rgba` laid out for `CreateIcon`, or None unless it holds `size` by `size`
/// pixels.
fn icon_bits(rgba: &[u8], size: u32) -> Option<IconBits> {
    let width = usize::try_from(size).ok().filter(|&w| w > 0)?;
    if rgba.len() != width.checked_mul(width)?.checked_mul(4)? {
        return None;
    }
    let bgra = rgba
        .as_chunks::<4>()
        .0
        .iter()
        .flat_map(|&[r, g, b, a]| [b, g, r, a])
        .collect();
    let mask = vec![0; width.div_ceil(16) * 2 * width];
    Some(IconBits { bgra, mask })
}

#[cfg(target_os = "windows")]
#[allow(
    unsafe_code,
    reason = "making an icon and handing it to the window needs Win32 calls"
)]
mod windows_icon {
    use std::sync::Mutex;

    use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateIcon, DestroyIcon, HICON, ICON_BIG, SendMessageW, WM_SETICON,
    };

    use super::IconBits;

    /// The icon last handed to the window, as a raw handle, so the next one
    /// can destroy it.
    static CURRENT: Mutex<isize> = Mutex::new(0);

    pub fn set(window: &tauri::WebviewWindow, bits: &IconBits, size: u32) -> Result<(), String> {
        let width = i32::try_from(size).map_err(|e| e.to_string())?;
        // Tauri may build on another version of the windows crate, so the
        // handle crosses as its raw pointer.
        let hwnd = HWND(window.hwnd().map_err(|e| e.to_string())?.0);
        // SAFETY: both buffers hold `size` by `size` pixels in the layouts
        // CreateIcon reads, and they outlive the call.
        let icon = unsafe {
            CreateIcon(
                None,
                width,
                width,
                1,
                32,
                bits.mask.as_ptr(),
                bits.bgra.as_ptr(),
            )
        }
        .map_err(|e| e.to_string())?;
        // SAFETY: `hwnd` is the live main window, and WM_SETICON takes the
        // icon's handle by value.
        unsafe {
            SendMessageW(
                hwnd,
                WM_SETICON,
                Some(WPARAM(ICON_BIG as usize)),
                Some(LPARAM(icon.0 as isize)),
            );
        }
        let mut current = CURRENT
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let old = std::mem::replace(&mut *current, icon.0 as isize);
        if old != 0 {
            // SAFETY: `old` came from CreateIcon above, and the window has
            // just been given its replacement.
            let _ = unsafe { DestroyIcon(HICON(old as *mut core::ffi::c_void)) };
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn swaps_red_and_blue_and_keeps_alpha() {
        let bits = icon_bits(&[10, 20, 30, 40, 50, 60, 70, 80, 1, 2, 3, 4, 5, 6, 7, 8], 2).unwrap();
        assert_eq!(
            bits.bgra,
            vec![30, 20, 10, 40, 70, 60, 50, 80, 3, 2, 1, 4, 7, 6, 5, 8]
        );
    }

    #[test]
    fn pads_each_mask_row_to_16_bits() {
        let rgba = vec![0; 64 * 64 * 4];
        assert_eq!(icon_bits(&rgba, 64).unwrap().mask.len(), 64 / 8 * 64);
        let rgba = vec![0; 17 * 17 * 4];
        assert_eq!(icon_bits(&rgba, 17).unwrap().mask.len(), 4 * 17);
    }

    #[test]
    fn refuses_pixels_that_dont_fill_the_square() {
        assert!(icon_bits(&[0; 15], 2).is_none());
        assert!(icon_bits(&[0; 20], 2).is_none());
        assert!(icon_bits(&[], 0).is_none());
    }
}
