//! Writing a file so a crash or power loss leaves either the old or the new
//! contents, never half of them.

use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

/// Replaces `path` with `contents` through a temporary file beside it. The
/// data reaches the disk before the rename, so the rename can't expose an
/// empty file after a power loss.
pub fn replace(path: &Path, contents: &[u8]) -> io::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let mut temp = path.as_os_str().to_owned();
    temp.push(".tmp");
    let temp = PathBuf::from(temp);
    let mut file = File::create(&temp)?;
    file.write_all(contents)?;
    file.sync_all()?;
    drop(file);
    fs::rename(temp, path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replaces_the_file_and_leaves_no_temporary_one() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested").join("game.json");
        replace(&path, b"one").unwrap();
        replace(&path, b"two").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "two");
        assert_eq!(fs::read_dir(path.parent().unwrap()).unwrap().count(), 1);
    }
}
