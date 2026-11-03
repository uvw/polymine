//! Folders from GitHub: a repository folder at a branch, tag, or commit, or
//! the files of a gist.
//!
//! A repository download costs two API requests, one to pin the ref to a
//! commit and one to list the folder's tree, then fetches each file from
//! `raw.githubusercontent.com` at that commit. The tree lists every entry's
//! mode, so symlinks and submodules are caught before anything downloads. A
//! gist costs one API request, then fetches each file's raw URL.

use std::collections::{BTreeMap, HashSet};
use std::fmt;
use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::atomic::{AtomicU64, Ordering};

use percent_encoding::{AsciiSet, NON_ALPHANUMERIC, percent_decode_str, utf8_percent_encode};
use serde::Deserialize;
use serde::de::DeserializeOwned;

use crate::cache::Cache;
use crate::client::{Client, Request, Token};
use crate::error::{Error, Result};

/// The hosts a [`GitHub`] source needs in its client's policy.
pub const GITHUB_HOSTS: [&str; 6] = [
    "github.com",
    "api.github.com",
    "codeload.github.com",
    "raw.githubusercontent.com",
    "gist.github.com",
    "gist.githubusercontent.com",
];

const API: &str = "https://api.github.com";
const RAW: &str = "https://raw.githubusercontent.com";
const API_VERSION: &str = "2022-11-28";
/// Names the folders a download fills before it moves them into place.
const PARTIAL_PREFIX: &str = ".polymine-partial-";

/// Everything except the characters RFC 3986 leaves unreserved.
const SEGMENT: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'.')
    .remove(b'_')
    .remove(b'~');

/// A GitHub folder to download.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Source {
    /// A folder in a repository. `reference` is a branch, tag, or commit, or
    /// the default branch when absent; `path` is empty for the root.
    Repo {
        owner: String,
        repo: String,
        reference: Option<String>,
        path: String,
    },
    /// Every file of a gist, at `revision` or the latest one.
    Gist {
        id: String,
        revision: Option<String>,
    },
}

impl Source {
    /// Reads a repository or gist URL as GitHub shows it:
    ///
    /// - `https://github.com/owner/repo`
    /// - `https://github.com/owner/repo/tree/<ref>/<folder>`, where the ref
    ///   is the single segment after `tree`, so a branch with a slash in its
    ///   name can't be named this way
    /// - `https://gist.github.com/<user>/<id>`, with an optional revision
    ///
    /// The scheme may be left out. A query or fragment is ignored.
    pub fn parse(url: &str) -> Result<Self> {
        let url = url.trim();
        let rest = match url.split_once("://") {
            Some((scheme, rest)) if scheme.eq_ignore_ascii_case("https") => rest,
            Some(_) => return Err(invalid(url, "use an https:// address")),
            None => url,
        };
        let rest = rest.split(['?', '#']).next().unwrap_or_default();
        let (host, path) = rest.split_once('/').unwrap_or((rest, ""));
        let segments: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
        let source = match host.to_ascii_lowercase().as_str() {
            "github.com" | "www.github.com" => parse_repo(url, &segments)?,
            "gist.github.com" => parse_gist(url, &segments)?,
            _ => return Err(invalid(url, "use a github.com or gist.github.com address")),
        };
        source.check()?;
        Ok(source)
    }

    /// Checks the parts a caller may have built by hand.
    fn check(&self) -> Result<()> {
        let fail = |what: &str| Err(Error::InvalidUrl(format!("{self} has {what}")));
        match self {
            Self::Repo {
                owner,
                repo,
                reference,
                path,
            } => {
                if !is_owner(owner) {
                    return fail("an invalid owner");
                }
                if !is_repo(repo) {
                    return fail("an invalid repository name");
                }
                if reference.as_deref().is_some_and(|r| !is_reference(r)) {
                    return fail("an invalid branch or tag");
                }
                if !path.is_empty() && !path.split('/').all(is_safe_component) {
                    return fail("an invalid folder");
                }
            }
            Self::Gist { id, revision } => {
                if !is_gist_id(id) {
                    return fail("an invalid gist id");
                }
                if revision.as_deref().is_some_and(|r| !is_sha(r)) {
                    return fail("an invalid gist revision");
                }
            }
        }
        Ok(())
    }
}

impl FromStr for Source {
    type Err = Error;

    fn from_str(url: &str) -> Result<Self> {
        Self::parse(url)
    }
}

impl fmt::Display for Source {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Repo {
                owner,
                repo,
                reference,
                path,
            } => {
                write!(f, "https://github.com/{owner}/{repo}")?;
                if reference.is_some() || !path.is_empty() {
                    write!(f, "/tree/{}", reference.as_deref().unwrap_or("HEAD"))?;
                }
                if !path.is_empty() {
                    write!(f, "/{path}")?;
                }
                Ok(())
            }
            Self::Gist { id, revision } => {
                write!(f, "https://gist.github.com/{id}")?;
                if let Some(revision) = revision {
                    write!(f, " at revision {revision}")?;
                }
                Ok(())
            }
        }
    }
}

fn invalid(url: &str, hint: &str) -> Error {
    Error::InvalidUrl(format!("{url}: {hint}"))
}

fn parse_repo(url: &str, segments: &[&str]) -> Result<Source> {
    let [owner, repo, rest @ ..] = segments else {
        return Err(invalid(
            url,
            "name a repository as github.com/<owner>/<repo>",
        ));
    };
    let repo = repo.strip_suffix(".git").unwrap_or(repo);
    let (reference, path) = match rest {
        [] => (None, String::new()),
        ["tree", reference, folder @ ..] => {
            let folder: Vec<String> = folder.iter().map(|s| decode(s)).collect();
            (Some(decode(reference)), folder.join("/"))
        }
        ["blob", ..] => return Err(invalid(url, "this links to a file; use its folder")),
        _ => return Err(invalid(url, "use a repository or folder address")),
    };
    Ok(Source::Repo {
        owner: (*owner).to_owned(),
        repo: repo.to_owned(),
        reference,
        path,
    })
}

