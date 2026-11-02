//! Shares a history through a GitHub gist. `sync` adds to the gist's
//! `history.jsonl` the ranked games it lacks, keeping the lines it already
//! holds. It then appends to the instance's file the ranked games that file
//! lacks, so two machines that sync both end with every ranked game. Only
//! ranked games travel: statistics and champions read nothing else, and the
//! app caps the rest of its history.

use std::collections::{BTreeMap, HashSet};
use std::io::Write;
use std::path::Path;

use polymine_core::GameRecord;
use polymine_ipc::history::{HISTORY_FILE as FILE, ends_mid_line, for_each_line};
use polymine_ipc::instance::{self, InstanceName};
use polymine_ipc::{ErrorBody, ErrorCode};
use polymine_net::{Client, JsonApi, Policy, Request, Token};
use serde::Deserialize;
use serde_json::{Value, json};

/// Holds a GitHub token with the `gist` scope.
pub const TOKEN_ENV: &str = "POLYMINE_GITHUB_TOKEN";

#[derive(Deserialize)]
struct Gist {
    files: BTreeMap<String, GistFile>,
}

#[derive(Deserialize)]
struct GistFile {
    content: Option<String>,
    #[serde(default)]
    truncated: bool,
    raw_url: Option<String>,
}

/// The largest history `sync` reads, far above any real one.
const MAX_HISTORY: u64 = 64 * 1024 * 1024;

/// Where `sync` reaches GitHub. Tests point both at a local server.
#[derive(Debug)]
struct Endpoints {
    api: JsonApi,
    /// Reads a gist file through its `raw_url`.
    raw: Client,
}

impl Endpoints {
    fn github(token: Token) -> Self {
        Self {
            api: JsonApi::new(
                Client::new(Policy::new(["api.github.com"])),
                "https://api.github.com",
            )
            .with_token(token),
            raw: Client::new(
                Policy::new(["gist.githubusercontent.com"]).with_max_response_bytes(MAX_HISTORY),
            ),
        }
    }
}

pub fn sync(name: &InstanceName, gist: &str) -> Result<Value, ErrorBody> {
    if gist.is_empty() || !gist.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err(
            ErrorBody::new(ErrorCode::Usage, "a gist id is letters and digits")
                .with_hint("the id is the last part of the gist's URL"),
        );
    }
    let token = std::env::var(TOKEN_ENV)
        .ok()
        .filter(|t| !t.trim().is_empty())
        .ok_or_else(|| {
            ErrorBody::new(ErrorCode::Usage, format!("{TOKEN_ENV} isn't set")).with_hint(
            "create a token with the gist scope at https://github.com/settings/tokens, then set it",
        )
        })?;
    let (config, data) = instance::app_dirs();
    let (_, data) = instance::instance_dirs(name, config, data);
    let path = data
        .ok_or_else(|| ErrorBody::new(ErrorCode::Internal, "no data folder"))?
        .join(FILE);
    sync_file(&path, gist, &Endpoints::github(Token::new(token)))
}

