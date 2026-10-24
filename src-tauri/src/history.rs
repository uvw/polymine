//! Finished games, stored one JSON record per line.
//!
//! Appending a line never rewrites earlier games, so a crash can at worst
//! leave one partial line at the end. Unreadable lines are skipped on load and
//! counted so the caller can report them.
//!
//! Only ranked records stay in memory, since statistics and champions use
//! nothing else. Unranked ones (assisted, custom, abandoned) are only counted.
//! Once the file holds too many, it is rewritten with the newest of them and
//! every ranked record.

use std::fs::{self, File, OpenOptions};
use std::io::{self, BufWriter, Write};
use std::path::{Path, PathBuf};

use polymine_core::GameRecord;
use polymine_ipc::history::{ends_mid_line, for_each_line, lock};

/// How many unranked records the file keeps.
const KEEP_UNRANKED: usize = 2_000;
/// The file is compacted once it holds this many unranked records. The gap
/// above [`KEEP_UNRANKED`] keeps rewrites rare: idle autoplay finishes
/// thousands of games a night.
const COMPACT_AT: usize = 3_000;

#[derive(Clone, Copy, Debug)]
struct Limits {
    keep_unranked: usize,
    compact_at: usize,
}

const LIMITS: Limits = Limits {
    keep_unranked: KEEP_UNRANKED,
    compact_at: COMPACT_AT,
};

#[derive(Debug)]
pub struct History {
    path: Option<PathBuf>,
    limits: Limits,
    ranked: Vec<GameRecord>,
    /// Records an earlier append failed to write, oldest first.
    pending: Vec<GameRecord>,
    /// Unranked records in the file.
    unranked: usize,
    /// Whether the file has been read. When it couldn't be, records still go
    /// to it, and each append tries to read it again.
    read: bool,
}

#[derive(Debug)]
pub struct Loaded {
    pub history: History,
    pub skipped_lines: usize,
}

impl History {
    /// Keeps records in memory only. Used when the data directory is unavailable.
    pub fn in_memory() -> Self {
        Self {
            path: None,
            limits: LIMITS,
            ranked: Vec::new(),
            pending: Vec::new(),
            unranked: 0,
            read: true,
        }
    }

    /// Writes to `path` without having read it, after an open failed. The
    /// session's games still reach the file, and statistics leave out older
    /// games until a later append manages to read it.
    pub fn unread(path: PathBuf) -> Self {
        Self {
            path: Some(path),
            read: false,
            ..Self::in_memory()
        }
    }

    /// Reads the ranked records at `path` and compacts the file if it holds
    /// too many unranked ones.
    pub fn open(path: PathBuf) -> io::Result<Loaded> {
        Self::open_with(path, LIMITS)
    }

    fn open_with(path: PathBuf, limits: Limits) -> io::Result<Loaded> {
        let mut ranked = Vec::new();
        let mut unranked = 0;
        let mut skipped_lines = 0;
        // Two syncs at once, or a retried partial write, can repeat a line. A
        // repeated ranked game would count twice in statistics.
        let mut seen = std::collections::HashSet::new();
        for_each_line(&path, |line| match parse(line) {
            Some(record) if record.is_ranked() => {
                if seen.insert(line.to_vec()) {
                    ranked.push(record);
                }
            }
            Some(_) => unranked += 1,
            None => skipped_lines += 1,
        })?;
        let mut history = Self {
            path: Some(path),
            limits,
            ranked,
            pending: Vec::new(),
            unranked,
            read: true,
        };
        history.compact_if_due();
        Ok(Loaded {
            history,
            skipped_lines,
        })
    }

    /// The ranked records, the only ones statistics and champions use.
    pub fn ranked(&self) -> &[GameRecord] {
        &self.ranked
    }

    /// Adds a record and writes it, with any an earlier append failed to
    /// write. The record stays in memory until it is written.
    pub fn append(&mut self, record: GameRecord) -> io::Result<()> {
        self.read_if_unread();
        if record.is_ranked() {
            self.ranked.push(record.clone());
        }
        self.pending.push(record);
        self.save_pending()?;
        self.compact_if_due();
        Ok(())
    }

    /// Reads the file now if it couldn't be read before. Records already
    /// written come back from the file, and unwritten ones stay pending.
    fn read_if_unread(&mut self) {
        if self.read {
            return;
        }
        let Some(path) = self.path.clone() else {
            return;
        };
        if let Ok(loaded) = Self::open_with(path, self.limits) {
            let pending = std::mem::take(&mut self.pending);
            *self = loaded.history;
            self.ranked
                .extend(pending.iter().filter(|r| r.is_ranked()).cloned());
            self.pending = pending;
        }
    }