fn parse_gist(url: &str, segments: &[&str]) -> Result<Source> {
    let (id, revision) = match segments {
        [id] | [_, id] => (*id, None),
        [_, id, revision] => (*id, Some((*revision).to_owned())),
        _ => return Err(invalid(url, "name a gist as gist.github.com/<user>/<id>")),
    };
    Ok(Source::Gist {
        id: id.strip_suffix(".git").unwrap_or(id).to_owned(),
        revision,
    })
}

fn decode(segment: &str) -> String {
    percent_decode_str(segment).decode_utf8_lossy().into_owned()
}

fn encode(segment: &str) -> String {
    utf8_percent_encode(segment, SEGMENT).to_string()
}

fn encode_path(path: &str) -> String {
    path.split('/').map(encode).collect::<Vec<_>>().join("/")
}

/// GitHub user and organization names: letters, digits, and single hyphens.
fn is_owner(name: &str) -> bool {
    (1..=39).contains(&name.len())
        && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
        && !name.starts_with('-')
}

fn is_repo(name: &str) -> bool {
    (1..=100).contains(&name.len())
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
        && name != "."
        && name != ".."
}

fn is_reference(name: &str) -> bool {
    (1..=255).contains(&name.len()) && !name.chars().any(|c| c.is_control() || c.is_whitespace())
}

fn is_gist_id(id: &str) -> bool {
    (1..=64).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric())
}

fn is_sha(sha: &str) -> bool {
    matches!(sha.len(), 40 | 64) && sha.bytes().all(|b| b.is_ascii_hexdigit())
}

/// Whether `name` can be one component of a path on Windows, macOS, and Linux
/// without naming a parent folder, a device, or a different file.
fn is_safe_component(name: &str) -> bool {
    const RESERVED: [&str; 26] = [
        "con", "prn", "aux", "nul", "conin$", "conout$", "com0", "com1", "com2", "com3", "com4",
        "com5", "com6", "com7", "com8", "com9", "lpt0", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5",
        "lpt6", "lpt7", "lpt8", "lpt9",
    ];
    let stem = name
        .split('.')
        .next()
        .unwrap_or_default()
        .trim_end()
        .to_ascii_lowercase();
    !name.is_empty()
        && name.len() <= 255
        && name != "."
        && name != ".."
        // Windows drops trailing dots and spaces, so "a.css." is "a.css".
        && !name.ends_with(['.', ' '])
        && !name.chars().any(|c| {
            c.is_control() || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
        })
        && !RESERVED.contains(&stem.as_str())
}

/// What a download may take from a source.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Limits {
    pub max_files: usize,
    pub max_file_bytes: u64,
    pub max_total_bytes: u64,
    /// How many subfolders deep files may sit: 0 takes only the folder's own
    /// files.
    pub max_depth: usize,
    /// The file names to take: an exact name such as `theme.css`, or `*.svg`
    /// for an extension, matched without regard to case. Other files are
    /// skipped. An empty list takes every name.
    pub allowed: Vec<String>,
}

impl Limits {
    pub fn allows(&self, name: &str) -> bool {
        let name = name.to_ascii_lowercase();
        self.allowed.is_empty()
            || self.allowed.iter().any(|pattern| {
                let pattern = pattern.to_ascii_lowercase();
                match pattern.strip_prefix('*') {
                    Some(suffix) => name.ends_with(suffix),
                    None => name == pattern,
                }
            })
    }
}

/// One file a listing will download.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RemoteFile {
    /// The path below the source folder, with `/` between components.
    pub path: String,
    /// The size GitHub reports. The download enforces the limits again.
    pub size: u64,
    url: String,
    send_token: bool,
}

/// The files of a source that fit the limits.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Listing {
    /// The commit (repositories) or gist revision the files come from.
    /// Comparing it with a later listing tells whether anything changed.
    pub revision: String,
    pub files: Vec<RemoteFile>,
    /// Files whose names aren't allowed, and folders deeper than
    /// `max_depth` (with a trailing `/`), left out of the download.
    pub skipped: Vec<String>,
}

/// A finished download.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Download {
    pub dir: PathBuf,
    pub revision: String,
    /// The paths written below `dir`, with `/` between components.
    pub files: Vec<String>,
    pub skipped: Vec<String>,
    pub bytes: u64,
}

/// Lists and downloads GitHub folders through a [`Client`] whose policy allows
/// [`GITHUB_HOSTS`].
#[derive(Debug)]
pub struct GitHub {
    client: Client,
    token: Option<Token>,
    cache: Option<Cache>,
    api: String,
    raw: String,
}

impl GitHub {
    pub fn new(client: Client) -> Self {
        Self {
            client,
            token: None,
            cache: None,
            api: API.to_owned(),
            raw: RAW.to_owned(),
        }
    }

    /// Authenticates with a GitHub token, which raises the API rate limit
    /// from 60 requests an hour to 5,000 and opens private repositories. It
    /// goes to `api.github.com` and `raw.githubusercontent.com` only.
    #[must_use]
    pub fn with_token(mut self, token: Token) -> Self {
        self.token = Some(token);
        self
    }

    /// Revalidates API listings and files through `cache`. An unchanged
    /// listing answered with 304 doesn't count against the rate limit.
    #[must_use]
    pub fn with_cache(mut self, cache: Cache) -> Self {
        self.cache = Some(cache);
        self
    }

    #[cfg(test)]
    fn with_bases(mut self, api: String, raw: String) -> Self {
        self.api = api;
        self.raw = raw;
        self
    }

