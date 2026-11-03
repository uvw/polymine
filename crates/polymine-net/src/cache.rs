//! A disk cache for GET responses. Every hit is revalidated with the server
//! through `If-None-Match` and `If-Modified-Since`, so the cache saves
//! bandwidth and GitHub rate limit but never serves anything stale.

use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime};

use serde::{Deserialize, Serialize};

use crate::client::{Client, Request, Response, status_error};
use crate::error::Result;

const ENTRY_EXTENSION: &str = "http";
const TEMP_EXTENSION: &str = "tmp";
/// Temporary files older than this belong to a write that crashed.
const ABANDONED_AFTER: Duration = Duration::from_hours(1);

/// A folder of cached responses, bounded in total size. Each entry is one
/// file named by a hash of its URL, so no part of a URL reaches a file name.
#[derive(Debug)]
pub struct Cache {
    dir: PathBuf,
    max_bytes: u64,
}

/// The first line of an entry file. The body follows it.
#[derive(Debug, Serialize, Deserialize)]
struct Header {
    key: String,
    etag: Option<String>,
    last_modified: Option<String>,
}

#[derive(Debug)]
struct Entry {
    header: Header,
    body: Vec<u8>,
}

impl Cache {
    /// Opens the cache in `dir`, creating it if needed. Once the entries add
    /// up to more than `max_bytes`, the least recently used go first.
    pub fn open(dir: impl Into<PathBuf>, max_bytes: u64) -> io::Result<Self> {
        let dir = dir.into();
        fs::create_dir_all(&dir)?;
        Ok(Self { dir, max_bytes })
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    /// Removes every entry.
    pub fn clear(&self) -> io::Result<()> {
        for item in fs::read_dir(&self.dir)? {
            let path = item?.path();
            if has_extension(&path, ENTRY_EXTENSION) || has_extension(&path, TEMP_EXTENSION) {
                remove_if_present(&path)?;
            }
        }
        Ok(())
    }

    fn path_for(&self, key: &str) -> PathBuf {
        self.dir
            .join(format!("{}.{ENTRY_EXTENSION}", file_stem(key)))
    }

    fn lookup(&self, key: &str) -> Option<Entry> {
        let bytes = fs::read(self.path_for(key)).ok()?;
        let split = bytes.iter().position(|&b| b == b'\n')?;
        let header: Header = serde_json::from_slice(&bytes[..split]).ok()?;
        // Two URLs can share a hash; the stored key tells them apart.
        (header.key == key).then(|| Entry {
            header,
            body: bytes[split + 1..].to_vec(),
        })
    }

    /// Marks an entry as just used, so eviction keeps it longer.
    fn touch(&self, key: &str) {
        let _ = File::options()
            .write(true)
            .open(self.path_for(key))
            .and_then(|file| file.set_modified(SystemTime::now()));
    }

    fn store(&self, entry: &Entry) -> io::Result<()> {
        let path = self.path_for(&entry.header.key);
        let mut bytes = serde_json::to_vec(&entry.header)?;
        bytes.push(b'\n');
        bytes.extend_from_slice(&entry.body);
        if bytes.len() as u64 > self.max_bytes {
            return remove_if_present(&path);
        }
        write_atomically(&path, &bytes)?;
        self.evict()
    }

    fn remove(&self, key: &str) -> io::Result<()> {
        remove_if_present(&self.path_for(key))
    }

    /// Deletes the least recently used entries until the rest fit, and any
    /// temporary file a crashed write left behind.
    fn evict(&self) -> io::Result<()> {
        let now = SystemTime::now();
        let mut entries = Vec::new();
        let mut total = 0;
        for item in fs::read_dir(&self.dir)? {
            let item = item?;
            let path = item.path();
            let Ok(meta) = item.metadata() else { continue };
            let modified = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
            if has_extension(&path, ENTRY_EXTENSION) {
                total += meta.len();
                entries.push((modified, meta.len(), path));
            } else if has_extension(&path, TEMP_EXTENSION)
                && now.duration_since(modified).unwrap_or_default() > ABANDONED_AFTER
            {
                remove_if_present(&path)?;
            }
        }
        entries.sort();
        for (_, len, path) in entries {
            if total <= self.max_bytes {
                break;
            }
            remove_if_present(&path)?;
            total -= len;
        }
        Ok(())
    }
}

impl Client {
    /// Sends a GET through `cache`. A cached entry goes out as
    /// `If-None-Match` and `If-Modified-Since`; on 304 the response carries
    /// the cached body with `from_cache` set. A success with an `ETag` or
    /// `Last-Modified` header, and no `Cache-Control: no-store`, is stored.
    /// Other methods skip the cache. A cache that can't be read or written
    /// only costs the saving; the request still succeeds.
    pub fn send_cached(&self, request: &Request, cache: &Cache) -> Result<Response> {
        if !request.is_get() {
            return self.send(request);
        }
        let key = cache_key(request);
        let cached = cache.lookup(&key);
        let mut conditions = Vec::new();
        if let Some(header) = cached.as_ref().map(|entry| &entry.header) {
            if let Some(etag) = &header.etag {
                conditions.push(("if-none-match", etag.clone()));
            }
            if let Some(date) = &header.last_modified {
                conditions.push(("if-modified-since", date.clone()));
            }
        }
        let mut response = self.execute(request, &conditions)?;
        if response.status == 304
            && let Some(entry) = cached
        {
            cache.touch(&key);
            response.status = 200;
            response.body = entry.body;
            response.from_cache = true;
            return Ok(response);
        }
        if !(200..300).contains(&response.status) {
            return Err(status_error(response.status, response.headers()));
        }
        let header = Header {
            key,
            etag: response.header("etag").map(str::to_owned),
            last_modified: response.header("last-modified").map(str::to_owned),
        };
        let no_store = response
            .header("cache-control")
            .is_some_and(|v| v.to_ascii_lowercase().contains("no-store"));
        let result = if response.status != 200
            || no_store
            || (header.etag.is_none() && header.last_modified.is_none())
        {
            cache.remove(&header.key)
        } else {
            cache.store(&Entry {
                header,
                body: response.body.clone(),
            })
        };
        if let Err(err) = result {
            log::warn!(
                "Couldn't update the response cache in {}: {err}",
                cache.dir.display()
            );
        }
        Ok(response)
    }
}

/// The URL plus the `Accept` header, since GitHub answers one URL with
/// different bodies per media type.
fn cache_key(request: &Request) -> String {
    format!(
        "{}\n{}",
        request.url(),
        request.header_value("accept").unwrap_or("")
    )
}

/// A 64-bit FNV-1a hash in hex: stable across builds, unlike `std`'s hasher.
fn file_stem(key: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in key.bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{hash:016x}")
}

/// Writes `bytes` to a temporary file beside `path`, syncs it, and renames
/// it over `path`, so readers see the old entry or the new one, never half.
fn write_atomically(path: &Path, bytes: &[u8]) -> io::Result<()> {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let temp = path.with_extension(format!(
        "{}.{}.{TEMP_EXTENSION}",
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    let result = File::create_new(&temp)
        .and_then(|mut file| {
            file.write_all(bytes)?;
            file.sync_all()
        })
        .and_then(|()| fs::rename(&temp, path));
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

fn has_extension(path: &Path, extension: &str) -> bool {
    path.extension().is_some_and(|e| e == extension)
}

fn remove_if_present(path: &Path) -> io::Result<()> {
    match fs::remove_file(path) {
        Err(err) if err.kind() != io::ErrorKind::NotFound => Err(err),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::sync::atomic::AtomicUsize;

    use super::*;
    use crate::client::tests::local_policy;
    use crate::error::Error;
    use crate::test_server::{Reply, TestServer};

    fn cache(dir: &tempfile::TempDir) -> Cache {
        Cache::open(dir.path().join("cache"), 10_000).unwrap()
    }

    fn entries(cache: &Cache) -> Vec<PathBuf> {
        let mut paths: Vec<_> = fs::read_dir(cache.dir())
            .unwrap()
            .map(|e| e.unwrap().path())
            .collect();
        paths.sort();
        paths
    }

    #[test]
    fn an_etag_is_revalidated_and_a_304_serves_the_cached_body() {
        let version = Arc::new(AtomicUsize::new(1));
        let server = {
            let version = Arc::clone(&version);
            TestServer::start(move |req| {
                let etag = format!("\"v{}\"", version.load(Ordering::SeqCst));
                if req.header("if-none-match") == Some(etag.as_str()) {
                    Reply::status(304).header("etag", &etag)
                } else {
                    Reply::ok(&format!("body {etag}")).header("etag", &etag)
                }
            })
        };
        let dir = tempfile::tempdir().unwrap();
        let cache = cache(&dir);
        let client = Client::new(local_policy());
        let request = Request::get(server.url("/file"));

        let first = client.send_cached(&request, &cache).unwrap();
        assert!(!first.from_cache);
        let second = client.send_cached(&request, &cache).unwrap();
        assert!(second.from_cache);
        assert_eq!(second.status, 200);
        assert_eq!(second.body, first.body);
        assert_eq!(server.requests()[1].header("if-none-match"), Some("\"v1\""));

        version.store(2, Ordering::SeqCst);
        let third = client.send_cached(&request, &cache).unwrap();
        assert!(!third.from_cache);
        assert_eq!(third.body, b"body \"v2\"");
        let fourth = client.send_cached(&request, &cache).unwrap();
        assert!(fourth.from_cache);
        assert_eq!(fourth.body, b"body \"v2\"");
    }

    #[test]
    fn last_modified_is_revalidated_too() {
        let date = "Tue, 03 Nov 2026 10:00:00 GMT";
        let server = TestServer::start(move |req| {
            if req.header("if-modified-since") == Some(date) {
                Reply::status(304)
            } else {
                Reply::ok("dated").header("last-modified", date)
            }
        });
        let dir = tempfile::tempdir().unwrap();
        let cache = cache(&dir);
        let client = Client::new(local_policy());
        let request = Request::get(server.url("/dated"));
        client.send_cached(&request, &cache).unwrap();
        let again = client.send_cached(&request, &cache).unwrap();
        assert!(again.from_cache);
        assert_eq!(again.body, b"dated");
    }

    #[test]
    fn responses_without_validators_or_marked_no_store_are_not_kept() {
        let server = TestServer::start(|req| match req.path.as_str() {
            "/plain" => Reply::ok("plain"),
            _ => Reply::ok("secret")
                .header("etag", "\"s\"")
                .header("cache-control", "private, no-store"),
        });
        let dir = tempfile::tempdir().unwrap();
        let cache = cache(&dir);
        let client = Client::new(local_policy());
        for path in ["/plain", "/no-store"] {
            client
                .send_cached(&Request::get(server.url(path)), &cache)
                .unwrap();
        }
        assert_eq!(entries(&cache), Vec::<PathBuf>::new());
        assert!(
            server
                .requests()
                .iter()
                .all(|r| r.header("if-none-match").is_none())
        );
    }

    #[test]
    fn errors_are_not_cached_and_still_report_their_status() {
        let server = TestServer::start(|_| Reply::status(404).header("etag", "\"x\""));
        let dir = tempfile::tempdir().unwrap();
        let cache = cache(&dir);
        let client = Client::new(local_policy());
        let err = client
            .send_cached(&Request::get(server.url("/missing")), &cache)
            .unwrap_err();
        assert!(matches!(err, Error::Status(404)), "{err:?}");
        assert_eq!(entries(&cache), Vec::<PathBuf>::new());
    }

    #[test]
    fn the_accept_header_is_part_of_the_key() {
        let server = TestServer::start(|req| {
            let accept = req.header("accept").unwrap_or("none").to_owned();
            Reply::ok(&accept).header("etag", &format!("\"{accept}\""))
        });
        let dir = tempfile::tempdir().unwrap();
        let cache = cache(&dir);
        let client = Client::new(local_policy());
        let json = Request::get(server.url("/x")).header("accept", "application/json");
        let raw = Request::get(server.url("/x")).header("accept", "application/raw");
        client.send_cached(&json, &cache).unwrap();
        client.send_cached(&raw, &cache).unwrap();
        assert_eq!(entries(&cache).len(), 2);
    }

    #[test]
    fn file_names_are_hashes_whatever_the_url() {
        let dir = tempfile::tempdir().unwrap();
        let cache = cache(&dir);
        for key in ["https://a.example/../../etc/passwd", "con\nAUX:*?", ""] {
            let name = cache.path_for(key);
            assert_eq!(name.parent(), Some(cache.dir()));
            let stem = name.file_stem().unwrap().to_str().unwrap();
            assert_eq!(stem.len(), 16);
            assert!(stem.chars().all(|c| c.is_ascii_hexdigit()));
        }
    }

    #[test]
    fn a_damaged_or_colliding_entry_is_a_miss() {
        let dir = tempfile::tempdir().unwrap();
        let cache = cache(&dir);
        fs::write(cache.path_for("a"), b"not json\nbody").unwrap();
        assert!(cache.lookup("a").is_none());
        fs::write(cache.path_for("b"), b"no newline").unwrap();
        assert!(cache.lookup("b").is_none());
        let other = Header {
            key: "someone else".into(),
            etag: Some("\"e\"".into()),
            last_modified: None,
        };
        let mut bytes = serde_json::to_vec(&other).unwrap();
        bytes.extend_from_slice(b"\nbody");
        fs::write(cache.path_for("c"), bytes).unwrap();
        assert!(cache.lookup("c").is_none());
    }

    fn entry(key: &str, body: &[u8]) -> Entry {
        Entry {
            header: Header {
                key: key.into(),
                etag: Some("\"e\"".into()),
                last_modified: None,
            },
            body: body.to_vec(),
        }
    }

    #[test]
    fn the_least_recently_used_entries_go_first() {
        let dir = tempfile::tempdir().unwrap();
        let cache = Cache::open(dir.path(), 350).unwrap();
        let age = |key: &str, secs: u64| {
            File::options()
                .write(true)
                .open(cache.path_for(key))
                .unwrap()
                .set_modified(SystemTime::now() - Duration::from_secs(secs))
                .unwrap();
        };
        cache.store(&entry("old", &[b'o'; 100])).unwrap();
        age("old", 300);
        cache.store(&entry("used", &[b'u'; 100])).unwrap();
        age("used", 200);
        cache.touch("used");
        cache.store(&entry("new", &[b'n'; 100])).unwrap();

        assert!(cache.lookup("old").is_none());
        assert!(cache.lookup("used").is_some());
        assert!(cache.lookup("new").is_some());
    }

    #[test]
    fn an_entry_bigger_than_the_cache_is_not_kept() {
        let dir = tempfile::tempdir().unwrap();
        let cache = Cache::open(dir.path(), 100).unwrap();
        cache.store(&entry("small", b"tiny")).unwrap();
        assert!(cache.lookup("small").is_some());
        cache.store(&entry("small", &[b'x'; 100])).unwrap();
        assert!(cache.lookup("small").is_none());
    }

    #[test]
    fn abandoned_temporary_files_are_swept_and_fresh_ones_kept() {
        let dir = tempfile::tempdir().unwrap();
        let cache = Cache::open(dir.path(), 1000).unwrap();
        let stale = dir.path().join("abc.1.0.tmp");
        let fresh = dir.path().join("abc.1.1.tmp");
        fs::write(&stale, b"half").unwrap();
        fs::write(&fresh, b"half").unwrap();
        File::options()
            .write(true)
            .open(&stale)
            .unwrap()
            .set_modified(SystemTime::now() - 2 * ABANDONED_AFTER)
            .unwrap();
        cache.store(&entry("k", b"v")).unwrap();
        assert!(!stale.exists());
        assert!(fresh.exists());
    }

    #[test]
    fn clear_removes_entries_and_leaves_other_files() {
        let dir = tempfile::tempdir().unwrap();
        let cache = Cache::open(dir.path(), 1000).unwrap();
        cache.store(&entry("k", b"v")).unwrap();
        let other = dir.path().join("keep.txt");
        fs::write(&other, b"mine").unwrap();
        cache.clear().unwrap();
        assert!(cache.lookup("k").is_none());
        assert!(other.exists());
    }

    #[test]
    fn a_write_leaves_no_temporary_file() {
        let dir = tempfile::tempdir().unwrap();
        let cache = Cache::open(dir.path(), 1000).unwrap();
        cache.store(&entry("k", b"v")).unwrap();
        cache.store(&entry("k", b"w")).unwrap();
        let names = entries(&cache);
        assert_eq!(names.len(), 1);
        assert!(has_extension(&names[0], ENTRY_EXTENSION));
        assert_eq!(cache.lookup("k").unwrap().body, b"w");
    }

    #[test]
    fn post_requests_skip_the_cache() {
        let server = TestServer::start(|_| Reply::ok("posted").header("etag", "\"p\""));
        let dir = tempfile::tempdir().unwrap();
        let cache = cache(&dir);
        let client = Client::new(local_policy());
        let request = Request::post(server.url("/p"), "text/plain", b"x".to_vec());
        client.send_cached(&request, &cache).unwrap();
        assert_eq!(entries(&cache), Vec::<PathBuf>::new());
    }
}
