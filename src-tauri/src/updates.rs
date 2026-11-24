//! Updates from GitHub releases: which copies look for them, when, and the
//! commands that check for, download, and install a signed release.
//!
//! `tauri-plugin-updater` reads the endpoint and the public key from
//! `tauri.conf.json`, and refuses a download whose signature or signed version
//! doesn't match. Nothing installs until the player asks.
#![allow(
    clippy::needless_pass_by_value,
    reason = "Tauri injects command arguments by value"
)]

use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use polymine_ipc::InstanceName;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_updater::{Update, Updater, UpdaterExt};

use crate::app::App;
use crate::error::AppError;
use crate::guard;
use crate::links;

/// The event that reports a download's progress to the window.
pub const PROGRESS_EVENT: &str = "polymine://update-progress";
/// Where a release's notes live, before its tag.
const RELEASES: &str = "https://github.com/uvw/polymine/releases/tag/v";
/// The least time between two automatic checks.
const CHECK_EVERY_MS: i64 = 24 * 60 * 60 * 1000;
/// The app's own record of its checks, beside the history. The player never
/// edits it, so it stays out of the settings.
const STATE_FILE: &str = "updates.json";
/// Progress reports while the size is unknown, one per this many bytes.
const UNKNOWN_SIZE_STEP: u64 = 1 << 20;

/// What decides whether a running copy of Polymine updates itself.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RunningCopy {
    /// The default instance, not one named by `--instance` or
    /// `POLYMINE_INSTANCE`.
    pub default_instance: bool,
    /// Data kept in a folder of its own: `POLYMINE_DATA_DIR`, or a portable
    /// copy's `data` folder.
    pub own_data_dir: bool,
    /// A debug build, such as `npm run app` or a test.
    pub debug_build: bool,
}

impl RunningCopy {
    /// This build, running as `instance`.
    pub fn new(instance: &InstanceName, own_data_dir: bool) -> Self {
        Self {
            default_instance: instance.is_default(),
            own_data_dir,
            debug_build: cfg!(debug_assertions),
        }
    }
}

/// Whether `copy` checks for and installs updates. Only the player's own
/// installed copy does: a named instance, a portable copy, a copy with its own
/// data folder, or a debug build never contacts GitHub on its own.
pub fn updates_itself(copy: RunningCopy) -> bool {
    copy.default_instance && !copy.own_data_dir && !copy.debug_build
}

/// Whether an automatic check is due at `now_ms`, given the last one. A clock
/// set back past the last check makes one due, so a wrong date can't stop
/// checks for good.
pub fn check_due(last_ms: Option<i64>, now_ms: i64) -> bool {
    last_ms.is_none_or(|last| now_ms < last || now_ms - last >= CHECK_EVERY_MS)
}

/// What `updates.json` holds.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Record {
    /// When a check last reached GitHub, in Unix milliseconds.
    last_check_ms: Option<i64>,
}

/// A release newer than this one, as the window shows it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    /// The release notes from the manifest, as Markdown.
    pub notes: Option<String>,
    /// When the release was published, in Unix milliseconds.
    pub date_ms: Option<i64>,
}

/// How far a download has come, sent as [`PROGRESS_EVENT`].
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", tag = "phase")]
pub enum UpdateProgress {
    /// Bytes so far, and the whole size when the server sent it.
    Downloading { downloaded: u64, total: Option<u64> },
    /// The download passed its signature check and is installing.
    Installing,
}

/// Counts a download's bytes and says when the window should hear about it:
/// at each whole percent, or each [`UNKNOWN_SIZE_STEP`] without a size.
#[derive(Debug, Default)]
struct Progress {
    downloaded: u64,
    /// The percent, or the step without a size, last reported.
    reported: u64,
}

impl Progress {
    /// Adds `chunk` bytes, returning a report when one is due.
    fn advance(&mut self, chunk: usize, total: Option<u64>) -> Option<UpdateProgress> {
        self.downloaded += chunk as u64;
        let total = total.filter(|&t| t > 0);
        let mark = match total {
            Some(total) => self.downloaded.saturating_mul(100) / total,
            None => self.downloaded / UNKNOWN_SIZE_STEP,
        };
        (mark > self.reported).then(|| {
            self.reported = mark;
            UpdateProgress::Downloading {
                downloaded: self.downloaded,
                total,
            }
        })
    }
}