    /// Writes the records an earlier append failed to write.
    pub fn save_pending(&mut self) -> io::Result<()> {
        let Some(path) = &self.path else {
            // Ranked records already live in memory; there is nowhere to
            // keep the rest.
            self.pending.clear();
            return Ok(());
        };
        if self.pending.is_empty() {
            return Ok(());
        }
        let _lock = lock(path)?;
        let mut file = OpenOptions::new()
            .create(true)
            .read(true)
            .append(true)
            .open(path)?;
        let mut text = String::new();
        if ends_mid_line(&mut file)? {
            text.push('\n');
        }
        for record in &self.pending {
            text.push_str(&serde_json::to_string(record).map_err(io::Error::other)?);
            text.push('\n');
        }
        file.write_all(text.as_bytes())?;
        self.unranked += self.pending.iter().filter(|r| !r.is_ranked()).count();
        self.pending.clear();
        Ok(())
    }

    /// Compacts the file once it holds too many unranked records. A failure
    /// leaves the file as it was and is only logged: the next append tries
    /// again.
    fn compact_if_due(&mut self) {
        let Some(path) = &self.path else { return };
        if self.unranked < self.limits.compact_at {
            return;
        }
        let excess = self.unranked - self.limits.keep_unranked;
        match compact(path, excess) {
            Ok(()) => self.unranked -= excess,
            Err(e) => log::warn!("could not compact {}: {e}", path.display()),
        }
    }
}

fn parse(line: &[u8]) -> Option<GameRecord> {
    // Bytes that aren't UTF-8 fail to parse like any other broken line.
    serde_json::from_slice(line).ok()
}

/// Rewrites the file at `path` without its `count` oldest unranked records.
/// Ranked records and lines this build can't read are kept as they are. The
/// new file is written beside the old one, synced, and renamed over it, so a
/// crash leaves one or the other whole.
fn compact(path: &Path, count: usize) -> io::Result<()> {
    let _lock = lock(path)?;
    let mut temp = path.as_os_str().to_owned();
    temp.push(".compact");
    let temp = PathBuf::from(temp);
    let mut out = BufWriter::new(File::create(&temp)?);
    let mut dropped = 0;
    let mut written = Ok(());
    for_each_line(path, |line| {
        if written.is_err() {
            return;
        }
        if dropped < count && parse(line).is_some_and(|r| !r.is_ranked()) {
            dropped += 1;
            return;
        }
        written = out.write_all(line).and_then(|()| out.write_all(b"\n"));
    })?;
    written?;
    let file = out.into_inner().map_err(io::IntoInnerError::into_error)?;
    file.sync_all()?;
    drop(file);
    fs::rename(&temp, path)?;
    sync_dir(path);
    Ok(())
}

/// Makes the rename itself durable where the platform allows syncing a
/// folder. A failure here still leaves a whole file, old or new.
fn sync_dir(path: &Path) {
    #[cfg(unix)]
    if let Some(dir) = path.parent()
        && let Ok(dir) = File::open(dir)
    {
        let _ = dir.sync_all();
    }
    #[cfg(not(unix))]
    let _ = path;
}

/// Every readable record in the file, ranked or not, for tests.
#[cfg(test)]
pub fn read_all(path: &Path) -> Vec<GameRecord> {
    let mut records = Vec::new();
    for_each_line(path, |line| records.extend(parse(line))).unwrap();
    records
}

#[cfg(test)]
mod tests {
    use super::*;
    use polymine_core::{Level, Outcome, TilingId, stats};

    fn record(duration_ms: u64) -> GameRecord {
        GameRecord {
            player: "ann".into(),
            tiling: TilingId::Hexagon,
            level: Level::Amateur,
            cols: 20,
            rows: 15,
            mines: 40,
            outcome: Outcome::Won,
            duration_ms,
            clicks: 50,
            opened: 260,
            safe_cells: 260,
            assisted: false,
            finished_at: duration_ms as i64,
        }
    }

    fn assisted(duration_ms: u64) -> GameRecord {
        GameRecord {
            assisted: true,
            ..record(duration_ms)
        }
    }

    fn write_lines(path: &Path, records: &[GameRecord]) {
        let text: String = records
            .iter()
            .map(|r| serde_json::to_string(r).unwrap() + "\n")
            .collect();
        fs::write(path, text).unwrap();
    }

