//! The history file both the app and `polymine-cli sync` read and append:
//! one finished game per line, as JSON. A crash during an append can leave one
//! partial line at the end, and a line may hold bytes that aren't UTF-8, so
//! the file is read line by line as bytes.

use std::fs::{self, File, OpenOptions};
use std::io::{self, BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::Path;

/// The history's name in an instance's data folder.
pub const HISTORY_FILE: &str = "history.jsonl";

/// Calls `f` with each non-blank line of the file at `path`, streaming it. A
/// missing file has no lines.
pub fn for_each_line(path: &Path, mut f: impl FnMut(&[u8])) -> io::Result<()> {
    let file = match File::open(path) {
        Ok(file) => file,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e),
    };
    for line in BufReader::new(file).split(b'\n') {
        let line = line?;
        if !line.trim_ascii().is_empty() {
            f(&line);
        }
    }
    Ok(())
}

/// Holds an exclusive lock on the history at `path` until dropped. The app and
/// `polymine-cli sync` both append to the file, and the app also rewrites it to
/// drop old records, so each takes this lock first: a rewrite then can't lose
/// a line appended while it ran. The lock lives in a file of its own beside the
/// history, since the rewrite replaces the history file itself.
pub fn lock(path: &Path) -> io::Result<File> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let mut name = path.as_os_str().to_owned();
    name.push(".lock");
    let file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(name)?;
    file.lock()?;
    Ok(file)
}

/// Whether the file ends partway through a line, as a crash during an append
/// leaves it. The next record then starts on a line of its own. The file must
/// be open for reading.
pub fn ends_mid_line(file: &mut File) -> io::Result<bool> {
    if file.metadata()?.len() == 0 {
        return Ok(false);
    }
    file.seek(SeekFrom::End(-1))?;
    let mut last = [0];
    file.read_exact(&mut last)?;
    Ok(last[0] != b'\n')
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lines(path: &Path) -> io::Result<Vec<Vec<u8>>> {
        let mut lines = Vec::new();
        for_each_line(path, |line| lines.push(line.to_vec()))?;
        Ok(lines)
    }

    #[test]
    fn yields_every_non_blank_line_as_bytes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(HISTORY_FILE);
        std::fs::write(&path, b"one\n\n  \n\xff two\nthree").unwrap();
        assert_eq!(
            lines(&path).unwrap(),
            [b"one".to_vec(), b"\xff two".to_vec(), b"three".to_vec()]
        );
    }

    #[test]
    fn a_missing_file_has_no_lines_and_others_fail() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            lines(&dir.path().join("none")).unwrap(),
            Vec::<Vec<u8>>::new()
        );
        assert!(lines(dir.path()).is_err(), "a folder can't be read");
    }

    #[test]
    fn the_lock_waits_for_its_holder() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(HISTORY_FILE);
        let held = lock(&path).unwrap();
        let (sent, got) = std::sync::mpsc::channel();
        let waiter = std::thread::spawn({
            let path = path.clone();
            move || {
                let _second = lock(&path).unwrap();
                sent.send(()).unwrap();
            }
        });
        assert!(
            got.recv_timeout(std::time::Duration::from_millis(200))
                .is_err(),
            "a second lock went through while the first was held"
        );
        drop(held);
        got.recv_timeout(std::time::Duration::from_secs(5)).unwrap();
        waiter.join().unwrap();
    }

    #[test]
    fn a_file_ends_mid_line_after_a_torn_append() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(HISTORY_FILE);
        for (text, torn) in [("", false), ("{}\n", false), ("{}\n{\"pla", true)] {
            std::fs::write(&path, text).unwrap();
            let mut file = File::open(&path).unwrap();
            assert_eq!(ends_mid_line(&mut file).unwrap(), torn, "{text:?}");
        }
    }
}
