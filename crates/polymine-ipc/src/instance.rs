//! Instance names, the folders an instance uses, and the registry of running
//! instances.

use std::fmt;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// The app's identifier. It names the Windows pipes, the folders Tauri
/// manages, and the runtime folder.
pub const APP_ID: &str = "dev.uvw.polymine";
/// The folder for settings, history, the saved game, and the window state.
pub const DIR_NAME: &str = "Polymine";
/// Names the instance to start or to talk to.
pub const INSTANCE_ENV: &str = "POLYMINE_INSTANCE";
/// Puts an instance's settings, history, and the CLI's headless games in one
/// folder, for tests that must not touch the player's data.
pub const DATA_DIR_ENV: &str = "POLYMINE_DATA_DIR";

const DEFAULT_NAME: &str = "default";
const MAX_NAME_LEN: usize = 24;

/// A validated instance name: 1 to 24 ASCII letters, digits, `-`, or `_`,
/// stored in lowercase.
///
/// Every normal launch is the `default` instance. Named instances run beside
/// it, each with its own data, for tests and experiments.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct InstanceName(String);

#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
#[error("instance names use 1 to {MAX_NAME_LEN} ASCII letters, digits, '-' or '_', got {0:?}")]
pub struct InvalidName(pub String);

impl InstanceName {
    pub fn new(name: &str) -> Result<Self, InvalidName> {
        let valid = (1..=MAX_NAME_LEN).contains(&name.len())
            && name
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
        if valid {
            Ok(Self(name.to_ascii_lowercase()))
        } else {
            Err(InvalidName(name.to_owned()))
        }
    }

    pub fn default_instance() -> Self {
        Self(DEFAULT_NAME.to_owned())
    }

    /// The name in `value`, or the default instance when it's absent or blank.
    pub fn from_option(value: Option<&str>) -> Result<Self, InvalidName> {
        match value.map(str::trim) {
            None | Some("") => Ok(Self::default_instance()),
            Some(name) => Self::new(name),
        }
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn is_default(&self) -> bool {
        self.0 == DEFAULT_NAME
    }
}

impl fmt::Display for InstanceName {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl TryFrom<String> for InstanceName {
    type Error = InvalidName;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::new(&value)
    }
}

impl From<InstanceName> for String {
    fn from(name: InstanceName) -> Self {
        name.0
    }
}

/// The per-user folder for files that only matter while instances run, such
/// as the registry.
pub fn runtime_dir() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join(APP_ID)
}

/// The default instance's settings and data folders: `Polymine` in the
/// platform's config and data folders, which are one folder on Windows and
/// macOS.
pub fn app_dirs() -> (Option<PathBuf>, Option<PathBuf>) {
    (
        dirs::config_dir().map(|d| d.join(DIR_NAME)),
        dirs::data_dir().map(|d| d.join(DIR_NAME)),
    )
}

/// `~/.local/bin`, where `polymine-cli link` puts its link on macOS and Linux.
pub fn home_bin_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".local").join("bin"))
}

/// A file with this name next to the executable makes Polymine portable.
pub const PORTABLE_MARKER: &str = "portable";

/// The `data` folder beside `exe` when a portable marker sits next to it.
pub fn portable_data_dir(exe: &Path) -> Option<PathBuf> {
    let dir = exe.parent()?;
    dir.join(PORTABLE_MARKER)
        .is_file()
        .then(|| dir.join("data"))
}

/// The folder for all data, when not the platform's own: the one set by
/// [`DATA_DIR_ENV`], or a portable copy's `data` folder.
pub fn data_dir_override() -> Option<PathBuf> {
    std::env::var_os(DATA_DIR_ENV)
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .or_else(|| portable_data_dir(&std::env::current_exe().ok()?))
}

/// A short tag for a portable copy's data folder, or `None` for any other
/// instance. A portable copy and an installed one then answer on different
/// pipes and registry entries, and the CLI shipped beside each copy finds the
/// same marker and computes the same tag. `POLYMINE_DATA_DIR` adds no tag, so a
/// CLI started without it still reaches a named test instance.
pub fn data_scope() -> Option<String> {
    let exe = std::env::current_exe().ok()?;
    portable_data_dir(&exe).map(|dir| scope_for(&dir))
}

/// The tag for `dir`: FNV-1a over its path, since the CLI and the app must
/// agree on it even when different Rust versions built them.
pub fn scope_for(dir: &Path) -> String {
    let dir = fs::canonicalize(dir).unwrap_or_else(|_| dir.to_path_buf());
    let text = dir.to_string_lossy();
    // Windows paths ignore case, so two spellings of one folder share a tag.
    let text = if cfg!(windows) {
        text.to_lowercase()
    } else {
        text.into_owned()
    };
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in text.bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{:08x}", hash >> 32)
}

