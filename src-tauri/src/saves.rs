//! Named saves: games the player keeps under a name in the `saves` folder
//! beside the autosave, and loads again later. Each is the autosave's
//! `SavedGame`, so loading replays its moves the same way.

use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use polymine_core::{Level, TilingId};
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::session::SavedGame;

const MAX_NAME: usize = 40;

/// One save, as the Saves dialog lists it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SaveInfo {
    pub name: String,
    pub tiling: TilingId,
    pub level: Level,
    pub cols: u32,
    pub rows: u32,
    pub mines: u32,
    pub elapsed_ms: u64,
    /// Unix time in milliseconds, from the file.
    pub saved_at: i64,
}

/// `name` trimmed, if it can name a file on every platform.
pub fn valid_name(name: &str) -> Result<&str, AppError> {
    let name = name.trim();
    let bad_char = name
        .chars()
        .any(|c| c.is_control() || r#"<>:"/\|?*"#.contains(c));
    let reserved = polymine_ipc::names::is_device_name(name);
    if name.is_empty()
        || name.chars().count() > MAX_NAME
        || bad_char
        || reserved
        || name.ends_with('.')
    {
        return Err(AppError::SaveName(name.to_owned()));
    }
    Ok(name)
}

fn file(dir: &Path, name: &str) -> PathBuf {
    dir.join(format!("{name}.json"))
}

/// Every save in `dir` this build can read, newest first.
pub fn list(dir: &Path) -> Vec<SaveInfo> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut saves: Vec<SaveInfo> = entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            let name = path.file_stem()?.to_str()?.to_owned();
            if path.extension()? != "json" || valid_name(&name).ok()? != name {
                return None;
            }
            let saved = read_file(&path)?;
            Some(info(&name, &saved, &path))
        })
        .collect();
    saves.sort_by(|a, b| {
        b.saved_at
            .cmp(&a.saved_at)
            .then_with(|| a.name.cmp(&b.name))
    });
    saves
}

fn read_file(path: &Path) -> Option<SavedGame> {
    serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()
}

fn info(name: &str, saved: &SavedGame, path: &Path) -> SaveInfo {
    let saved_at = std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX));
    SaveInfo {
        name: name.to_owned(),
        tiling: saved.config.tiling,
        level: saved.config.level,
        cols: saved.config.cols,
        rows: saved.config.rows,
        mines: saved.config.mines,
        elapsed_ms: saved.elapsed_ms,
        saved_at,
    }
}

/// Writes `saved` as `name`, replacing a save of that name.
pub fn write(dir: &Path, name: &str, saved: &SavedGame) -> Result<SaveInfo, AppError> {
    let name = valid_name(name)?;
    std::fs::create_dir_all(dir)?;
    let path = file(dir, name);
    let json = serde_json::to_string(saved).map_err(std::io::Error::other)?;
    crate::files::replace(&path, json.as_bytes())?;
    Ok(info(name, saved, &path))
}

pub fn read(dir: &Path, name: &str) -> Result<SavedGame, AppError> {
    let name = valid_name(name)?;
    read_file(&file(dir, name)).ok_or_else(|| AppError::NoSave(name.to_owned()))
}

pub fn delete(dir: &Path, name: &str) -> Result<(), AppError> {
    let name = valid_name(name)?;
    match std::fs::remove_file(file(dir, name)) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            Err(AppError::NoSave(name.to_owned()))
        }
        other => Ok(other?),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use polymine_core::{GameConfig, Rules};

    fn game() -> SavedGame {
        SavedGame {
            config: GameConfig::preset(TilingId::Hexagon, Level::Amateur),
            seed: 7,
            rules: Rules::default(),
            moves: Vec::new(),
            elapsed_ms: 1234,
            assisted: false,
        }
    }

    #[test]
    fn names_work_as_files_everywhere() {
        assert_eq!(valid_name("  Tricky corner ").unwrap(), "Tricky corner");
        for bad in [
            "",
            "   ",
            "a/b",
            r"a\b",
            "what?",
            "con",
            "LPT1",
            "nul.x",
            "COM¹",
            "dots.",
            &"x".repeat(41),
        ] {
            assert!(valid_name(bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn the_name_error_states_the_rule() {
        let message = valid_name("a?b").unwrap_err().to_string();
        assert_eq!(
            message,
            r#""a?b" can't name a save. Use 1 to 40 characters, without < > : " / \ | ? * or control characters. Don't end it with a dot or use a Windows device name such as CON or COM1."#
        );
        for c in r#"<>:"/\|?*"#.chars() {
            assert!(valid_name(&format!("a{c}b")).is_err(), "{c}");
        }
        assert!(valid_name("a\u{7}b").is_err());
        for good in ["Café #1 (hard), v2.0", "ünïcödé_ÿ", &"é".repeat(40)] {
            assert_eq!(valid_name(good).unwrap(), good);
        }
    }

    #[test]
    fn saves_lists_reads_and_deletes() {
        let dir = tempfile::tempdir().unwrap();
        let info = write(dir.path(), "first", &game()).unwrap();
        assert_eq!(
            (info.tiling, info.level, info.elapsed_ms),
            (TilingId::Hexagon, Level::Amateur, 1234)
        );
        write(dir.path(), "second", &game()).unwrap();
        std::fs::write(dir.path().join("broken.json"), "not json").unwrap();
        let names: Vec<_> = list(dir.path()).into_iter().map(|s| s.name).collect();
        assert_eq!(names.len(), 2);
        assert!(names.contains(&"first".to_owned()) && names.contains(&"second".to_owned()));
        assert_eq!(read(dir.path(), "first").unwrap().seed, 7);
        delete(dir.path(), "first").unwrap();
        assert!(matches!(
            read(dir.path(), "first"),
            Err(AppError::NoSave(_))
        ));
        assert!(matches!(
            delete(dir.path(), "first"),
            Err(AppError::NoSave(_))
        ));
    }
}