/// The updater's state for the app: whether this copy updates itself, when it
/// last checked, and the release the last check found.
#[derive(Debug)]
pub struct Updates {
    enabled: bool,
    path: Option<PathBuf>,
    record: Mutex<Record>,
    found: Mutex<Option<Found>>,
    installing: AtomicBool,
}

/// A release the last check found.
struct Found(Update);

impl std::fmt::Debug for Found {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_tuple("Found").field(&self.0.version).finish()
    }
}

impl Updates {
    /// Reads the last check time from `data_dir`. A missing or unreadable
    /// record counts as never checked.
    pub fn new(enabled: bool, data_dir: Option<&Path>) -> Self {
        let path = data_dir.map(|d| d.join(STATE_FILE));
        let record = path
            .as_deref()
            .and_then(|p| std::fs::read(p).ok())
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        Self {
            enabled,
            path,
            record: Mutex::new(record),
            found: Mutex::new(None),
            installing: AtomicBool::new(false),
        }
    }

    /// Whether the automatic check should run at `now_ms`.
    fn due(&self, setting_on: bool, now_ms: i64) -> bool {
        self.enabled && setting_on && check_due(lock(&self.record).last_check_ms, now_ms)
    }

    /// Remembers that a check reached GitHub at `now_ms`.
    fn checked(&self, now_ms: i64) {
        let mut record = lock(&self.record);
        record.last_check_ms = Some(now_ms);
        let Some(path) = &self.path else { return };
        let saved = serde_json::to_string_pretty(&*record)
            .map_err(io::Error::other)
            .and_then(|json| crate::files::replace(path, json.as_bytes()));
        if let Err(e) = saved {
            log::warn!("could not save the time of the update check: {e}");
        }
    }

    fn found(&self) -> Option<Update> {
        lock(&self.found).as_ref().map(|found| found.0.clone())
    }
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn unix_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as i64)
}

/// The release page for `version`, or `None` when the version holds anything
/// but the letters, digits, dots, plus signs, and hyphens a version uses. The
/// manifest is served over HTTPS but isn't signed.
pub fn release_notes_url(version: &str) -> Option<String> {
    let plain = !version.is_empty()
        && version
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'+' | b'-'));
    plain.then(|| format!("{RELEASES}{version}"))
}

/// An updater error in words for the player.
fn plain(error: &tauri_plugin_updater::Error) -> String {
    use tauri_plugin_updater::Error;
    match error {
        Error::Reqwest(_) | Error::Network(_) => {
            "Polymine couldn't reach GitHub; check the connection and try again".to_owned()
        }
        Error::ReleaseNotFound
        | Error::Serialization(_)
        | Error::TargetNotFound(_)
        | Error::TargetsNotFound(_) => {
            "GitHub has no update information for this copy of Polymine yet; try again later"
                .to_owned()
        }
        Error::Minisign(_)
        | Error::Base64(_)
        | Error::SignatureUtf8(_)
        | Error::SignedVersionMismatch { .. }
        | Error::MissingSignedVersion => {
            "the download didn't match its signature, so nothing was installed".to_owned()
        }
        other => other.to_string(),
    }
}

/// The updater, with a hook that saves the game before the Windows installer
/// ends the process.
fn updater(app: &AppHandle) -> tauri_plugin_updater::Result<Updater> {
    let handle = app.clone();
    app.updater_builder()
        .on_before_exit(move || {
            crate::save_on_exit(&handle);
            handle.cleanup_before_exit();
        })
        .build()
}

/// Looks for a release newer than this one. An automatic check runs only when
/// the setting is on and a day has passed since the last one, and otherwise
/// returns `None` without a request. A check by hand always runs.
#[tauri::command]
#[specta::specta]
pub async fn check_for_update(
    app: AppHandle,
    updates: State<'_, Updates>,
    game: State<'_, App>,
    automatic: bool,
) -> Result<Option<UpdateInfo>, AppError> {
    guard::command_async("check_for_update", async {
        if !updates.enabled {
            return if automatic {
                Ok(None)
            } else {
                Err(AppError::UpdatesOff)
            };
        }
        let now = unix_ms();
        if automatic && !updates.due(game.settings().check_for_updates, now) {
            return Ok(None);
        }
        let checked = match updater(&app) {
            Ok(client) => client.check().await,
            Err(e) => Err(e),
        };
        let update = checked.map_err(|e| {
            log::warn!("could not check for updates: {e}");
            AppError::UpdateCheck(plain(&e))
        })?;
        updates.checked(now);
        let info = update.as_ref().map(|u| UpdateInfo {
            version: u.version.clone(),
            notes: u.body.clone(),
            date_ms: u.date.map(|d| d.unix_timestamp() * 1000),
        });
        match &info {
            Some(info) => log::info!("Polymine {} is available", info.version),
            None => log::info!("Polymine is up to date"),
        }
        *lock(&updates.found) = update.map(Found);
        Ok(info)
    })
    .await
}

