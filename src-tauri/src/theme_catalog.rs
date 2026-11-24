//! The themes `polymine-cli theme` can pick: the built-in ones and the
//! player's folders. It follows the window's catalog in `ui/src/lib/themes`,
//! so an id the CLI accepts is one the window shows.

use std::path::{Path, PathBuf};

use polymine_ipc::themes;
use polymine_ipc::{ErrorBody, ErrorCode};
use serde::Serialize;

// The folders in `ui/src/themes`, as `build.rs` found them.
include!(concat!(env!("OUT_DIR"), "/built_in_themes.rs"));

/// Built-in themes only some builds show: `EXPERIMENTAL_THEMES` in
/// `ui/src/lib/themes/builtin.ts`.
const EXPERIMENTAL_THEMES: &[&str] = &["ferrofluid"];

/// Old ids of built-in themes and the ids they took: `RENAMED_BUILT_INS` in
/// `ui/src/lib/themes/builtin.ts`.
const RENAMED_THEMES: &[(&str, &str)] = &[
    ("charcoal", "datum"),
    ("orbital-night", "atom-one-dark"),
    ("nightshift", "one-dark-pro"),
    ("velvet", "dracula"),
    ("night-market", "monokai"),
    ("late-commit", "github-dark"),
    ("orbital-day", "atom-one-light"),
    ("clean-diff", "github-light"),
    ("sundial", "solarized-light"),
    ("marshmallow", "catppuccin-latte"),
];