    /// Files in `dir`, leaving out the lock file writes take beside the history.
    fn files_but_the_lock(dir: &Path) -> usize {
        fs::read_dir(dir)
            .unwrap()
            .filter(|e| {
                !e.as_ref()
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .ends_with(".lock")
            })
            .count()
    }

    const SMALL: Limits = Limits {
        keep_unranked: 3,
        compact_at: 5,
    };

    #[test]
    fn appended_records_survive_a_reload() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested").join("history.jsonl");
        let mut history = History::open(path.clone()).unwrap().history;
        history.append(record(1)).unwrap();
        history.append(assisted(2)).unwrap();
        history.append(record(3)).unwrap();

        let loaded = History::open(path.clone()).unwrap();
        assert_eq!(loaded.history.ranked(), &[record(1), record(3)]);
        assert_eq!(loaded.history.unranked, 1);
        assert_eq!(loaded.skipped_lines, 0);
        assert_eq!(read_all(&path), [record(1), assisted(2), record(3)]);
    }

    #[test]
    fn broken_lines_are_skipped_and_counted() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("history.jsonl");
        let good = serde_json::to_string(&record(5)).unwrap();
        fs::write(&path, format!("{good}\n{{\"player\": \"trunc\n")).unwrap();

        let loaded = History::open(path).unwrap();
        assert_eq!(loaded.history.ranked().len(), 1);
        assert_eq!(loaded.skipped_lines, 1);
    }

    #[test]
    fn a_line_that_is_not_utf8_is_skipped_and_counted() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("history.jsonl");
        let line = |r: GameRecord| serde_json::to_string(&r).unwrap() + "\n";
        let mut bytes = line(record(5)).into_bytes();
        bytes.extend_from_slice(b"{\"player\": \"\xff\"}\n");
        bytes.extend_from_slice(line(record(6)).as_bytes());
        fs::write(&path, bytes).unwrap();

        let loaded = History::open(path).unwrap();
        assert_eq!(loaded.history.ranked(), &[record(5), record(6)]);
        assert_eq!(loaded.skipped_lines, 1);
    }

    #[test]
    fn a_torn_last_line_does_not_swallow_the_next_record() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("history.jsonl");
        let good = serde_json::to_string(&record(5)).unwrap();
        fs::write(&path, format!("{good}\n{{\"player\": \"tor")).unwrap();

        let mut history = History::open(path.clone()).unwrap().history;
        history.append(record(6)).unwrap();
        let loaded = History::open(path).unwrap();
        assert_eq!(loaded.history.ranked(), &[record(5), record(6)]);
        assert_eq!(loaded.skipped_lines, 1);
    }

    #[test]
    fn a_failed_append_keeps_the_record_and_writes_it_later() {
        let dir = tempfile::tempdir().unwrap();
        let folder = dir.path().join("data");
        let path = folder.join("history.jsonl");
        let mut history = History::open(path.clone()).unwrap().history;
        // A file where the folder should be makes every write fail.
        fs::write(&folder, "").unwrap();
        assert!(history.append(record(1)).is_err());
        assert!(history.append(assisted(2)).is_err());
        assert!(history.save_pending().is_err());
        assert_eq!(history.ranked(), &[record(1)]);
        assert_eq!(history.pending, [record(1), assisted(2)]);

        fs::remove_file(&folder).unwrap();
        history.save_pending().unwrap();
        history.append(record(3)).unwrap();
        assert_eq!(read_all(&path), [record(1), assisted(2), record(3)]);
    }

    #[test]
    fn a_history_that_could_not_be_read_still_records_and_catches_up() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("history.jsonl");
        write_lines(&path, &[record(1)]);
        let mut history = History::unread(path.clone());
        assert_eq!(history.ranked(), []);
        history.append(record(2)).unwrap();
        // The append read the file, so older games count again.
        assert_eq!(history.ranked(), &[record(1), record(2)]);
        assert_eq!(read_all(&path), [record(1), record(2)]);
    }

    #[test]
    fn a_repeated_ranked_line_counts_once() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("history.jsonl");
        write_lines(&path, &[record(1), record(1), record(2), assisted(3)]);
        let history = History::open(path).unwrap().history;
        assert_eq!(history.ranked(), &[record(1), record(2)]);
    }

    #[test]
    fn memory_only_history_keeps_ranked_records_alone() {
        let mut history = History::in_memory();
        history.append(record(1)).unwrap();
        history.append(assisted(2)).unwrap();
        assert_eq!(history.ranked(), &[record(1)]);
        assert_eq!(history.pending, []);
    }

    #[test]
    fn compaction_keeps_ranked_and_the_newest_unranked_records() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("history.jsonl");
        let mut history = History::open_with(path.clone(), SMALL).unwrap().history;
        for i in 0..4 {
            history.append(record(i * 10)).unwrap();
            history.append(assisted(i * 10 + 1)).unwrap();
        }
        assert_eq!(history.unranked, 4, "below the threshold, nothing goes");
        history.append(assisted(100)).unwrap();

        assert_eq!(history.unranked, 3);
        assert_eq!(
            read_all(&path),
            [
                record(0),
                record(10),
                record(20),
                assisted(21),
                record(30),
                assisted(31),
                assisted(100)
            ]
        );
        assert_eq!(files_but_the_lock(dir.path()), 1, "no temp file");
    }

    #[test]
    fn opening_a_long_file_compacts_it_and_keeps_unreadable_lines() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("history.jsonl");
        let mut records: Vec<GameRecord> = (0..6).map(assisted).collect();
        records.insert(2, record(50));
        write_lines(&path, &records);
        let mut text = fs::read_to_string(&path).unwrap();
        text.push_str("{\"from\": \"a newer build\"}\n");
        fs::write(&path, text).unwrap();

        let loaded = History::open_with(path.clone(), SMALL).unwrap();
        assert_eq!(loaded.history.ranked(), &[record(50)]);
        assert_eq!(loaded.skipped_lines, 1);
        assert_eq!(
            read_all(&path),
            [record(50), assisted(3), assisted(4), assisted(5)]
        );
        assert!(fs::read_to_string(&path).unwrap().contains("a newer build"));
    }

    #[test]
    fn a_crash_mid_compaction_leaves_the_old_file_whole() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("history.jsonl");
        let records: Vec<GameRecord> = (0..6).map(assisted).chain([record(9)]).collect();
        write_lines(&path, &records);
        // A crash before the rename leaves a partial file beside the real one.
        fs::write(dir.path().join("history.jsonl.compact"), "{\"half").unwrap();
        assert_eq!(read_all(&path), records);

        let loaded = History::open_with(path.clone(), SMALL).unwrap();
        assert_eq!(loaded.skipped_lines, 0, "the partial file is never read");
        assert_eq!(
            read_all(&path),
            [assisted(3), assisted(4), assisted(5), record(9)]
        );
        assert_eq!(files_but_the_lock(dir.path()), 1);
    }

    #[test]
    fn a_failed_compaction_keeps_the_file_and_tries_again() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("history.jsonl");
        let records: Vec<GameRecord> = (0..6).map(assisted).collect();
        write_lines(&path, &records);
        // A folder where the temporary file goes makes compaction fail.
        let blocker = dir.path().join("history.jsonl.compact");
        fs::create_dir(&blocker).unwrap();

        let mut history = History::open_with(path.clone(), SMALL).unwrap().history;
        assert_eq!(read_all(&path), records);
        assert_eq!(history.unranked, 6);

        fs::remove_dir(&blocker).unwrap();
        history.append(assisted(6)).unwrap();
        assert_eq!(read_all(&path), [assisted(4), assisted(5), assisted(6)]);
    }

    #[test]
    fn statistics_are_the_same_after_compaction() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("history.jsonl");
        let mut all = Vec::new();
        for i in 0..40u64 {
            let mut r = record(1_000 + i * 37 % 500);
            r.player = ["ann", "bob", "cy"][i as usize % 3].into();
            r.outcome = if i % 4 == 0 {
                Outcome::Lost
            } else {
                Outcome::Won
            };
            r.level = if i % 5 == 0 {
                Level::Custom
            } else {
                Level::Amateur
            };
            r.assisted = i % 3 == 1;
            all.push(r);
        }
        write_lines(&path, &all);
        let (tiling, level) = (TilingId::Hexagon, Level::Amateur);
        let before = (
            stats::player_stats(&all, tiling, level),
            stats::champions(&all, tiling, level, 10),
        );

        let history = History::open_with(path.clone(), SMALL).unwrap().history;
        assert!(read_all(&path).len() < all.len(), "the file was compacted");
        let after = (
            stats::player_stats(history.ranked(), tiling, level),
            stats::champions(history.ranked(), tiling, level, 10),
        );
        assert_eq!(before, after);
        let reopened = History::open_with(path, SMALL).unwrap().history;
        assert_eq!(reopened.ranked(), history.ranked());
    }
}