/// Syncs the history file at `path` with the gist `gist`.
fn sync_file(path: &Path, gist: &str, remote: &Endpoints) -> Result<Value, ErrorBody> {
    let (local, skipped) = read_local(path).map_err(|e| {
        ErrorBody::new(
            ErrorCode::Internal,
            format!("could not read {}: {e}", path.display()),
        )
    })?;

    let network = |e: polymine_net::Error| ErrorBody::new(ErrorCode::Internal, e.to_string());
    let found: Gist = remote.api.get(&format!("gists/{gist}")).map_err(network)?;
    let remote_text = match found.files.get(FILE) {
        // The API cuts files at about a megabyte; the raw file is whole.
        Some(GistFile {
            truncated: true,
            raw_url: Some(url),
            ..
        }) => raw(&remote.raw, url).map_err(network)?,
        // Writing back a cut file would drop the rest of the gist.
        Some(GistFile {
            truncated: true, ..
        }) => {
            return Err(ErrorBody::new(
                ErrorCode::Internal,
                "the gist's history is cut short and GitHub gave no link to the whole file",
            ));
        }
        Some(file) => file.content.clone().unwrap_or_default(),
        None => String::new(),
    };
    let lines = gist_lines(&remote_text);

    // A game is a record of the fields this build knows, so a copy a newer
    // build wrote with more fields is the same game. The gist's lines go back
    // as they came, fields this build can't read included.
    let in_gist: HashSet<&GameRecord> = lines.iter().filter_map(|l| l.record.as_ref()).collect();
    let to_gist = once_each(
        local
            .iter()
            .filter(|r| r.is_ranked() && !in_gist.contains(r)),
    );
    if !to_gist.is_empty() {
        let mut content = String::new();
        for line in &lines {
            content.push_str(line.text);
            content.push('\n');
        }
        content.push_str(&jsonl(to_gist.iter().copied()));
        let body = json!({ "files": { FILE: { "content": content } } });
        let _: Value = remote
            .api
            .patch(&format!("gists/{gist}"), &body)
            .map_err(network)?;
    }
    let in_file: HashSet<&GameRecord> = local.iter().collect();
    let mut seen = HashSet::new();
    let here: Vec<&str> = lines
        .iter()
        .filter(|l| {
            l.record
                .as_ref()
                .is_some_and(|r| r.is_ranked() && !in_file.contains(r) && seen.insert(r))
        })
        .map(|l| l.text)
        .collect();
    append(path, &here).map_err(|e| ErrorBody::new(ErrorCode::Internal, e.to_string()))?;
    Ok(json!({
        "gist": gist,
        "file": path,
        "games": in_gist.iter().filter(|r| r.is_ranked()).count() + to_gist.len(),
        "addedToGist": to_gist.len(),
        "addedHere": here.len(),
        "skippedLines": skipped,
        "skippedGistLines": lines.iter().filter(|l| l.record.is_none()).count(),
    }))
}

/// A gist file's full text from its `raw_url`. Text that isn't UTF-8 is
/// refused, since sync writes the gist's lines back as they are.
fn raw(client: &Client, url: &str) -> polymine_net::Result<String> {
    let response = client.send(&Request::get(url).max_bytes(MAX_HISTORY))?;
    String::from_utf8(response.body)
        .map_err(|_| polymine_net::Error::BadResponse(format!("{url} isn't UTF-8 text")))
}

/// The records in the history file at `path`, and how many lines didn't
/// parse. A line that isn't UTF-8 counts as one that didn't parse, so it
/// can't hide the games around it.
fn read_local(path: &Path) -> std::io::Result<(Vec<GameRecord>, usize)> {
    let mut records = Vec::new();
    let mut skipped = 0;
    for_each_line(path, |line| match serde_json::from_slice(line) {
        Ok(record) => records.push(record),
        Err(_) => skipped += 1,
    })?;
    Ok((records, skipped))
}

/// One non-blank line of the gist's history, with its record when this build
/// can read it.
struct GistLine<'a> {
    text: &'a str,
    record: Option<GameRecord>,
}

fn gist_lines(text: &str) -> Vec<GistLine<'_>> {
    text.lines()
        .filter(|line| !line.trim().is_empty())
        .map(|text| GistLine {
            text,
            record: serde_json::from_str(text).ok(),
        })
        .collect()
}

/// `records` without repeats, in order.
fn once_each<'a>(records: impl Iterator<Item = &'a GameRecord>) -> Vec<&'a GameRecord> {
    let mut seen = HashSet::new();
    records.filter(|r| seen.insert(*r)).collect()
}

fn jsonl<'a>(records: impl IntoIterator<Item = &'a GameRecord>) -> String {
    records
        .into_iter()
        .map(|r| serde_json::to_string(r).expect("records always serialize") + "\n")
        .collect()
}