/// Whether this build shows the experimental themes. The window shows them in
/// development and in builds made with `VITE_EXPERIMENTS=1`.
pub fn experiments() -> bool {
    cfg!(debug_assertions) || option_env!("VITE_EXPERIMENTS") == Some("1")
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Source {
    BuiltIn,
    Experimental,
    Player,
}

#[derive(Clone, Debug, Serialize)]
pub struct Entry {
    pub id: String,
    pub source: Source,
}

/// A player's folder the window leaves out, and why.
#[derive(Clone, Debug, Serialize)]
pub struct Skipped {
    pub id: String,
    pub reason: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct Catalog {
    /// The player themes folder, when the instance has a data folder.
    pub folder: Option<PathBuf>,
    /// The built-in themes by id, then the player's.
    pub themes: Vec<Entry>,
    pub skipped: Vec<Skipped>,
    #[serde(skip)]
    experiments: bool,
}

impl Catalog {
    /// Lists the built-in themes and the player themes in `folder`, which is
    /// read again on every call.
    pub fn read(folder: Option<&Path>, experiments: bool) -> Self {
        let mut themes: Vec<Entry> = BUILT_IN_THEMES
            .iter()
            .filter_map(|&id| {
                let source = if EXPERIMENTAL_THEMES.contains(&id) {
                    experiments.then_some(Source::Experimental)?
                } else {
                    Source::BuiltIn
                };
                Some(Entry {
                    id: id.to_owned(),
                    source,
                })
            })
            .collect();
        let mut skipped = Vec::new();
        let listing = folder.map(themes::list).transpose().unwrap_or_else(|e| {
            log::warn!("could not list the player's themes: {e}");
            None
        });
        for theme in listing.iter().flat_map(|l| &l.themes) {
            let taken = themes.iter().any(|t| t.id == theme.id)
                || RENAMED_THEMES.iter().any(|(old, _)| *old == theme.id);
            if taken {
                skipped.push(Skipped {
                    id: theme.id.clone(),
                    reason: "a built-in theme has this name".to_owned(),
                });
            } else {
                themes.push(Entry {
                    id: theme.id.clone(),
                    source: Source::Player,
                });
            }
        }
        skipped.extend(
            listing
                .into_iter()
                .flat_map(|l| l.skipped)
                .map(|s| Skipped {
                    id: s.id,
                    reason: s.reason,
                }),
        );
        Self {
            folder: folder.map(Path::to_path_buf),
            themes,
            skipped,
            experiments,
        }
    }

    /// Where the theme `id` comes from, or why the window can't show it. A
    /// player's theme is read whole, glyphs included, as the window reads the
    /// theme it shows.
    pub fn check(&self, id: &str) -> Result<Source, ErrorBody> {
        let refused = |message: String| ErrorBody::new(ErrorCode::InvalidValue, message);
        if let Some((_, now)) = RENAMED_THEMES.iter().find(|(old, _)| *old == id) {
            return Err(refused(format!("theme {id} is called {now} now"))
                .with_hint(format!("use `{now}`")));
        }
        let fix = || {
            let folder = self.folder.as_ref().map_or_else(
                || "the themes folder".to_owned(),
                |f| f.display().to_string(),
            );
            format!("fix the theme's folder in {folder}, then run `theme use {id}` again")
        };
        match self.themes.iter().find(|t| t.id == id).map(|t| t.source) {
            Some(Source::Player) => {
                let folder = self.folder.as_deref().expect("player themes have a folder");
                match themes::read_theme(folder, id) {
                    Ok(_) => Ok(Source::Player),
                    Err(e) => {
                        Err(refused(format!("theme {id} can't be used: {e}")).with_hint(fix()))
                    }
                }
            }
            Some(source) => Ok(source),
            None => match self.skipped.iter().find(|s| s.id == id) {
                Some(s) => {
                    Err(refused(format!("theme {id} can't be used: {}", s.reason)).with_hint(fix()))
                }
                None if !self.experiments && EXPERIMENTAL_THEMES.contains(&id) => Err(refused(
                    format!("theme {id} is an experiment this build doesn't show"),
                )
                .with_hint(self.choices())),
                None => {
                    Err(refused(format!("there is no theme named {id}")).with_hint(self.choices()))
                }
            },
        }
    }

    fn choices(&self) -> String {
        let ids: Vec<&str> = self.themes.iter().map(|t| t.id.as_str()).collect();
        format!(
            "use one of: {}; `polymine-cli theme list` says where each comes from",
            ids.join(", ")
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const CSS: &str = "/* Name: Dusk */ :root { --cell-closed: #123456; }";

    fn folder_with(themes: &[(&str, Option<&str>)]) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        for (id, css) in themes {
            let theme = dir.path().join(id);
            std::fs::create_dir(&theme).unwrap();
            if let Some(css) = css {
                std::fs::write(theme.join("theme.css"), css).unwrap();
            }
        }
        dir
    }

    fn source(catalog: &Catalog, id: &str) -> Option<Source> {
        catalog.themes.iter().find(|t| t.id == id).map(|t| t.source)
    }

    #[test]
    fn lists_the_built_in_themes_and_the_players() {
        let dir = folder_with(&[("dusk", Some(CSS)), ("empty", None)]);
        let catalog = Catalog::read(Some(dir.path()), false);
        assert_eq!(source(&catalog, "frost"), Some(Source::BuiltIn));
        assert_eq!(source(&catalog, "dusk"), Some(Source::Player));
        assert_eq!(catalog.themes.last().unwrap().id, "dusk");
        assert_eq!(catalog.skipped.len(), 1);
        assert_eq!(catalog.skipped[0].id, "empty");
        assert_eq!(catalog.check("dusk").unwrap(), Source::Player);
        let broken = catalog.check("empty").unwrap_err();
        assert_eq!(broken.code, ErrorCode::InvalidValue);
        assert!(broken.message.contains("theme.css"), "{}", broken.message);
        assert!(broken.hint.unwrap().contains("theme use empty"));
    }

    #[test]
    fn built_in_names_win_over_the_players_folders() {
        let dir = folder_with(&[("graphite", Some(CSS)), ("charcoal", Some(CSS))]);
        let catalog = Catalog::read(Some(dir.path()), false);
        assert_eq!(source(&catalog, "graphite"), Some(Source::BuiltIn));
        assert_eq!(source(&catalog, "charcoal"), None);
        let skipped: Vec<&str> = catalog.skipped.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(skipped, ["charcoal", "graphite"]);
        assert_eq!(catalog.check("graphite").unwrap(), Source::BuiltIn);
        let renamed = catalog.check("charcoal").unwrap_err();
        assert_eq!(renamed.hint.as_deref(), Some("use `datum`"));
    }

    #[test]
    fn experiments_show_only_in_builds_that_list_them() {
        let with = Catalog::read(None, true);
        assert_eq!(with.check("ferrofluid").unwrap(), Source::Experimental);
        let without = Catalog::read(None, false);
        assert_eq!(source(&without, "ferrofluid"), None);
        let refused = without.check("ferrofluid").unwrap_err();
        assert!(
            refused.message.contains("experiment"),
            "{}",
            refused.message
        );
        // A player's folder may take the name in a build without it.
        let dir = folder_with(&[("ferrofluid", Some(CSS))]);
        let catalog = Catalog::read(Some(dir.path()), false);
        assert_eq!(source(&catalog, "ferrofluid"), Some(Source::Player));
    }

    #[test]
    fn an_unknown_id_names_the_ones_there_are() {
        let catalog = Catalog::read(None, false);
        let unknown = catalog.check("nope").unwrap_err();
        assert_eq!(unknown.code, ErrorCode::InvalidValue);
        let hint = unknown.hint.unwrap();
        assert!(
            hint.contains("frost, ") && hint.contains("theme list"),
            "{hint}"
        );
    }

    /// The window's lists of experiments and renamed themes, read from its
    /// source, so the two stay the same.
    #[test]
    fn matches_the_windows_catalog() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
        let builtin = std::fs::read_to_string(root.join("ui/src/lib/themes/builtin.ts")).unwrap();
        let quoted = |text: &str| -> Vec<String> {
            text.split('"')
                .skip(1)
                .step_by(2)
                .map(str::to_owned)
                .collect()
        };
        let experiments = builtin
            .lines()
            .find(|l| l.starts_with("export const EXPERIMENTAL_THEMES"))
            .unwrap();
        assert_eq!(
            quoted(experiments.split('=').nth(1).unwrap()),
            EXPERIMENTAL_THEMES
        );
        let renamed = builtin
            .split("RENAMED_BUILT_INS")
            .nth(1)
            .and_then(|rest| rest.split("]);").next())
            .unwrap();
        let pairs: Vec<(String, String)> = quoted(renamed)
            .chunks(2)
            .map(|pair| (pair[0].clone(), pair[1].clone()))
            .collect();
        let ours: Vec<(String, String)> = RENAMED_THEMES
            .iter()
            .map(|(a, b)| ((*a).to_owned(), (*b).to_owned()))
            .collect();
        assert_eq!(pairs, ours);
        let folders = std::fs::read_dir(root.join("ui/src/themes"))
            .unwrap()
            .filter(|e| e.as_ref().unwrap().path().is_dir())
            .count();
        assert_eq!(BUILT_IN_THEMES.len(), folders);
        assert!(BUILT_IN_THEMES.contains(&"frost"));
    }
}