/// Downloads the release the last check found, checks its signature, installs
/// it, and restarts into it. Progress arrives as [`PROGRESS_EVENT`]. On
/// Windows the installer runs in passive mode and starts the new version.
#[tauri::command]
#[specta::specta]
pub async fn install_update(app: AppHandle, updates: State<'_, Updates>) -> Result<(), AppError> {
    let update = updates.found().ok_or(AppError::NoUpdate)?;
    if updates.installing.swap(true, Ordering::SeqCst) {
        return Err(AppError::UpdateBusy);
    }
    // Guarded on its own, so a panic still clears `installing`.
    let result = guard::command_async("install_update", async {
        Ok(download_and_install(&app, &update).await)
    })
    .await;
    updates.installing.store(false, Ordering::SeqCst);
    result?.map_err(|e| {
        log::error!("could not install Polymine {}: {e}", update.version);
        AppError::UpdateInstall(plain(&e))
    })?;
    log::info!("installed Polymine {}, restarting", update.version);
    app.restart();
}

async fn download_and_install(
    app: &AppHandle,
    update: &Update,
) -> tauri_plugin_updater::Result<()> {
    log::info!("downloading Polymine {}", update.version);
    let mut progress = Progress::default();
    let bytes = update
        .download(
            |chunk, total| {
                if let Some(report) = progress.advance(chunk, total) {
                    let _ = app.emit(PROGRESS_EVENT, report);
                }
            },
            || {},
        )
        .await?;
    let _ = app.emit(PROGRESS_EVENT, UpdateProgress::Installing);
    // Windows ends the process here, after the hook in `updater` saves.
    update.install(bytes)
}