    /// The files `source` holds within `limits`, without downloading them.
    ///
    /// Fails with [`Error::Refused`] when an allowed name is a symlink, a
    /// submodule, or a path that isn't safe on every platform, and with
    /// [`Error::TooLarge`] when the files break a limit by their listed size.
    pub fn list(&self, source: &Source, limits: &Limits) -> Result<Listing> {
        source.check()?;
        match source {
            Source::Repo {
                owner,
                repo,
                reference,
                path,
            } => self.list_repo(owner, repo, reference.as_deref(), path, limits),
            Source::Gist { id, revision } => self.list_gist(id, revision.as_deref(), limits),
        }
    }

    /// Downloads `source` into `target`, a folder that must not exist yet,
    /// inside a staging folder that does.
    ///
    /// The files go into a hidden folder beside `target` first, which is
    /// renamed to `target` once every file is written. On failure the hidden
    /// folder is removed, so `target` either appears complete or not at all.
    pub fn download(&self, source: &Source, target: &Path, limits: &Limits) -> Result<Download> {
        if fs::symlink_metadata(target).is_ok() {
            return Err(Error::Io(io::Error::new(
                io::ErrorKind::AlreadyExists,
                format!("{} already exists", target.display()),
            )));
        }
        let parent = target
            .parent()
            .filter(|p| !p.as_os_str().is_empty())
            .unwrap_or(Path::new("."));
        let listing = self.list(source, limits)?;
        let partial = Partial::create(parent)?;
        let mut bytes = 0;
        for file in &listing.files {
            let left = limits.max_total_bytes.saturating_sub(bytes);
            let cap = left.min(limits.max_file_bytes);
            let body = self.fetch(file, cap, limits)?;
            bytes += body.len() as u64;
            partial.write(&file.path, &body)?;
        }
        partial.finish(target)?;
        Ok(Download {
            dir: target.to_owned(),
            revision: listing.revision,
            files: listing.files.into_iter().map(|f| f.path).collect(),
            skipped: listing.skipped,
            bytes,
        })
    }

    fn list_repo(
        &self,
        owner: &str,
        repo: &str,
        reference: Option<&str>,
        path: &str,
        limits: &Limits,
    ) -> Result<Listing> {
        let base = format!("{}/repos/{owner}/{repo}", self.api);
        let commit_url = format!("{base}/commits/{}", encode(reference.unwrap_or("HEAD")));
        let commit = self.api_get(commit_url, "application/vnd.github.sha")?;
        let commit = String::from_utf8_lossy(&commit).trim().to_owned();
        if !is_sha(&commit) {
            return Err(Error::BadResponse(format!(
                "GitHub returned {commit:?} as the commit for {owner}/{repo}"
            )));
        }
        let tree = if path.is_empty() {
            commit.clone()
        } else {
            format!("{commit}:{}", encode_path(path))
        };
        let mut url = format!("{base}/git/trees/{tree}");
        if limits.max_depth > 0 {
            url.push_str("?recursive=1");
        }
        let tree: Tree = self.api_json(url)?;
        if tree.truncated {
            return Err(Error::TooLarge(format!(
                "{owner}/{repo} has more files than GitHub lists at once"
            )));
        }
        let folder = if path.is_empty() {
            String::new()
        } else {
            format!("{}/", encode_path(path))
        };
        let mut picker = Picker::new(limits);
        for entry in tree.tree {
            let kind = match (entry.kind.as_str(), entry.mode.as_str()) {
                ("blob", "100644" | "100755") => Kind::File,
                ("blob", "120000") => Kind::Symlink,
                ("tree", _) => Kind::Folder,
                ("commit", _) => Kind::Submodule,
                _ => Kind::Other,
            };
            let url = format!(
                "{}/{owner}/{repo}/{commit}/{folder}{}",
                self.raw,
                encode_path(&entry.path)
            );
            picker.add(entry.path, kind, entry.size.unwrap_or(0), url, true)?;
        }
        Ok(picker.finish(commit))
    }

    fn list_gist(&self, id: &str, revision: Option<&str>, limits: &Limits) -> Result<Listing> {
        let mut url = format!("{}/gists/{id}", self.api);
        if let Some(revision) = revision {
            url.push('/');
            url.push_str(revision);
        }
        let gist: Gist = self.api_json(url)?;
        if gist.truncated {
            return Err(Error::TooLarge(format!(
                "gist {id} has more files than GitHub lists at once"
            )));
        }
        let revision = match revision {
            Some(revision) => revision.to_owned(),
            None => gist
                .history
                .into_iter()
                .next()
                .map(|h| h.version)
                .ok_or_else(|| Error::BadResponse(format!("gist {id} has no revision")))?,
        };
        let mut picker = Picker::new(limits);
        for (name, file) in gist.files {
            picker.add(name, Kind::File, file.size, file.raw_url, false)?;
        }
        Ok(picker.finish(revision))
    }

    fn api_get(&self, url: String, accept: &str) -> Result<Vec<u8>> {
        let request = Request::get(url)
            .header("accept", accept)
            .header("x-github-api-version", API_VERSION)
            .bearer(self.token.as_ref());
        Ok(self.send(&request)?.body)
    }

    fn api_json<T: DeserializeOwned>(&self, url: String) -> Result<T> {
        let body = self.api_get(url, "application/vnd.github+json")?;
        serde_json::from_slice(&body)
            .map_err(|err| Error::BadResponse(format!("GitHub's listing didn't parse: {err}")))
    }

    fn send(&self, request: &Request) -> Result<crate::client::Response> {
        match &self.cache {
            Some(cache) => self.client.send_cached(request, cache),
            None => self.client.send(request),
        }
    }

