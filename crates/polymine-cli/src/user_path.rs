//! The user's `PATH` on Windows, where `link` and `unlink` add and remove the
//! CLI's own folder. The editing is plain string work; only reading and
//! writing the registry needs Windows.

/// `path` with `folder` appended, or `None` when it's already there.
pub fn with_folder(path: &str, folder: &str) -> Option<String> {
    if path.split(';').any(|entry| same(entry, folder)) {
        return None;
    }
    let kept = path.trim_end_matches(';');
    Some(if kept.is_empty() {
        folder.to_owned()
    } else {
        format!("{kept};{folder}")
    })
}

/// `path` without any entry for `folder`, or `None` when it has none.
pub fn without_folder(path: &str, folder: &str) -> Option<String> {
    if !path.split(';').any(|entry| same(entry, folder)) {
        return None;
    }
    Some(
        path.split(';')
            .filter(|entry| !same(entry, folder))
            .collect::<Vec<_>>()
            .join(";"),
    )
}

/// Windows compares paths without case, and a trailing slash doesn't matter.
fn same(entry: &str, folder: &str) -> bool {
    let tidy = |s: &str| s.trim().trim_end_matches(['\\', '/']).to_lowercase();
    !entry.trim().is_empty() && tidy(entry) == tidy(folder)
}

/// The user's `PATH` in `HKEY_CURRENT_USER\Environment`.
#[cfg(windows)]
#[allow(
    unsafe_code,
    reason = "the registry and the settings broadcast need Win32 calls"
)]
pub mod registry {
    use std::io;

    use windows::Win32::Foundation::{ERROR_FILE_NOT_FOUND, LPARAM, WPARAM};
    use windows::Win32::System::Registry::{
        HKEY_CURRENT_USER, REG_EXPAND_SZ, REG_SZ, REG_VALUE_TYPE, RRF_NOEXPAND,
        RRF_RT_REG_EXPAND_SZ, RRF_RT_REG_SZ, RegGetValueW, RegSetKeyValueW,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        HWND_BROADCAST, SMTO_ABORTIFHUNG, SendMessageTimeoutW, WM_SETTINGCHANGE,
    };
    use windows::core::w;

    /// The user's `PATH`, unexpanded, and whether it's stored as
    /// `REG_EXPAND_SZ`. A user without one gets an empty, expandable value.
    pub fn read() -> io::Result<(String, bool)> {
        let flags = RRF_RT_REG_SZ | RRF_RT_REG_EXPAND_SZ | RRF_NOEXPAND;
        let mut kind = REG_VALUE_TYPE::default();
        let mut bytes = 0u32;
        // SAFETY: a size query with no buffer.
        let sized = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                w!("Environment"),
                w!("Path"),
                flags,
                Some(&raw mut kind),
                None,
                Some(&raw mut bytes),
            )
        };
        if sized == ERROR_FILE_NOT_FOUND {
            return Ok((String::new(), true));
        }
        sized.ok().map_err(io::Error::other)?;
        let mut buffer = vec![0u16; (bytes as usize).div_ceil(2)];
        // SAFETY: `buffer` holds the `bytes` the size query asked for.
        unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                w!("Environment"),
                w!("Path"),
                flags,
                Some(&raw mut kind),
                Some(buffer.as_mut_ptr().cast()),
                Some(&raw mut bytes),
            )
        }
        .ok()
        .map_err(io::Error::other)?;
        let len = buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len());
        Ok((
            String::from_utf16_lossy(&buffer[..len]),
            kind == REG_EXPAND_SZ,
        ))
    }

    /// Stores `value` as the user's `PATH`, keeping its registry type, and
    /// tells running programs the environment changed.
    pub fn write(value: &str, expand: bool) -> io::Result<()> {
        let data: Vec<u16> = value.encode_utf16().chain(Some(0)).collect();
        let kind = if expand { REG_EXPAND_SZ } else { REG_SZ };
        let size = u32::try_from(data.len() * 2).map_err(io::Error::other)?;
        // SAFETY: `data` is a NUL-terminated UTF-16 string of `size` bytes.
        unsafe {
            RegSetKeyValueW(
                HKEY_CURRENT_USER,
                w!("Environment"),
                w!("Path"),
                kind.0,
                Some(data.as_ptr().cast()),
                size,
            )
        }
        .ok()
        .map_err(io::Error::other)?;
        let topic = w!("Environment");
        // SAFETY: a broadcast with a static string; hung windows are skipped
        // after the timeout.
        unsafe {
            SendMessageTimeoutW(
                HWND_BROADCAST,
                WM_SETTINGCHANGE,
                WPARAM(0),
                LPARAM(topic.as_ptr() as isize),
                SMTO_ABORTIFHUNG,
                5000,
                None,
            );
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adds_a_folder_once() {
        assert_eq!(
            with_folder(r"C:\a;C:\b", r"C:\app").as_deref(),
            Some(r"C:\a;C:\b;C:\app")
        );
        assert_eq!(
            with_folder(r"C:\a;", r"C:\app").as_deref(),
            Some(r"C:\a;C:\app")
        );
        assert_eq!(with_folder("", r"C:\app").as_deref(), Some(r"C:\app"));
        assert_eq!(with_folder(r"C:\a;c:\APP\", r"C:\app"), None);
    }

    #[test]
    fn removes_every_entry_for_a_folder_and_nothing_else() {
        assert_eq!(
            without_folder(r"C:\a;C:\app;%USERPROFILE%\x;c:\app\", r"C:\app").as_deref(),
            Some(r"C:\a;%USERPROFILE%\x")
        );
        assert_eq!(without_folder(r"C:\a;C:\b", r"C:\app"), None);
        assert_eq!(
            without_folder(r"C:\a;;C:\app", r"C:\app").as_deref(),
            Some(r"C:\a;")
        );
    }
}
