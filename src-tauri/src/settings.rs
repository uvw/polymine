//! Player preferences, saved as JSON in the app's config directory.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use polymine_core::{Level, Rules, TilingId};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::session::CustomSize;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", default)]
#[allow(
    clippy::struct_excessive_bools,
    reason = "each flag is an independent player preference"
)]
pub struct Settings {
    /// The active profile: the name new games are recorded under.
    pub player_name: String,
    /// Every profile's name, the active one among them.
    pub profiles: Vec<String>,
    pub rules: Rules,
    pub tiling: TilingId,
    pub level: Level,
    pub custom: CustomSize,
    pub assistant: AssistantSettings,
    /// Id of the UI theme. The UI owns the theme catalog and falls back to its
    /// default for ids it doesn't know.
    pub theme: String,
    /// Pause the game when the Polymine window loses focus.
    pub pause_on_focus_loss: bool,
    /// Tint themes that support it with the system accent color.
    pub accent_tint: bool,
    /// Size every new custom game to fill the window.
    pub fill_window: bool,
    /// The UI language: `system`, or a locale code such as `en`.
    pub language: String,
    /// Keep the toolbar out of sight until the pointer reaches the top edge.
    pub hide_toolbar: bool,
    /// Remap the board's colors for a color vision deficiency.
    pub color_filter: ColorFilter,
    /// Top-level keys this build doesn't know, such as ones a newer build
    /// wrote. They're saved back as they were, and the window never sees them.
    #[serde(flatten)]
    #[specta(skip)]
    pub extra: Map<String, Value>,
}

/// A color vision deficiency the board's colors can be remapped for.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ColorFilter {
    #[default]
    Off,
    /// Red-green: no green-sensitive cones.
    Deuteranopia,
    /// Red-green: no red-sensitive cones.
    Protanopia,
    /// Blue-yellow: no blue-sensitive cones.
    Tritanopia,
}

/// What the assistant does once the player has been idle for a while.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum IdleAction {
    #[default]
    Off,
    Hint,
    /// The assistant takes over and plays until the player clicks.
    Autoplay,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", default)]
pub struct AssistantSettings {
    /// Pause between autoplay moves.
    pub move_delay_ms: u32,
    /// Autoplay stops instead of guessing when no move is certain.
    pub stop_when_uncertain: bool,
    /// Autoplay starts the next game by itself after one ends.
    pub autostart_next_game: bool,
    pub idle_action: IdleAction,
    /// Seconds without input before the idle action.
    pub idle_seconds: u32,
}

impl Default for AssistantSettings {
    fn default() -> Self {
        Self {
            move_delay_ms: 120,
            stop_when_uncertain: false,
            autostart_next_game: false,
            idle_action: IdleAction::Off,
            idle_seconds: 30,
        }
    }
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            player_name: default_player_name(),
            // Filled in by `normalized`, so settings saved before profiles
            // existed don't gain one named after the system user.
            profiles: Vec::new(),
            rules: Rules::default(),
            tiling: TilingId::Square,
            level: Level::Beginner,
            custom: CustomSize {
                cols: 16,
                rows: 16,
                mines: 40,
            },
            assistant: AssistantSettings::default(),
            theme: "frost".to_owned(),
            pause_on_focus_loss: true,
            accent_tint: true,
            fill_window: false,
            language: "system".to_owned(),
            hide_toolbar: false,
            color_filter: ColorFilter::Off,
            extra: Map::new(),
        }
    }
}

fn default_player_name() -> String {
    std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .ok()
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| "Player".to_owned())
}

impl Settings {
    /// Reads settings, falling back to defaults when the file is missing or
    /// unreadable. Returns the error alongside so the caller can report it.
    /// An error of kind [`io::ErrorKind::Other`] means the file was read and
    /// set aside; any other kind means it couldn't be read at all.
    ///
    /// A value this build doesn't understand takes its field's default while
    /// the rest load, and a copy of the file goes to `settings.json.bad`
    /// before a save can drop the value. A file that isn't JSON at all moves
    /// there instead.
    pub fn load(path: &Path) -> (Self, Option<io::Error>) {
        let bytes = match fs::read(path) {
            Ok(bytes) => bytes,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return (Self::default(), None),
            Err(e) => return (Self::default(), Some(e)),
        };
        match Self::parse_lenient(&bytes) {
            Ok((settings, dropped)) if dropped.is_empty() => (settings, None),
            Ok((settings, dropped)) => {
                let kept = keep_aside(path, fs::copy(path, bad_path(path)).map(drop));
                let message = format!(
                    "unknown values for {} took their defaults; {kept}",
                    dropped.join(", ")
                );
                (settings, Some(io::Error::other(message)))
            }
            Err(e) => {
                let kept = keep_aside(path, fs::rename(path, bad_path(path)));
                (
                    Self::default(),
                    Some(io::Error::other(format!("{e}; {kept}"))),
                )
            }
        }
    }