    fn fetch(&self, file: &RemoteFile, cap: u64, limits: &Limits) -> Result<Vec<u8>> {
        let token = self.token.as_ref().filter(|_| file.send_token);
        let request = Request::get(&file.url).max_bytes(cap).bearer(token);
        let too_large = || {
            if cap < limits.max_file_bytes {
                Error::TooLarge(format!(
                    "the files add up to more than {} bytes",
                    limits.max_total_bytes
                ))
            } else {
                Error::TooLarge(format!(
                    "{} is over {} bytes",
                    file.path, limits.max_file_bytes
                ))
            }
        };
        match self.send(&request) {
            Ok(response) if response.body.len() as u64 <= cap => Ok(response.body),
            Ok(_) | Err(Error::TooLarge(_)) => Err(too_large()),
            Err(err) => Err(err),
        }
    }
}

#[derive(Deserialize)]
struct Tree {
    tree: Vec<TreeEntry>,
    #[serde(default)]
    truncated: bool,
}

#[derive(Deserialize)]
struct TreeEntry {
    path: String,
    mode: String,
    #[serde(rename = "type")]
    kind: String,
    size: Option<u64>,
}

#[derive(Deserialize)]
struct Gist {
    files: BTreeMap<String, GistFile>,
    #[serde(default)]
    truncated: bool,
    #[serde(default)]
    history: Vec<GistVersion>,
}

#[derive(Deserialize)]
struct GistFile {
    raw_url: String,
    size: u64,
}

#[derive(Deserialize)]
struct GistVersion {
    version: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Kind {
    File,
    Folder,
    Symlink,
    Submodule,
    Other,
}

/// Applies the limits and the safety rules to a listing, entry by entry.
struct Picker<'a> {
    limits: &'a Limits,
    files: Vec<RemoteFile>,
    skipped: Vec<String>,
    seen: HashSet<String>,
    bytes: u64,
}

impl<'a> Picker<'a> {
    fn new(limits: &'a Limits) -> Self {
        Self {
            limits,
            files: Vec::new(),
            skipped: Vec::new(),
            seen: HashSet::new(),
            bytes: 0,
        }
    }

    fn add(
        &mut self,
        path: String,
        kind: Kind,
        size: u64,
        url: String,
        send_token: bool,
    ) -> Result<()> {
        // Git never stores these, so a listing that has them is refused
        // whole, wherever the entry sits.
        let malformed = path
            .split('/')
            .any(|c| c.is_empty() || c == "." || c == ".." || c.contains(['\\', '\0']));
        if malformed {
            return Err(Error::Refused(format!("{path:?} is not a valid path")));
        }
        let depth = path.matches('/').count();
        let name = path.rsplit('/').next().unwrap_or_default();
        if kind == Kind::Folder {
            if depth == self.limits.max_depth {
                self.skipped.push(format!("{path}/"));
            }
            return Ok(());
        }
        // Inside a folder already reported as skipped.
        if depth > self.limits.max_depth {
            return Ok(());
        }
        if !self.limits.allows(name) {
            self.skipped.push(path);
            return Ok(());
        }
        match kind {
            Kind::File => {}
            Kind::Symlink => return Err(Error::Refused(format!("{path} is a symlink"))),
            Kind::Submodule => return Err(Error::Refused(format!("{path} is a submodule"))),
            Kind::Folder | Kind::Other => {
                return Err(Error::Refused(format!("{path} is not a regular file")));
            }
        }
        if !path.split('/').all(is_safe_component) {
            return Err(Error::Refused(format!(
                "{path:?} is not a safe file name on every platform"
            )));
        }
        if !self.seen.insert(path.to_lowercase()) {
            return Err(Error::Refused(format!(
                "{path} appears twice when case is ignored"
            )));
        }
        if self.files.len() == self.limits.max_files {
            return Err(Error::TooLarge(format!(
                "there are more than {} files",
                self.limits.max_files
            )));
        }
        if size > self.limits.max_file_bytes {
            return Err(Error::TooLarge(format!(
                "{path} is over {} bytes",
                self.limits.max_file_bytes
            )));
        }
        self.bytes += size;
        if self.bytes > self.limits.max_total_bytes {
            return Err(Error::TooLarge(format!(
                "the files add up to more than {} bytes",
                self.limits.max_total_bytes
            )));
        }
        self.files.push(RemoteFile {
            path,
            size,
            url,
            send_token,
        });
        Ok(())
    }

    fn finish(self, revision: String) -> Listing {
        Listing {
            revision,
            files: self.files,
            skipped: self.skipped,
        }
    }
}

/// A hidden folder a download fills before it takes the target's name. It
/// removes itself unless finished.
struct Partial {
    path: PathBuf,
    finished: bool,
}

impl Partial {
    fn create(parent: &Path) -> io::Result<Self> {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        loop {
            let name = format!(
                "{PARTIAL_PREFIX}{}-{}",
                std::process::id(),
                COUNTER.fetch_add(1, Ordering::Relaxed)
            );
            let path = parent.join(name);
            match fs::create_dir(&path) {
                Ok(()) => {
                    return Ok(Self {
                        path,
                        finished: false,
                    });
                }
                Err(err) if err.kind() == io::ErrorKind::AlreadyExists => {}
                Err(err) => return Err(err),
            }
        }
    }

    /// Writes one file. `relative` has passed [`is_safe_component`] for every
    /// component, so it stays inside the folder.
    fn write(&self, relative: &str, bytes: &[u8]) -> io::Result<()> {
        let mut path = self.path.clone();
        path.extend(relative.split('/'));
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir)?;
        }
        let mut file = File::create_new(&path)?;
        file.write_all(bytes)?;
        file.sync_all()
    }

    fn finish(mut self, target: &Path) -> io::Result<()> {
        fs::rename(&self.path, target)?;
        self.finished = true;
        Ok(())
    }
}

