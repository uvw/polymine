//! Player themes from the instance's `themes` folder, for the UI. The folder
//! rules live in `polymine_ipc::themes`.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

use polymine_ipc::themes::{self, ListedTheme, ThemeFolder};
use serde::Serialize;
use tauri::State;

use crate::error::AppError;
use crate::guard;

/// Where player themes live, when the platform has a data folder.
#[derive(Debug)]
pub struct Themes {
    dir: Option<PathBuf>,
    /// Skip reasons already logged, so a listing on every focus logs each once.
    logged: Mutex<HashSet<String>>,
}

impl Themes {
    pub fn new(data_dir: Option<&Path>) -> Self {
        Self {
            dir: data_dir.map(themes::themes_dir),
            logged: Mutex::default(),
        }
    }

    fn list(&self) -> ThemeList {
        let mut list = ThemeList {
            folder: self.dir.as_ref().map(|d| d.display().to_string()),
            themes: Vec::new(),
            skipped: Vec::new(),
        };
        let Some(dir) = &self.dir else { return list };
        let listing = match themes::list(dir) {
            Ok(listing) => listing,
            Err(e) => {
                self.log_once(format!("could not list {}: {e}", dir.display()));
                return list;
            }
        };
        for skipped in listing.skipped {
            self.log_once(format!("skipped theme {}: {}", skipped.id, skipped.reason));
            list.skipped.push(SkippedTheme {
                id: skipped.id,
                reason: skipped.reason,
            });
        }
        list.themes = listing.themes.into_iter().map(ThemeSummary::from).collect();
        list
    }

    fn log_once(&self, message: String) {
        let mut logged = self
            .logged
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if !logged.contains(&message) {
            log::warn!("{message}");
            logged.insert(message);
        }
    }
}

/// The player themes folder and what it holds.
#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ThemeList {
    /// The folder's path, or `None` when the platform has no data folder.
    pub folder: Option<String>,
    pub themes: Vec<ThemeSummary>,
    pub skipped: Vec<SkippedTheme>,
}

/// A usable theme, without its SVG files, which `read_theme` brings.
#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ThemeSummary {
    pub id: String,
    pub css: String,
    /// `preview.png` as a `data:` URL.
    pub preview: Option<String>,
    /// The glyphs the folder has SVG files for.
    pub glyphs: Vec<String>,
}

/// A theme folder that can't be used, and why, in words for the player.
#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SkippedTheme {
    pub id: String,
    pub reason: String,
}

/// Every file of one theme.
#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ThemeFiles {
    pub id: String,
    pub css: String,
    pub preview: Option<String>,
    pub glyphs: Vec<ThemeGlyph>,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ThemeGlyph {
    pub name: String,
    pub svg: String,
}

impl From<ListedTheme> for ThemeSummary {
    fn from(theme: ListedTheme) -> Self {
        Self {
            id: theme.id,
            css: theme.css,
            preview: theme.preview.as_deref().map(png_data_url),
            glyphs: theme.glyphs,
        }
    }
}

impl From<ThemeFolder> for ThemeFiles {
    fn from(theme: ThemeFolder) -> Self {
        Self {
            id: theme.id,
            css: theme.css,
            preview: theme.preview.as_deref().map(png_data_url),
            glyphs: theme
                .glyphs
                .into_iter()
                .map(|g| ThemeGlyph {
                    name: g.name,
                    svg: g.svg,
                })
                .collect(),
        }
    }
}

fn png_data_url(png: &[u8]) -> String {
    format!("data:image/png;base64,{}", base64(png))
}

/// Standard base64 with padding.
fn base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = chunk
            .iter()
            .enumerate()
            .fold(0_u32, |n, (i, &b)| n | u32::from(b) << (16 - 8 * i));
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(char::from(ALPHABET[(n >> (18 - 6 * i) & 63) as usize]));
            } else {
                out.push('=');
            }
        }
    }
    out
}

/// Lists the player's themes. Folders that break the rules come back in
/// `skipped`, and the log says why once.
#[tauri::command(async)]
#[specta::specta]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri injects command arguments by value"
)]
pub fn list_themes(themes: State<'_, Themes>) -> Result<ThemeList, AppError> {
    guard::command("list_themes", || Ok(themes.list()))
}