/// Appends `lines` to the history file, as the app does, so a running
/// instance keeps writing to the same file.
fn append(path: &Path, lines: &[&str]) -> std::io::Result<()> {
    if lines.is_empty() {
        return Ok(());
    }
    // The app rewrites this file to drop old records, under the same lock.
    let _lock = polymine_ipc::history::lock(path)?;
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .read(true)
        .append(true)
        .open(path)?;
    let mut text = String::new();
    if ends_mid_line(&mut file)? {
        text.push('\n');
    }
    for line in lines {
        text.push_str(line);
        text.push('\n');
    }
    file.write_all(text.as_bytes())
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::time::Duration;

    use polymine_net::test_server::{Reply, TestServer};

    use super::*;

    const GIST: &str = "abc123";

    /// A gist on a local server whose history file holds `file`. With
    /// `truncated`, the API sends half of it and a `raw_url` for the rest.
    /// Every PATCH succeeds and changes nothing.
    fn gist(file: &str, truncated: bool) -> TestServer {
        let file = file.to_owned();
        TestServer::start(move |req| match (req.method.as_str(), req.path.as_str()) {
            ("GET", "/gists/abc123") => {
                let host = req.header("host").unwrap_or_default();
                let content = if truncated {
                    &file[..file.len() / 2]
                } else {
                    &file
                };
                let files = json!({ FILE: {
                    "content": content,
                    "truncated": truncated,
                    "raw_url": format!("http://{host}/raw/{FILE}"),
                }});
                Reply::json(&json!({ "files": files }).to_string())
            }
            ("GET", "/raw/history.jsonl") => Reply::ok(&file),
            ("PATCH", "/gists/abc123") => Reply::json("{}"),
            _ => Reply::status(404),
        })
    }

    fn endpoints(server: &TestServer) -> Endpoints {
        let policy = Policy::new(["127.0.0.1"])
            .allow_plain_http_to_loopback()
            .with_timeout(Duration::from_secs(5));
        Endpoints {
            api: JsonApi::new(Client::new(policy.clone()), server.url(""))
                .with_token(Token::new("test-token")),
            raw: Client::new(policy.with_max_response_bytes(MAX_HISTORY)),
        }
    }

    /// Syncs a history file holding `local` with the gist `server` serves.
    fn sync_bytes(
        server: &TestServer,
        local: &[u8],
    ) -> (tempfile::TempDir, PathBuf, Result<Value, ErrorBody>) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(FILE);
        std::fs::write(&path, local).unwrap();
        let result = sync_file(&path, GIST, &endpoints(server));
        (dir, path, result)
    }

    /// The history each PATCH sent to the gist.
    fn patched(server: &TestServer) -> Vec<String> {
        server
            .requests()
            .iter()
            .filter(|r| r.method == "PATCH")
            .map(|r| {
                let body: Value = serde_json::from_slice(&r.body).unwrap();
                body["files"][FILE]["content"].as_str().unwrap().to_owned()
            })
            .collect()
    }

    /// The records in `text`, oldest first.
    fn sorted(text: &str) -> Vec<GameRecord> {
        let mut records: Vec<GameRecord> = gist_lines(text)
            .into_iter()
            .filter_map(|l| l.record)
            .collect();
        records.sort_by_key(|r| r.finished_at);
        records
    }

    fn record(player: &str, finished_at: i64) -> GameRecord {
        serde_json::from_value(json!({
            "player": player, "tiling": "square", "level": "beginner", "cols": 9, "rows": 9,
            "mines": 10, "outcome": "won", "durationMs": 1000, "clicks": 5, "opened": 71,
            "safeCells": 71, "assisted": false, "finishedAt": finished_at
        }))
        .unwrap()
    }

    #[test]
    fn reads_gist_lines_and_keeps_the_ones_it_cant() {
        let text = jsonl(&[record("ann", 1), record("bob", 2)]) + "not json\r\n\n  \n";
        let lines = gist_lines(&text);
        let texts: Vec<_> = lines.iter().map(|l| l.text).collect();
        assert_eq!(texts.len(), 3);
        assert_eq!(texts[2], "not json");
        assert_eq!(lines.iter().filter(|l| l.record.is_some()).count(), 2);
    }

    #[test]
    fn a_game_only_here_goes_to_the_gist() {
        let (a, b) = (record("ann", 1), record("bob", 2));
        let server = gist(&jsonl(std::slice::from_ref(&b)), false);
        let (_dir, path, result) = sync_bytes(&server, jsonl(std::slice::from_ref(&a)).as_bytes());
        let result = result.unwrap();
        assert_eq!(result["addedToGist"], 1);
        let patches = patched(&server);
        assert_eq!(patches.len(), 1);
        assert_eq!(sorted(&patches[0]), [a.clone(), b.clone()]);
        assert_eq!(sorted(&std::fs::read_to_string(path).unwrap()), [a, b]);
        let auth = server.requests()[0]
            .header("authorization")
            .map(str::to_owned);
        assert_eq!(auth.as_deref(), Some("Bearer test-token"));
    }

    #[test]
    fn a_game_only_in_the_gist_comes_here() {
        let (a, b) = (record("ann", 1), record("bob", 2));
        let server = gist(&jsonl(&[a.clone(), b.clone()]), false);
        let (_dir, path, result) = sync_bytes(&server, jsonl(std::slice::from_ref(&a)).as_bytes());
        assert_eq!(result.unwrap()["addedHere"], 1);
        assert_eq!(patched(&server), Vec::<String>::new());
        assert_eq!(read_local(&path).unwrap().0, [a, b]);
    }

    #[test]
    fn a_truncated_gist_is_read_whole_through_its_raw_url() {
        let games: Vec<GameRecord> = (1..=6).map(|i| record("ann", i)).collect();
        let server = gist(&jsonl(&games), true);
        let (_dir, path, result) = sync_bytes(&server, b"");
        assert_eq!(result.unwrap()["addedHere"], 6);
        assert_eq!(read_local(&path).unwrap().0, games);
        assert!(
            server
                .requests()
                .iter()
                .any(|r| r.path == "/raw/history.jsonl")
        );
        assert_eq!(patched(&server), Vec::<String>::new());
    }

    #[test]
    fn a_cut_gist_without_a_raw_url_is_never_written_back() {
        let games: Vec<GameRecord> = (1..=6).map(|i| record("ann", i)).collect();
        let text = jsonl(&games);
        let server = TestServer::start(move |req| match req.method.as_str() {
            "GET" => {
                let files = json!({ FILE: {
                    "content": &text[..text.len() / 2],
                    "truncated": true,
                }});
                Reply::json(&json!({ "files": files }).to_string())
            }
            _ => Reply::json("{}"),
        });
        let local = jsonl(&[record("bob", 9)]);
        let (_dir, _path, result) = sync_bytes(&server, local.as_bytes());
        assert!(result.is_err());
        assert_eq!(patched(&server), Vec::<String>::new());
    }

    #[test]
    fn a_sync_with_nothing_new_sends_no_patch() {
        let (a, b) = (record("ann", 1), record("bob", 2));
        let local = jsonl(&[a.clone(), b.clone()]);
        let server = gist(&jsonl(&[b, a]), false);
        let (_dir, path, result) = sync_bytes(&server, local.as_bytes());
        let result = result.unwrap();
        assert_eq!(
            (&result["addedToGist"], &result["addedHere"]),
            (&json!(0), &json!(0))
        );
        assert_eq!(server.requests().len(), 1, "one GET and nothing else");
        assert_eq!(std::fs::read_to_string(path).unwrap(), local);
    }

    #[test]
    fn a_line_that_isnt_utf8_hides_no_other_game() {
        let a = record("José", 1);
        let mut local = jsonl(std::slice::from_ref(&a)).into_bytes();
        // A crash cut this line inside the é, and the next append ended it.
        let torn = jsonl(&[record("José", 2)]).into_bytes();
        let cut = torn.iter().position(|&b| b == 0xC3).unwrap() + 1;
        local.extend_from_slice(&torn[..cut]);
        local.push(b'\n');
        let server = gist(&jsonl(std::slice::from_ref(&a)), false);
        let (_dir, path, result) = sync_bytes(&server, &local);
        let result = result.unwrap();
        assert_eq!(
            (&result["addedHere"], &result["skippedLines"]),
            (&json!(0), &json!(1))
        );
        assert_eq!(std::fs::read(path).unwrap(), local);
        assert_eq!(patched(&server), Vec::<String>::new());
    }

    #[test]
    fn a_history_that_cant_be_read_stops_the_sync() {
        let server = gist("", false);
        let dir = tempfile::tempdir().unwrap();
        // A folder where the file should be fails to open or to read.
        let error = sync_file(dir.path(), GIST, &endpoints(&server)).unwrap_err();
        assert_eq!(error.code, ErrorCode::Internal);
        assert!(server.requests().is_empty(), "the gist is never touched");
    }

    #[test]
    fn a_game_from_the_gist_starts_a_line_after_a_torn_one() {
        let (a, b) = (record("ann", 1), record("bob", 2));
        let whole = jsonl(std::slice::from_ref(&a));
        let torn = &whole[..whole.len() - 10];
        let server = gist(&jsonl(std::slice::from_ref(&b)), false);
        let (_dir, path, result) = sync_bytes(&server, torn.as_bytes());
        assert_eq!(result.unwrap()["addedHere"], 1);
        assert_eq!(read_local(&path).unwrap(), (vec![b], 1));
    }

    #[test]
    fn duplicate_gist_lines_dont_hide_games_the_gist_lacks() {
        let (a, b) = (record("ann", 1), record("bob", 2));
        let server = gist(&jsonl(&[a.clone(), a.clone()]), false);
        let (_dir, _path, result) = sync_bytes(&server, b"");
        let result = result.unwrap();
        assert_eq!(
            (&result["addedToGist"], &result["addedHere"]),
            (&json!(0), &json!(1))
        );
        assert_eq!(patched(&server), Vec::<String>::new());

        let server = gist(&jsonl(&[a.clone(), a.clone()]), false);
        let local = jsonl(std::slice::from_ref(&b));
        let (_dir, _path, result) = sync_bytes(&server, local.as_bytes());
        assert_eq!(result.unwrap()["addedToGist"], 1);
        let patches = patched(&server);
        assert_eq!(patches.len(), 1);
        assert!(sorted(&patches[0]).contains(&b));
    }

    /// `record` as a newer build might write it: an unknown field, and
    /// another tiling when `tiling` is set.
    fn newer(record: &GameRecord, tiling: Option<&str>) -> String {
        let mut value = serde_json::to_value(record).unwrap();
        value["replay"] = json!("r1c1");
        if let Some(tiling) = tiling {
            value["tiling"] = json!(tiling);
        }
        value.to_string()
    }

    #[test]
    fn gist_lines_this_build_cant_read_stay_in_the_gist() {
        let (a, b, c) = (record("ann", 1), record("bob", 2), record("cy", 3));
        let future = newer(&a, Some("some-future-tiling"));
        let extra = newer(&c, None);
        let file = format!("{future}\nnot json\n{extra}\n");
        let server = gist(&file, false);
        let local = jsonl(std::slice::from_ref(&b));
        let (_dir, path, result) = sync_bytes(&server, local.as_bytes());
        let result = result.unwrap();
        assert_eq!(result["skippedGistLines"], 2);
        assert_eq!(
            (&result["addedToGist"], &result["addedHere"]),
            (&json!(1), &json!(1))
        );
        let patches = patched(&server);
        assert_eq!(patches.len(), 1);
        let lines: Vec<&str> = patches[0].lines().collect();
        assert_eq!(
            lines,
            [future.as_str(), "not json", &extra, local.trim_end()]
        );
        // Only the game this build reads comes here, as the gist has it.
        let here = std::fs::read_to_string(path).unwrap();
        assert_eq!(here, format!("{local}{extra}\n"));
    }

    #[test]
    fn a_game_a_newer_build_wrote_is_still_one_game() {
        let a = record("ann", 1);
        let plain = jsonl(std::slice::from_ref(&a));
        let extra = newer(&a, None) + "\n";
        for (local, remote) in [(&plain, &extra), (&extra, &plain)] {
            let server = gist(remote, false);
            let (_dir, path, result) = sync_bytes(&server, local.as_bytes());
            let result = result.unwrap();
            assert_eq!(
                (&result["addedToGist"], &result["addedHere"]),
                (&json!(0), &json!(0))
            );
            assert_eq!(patched(&server), Vec::<String>::new());
            assert_eq!(&std::fs::read_to_string(path).unwrap(), local);
        }
    }

    #[test]
    fn only_ranked_games_travel() {
        let (a, b) = (record("ann", 1), record("bob", 2));
        let mut assisted = record("ann", 3);
        assisted.assisted = true;
        let mut custom = record("bob", 4);
        custom.level = polymine_core::Level::Custom;
        let server = gist(&jsonl(&[b.clone(), custom.clone()]), false);
        let local = jsonl(&[a.clone(), assisted]);
        let (_dir, path, result) = sync_bytes(&server, local.as_bytes());
        let result = result.unwrap();
        assert_eq!(
            (&result["addedToGist"], &result["addedHere"]),
            (&json!(1), &json!(1))
        );
        assert_eq!(result["games"], 2);
        let patches = patched(&server);
        assert_eq!(patches.len(), 1);
        assert_eq!(sorted(&patches[0]), [a, b.clone(), custom]);
        assert_eq!(std::fs::read_to_string(path).unwrap(), local + &jsonl([&b]));
    }

    #[test]
    fn refuses_a_gist_id_that_isnt_an_id() {
        let name = InstanceName::default_instance();
        let error = sync(&name, "../evil").unwrap_err();
        assert_eq!(error.code, ErrorCode::Usage);
    }
}