/// The name an instance's pipe or socket and its registry entry use: the
/// instance's own name, plus [`data_scope`]'s tag when it has one.
pub fn endpoint(name: &InstanceName) -> String {
    endpoint_for(name, data_scope().as_deref())
}

pub fn endpoint_for(name: &InstanceName, scope: Option<&str>) -> String {
    match scope {
        Some(scope) => format!("{name}.{scope}"),
        None => name.to_string(),
    }
}

/// Settings and history folders for an instance, given the app's own config
/// and data folders. The default instance uses those folders; a named one
/// gets a subfolder of the data folder. [`data_dir_override`] overrides both.
pub fn instance_dirs(
    name: &InstanceName,
    app_config: Option<PathBuf>,
    app_data: Option<PathBuf>,
) -> (Option<PathBuf>, Option<PathBuf>) {
    if let Some(dir) = data_dir_override() {
        return (Some(dir.clone()), Some(dir));
    }
    if name.is_default() {
        return (app_config, app_data);
    }
    let dir = app_data.map(|d| d.join("instances").join(name.as_str()));
    (dir.clone(), dir)
}

/// Where the app's log file for an instance lives.
pub fn log_file(name: &InstanceName) -> Option<PathBuf> {
    log_dir().map(|d| d.join(format!("{}.log", log_file_stem(name))))
}

/// The log folder: the platform's, or `logs` in the data folder when that is
/// overridden, as for a portable copy.
pub fn log_dir() -> Option<PathBuf> {
    if let Some(dir) = data_dir_override() {
        return Some(dir.join("logs"));
    }
    #[cfg(target_os = "macos")]
    let dir = dirs::home_dir().map(|h| h.join("Library/Logs").join(APP_ID));
    #[cfg(not(target_os = "macos"))]
    let dir = dirs::data_local_dir().map(|d| d.join(APP_ID).join("logs"));
    dir
}

/// The log file name without its extension, as the app configures its logger.
pub fn log_file_stem(name: &InstanceName) -> String {
    if name.is_default() {
        "Polymine".to_owned()
    } else {
        format!("Polymine-{name}")
    }
}

/// One running instance, as it registered itself at startup.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Registration {
    pub name: InstanceName,
    pub pid: u32,
    pub version: String,
    pub socket: String,
    pub started_ms: i64,
}

/// The folder where running instances register: one JSON file each.
#[derive(Clone, Debug)]
pub struct Registry {
    dir: PathBuf,
}

impl Registry {
    pub fn at(dir: impl Into<PathBuf>) -> Self {
        Self { dir: dir.into() }
    }

    /// The registry every instance of this user shares.
    pub fn shared() -> Self {
        Self::at(runtime_dir().join("instances"))
    }

    fn file(&self, name: &InstanceName) -> PathBuf {
        self.dir.join(format!("{}.json", endpoint(name)))
    }

    /// Writes the entry. The returned guard removes it again when dropped.
    pub fn register(&self, entry: &Registration) -> io::Result<RegistrationGuard> {
        fs::create_dir_all(&self.dir)?;
        let json = serde_json::to_string_pretty(entry).map_err(io::Error::other)?;
        let path = self.file(&entry.name);
        fs::write(&path, json)?;
        Ok(RegistrationGuard { path })
    }

    /// Every readable entry, sorted by name. Unreadable files are skipped.
    pub fn list(&self) -> Vec<Registration> {
        let Ok(entries) = fs::read_dir(&self.dir) else {
            return Vec::new();
        };
        let mut found: Vec<Registration> = entries
            .filter_map(Result::ok)
            .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
            .filter_map(|e| fs::read_to_string(e.path()).ok())
            .filter_map(|text| serde_json::from_str(&text).ok())
            .collect();
        found.sort_by(|a, b| a.name.as_str().cmp(b.name.as_str()));
        found
    }

    /// Removes the entry for `name` if it exists. The app calls it on exit,
    /// and the CLI for entries a crash left behind.
    pub fn remove(&self, name: &InstanceName) -> io::Result<()> {
        match fs::remove_file(self.file(name)) {
            Err(e) if e.kind() != io::ErrorKind::NotFound => Err(e),
            _ => Ok(()),
        }
    }

    /// Removes the entry for `name` only if process `pid` wrote it, so a second
    /// copy that gives way to a running one leaves that one's entry alone.
    pub fn remove_own(&self, name: &InstanceName, pid: u32) -> io::Result<()> {
        let path = self.file(name);
        let owner = fs::read_to_string(&path)
            .ok()
            .and_then(|text| serde_json::from_str::<Registration>(&text).ok())
            .map(|entry| entry.pid);
        if owner == Some(pid) {
            self.remove(name)
        } else {
            Ok(())
        }
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }
}