    /// Parses `bytes`, giving each field whose value doesn't parse its
    /// default. Returns the dotted names of those fields too.
    fn parse_lenient(bytes: &[u8]) -> Result<(Self, Vec<String>), serde_json::Error> {
        let file: Value = serde_json::from_slice(bytes)?;
        let error = match serde_json::from_value(file.clone()) {
            Ok(settings) => return Ok((settings, Vec::new())),
            Err(e) => e,
        };
        let Value::Object(fields) = file else {
            return Err(error);
        };
        let mut merged = serde_json::to_value(Self::default())?;
        let mut values = Vec::new();
        leaves(&merged, fields, &mut Vec::new(), &mut values);
        let mut dropped = Vec::new();
        for (path, value) in values {
            let (key, parents) = path.split_last().expect("paths are never empty");
            let previous = object_at(&mut merged, parents).insert(key.clone(), value);
            if serde_json::from_value::<Self>(merged.clone()).is_err() {
                match previous {
                    Some(previous) => object_at(&mut merged, parents).insert(key.clone(), previous),
                    None => object_at(&mut merged, parents).remove(key),
                };
                dropped.push(path.join("."));
            }
        }
        Ok((serde_json::from_value(merged)?, dropped))
    }

    /// Writes to a temporary file first, so a crash never leaves half a file.
    pub fn save(&self, path: &Path) -> io::Result<()> {
        let json = serde_json::to_string_pretty(self).map_err(io::Error::other)?;
        crate::files::replace(path, json.as_bytes())
    }

    /// Trims the names, drops blank and repeated profiles, falls back to the
    /// default name when the active one is blank, and lists the active one.
    #[must_use]
    pub fn normalized(mut self) -> Self {
        self.player_name = self.player_name.trim().to_owned();
        if self.player_name.is_empty() {
            self.player_name = default_player_name();
        }
        let mut profiles: Vec<String> = Vec::with_capacity(self.profiles.len() + 1);
        for name in self.profiles.iter().map(|n| n.trim()) {
            if !name.is_empty() && !profiles.iter().any(|p| p == name) {
                profiles.push(name.to_owned());
            }
        }
        if !profiles.contains(&self.player_name) {
            profiles.insert(0, self.player_name.clone());
        }
        self.profiles = profiles;
        self
    }
}

/// Every value in `fields`, with its path of keys. Objects that the defaults
/// also hold as objects are walked into, so one bad nested value drops alone.
fn leaves(
    defaults: &Value,
    fields: Map<String, Value>,
    path: &mut Vec<String>,
    out: &mut Vec<(Vec<String>, Value)>,
) {
    for (key, value) in fields {
        path.push(key);
        match (defaults.get(path.last().expect("just pushed")), value) {
            (Some(inner @ Value::Object(_)), Value::Object(nested)) => {
                leaves(inner, nested, path, out);
            }
            (_, value) => out.push((path.clone(), value)),
        }
        path.pop();
    }
}

/// The object `parents` leads to from `root`.
fn object_at<'a>(root: &'a mut Value, parents: &[String]) -> &'a mut Map<String, Value> {
    parents
        .iter()
        .fold(root, |v, k| &mut v[k])
        .as_object_mut()
        .expect("leaves sit in objects")
}

/// Where a file this build can't use is set aside: its name plus `.bad`.
pub(crate) fn bad_path(path: &Path) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(".bad");
    PathBuf::from(name)
}