/// Every file of the player theme `id`.
#[tauri::command(async)]
#[specta::specta]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri injects command arguments by value"
)]
pub fn read_theme(themes: State<'_, Themes>, id: String) -> Result<ThemeFiles, AppError> {
    guard::command("read_theme", || {
        let dir = themes.dir.as_deref().ok_or(AppError::NoThemesFolder)?;
        Ok(themes::read_theme(dir, &id)?.into())
    })
}

/// Opens the themes folder in Finder, Explorer, or the desktop's file
/// manager, creating it first.
#[tauri::command]
#[specta::specta]
#[allow(
    clippy::needless_pass_by_value,
    reason = "Tauri injects command arguments by value"
)]
pub fn open_themes_folder(themes: State<'_, Themes>) -> Result<(), AppError> {
    guard::command("open_themes_folder", || {
        let dir = themes.dir.as_deref().ok_or(AppError::NoThemesFolder)?;
        std::fs::create_dir_all(dir).map_err(AppError::OpenFolder)?;
        let opener = if cfg!(target_os = "macos") {
            "open"
        } else if cfg!(target_os = "windows") {
            "explorer"
        } else {
            "xdg-open"
        };
        // Explorer opens Documents instead of a folder written with forward
        // slashes, which a data folder override such as `C:/scratch` produces.
        #[cfg(target_os = "windows")]
        let dir = std::path::PathBuf::from(dir.to_string_lossy().replace('/', "\\"));
        let mut child = Command::new(opener)
            .arg(dir)
            .spawn()
            .map_err(AppError::OpenFolder)?;
        // Reaps the opener when it exits, so it doesn't linger as a zombie.
        std::thread::spawn(move || child.wait());
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn encodes_base64_with_padding() {
        let cases = [
            ("", ""),
            ("f", "Zg=="),
            ("fo", "Zm8="),
            ("foo", "Zm9v"),
            ("foob", "Zm9vYg=="),
            ("fooba", "Zm9vYmE="),
            ("foobar", "Zm9vYmFy"),
        ];
        for (plain, encoded) in cases {
            assert_eq!(base64(plain.as_bytes()), encoded, "{plain}");
        }
        assert_eq!(base64(&[0xfb, 0xff]), "+/8=");
    }

    #[test]
    fn lists_themes_with_previews_as_data_urls_and_skips_with_reasons() {
        let data = tempfile::tempdir().unwrap();
        let root = themes::themes_dir(data.path());
        let good = root.join("good");
        fs::create_dir_all(&good).unwrap();
        fs::write(good.join("theme.css"), ":root {}").unwrap();
        fs::write(good.join("flag.svg"), "<svg/>").unwrap();
        let mut png = b"\x89PNG\r\n\x1a\n\0\0\0\x0dIHDR".to_vec();
        png.extend(2_u32.to_be_bytes());
        png.extend(1_u32.to_be_bytes());
        fs::write(good.join("preview.png"), &png).unwrap();
        fs::create_dir_all(root.join("bad")).unwrap();

        let themes = Themes::new(Some(data.path()));
        let list = themes.list();
        assert_eq!(list.folder, Some(root.display().to_string()));
        assert_eq!(list.themes.len(), 1);
        let summary = &list.themes[0];
        assert_eq!(summary.glyphs, ["flag"]);
        assert!(
            summary
                .preview
                .as_deref()
                .is_some_and(|p| p.starts_with("data:image/png;base64,iVBORw0KGgo"))
        );
        assert_eq!(list.skipped.len(), 1);
        assert!(list.skipped[0].reason.contains("no theme.css"));
        assert_eq!(themes.logged.lock().unwrap().len(), 1);
        themes.list();
        assert_eq!(themes.logged.lock().unwrap().len(), 1);

        let files = ThemeFiles::from(themes::read_theme(&root, "good").unwrap());
        assert_eq!(files.glyphs[0].svg, "<svg/>");
    }

    #[test]
    fn has_nothing_without_a_data_folder() {
        let list = Themes::new(None).list();
        assert!(list.folder.is_none());
        assert!(list.themes.is_empty());
    }
}