/// Removes a registry entry when the instance shuts down.
#[derive(Debug)]
pub struct RegistrationGuard {
    path: PathBuf,
}

impl Drop for RegistrationGuard {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_short_safe_and_lowercase() {
        assert_eq!(InstanceName::new("Smoke-1").unwrap().as_str(), "smoke-1");
        for bad in ["", "has space", "dots.no", "slash/no", &"x".repeat(25)] {
            assert!(InstanceName::new(bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn a_missing_or_blank_name_is_the_default() {
        assert!(InstanceName::from_option(None).unwrap().is_default());
        assert!(InstanceName::from_option(Some("  ")).unwrap().is_default());
        assert!(
            !InstanceName::from_option(Some("test"))
                .unwrap()
                .is_default()
        );
    }

    #[test]
    fn named_instances_keep_their_data_apart() {
        let name = InstanceName::new("lab").unwrap();
        let (config, data) = instance_dirs(
            &name,
            Some(PathBuf::from("cfg")),
            Some(PathBuf::from("data")),
        );
        let expected = Path::new("data").join("instances").join("lab");
        assert_eq!(config.as_deref(), Some(expected.as_path()));
        assert_eq!(data.as_deref(), Some(expected.as_path()));
        let default = InstanceName::default_instance();
        let (config, _) = instance_dirs(&default, Some(PathBuf::from("cfg")), None);
        assert_eq!(config.as_deref(), Some(Path::new("cfg")));
    }

    #[test]
    fn a_marker_beside_the_executable_makes_it_portable() {
        let dir = tempfile::tempdir().unwrap();
        let exe = dir.path().join("Polymine.exe");
        assert_eq!(portable_data_dir(&exe), None);
        std::fs::write(dir.path().join(PORTABLE_MARKER), "").unwrap();
        assert_eq!(portable_data_dir(&exe), Some(dir.path().join("data")));
    }

    #[test]
    fn a_data_folder_gives_an_instance_its_own_endpoint() {
        let dir = tempfile::tempdir().unwrap();
        let lab = InstanceName::new("lab").unwrap();
        let one = scope_for(&dir.path().join("one"));
        let two = scope_for(&dir.path().join("two"));
        assert_ne!(one, two);
        assert_eq!(one, scope_for(&dir.path().join("one")));
        assert_eq!(one.len(), 8);
        assert_eq!(endpoint_for(&lab, None), "lab");
        assert_eq!(endpoint_for(&lab, Some(&one)), format!("lab.{one}"));
    }

    #[test]
    fn log_files_are_named_per_instance() {
        assert_eq!(log_file_stem(&InstanceName::default_instance()), "Polymine");
        assert_eq!(
            log_file_stem(&InstanceName::new("lab").unwrap()),
            "Polymine-lab"
        );
    }

    #[test]
    fn registry_lists_entries_until_their_guard_drops() {
        let dir = tempfile::tempdir().unwrap();
        let registry = Registry::at(dir.path());
        let entry = |name: &str| Registration {
            name: InstanceName::new(name).unwrap(),
            pid: 7,
            version: "0.0.1".into(),
            socket: "sock".into(),
            started_ms: 1,
        };
        let b = registry.register(&entry("b")).unwrap();
        let a = registry.register(&entry("a")).unwrap();
        std::fs::write(dir.path().join("junk.json"), "not json").unwrap();
        let names: Vec<String> = registry.list().into_iter().map(|r| r.name.into()).collect();
        assert_eq!(names, ["a", "b"]);
        drop(a);
        assert_eq!(registry.list().len(), 1);
        registry.remove(&InstanceName::new("b").unwrap()).unwrap();
        registry.remove(&InstanceName::new("b").unwrap()).unwrap();
        drop(b);
        assert_eq!(registry.list(), []);
    }

    #[test]
    fn only_the_process_that_registered_an_entry_removes_it() {
        let dir = tempfile::tempdir().unwrap();
        let registry = Registry::at(dir.path());
        let name = InstanceName::new("lab").unwrap();
        let entry = Registration {
            name: name.clone(),
            pid: 7,
            version: "0.0.1".into(),
            socket: "sock".into(),
            started_ms: 1,
        };
        std::mem::forget(registry.register(&entry).unwrap());
        registry.remove_own(&name, 8).unwrap();
        assert_eq!(registry.list().len(), 1);
        registry.remove_own(&name, 7).unwrap();
        assert_eq!(registry.list(), []);
        registry.remove_own(&name, 7).unwrap();
    }
}