/// Says where the original settings went, for the load error.
fn keep_aside(path: &Path, result: io::Result<()>) -> String {
    match result {
        Ok(()) => format!("the original is kept as {}", bad_path(path).display()),
        Err(e) => format!("could not keep a copy of the original: {e}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saves_and_loads_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let settings = Settings {
            tiling: TilingId::Cairo,
            ..Settings::default()
        };
        settings.save(&path).unwrap();
        let (loaded, error) = Settings::load(&path);
        assert!(error.is_none());
        assert_eq!(loaded, settings);
    }

    #[test]
    fn keys_from_a_newer_build_survive_a_save() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        fs::write(&path, r#"{ "tiling": "hexagon", "futureKey": [1, 2] }"#).unwrap();
        let (loaded, error) = Settings::load(&path);
        assert!(error.is_none());
        loaded.save(&path).unwrap();
        let saved: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(saved["futureKey"], serde_json::json!([1, 2]));
        assert_eq!(saved["tiling"], "hexagon");
    }

    #[test]
    fn missing_fields_take_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        fs::write(&path, r#"{ "tiling": "hexagon" }"#).unwrap();
        let (loaded, error) = Settings::load(&path);
        assert!(error.is_none());
        assert_eq!(loaded.tiling, TilingId::Hexagon);
        assert_eq!(loaded.rules, Rules::default());
        assert!(loaded.pause_on_focus_loss);
    }

    #[test]
    fn normalizing_restores_a_blank_player_name() {
        let settings = Settings {
            player_name: "   ".to_owned(),
            ..Settings::default()
        }
        .normalized();
        assert_eq!(settings.player_name, Settings::default().player_name);
    }

    #[test]
    fn normalizing_keeps_one_profile_per_name_with_the_active_one_listed() {
        let settings = Settings {
            player_name: " cy ".to_owned(),
            profiles: vec![" ann".into(), String::new(), "bob".into(), "ann".into()],
            ..Settings::default()
        }
        .normalized();
        assert_eq!(settings.player_name, "cy");
        assert_eq!(settings.profiles, ["cy", "ann", "bob"]);
    }

    #[test]
    fn settings_from_before_profiles_list_the_player() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, r#"{"playerName":"ann"}"#).unwrap();
        let (settings, _) = Settings::load(&path);
        assert_eq!(settings.normalized().profiles, ["ann"]);
    }

    #[test]
    fn unreadable_file_reports_the_error() {
        let dir = tempfile::tempdir().unwrap();
        // A directory in place of the file can't be read as text.
        let path = dir.path().join("settings.json");
        fs::create_dir(&path).unwrap();
        let (_, error) = Settings::load(&path);
        assert!(error.is_some());
    }

    #[test]
    fn corrupt_file_falls_back_and_is_moved_aside() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let bad = dir.path().join("settings.json.bad");
        fs::write(&bad, "an older bad file").unwrap();
        fs::write(&path, "{ nope").unwrap();
        let (loaded, error) = Settings::load(&path);
        assert!(error.is_some());
        assert_eq!(loaded, Settings::default());
        assert!(!path.exists());
        assert_eq!(fs::read_to_string(&bad).unwrap(), "{ nope");
    }

    #[test]
    fn an_unknown_value_falls_back_for_its_field_only() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let text = r#"{
            "tiling": "hexagon",
            "level": "nonsense",
            "theme": "datum",
            "custom": { "cols": 9 },
            "assistant": { "idleAction": "dance", "idleSeconds": 9 }
        }"#;
        fs::write(&path, text).unwrap();
        let (loaded, error) = Settings::load(&path);
        let error = error.expect("the dropped values are reported").to_string();
        assert!(error.contains("level") && error.contains("assistant.idleAction"));
        assert_eq!(loaded.tiling, TilingId::Hexagon);
        assert_eq!(loaded.level, Level::Beginner);
        assert_eq!(loaded.theme, "datum");
        assert_eq!(loaded.custom.cols, 9);
        assert_eq!(loaded.custom.rows, Settings::default().custom.rows);
        assert_eq!(loaded.assistant.idle_seconds, 9);
        assert_eq!(loaded.assistant.idle_action, IdleAction::Off);
        // The file stays, and a copy keeps the values a save would drop.
        assert_eq!(fs::read_to_string(&path).unwrap(), text);
        assert_eq!(
            fs::read_to_string(dir.path().join("settings.json.bad")).unwrap(),
            text
        );
    }

    #[test]
    fn the_color_filter_loads_and_falls_back_to_off() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        fs::write(&path, r#"{ "colorFilter": "tritanopia" }"#).unwrap();
        let (loaded, error) = Settings::load(&path);
        assert!(error.is_none());
        assert_eq!(loaded.color_filter, ColorFilter::Tritanopia);

        fs::write(&path, r#"{ "colorFilter": "sepia", "theme": "datum" }"#).unwrap();
        let (loaded, error) = Settings::load(&path);
        let error = error.expect("the dropped value is reported").to_string();
        assert!(error.contains("colorFilter"));
        assert_eq!(loaded.color_filter, ColorFilter::Off);
        assert_eq!(loaded.theme, "datum");
    }

    #[test]
    fn bytes_that_are_not_utf8_count_as_corrupt() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        fs::write(&path, b"{\"theme\": \"\xff\"}").unwrap();
        let (loaded, error) = Settings::load(&path);
        assert!(error.is_some());
        assert_eq!(loaded, Settings::default());
        assert!(dir.path().join("settings.json.bad").exists());
    }
}