/// Opens the notes of the release the last check found in the browser.
#[tauri::command]
#[specta::specta]
pub fn open_release_notes(updates: State<'_, Updates>) -> Result<(), AppError> {
    guard::command("open_release_notes", || {
        let update = updates.found().ok_or(AppError::NoUpdate)?;
        let url = release_notes_url(&update.version).ok_or(AppError::NoUpdate)?;
        links::open_url(&url).map_err(AppError::OpenLink)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const PLAYER: RunningCopy = RunningCopy {
        default_instance: true,
        own_data_dir: false,
        debug_build: false,
    };
    const HOUR_MS: i64 = 60 * 60 * 1000;
    const NOW: i64 = 1_795_000_000_000;

    #[test]
    fn only_the_players_installed_release_build_updates_itself() {
        assert!(updates_itself(PLAYER));
        let named = RunningCopy {
            default_instance: false,
            ..PLAYER
        };
        let portable = RunningCopy {
            own_data_dir: true,
            ..PLAYER
        };
        let debug = RunningCopy {
            debug_build: true,
            ..PLAYER
        };
        for copy in [named, portable, debug] {
            assert!(!updates_itself(copy), "{copy:?}");
        }
    }

    #[test]
    fn a_check_is_due_once_a_day() {
        assert!(check_due(None, NOW));
        assert!(!check_due(Some(NOW - HOUR_MS), NOW));
        assert!(!check_due(Some(NOW - 23 * HOUR_MS), NOW));
        assert!(check_due(Some(NOW - 24 * HOUR_MS), NOW));
        assert!(check_due(Some(NOW - 30 * 24 * HOUR_MS), NOW));
        // The clock went back past the last check.
        assert!(check_due(Some(NOW + HOUR_MS), NOW));
    }

    #[test]
    fn the_last_check_survives_a_restart() {
        let dir = tempfile::tempdir().unwrap();
        let updates = Updates::new(true, Some(dir.path()));
        assert!(updates.due(true, NOW));
        updates.checked(NOW);
        assert!(!updates.due(true, NOW + HOUR_MS));
        let again = Updates::new(true, Some(dir.path()));
        assert!(!again.due(true, NOW + HOUR_MS));
        assert!(again.due(true, NOW + 24 * HOUR_MS));
        let saved = std::fs::read_to_string(dir.path().join(STATE_FILE)).unwrap();
        assert!(
            saved.contains(&format!("\"lastCheckMs\": {NOW}")),
            "{saved}"
        );
    }

    #[test]
    fn no_automatic_check_with_the_setting_off_or_on_a_copy_that_doesnt_update() {
        let dir = tempfile::tempdir().unwrap();
        assert!(!Updates::new(true, Some(dir.path())).due(false, NOW));
        assert!(!Updates::new(false, Some(dir.path())).due(true, NOW));
    }

    #[test]
    fn a_broken_record_counts_as_never_checked() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(STATE_FILE), "{ nope").unwrap();
        assert!(Updates::new(true, Some(dir.path())).due(true, NOW));
        // Without a data folder the time lives in memory only.
        let memory = Updates::new(true, None);
        memory.checked(NOW);
        assert!(!memory.due(true, NOW + HOUR_MS));
    }

    #[test]
    fn progress_reports_each_whole_percent() {
        let mut progress = Progress::default();
        let total = Some(1000);
        let reports: Vec<_> = (0..100)
            .filter_map(|_| progress.advance(5, total))
            .collect();
        assert_eq!(reports.len(), 50);
        assert_eq!(
            reports.first(),
            Some(&UpdateProgress::Downloading {
                downloaded: 10,
                total
            })
        );
        assert_eq!(
            reports.last(),
            Some(&UpdateProgress::Downloading {
                downloaded: 500,
                total
            })
        );
    }

    #[test]
    fn progress_without_a_size_reports_each_mebibyte() {
        let mut progress = Progress::default();
        let step = UNKNOWN_SIZE_STEP as usize;
        assert_eq!(progress.advance(step / 2, None), None);
        assert_eq!(
            progress.advance(step / 2, None),
            Some(UpdateProgress::Downloading {
                downloaded: UNKNOWN_SIZE_STEP,
                total: None
            })
        );
        assert_eq!(progress.advance(1, None), None);
    }

    #[test]
    fn release_notes_link_only_to_a_plain_version() {
        assert_eq!(
            release_notes_url("1.2.3").as_deref(),
            Some("https://github.com/uvw/polymine/releases/tag/v1.2.3")
        );
        assert_eq!(
            release_notes_url("1.2.3-rc.1+build.5").as_deref(),
            Some("https://github.com/uvw/polymine/releases/tag/v1.2.3-rc.1+build.5")
        );
        for bad in [
            "",
            "1.2.3/../../evil",
            "1.2.3?x=1",
            "1.2.3 & calc",
            "1.2.3#x",
        ] {
            assert_eq!(release_notes_url(bad), None, "{bad}");
        }
    }

    #[test]
    fn the_shipped_config_asks_github_for_signed_versions() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let updater: tauri_plugin_updater::Config =
            serde_json::from_value(config["plugins"]["updater"].clone()).unwrap();
        let endpoints: Vec<&str> = updater.endpoints.iter().map(tauri::Url::as_str).collect();
        assert_eq!(
            endpoints,
            ["https://github.com/uvw/polymine/releases/latest/download/latest.json"]
        );
        assert!(updater.require_signed_version);
        assert!(!updater.allow_downgrades);
        let windows = updater.windows.expect("the Windows settings are present");
        assert_eq!(windows.install_mode.nsis_args(), ["/P"]);
        let key = base64_decode(&updater.pubkey);
        assert!(
            key.starts_with("untrusted comment: minisign public key"),
            "{key}"
        );
    }

    /// Standard base64 to text, enough for the key file.
    fn base64_decode(text: &str) -> String {
        const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut bits = 0_u32;
        let mut count = 0;
        let mut out = Vec::new();
        for byte in text.bytes().filter(|&b| b != b'=') {
            let value = ALPHABET.iter().position(|&a| a == byte).unwrap() as u32;
            bits = bits << 6 | value;
            count += 6;
            if count >= 8 {
                count -= 8;
                out.push((bits >> count) as u8);
            }
        }
        String::from_utf8(out).unwrap()
    }

    #[test]
    fn updater_errors_read_as_plain_words() {
        use tauri_plugin_updater::Error;
        let offline = plain(&Error::Network("connection refused".into()));
        assert!(offline.contains("couldn't reach GitHub"), "{offline}");
        let missing = plain(&Error::ReleaseNotFound);
        assert!(missing.contains("no update information"), "{missing}");
        let tampered = plain(&Error::MissingSignedVersion);
        assert!(tampered.contains("signature"), "{tampered}");
        let other = plain(&Error::UnsupportedOs);
        assert!(other.contains("Unsupported OS"), "{other}");
    }
}