impl Drop for Partial {
    fn drop(&mut self) {
        if !self.finished {
            let _ = fs::remove_dir_all(&self.path);
        }
    }
}

/// Removes the hidden folders that downloads interrupted by a crash left in
/// `staging`. Call it before any download into that folder starts, such as
/// at startup. Returns how many it removed.
pub fn remove_partial_downloads(staging: &Path) -> io::Result<usize> {
    let mut removed = 0;
    for item in fs::read_dir(staging)? {
        let item = item?;
        let is_partial = item
            .file_name()
            .to_str()
            .is_some_and(|name| name.starts_with(PARTIAL_PREFIX));
        if is_partial && item.file_type()?.is_dir() {
            fs::remove_dir_all(item.path())?;
            removed += 1;
        }
    }
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::Arc;

    use super::*;
    use crate::client::tests::local_policy;
    use crate::test_server::{Reply, Seen, TestServer};

    const COMMIT: &str = "0123456789abcdef0123456789abcdef01234567";
    const REPO: &str = "/repos/octo-themes/polymine-themes";
    const TREE: &str = include_str!("../tests/fixtures/github/tree-dusk.json");
    const GIST: &str = include_str!("../tests/fixtures/github/gist-dusk.json");
    const THEME_CSS: &str = ":root {\n  --cell-fill: #1d2433;\n}\n";
    const PNG: &[u8] = b"\x89PNG\r\n\x1a\n";

    fn dusk() -> Source {
        Source::parse("https://github.com/octo-themes/polymine-themes/tree/main/themes/dusk")
            .unwrap()
    }

    fn limits() -> Limits {
        Limits {
            max_files: 10,
            max_file_bytes: 1000,
            max_total_bytes: 10_000,
            max_depth: 1,
            allowed: vec!["theme.css".into(), "*.svg".into(), "*.PNG".into()],
        }
    }

    fn files() -> HashMap<&'static str, Vec<u8>> {
        HashMap::from([
            ("theme.css", THEME_CSS.as_bytes().to_vec()),
            ("preview.png", PNG.to_vec()),
            ("icons/flag.svg", b"<svg id=\"flag\"></svg>".to_vec()),
            ("icons/mine.svg", b"<svg id=\"mine\"></svg>".to_vec()),
            ("README.md", b"# Dusk".to_vec()),
        ])
    }

    /// Answers like GitHub for the dusk folder: `tree` is the trees API body,
    /// and raw files come from `files` under `/raw`.
    fn github_server(tree: String, files: HashMap<&'static str, Vec<u8>>) -> TestServer {
        let tree = Arc::new(tree);
        TestServer::start(move |req: &Seen| {
            let path = req.path.as_str();
            let raw_prefix = format!("/raw/octo-themes/polymine-themes/{COMMIT}/themes/dusk/");
            if let Some(file) = path.strip_prefix(&raw_prefix) {
                return files
                    .get(file)
                    .map_or_else(|| Reply::status(404), |b| Reply::bytes(b.clone()));
            }
            match path.strip_prefix(REPO) {
                Some("/commits/main" | "/commits/HEAD") => Reply::ok(COMMIT)
                    .header("content-type", "application/vnd.github.sha; charset=utf-8")
                    .header("etag", &format!("\"{COMMIT}\"")),
                Some(rest) if rest.starts_with(&format!("/git/trees/{COMMIT}:themes/dusk")) => {
                    let etag = "\"tree-1\"";
                    if req.header("if-none-match") == Some(etag) {
                        Reply::status(304).header("etag", etag)
                    } else {
                        Reply::json(&tree).header("etag", etag)
                    }
                }
                _ => Reply::status(404),
            }
        })
    }

    fn github(server: &TestServer) -> GitHub {
        GitHub::new(Client::new(local_policy())).with_bases(server.url(""), server.url("/raw"))
    }

    /// The fixture tree with one more entry.
    fn tree_with(path: &str, mode: &str, kind: &str, size: u64) -> String {
        let mut tree: serde_json::Value = serde_json::from_str(TREE).unwrap();
        tree["tree"]
            .as_array_mut()
            .unwrap()
            .push(serde_json::json!({
                "path": path, "mode": mode, "type": kind, "sha": COMMIT, "size": size,
            }));
        tree.to_string()
    }

    fn names_in(dir: &Path) -> Vec<String> {
        let mut names: Vec<_> = fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    #[test]
    fn repository_and_gist_urls_parse() {
        let repo = |owner: &str, repo: &str, reference: Option<&str>, path: &str| Source::Repo {
            owner: owner.into(),
            repo: repo.into(),
            reference: reference.map(Into::into),
            path: path.into(),
        };
        let gist = |id: &str, revision: Option<&str>| Source::Gist {
            id: id.into(),
            revision: revision.map(Into::into),
        };
        let cases = [
            (
                "https://github.com/owner/repo",
                repo("owner", "repo", None, ""),
            ),
            (
                "github.com/owner/repo.git/",
                repo("owner", "repo", None, ""),
            ),
            (
                "HTTPS://WWW.GitHub.com/o-1/r.e_p",
                repo("o-1", "r.e_p", None, ""),
            ),
            (
                "https://github.com/owner/repo/tree/main/themes/dusk?tab=readme#top",
                repo("owner", "repo", Some("main"), "themes/dusk"),
            ),
            (
                "https://github.com/owner/repo/tree/v1.2/My%20Themes/",
                repo("owner", "repo", Some("v1.2"), "My Themes"),
            ),
            (
                "https://gist.github.com/someone/2f6b1c9e8d7a4f3b5c0e1d2a3b4c5d6e",
                gist("2f6b1c9e8d7a4f3b5c0e1d2a3b4c5d6e", None),
            ),
            (
                "gist.github.com/2f6b1c9e8d7a4f3b5c0e1d2a3b4c5d6e.git",
                gist("2f6b1c9e8d7a4f3b5c0e1d2a3b4c5d6e", None),
            ),
            (
                "https://gist.github.com/someone/abc123/e4f5a6b7c8d9e0f1a2b3c4d5e6f708192a3b4c5d",
                gist("abc123", Some("e4f5a6b7c8d9e0f1a2b3c4d5e6f708192a3b4c5d")),
            ),
        ];
        for (url, expected) in cases {
            assert_eq!(url.parse::<Source>().unwrap(), expected, "{url}");
        }
    }

    #[test]
    fn other_urls_are_invalid() {
        for url in [
            "",
            "http://github.com/owner/repo",
            "ftp://github.com/owner/repo",
            "https://gitlab.com/owner/repo",
            "https://github.com.evil.example/owner/repo",
            "https://github.com/owner",
            "https://github.com/owner/repo/blob/main/theme.css",
            "https://github.com/owner/repo/tree",
            "https://github.com/owner/repo/pulls",
            "https://github.com/-owner/repo",
            "https://github.com/ow_ner/repo",
            "https://github.com/owner/..",
            "https://github.com/owner/repo/tree/main/../../etc",
            "https://github.com/owner/repo/tree/main/a%2F..%2Fb",
            "https://github.com/owner/repo/tree/ma%20in/x",
            "https://gist.github.com/",
            "https://gist.github.com/someone/abc/not-a-sha",
            "https://gist.github.com/someone/ab-c",
            "https://gist.github.com/a/b/c/d",
        ] {
            assert!(
                matches!(Source::parse(url), Err(Error::InvalidUrl(_))),
                "{url} should be invalid"
            );
        }
    }

    #[test]
    fn a_hand_built_source_is_checked_too() {
        let server = github_server(TREE.into(), files());
        let source = Source::Repo {
            owner: "octo-themes".into(),
            repo: "polymine-themes".into(),
            reference: None,
            path: "../secrets".into(),
        };
        let err = github(&server).list(&source, &limits()).unwrap_err();
        assert!(matches!(err, Error::InvalidUrl(_)), "{err:?}");
        assert!(server.requests().is_empty());
    }

    #[test]
    fn a_repository_folder_downloads_into_its_target() {
        let server = github_server(TREE.into(), files());
        let staging = tempfile::tempdir().unwrap();
        let target = staging.path().join("dusk");
        let download = github(&server)
            .download(&dusk(), &target, &limits())
            .unwrap();

        assert_eq!(download.revision, COMMIT);
        assert_eq!(
            download.files,
            [
                "icons/flag.svg",
                "icons/mine.svg",
                "preview.png",
                "theme.css"
            ]
        );
        assert_eq!(download.skipped, ["README.md", "extras/deep/"]);
        assert_eq!(download.bytes, 21 + 21 + 8 + 34);
        assert_eq!(
            fs::read_to_string(target.join("theme.css")).unwrap(),
            THEME_CSS
        );
        assert_eq!(fs::read(target.join("preview.png")).unwrap(), PNG);
        assert_eq!(names_in(&target), ["icons", "preview.png", "theme.css"]);
        assert_eq!(names_in(&target.join("icons")), ["flag.svg", "mine.svg"]);
        assert_eq!(names_in(staging.path()), ["dusk"]);

        let paths: Vec<String> = server.requests().into_iter().map(|r| r.path).collect();
        assert_eq!(paths[0], format!("{REPO}/commits/main"));
        assert_eq!(
            paths[1],
            format!("{REPO}/git/trees/{COMMIT}:themes/dusk?recursive=1")
        );
        assert!(paths[2..].iter().all(|p| p.starts_with("/raw/")));
    }

    #[test]
    fn a_flat_listing_skips_every_subfolder() {
        let server = github_server(TREE.into(), files());
        let limits = Limits {
            max_depth: 0,
            ..limits()
        };
        let listing = github(&server).list(&dusk(), &limits).unwrap();
        let files: Vec<_> = listing.files.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(files, ["preview.png", "theme.css"]);
        assert_eq!(listing.skipped, ["README.md", "extras/", "icons/"]);
        assert!(!server.requests()[1].path.contains("recursive"));
    }

    #[test]
    fn the_default_branch_is_head() {
        let server = github_server(TREE.into(), files());
        let source = Source::parse("https://github.com/octo-themes/polymine-themes").unwrap();
        // The fixture server has no tree for the repository root, so the
        // listing fails after both requests.
        let _ = github(&server).list(&source, &limits());
        assert_eq!(server.requests()[0].path, format!("{REPO}/commits/HEAD"));
        assert_eq!(
            server.requests()[1].path,
            format!("{REPO}/git/trees/{COMMIT}?recursive=1")
        );
    }

    #[test]
    fn symlinks_and_submodules_are_refused_when_their_names_are_allowed() {
        for (path, mode, kind) in [
            ("link.css", "120000", "blob"),
            ("icons/link.svg", "120000", "blob"),
            ("vendor.svg", "160000", "commit"),
            ("odd.svg", "100600", "blob"),
        ] {
            let server = github_server(tree_with(path, mode, kind, 9), files());
            let limits = Limits {
                allowed: vec!["*.css".into(), "*.svg".into()],
                ..limits()
            };
            let staging = tempfile::tempdir().unwrap();
            let target = staging.path().join("dusk");
            let err = github(&server)
                .download(&dusk(), &target, &limits)
                .unwrap_err();
            assert!(matches!(err, Error::Refused(_)), "{path}: {err:?}");
            assert_eq!(names_in(staging.path()), Vec::<String>::new(), "{path}");
            assert!(
                server
                    .requests()
                    .iter()
                    .all(|r| !r.path.starts_with("/raw/"))
            );
        }

        let server = github_server(tree_with("vendor", "160000", "commit", 0), files());
        let listing = github(&server).list(&dusk(), &limits()).unwrap();
        assert!(listing.skipped.contains(&"vendor".to_owned()));
    }

    #[test]
    fn unsafe_paths_are_refused() {
        for path in [
            "../evil.svg",
            "icons/../../evil.svg",
            "/etc/evil.svg",
            "a\\..\\evil.svg",
            "c:evil.svg",
            "con.svg",
            "icons/LPT1.svg",
            "icons./x.svg",
            "nul\u{0}.svg",
            "extras/deep/../../../../evil.txt",
            "",
        ] {
            let server = github_server(tree_with(path, "100644", "blob", 9), files());
            let err = github(&server).list(&dusk(), &limits()).unwrap_err();
            assert!(matches!(err, Error::Refused(_)), "{path}: {err:?}");
        }
    }

    #[test]
    fn names_that_differ_only_in_case_are_refused() {
        let server = github_server(tree_with("Theme.CSS", "100644", "blob", 9), files());
        let err = github(&server).list(&dusk(), &limits()).unwrap_err();
        assert!(matches!(err, Error::Refused(_)), "{err:?}");
    }

    #[test]
    fn listed_sizes_and_counts_are_checked_before_downloading() {
        let cases = [
            Limits {
                max_files: 3,
                ..limits()
            },
            Limits {
                max_file_bytes: 30,
                ..limits()
            },
            Limits {
                max_total_bytes: 80,
                ..limits()
            },
        ];
        for limits in cases {
            let server = github_server(TREE.into(), files());
            let staging = tempfile::tempdir().unwrap();
            let target = staging.path().join("dusk");
            let err = github(&server)
                .download(&dusk(), &target, &limits)
                .unwrap_err();
            assert!(matches!(err, Error::TooLarge(_)), "{limits:?}: {err:?}");
            assert!(
                server
                    .requests()
                    .iter()
                    .all(|r| !r.path.starts_with("/raw/"))
            );
            assert_eq!(names_in(staging.path()), Vec::<String>::new());
        }
    }

    #[test]
    fn a_file_bigger_than_listed_stops_the_download_and_leaves_nothing() {
        let mut files = files();
        files.insert("theme.css", vec![b'x'; 5000]);
        let server = github_server(TREE.into(), files);
        let staging = tempfile::tempdir().unwrap();
        let target = staging.path().join("dusk");
        let err = github(&server)
            .download(&dusk(), &target, &limits())
            .unwrap_err();
        let Error::TooLarge(message) = err else {
            panic!("expected TooLarge, got {err:?}");
        };
        assert!(message.contains("theme.css"), "{message}");
        assert_eq!(names_in(staging.path()), Vec::<String>::new());
    }

    #[test]
    fn files_bigger_than_listed_count_toward_the_total() {
        let mut files = files();
        files.insert("preview.png", vec![b'p'; 900]);
        let server = github_server(TREE.into(), files);
        let staging = tempfile::tempdir().unwrap();
        let limits = Limits {
            max_total_bytes: 500,
            ..limits()
        };
        let err = github(&server)
            .download(&dusk(), &staging.path().join("dusk"), &limits)
            .unwrap_err();
        let Error::TooLarge(message) = err else {
            panic!("expected TooLarge, got {err:?}");
        };
        assert!(message.contains("add up"), "{message}");
        assert_eq!(names_in(staging.path()), Vec::<String>::new());
    }

    #[test]
    fn a_missing_file_fails_the_whole_download() {
        let mut files = files();
        files.remove("icons/mine.svg");
        let server = github_server(TREE.into(), files);
        let staging = tempfile::tempdir().unwrap();
        let err = github(&server)
            .download(&dusk(), &staging.path().join("dusk"), &limits())
            .unwrap_err();
        assert!(matches!(err, Error::Status(404)), "{err:?}");
        assert_eq!(names_in(staging.path()), Vec::<String>::new());
    }

    #[test]
    fn an_existing_target_is_left_alone() {
        let server = github_server(TREE.into(), files());
        let staging = tempfile::tempdir().unwrap();
        let target = staging.path().join("dusk");
        fs::create_dir(&target).unwrap();
        fs::write(target.join("mine.txt"), b"keep").unwrap();
        let err = github(&server)
            .download(&dusk(), &target, &limits())
            .unwrap_err();
        assert!(
            matches!(&err, Error::Io(e) if e.kind() == io::ErrorKind::AlreadyExists),
            "{err:?}"
        );
        assert_eq!(names_in(&target), ["mine.txt"]);
        assert!(server.requests().is_empty());
    }

    #[test]
    fn a_truncated_tree_is_too_large() {
        let tree = TREE.replace("\"truncated\": false", "\"truncated\": true");
        let server = github_server(tree, files());
        let err = github(&server).list(&dusk(), &limits()).unwrap_err();
        assert!(matches!(err, Error::TooLarge(_)), "{err:?}");
    }

    #[test]
    fn rate_limits_missing_repositories_and_odd_answers_are_reported() {
        let server = TestServer::start(|req| {
            let owner = req.path.split('/').nth(2).unwrap_or_default();
            match owner {
                "limited" => Reply::json(
                    r#"{"message":"API rate limit exceeded for 127.0.0.1.","documentation_url":"https://docs.github.com/rest/using-the-rest-api/rate-limits-for-the-rest-api"}"#,
                )
                .header("x-ratelimit-limit", "60")
                .header("x-ratelimit-remaining", "0")
                .header("x-ratelimit-reset", "1")
                .header("x-ratelimit-resource", "core")
                .with_status(403),
                "missing" => Reply::json(r#"{"message":"Not Found","status":"404"}"#).with_status(404),
                _ => Reply::json(r#"{"message":"not a sha"}"#),
            }
        });
        let github = github(&server);
        let list = |url: &str| github.list(&Source::parse(url).unwrap(), &limits());
        assert!(matches!(
            list("https://github.com/limited/repo"),
            Err(Error::RateLimited { .. })
        ));
        assert!(matches!(
            list("https://github.com/missing/repo"),
            Err(Error::Status(404))
        ));
        assert!(matches!(
            list("https://github.com/odd/repo"),
            Err(Error::BadResponse(_))
        ));
    }

    #[test]
    fn the_token_goes_to_the_api_and_raw_repository_files_only() {
        let server = github_server(TREE.into(), files());
        let github = github(&server).with_token(Token::new("ghp_secret"));
        let staging = tempfile::tempdir().unwrap();
        github
            .download(&dusk(), &staging.path().join("dusk"), &limits())
            .unwrap();
        for request in server.requests() {
            assert_eq!(request.header("authorization"), Some("Bearer ghp_secret"));
            if !request.path.starts_with("/raw/") {
                assert_eq!(request.header("x-github-api-version"), Some(API_VERSION));
            }
        }
    }

    fn gist_server() -> TestServer {
        let gist = Arc::new(std::sync::OnceLock::<String>::new());
        let server = {
            let gist = Arc::clone(&gist);
            TestServer::start(move |req| match req.path.as_str() {
                "/gists/2f6b1c9e8d7a4f3b5c0e1d2a3b4c5d6e" => Reply::json(gist.get().unwrap()),
                p if p.ends_with("/theme.css") => Reply::ok(THEME_CSS),
                p if p.ends_with("/notes.md") => Reply::ok("Made for fun.\n"),
                _ => Reply::status(404),
            })
        };
        gist.set(GIST.replace("{{server}}", &server.url("")))
            .unwrap();
        server
    }

    #[test]
    fn a_gist_downloads_its_allowed_files() {
        let server = gist_server();
        let github = github(&server).with_token(Token::new("ghp_secret"));
        let source =
            Source::parse("https://gist.github.com/octo-themes/2f6b1c9e8d7a4f3b5c0e1d2a3b4c5d6e")
                .unwrap();
        let staging = tempfile::tempdir().unwrap();
        let target = staging.path().join("dusk");
        let download = github.download(&source, &target, &limits()).unwrap();
        assert_eq!(
            download.revision,
            "e4f5a6b7c8d9e0f1a2b3c4d5e6f708192a3b4c5d"
        );
        assert_eq!(download.files, ["theme.css"]);
        assert_eq!(download.skipped, ["notes.md"]);
        assert_eq!(
            fs::read_to_string(target.join("theme.css")).unwrap(),
            THEME_CSS
        );

        let requests = server.requests();
        assert_eq!(
            requests[0].header("authorization"),
            Some("Bearer ghp_secret")
        );
        assert_eq!(requests[1].header("authorization"), None);
    }

    #[test]
    fn a_cached_listing_is_revalidated() {
        let server = github_server(TREE.into(), files());
        let dir = tempfile::tempdir().unwrap();
        let cache = Cache::open(dir.path(), 1_000_000).unwrap();
        let github = github(&server).with_cache(cache);
        let first = github.list(&dusk(), &limits()).unwrap();
        let second = github.list(&dusk(), &limits()).unwrap();
        assert_eq!(first, second);
        // The server can log a request after answering it, so find the second
        // tree listing by its path rather than by its place in the log.
        let trees: Vec<_> = server
            .requests()
            .into_iter()
            .filter(|r| r.path.contains("/git/trees/"))
            .collect();
        assert_eq!(trees.len(), 2);
        assert!(
            trees
                .iter()
                .any(|r| r.header("if-none-match") == Some("\"tree-1\""))
        );
    }

    #[test]
    fn partial_downloads_are_swept() {
        let staging = tempfile::tempdir().unwrap();
        let partial = staging.path().join(format!("{PARTIAL_PREFIX}1-0"));
        fs::create_dir_all(partial.join("icons")).unwrap();
        fs::write(partial.join("theme.css"), b"half").unwrap();
        fs::create_dir(staging.path().join("dusk")).unwrap();
        fs::write(
            staging.path().join(format!("{PARTIAL_PREFIX}note")),
            b"a file",
        )
        .unwrap();
        assert_eq!(remove_partial_downloads(staging.path()).unwrap(), 1);
        assert_eq!(
            names_in(staging.path()),
            [format!("{PARTIAL_PREFIX}note"), "dusk".to_owned()]
        );
    }

    #[test]
    fn allowed_names_match_exactly_or_by_extension() {
        let limits = limits();
        assert!(limits.allows("theme.css"));
        assert!(limits.allows("THEME.CSS"));
        assert!(limits.allows("x.Svg"));
        assert!(limits.allows("preview.png"));
        assert!(!limits.allows("other.css"));
        assert!(!limits.allows("svg"));
        let everything = Limits {
            allowed: Vec::new(),
            ..limits
        };
        assert!(everything.allows("anything.bin"));
    }

    #[test]
    fn safe_components_cover_windows_rules() {
        for name in [
            "theme.css",
            ".hidden",
            "a b.svg",
            "con-tour.svg",
            "comma.svg",
            "über.css",
        ] {
            assert!(is_safe_component(name), "{name}");
        }
        for name in [
            "",
            ".",
            "..",
            "a/b",
            "a\\b",
            "a:b",
            "a*b",
            "a?b",
            "a\"b",
            "a<b",
            "a>b",
            "a|b",
            "tab\t",
            "dot.",
            "space ",
            "CON",
            "con.txt",
            "Nul.svg",
            "COM1",
            "lpt9.css",
            "conin$",
            &"x".repeat(256),
        ] {
            assert!(!is_safe_component(name), "{name:?}");
        }
    }
}
