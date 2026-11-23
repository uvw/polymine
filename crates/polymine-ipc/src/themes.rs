//! Player theme folders: where they live, which files they may hold, and how
//! large those may be. The app lists themes through here, and a download can
//! check a folder the same way before moving it into place.
//!
//! This checks the folder and its files. The UI parses `theme.css` itself and
//! skips a theme whose file breaks the format, so the CSS checks here only
//! refuse what must never reach it.

use std::fs::{self, File, Metadata};
use std::io::{self, Read};
use std::path::{Path, PathBuf};

/// The folder in an instance's data folder that holds player themes.
pub const THEMES_DIR: &str = "themes";
/// Themes past this many, in name order, are skipped.
pub const MAX_THEMES: usize = 64;
/// Entries in one theme folder, hidden ones included, so a crowded folder
/// can't make a listing slow.
pub const MAX_ENTRIES: usize = 64;
pub const MAX_CSS_BYTES: u64 = 32 * 1024;
pub const MAX_SVG_BYTES: u64 = 32 * 1024;
pub const MAX_PREVIEW_BYTES: u64 = 256 * 1024;
/// The widest and tallest `preview.png`, in pixels, so a small file can't
/// decode to a huge image.
pub const MAX_PREVIEW_SIDE: u32 = 1024;
pub const MAX_DOC_BYTES: u64 = 64 * 1024;
/// Every file in one theme folder together.
pub const MAX_THEME_BYTES: u64 = 1024 * 1024;
pub const MAX_ID_LEN: usize = 40;

pub const CSS_FILE: &str = "theme.css";
pub const PREVIEW_FILE: &str = "preview.png";
/// Marks and numbers a theme can draw itself, each as `<name>.svg`.
pub const GLYPHS: [&str; 17] = [
    "mine", "flag", "question", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12",
    "13", "14",
];
/// Files for people, which a theme may carry and the app never reads.
pub const DOC_FILES: [&str; 4] = ["README.md", "LICENSE", "LICENSE.md", "LICENSE.txt"];
/// Files the system leaves in folders, which don't count as part of a theme.
const SYSTEM_FILES: [&str; 2] = ["Thumbs.db", "desktop.ini"];

const PNG_SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";

/// The player themes folder in an instance's data folder.
pub fn themes_dir(data_dir: &Path) -> PathBuf {
    data_dir.join(THEMES_DIR)
}

/// Every file name a theme folder may hold. Names match exactly, case included.
pub fn allowed_files() -> Vec<String> {
    let mut names = vec![CSS_FILE.to_owned(), PREVIEW_FILE.to_owned()];
    names.extend(GLYPHS.iter().map(|g| format!("{g}.svg")));
    names.extend(DOC_FILES.iter().map(|&d| d.to_owned()));
    names
}

/// Whether `id` can name a theme folder: 1 to 40 lowercase ASCII letters,
/// digits, or hyphens, starting with a letter or a digit.
pub fn is_valid_id(id: &str) -> bool {
    (1..=MAX_ID_LEN).contains(&id.len())
        && !id.starts_with('-')
        && id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// Why a theme folder can't be used. The message is written for the player.
#[derive(Debug, thiserror::Error)]
pub enum ThemeError {
    #[error(
        "the folder name must be 1 to {MAX_ID_LEN} lowercase letters, digits, or hyphens, starting with a letter or digit"
    )]
    InvalidId,
    #[error("there is no theme named {0}")]
    NotFound(String),
    #[error("it is not a folder")]
    NotAFolder,
    #[error("{0} is a link, and themes can't use links")]
    Link(String),
    #[error("{0} is a folder, and themes hold only files")]
    Subfolder(String),
    #[error("{0} is not a regular file")]
    NotAFile(String),
    #[error("{0} is not a file a theme can hold")]
    UnexpectedFile(String),
    #[error("it holds more than {MAX_ENTRIES} files")]
    TooManyFiles,
    #[error("{name} is larger than {limit_kib} KiB")]
    TooLarge { name: String, limit_kib: u64 },
    #[error("its files add up to more than {} KiB", MAX_THEME_BYTES / 1024)]
    FolderTooLarge,
    #[error("it has no {CSS_FILE}")]
    MissingCss,
    #[error("{0} is not UTF-8 text")]
    NotText(String),
    #[error("{0} is not an SVG image")]
    NotSvg(String),
    #[error("{name} contains {what}, which themes can't use")]
    Refused { name: String, what: &'static str },
    #[error("{PREVIEW_FILE} is not a PNG image")]
    NotPng,
    #[error(
        "{PREVIEW_FILE} is {width} by {height} pixels; the most is {MAX_PREVIEW_SIDE} by {MAX_PREVIEW_SIDE}"
    )]
    PreviewSize { width: u32, height: u32 },
    #[error("{0} changed while it was read")]
    Changed(String),
    #[error("there are more than {MAX_THEMES} themes")]
    TooMany,
    #[error("could not read {name}: {source}")]
    Io { name: String, source: io::Error },
}

/// One SVG glyph from a theme.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Glyph {
    /// One of [`GLYPHS`].
    pub name: String,
    pub svg: String,
}

/// A theme folder's files, checked.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ThemeFolder {
    /// The folder's name.
    pub id: String,
    pub css: String,
    pub preview: Option<Vec<u8>>,
    /// In the order of [`GLYPHS`].
    pub glyphs: Vec<Glyph>,
}

/// A theme as a listing shows it. Its glyph files pass every check that needs
/// only their names and sizes, but stay unread until [`read_theme`].
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ListedTheme {
    /// The folder's name.
    pub id: String,
    pub css: String,
    pub preview: Option<Vec<u8>>,
    /// The glyphs the folder has SVG files for, in the order of [`GLYPHS`].
    pub glyphs: Vec<String>,
}

/// A theme left out of a listing, and why.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Skipped {
    pub id: String,
    pub reason: String,
}

/// Every usable theme in a themes folder, and the ones that aren't.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Listing {
    pub themes: Vec<ListedTheme>,
    pub skipped: Vec<Skipped>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Kind {
    Css,
    Preview,
    Glyph(&'static str),
    Doc,
}

impl Kind {
    fn of(name: &str) -> Option<Self> {
        if name == CSS_FILE {
            return Some(Self::Css);
        }
        if name == PREVIEW_FILE {
            return Some(Self::Preview);
        }
        if DOC_FILES.contains(&name) {
            return Some(Self::Doc);
        }
        let stem = name.strip_suffix(".svg")?;
        GLYPHS.iter().find(|&&g| g == stem).map(|&g| Self::Glyph(g))
    }

    fn limit(self) -> u64 {
        match self {
            Self::Css => MAX_CSS_BYTES,
            Self::Preview => MAX_PREVIEW_BYTES,
            Self::Glyph(_) => MAX_SVG_BYTES,
            Self::Doc => MAX_DOC_BYTES,
        }
    }
}

/// Hidden entries, such as a download's staging folder or `.DS_Store`, and
/// the files Windows leaves behind.
fn ignored(name: &str) -> bool {
    name.starts_with('.') || SYSTEM_FILES.contains(&name)
}

/// Every theme in `themes_dir`, in name order. A missing folder has none.
/// Files and hidden entries beside the theme folders are left alone.
///
/// Glyph files are held to the rules for their names and sizes but not read,
/// since the app lists themes whenever its window comes to the front.
/// [`read_theme`] reads and checks them when a theme is chosen.
pub fn list(themes_dir: &Path) -> io::Result<Listing> {
    let entries = match fs::read_dir(themes_dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Listing::default()),
        Err(e) => return Err(e),
    };
    let mut names: Vec<String> = Vec::new();
    for entry in entries {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if ignored(&name) || entry.file_type().is_ok_and(|t| t.is_file()) {
            continue;
        }
        names.push(name);
    }
    names.sort();
    let mut listing = Listing::default();
    for id in names {
        let result = if listing.themes.len() == MAX_THEMES {
            Err(ThemeError::TooMany)
        } else {
            theme_dir(themes_dir, &id).and_then(|dir| list_folder(&dir))
        };
        match result {
            Ok(theme) => listing.themes.push(theme),
            Err(e) => listing.skipped.push(Skipped {
                id,
                reason: e.to_string(),
            }),
        }
    }
    Ok(listing)
}

/// The theme `id` in `themes_dir`. `id` must be a valid folder name, so it
/// can't reach outside `themes_dir`.
pub fn read_theme(themes_dir: &Path, id: &str) -> Result<ThemeFolder, ThemeError> {
    read_folder(&theme_dir(themes_dir, id)?)
}

fn theme_dir(themes_dir: &Path, id: &str) -> Result<PathBuf, ThemeError> {
    if !is_valid_id(id) {
        return Err(ThemeError::InvalidId);
    }
    let dir = themes_dir.join(id);
    match fs::symlink_metadata(&dir) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => Err(ThemeError::NotFound(id.to_owned())),
        _ => Ok(dir),
    }
}

/// Reads and checks the theme folder at `dir`, whatever its name. Links are
/// never followed, and every file is held to its limit while it's read.
pub fn read_folder(dir: &Path) -> Result<ThemeFolder, ThemeError> {
    let folder = Entries::check(dir)?;
    let (css, preview) = folder.read_css_and_preview()?;
    let mut glyphs = Vec::new();
    for (glyph, name, meta) in folder.glyphs() {
        let svg = text(
            name,
            read_capped(&dir.join(name), name, meta, MAX_SVG_BYTES)?,
        )?;
        check_svg(name, &svg)?;
        glyphs.push(Glyph {
            name: glyph.to_owned(),
            svg,
        });
    }
    Ok(ThemeFolder {
        id: folder.id,
        css,
        preview,
        glyphs,
    })
}

/// Like [`read_folder`], leaving the glyph files unread.
fn list_folder(dir: &Path) -> Result<ListedTheme, ThemeError> {
    let folder = Entries::check(dir)?;
    let (css, preview) = folder.read_css_and_preview()?;
    let glyphs = folder
        .glyphs()
        .map(|(glyph, ..)| glyph.to_owned())
        .collect();
    Ok(ListedTheme {
        id: folder.id,
        css,
        preview,
        glyphs,
    })
}

/// A theme folder whose entries passed every check that needs only their
/// names and metadata.
struct Entries<'a> {
    dir: &'a Path,
    id: String,
    /// Glyphs in the order of [`GLYPHS`].
    files: Vec<(Kind, String, Metadata)>,
}

impl<'a> Entries<'a> {
    fn check(dir: &'a Path) -> Result<Self, ThemeError> {
        let id = dir
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let io_error = |name: &str| {
            let name = name.to_owned();
            move |source| ThemeError::Io { name, source }
        };
        let meta = fs::symlink_metadata(dir).map_err(io_error(&id))?;
        if meta.file_type().is_symlink() {
            return Err(ThemeError::Link(id));
        }
        if !meta.is_dir() {
            return Err(ThemeError::NotAFolder);
        }

        let mut files: Vec<(Kind, String, Metadata)> = Vec::new();
        for (i, entry) in fs::read_dir(dir).map_err(io_error(&id))?.enumerate() {
            if i == MAX_ENTRIES {
                return Err(ThemeError::TooManyFiles);
            }
            let entry = entry.map_err(io_error(&id))?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if ignored(&name) {
                continue;
            }
            let meta = fs::symlink_metadata(entry.path()).map_err(io_error(&name))?;
            let kind = meta.file_type();
            if kind.is_symlink() {
                return Err(ThemeError::Link(name));
            }
            if kind.is_dir() {
                return Err(ThemeError::Subfolder(name));
            }
            if !kind.is_file() {
                return Err(ThemeError::NotAFile(name));
            }
            let Some(kind) = Kind::of(&name) else {
                return Err(ThemeError::UnexpectedFile(name));
            };
            if meta.len() > kind.limit() {
                return Err(too_large(name, kind.limit()));
            }
            files.push((kind, name, meta));
        }
        if files.iter().map(|(_, _, m)| m.len()).sum::<u64>() > MAX_THEME_BYTES {
            return Err(ThemeError::FolderTooLarge);
        }
        if !files.iter().any(|(kind, ..)| *kind == Kind::Css) {
            return Err(ThemeError::MissingCss);
        }
        files.sort_by_key(|(kind, ..)| match kind {
            Kind::Glyph(glyph) => GLYPHS.iter().position(|g| g == glyph),
            _ => None,
        });
        Ok(Self { dir, id, files })
    }

    /// Reads and checks `theme.css` and any `preview.png`.
    fn read_css_and_preview(&self) -> Result<(String, Option<Vec<u8>>), ThemeError> {
        let mut css = String::new();
        let mut preview = None;
        for (kind, name, meta) in &self.files {
            match kind {
                Kind::Css => {
                    let bytes = read_capped(&self.dir.join(name), name, meta, MAX_CSS_BYTES)?;
                    css = text(name, bytes)?;
                    check_css(&css)?;
                }
                Kind::Preview => {
                    let bytes = read_capped(&self.dir.join(name), name, meta, MAX_PREVIEW_BYTES)?;
                    check_png(&bytes)?;
                    preview = Some(bytes);
                }
                Kind::Glyph(_) | Kind::Doc => {}
            }
        }
        Ok((css, preview))
    }

    /// The glyph files, each with its glyph's name.
    fn glyphs(&self) -> impl Iterator<Item = (&'static str, &str, &Metadata)> {
        self.files
            .iter()
            .filter_map(|(kind, name, meta)| match kind {
                Kind::Glyph(glyph) => Some((*glyph, name.as_str(), meta)),
                _ => None,
            })
    }
}

fn too_large(name: String, limit: u64) -> ThemeError {
    ThemeError::TooLarge {
        name,
        limit_kib: limit / 1024,
    }
}

/// The file's bytes, refusing more than `limit` even when it grew since it
/// was listed, and refusing a file that was swapped for another meanwhile.
fn read_capped(
    path: &Path,
    name: &str,
    listed: &Metadata,
    limit: u64,
) -> Result<Vec<u8>, ThemeError> {
    let io_error = |source| ThemeError::Io {
        name: name.to_owned(),
        source,
    };
    let file = open_no_follow(path).map_err(io_error)?;
    let opened = file.metadata().map_err(io_error)?;
    if !opened.is_file() || !same_file(listed, &opened) {
        return Err(ThemeError::Changed(name.to_owned()));
    }
    // A hard link is a plain file to every check above, but it can share its
    // contents with a file anywhere on the volume.
    if links(&file, &opened).map_err(io_error)? > 1 {
        return Err(ThemeError::Link(name.to_owned()));
    }
    let mut bytes = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(io_error)?;
    if bytes.len() as u64 > limit {
        return Err(too_large(name.to_owned(), limit));
    }
    Ok(bytes)
}

#[cfg(unix)]
fn open_no_follow(path: &Path) -> io::Result<File> {
    File::open(path)
}

/// Opens a symbolic link or junction as itself, so one swapped in after the
/// listing fails the `is_file` check instead of being followed.
#[cfg(windows)]
fn open_no_follow(path: &Path) -> io::Result<File> {
    use std::os::windows::fs::OpenOptionsExt;
    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
    File::options()
        .read(true)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
}

#[cfg(unix)]
fn same_file(a: &Metadata, b: &Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    a.dev() == b.dev() && a.ino() == b.ino()
}

/// `std` has no stable file id on Windows, so a file swapped in after the
/// listing is caught by its size and write time instead.
#[cfg(windows)]
fn same_file(a: &Metadata, b: &Metadata) -> bool {
    a.len() == b.len() && a.modified().ok() == b.modified().ok()
}

#[cfg(unix)]
#[allow(
    clippy::unnecessary_wraps,
    reason = "the Windows version reads the count from a handle, which can fail"
)]
fn links(_: &File, opened: &Metadata) -> io::Result<u64> {
    use std::os::unix::fs::MetadataExt;
    Ok(opened.nlink())
}

#[cfg(windows)]
fn links(file: &File, _: &Metadata) -> io::Result<u64> {
    Ok(winapi_util::file::information(file)?.number_of_links())
}

fn text(name: &str, bytes: Vec<u8>) -> Result<String, ThemeError> {
    String::from_utf8(bytes).map_err(|_| ThemeError::NotText(name.to_owned()))
}

/// The UI parses `theme.css` and has the final say. These are what could
/// load a resource, hide one behind an escape, or build a call from a variable:
/// `var(--u)(x)` becomes `url(x)` once `--u` is `url`. Comments go first, since
/// the browser drops them too.
fn check_css(css: &str) -> Result<(), ThemeError> {
    let lower = without_comments(&css.to_ascii_lowercase());
    for (needle, what) in [
        ("url(", "url()"),
        ("@import", "@import"),
        ("\\", "a backslash escape"),
        (")(", "a call built from a variable"),
    ] {
        if lower.contains(needle) {
            return Err(ThemeError::Refused {
                name: CSS_FILE.to_owned(),
                what,
            });
        }
    }
    Ok(())
}

/// `css` with every `/* */` comment removed; an unclosed one runs to the end.
fn without_comments(css: &str) -> String {
    let mut out = String::with_capacity(css.len());
    let mut rest = css;
    while let Some(start) = rest.find("/*") {
        out.push_str(&rest[..start]);
        rest = rest[start + 2..]
            .find("*/")
            .map_or("", |end| &rest[start + 4 + end..]);
    }
    out.push_str(rest);
    out
}

/// The UI draws an SVG only as an image, which can't run scripts or fetch
/// anything. These refusals catch what has no place in a glyph anyway, and
/// entity declarations, which can blow up when parsed.
fn check_svg(name: &str, svg: &str) -> Result<(), ThemeError> {
    let lower = svg.to_ascii_lowercase();
    if !lower.contains("<svg") {
        return Err(ThemeError::NotSvg(name.to_owned()));
    }
    for (needle, what) in [
        ("<!doctype", "a DOCTYPE"),
        ("<!entity", "an entity declaration"),
        ("<script", "a script"),
        ("<foreignobject", "a foreignObject"),
        ("javascript:", "a javascript: link"),
    ] {
        if lower.contains(needle) {
            return Err(ThemeError::Refused {
                name: name.to_owned(),
                what,
            });
        }
    }
    Ok(())
}

/// A PNG whose header gives a size within [`MAX_PREVIEW_SIDE`].
fn check_png(bytes: &[u8]) -> Result<(), ThemeError> {
    if bytes.len() < 24 || !bytes.starts_with(PNG_SIGNATURE) || &bytes[12..16] != b"IHDR" {
        return Err(ThemeError::NotPng);
    }
    let side =
        |at: usize| u32::from_be_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]]);
    let (width, height) = (side(16), side(20));
    if width == 0 || height == 0 || width > MAX_PREVIEW_SIDE || height > MAX_PREVIEW_SIDE {
        return Err(ThemeError::PreviewSize { width, height });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const CSS: &str = "/* Name: T */ :root { --cell-closed: #123456; }";

    fn png(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = PNG_SIGNATURE.to_vec();
        bytes.extend([0, 0, 0, 13]);
        bytes.extend(b"IHDR");
        bytes.extend(width.to_be_bytes());
        bytes.extend(height.to_be_bytes());
        bytes.extend([8, 6, 0, 0, 0]);
        bytes
    }

    /// A themes folder holding one theme, `ok`, with `files`. Returns the
    /// themes folder and the theme's folder.
    fn theme(files: &[(&str, &[u8])]) -> (tempfile::TempDir, PathBuf) {
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join("ok");
        fs::create_dir(&dir).unwrap();
        for (name, bytes) in files {
            fs::write(dir.join(name), bytes).unwrap();
        }
        (root, dir)
    }

    fn reason(files: &[(&str, &[u8])]) -> String {
        let (_root, dir) = theme(files);
        read_folder(&dir).unwrap_err().to_string()
    }

    #[test]
    fn reads_a_theme_and_its_glyphs_in_order() {
        let preview = png(320, 112);
        let (_root, dir) = theme(&[
            ("theme.css", CSS.as_bytes()),
            ("preview.png", &preview),
            ("12.svg", b"<svg/>"),
            ("mine.svg", b"<svg viewBox='0 0 1 1'/>"),
            ("README.md", b"# Notes"),
            (".DS_Store", b"\0"),
            ("Thumbs.db", b"\0"),
        ]);
        let folder = read_folder(&dir).unwrap();
        assert_eq!(folder.id, "ok");
        assert_eq!(folder.css, CSS);
        assert_eq!(folder.preview, Some(preview));
        let names: Vec<_> = folder.glyphs.iter().map(|g| g.name.as_str()).collect();
        assert_eq!(names, ["mine", "12"]);
    }

    #[test]
    fn names_what_a_theme_may_hold() {
        let allowed = allowed_files();
        assert_eq!(allowed.len(), 2 + GLYPHS.len() + DOC_FILES.len());
        assert!(allowed.contains(&"14.svg".to_owned()));
        assert!(!allowed.contains(&"15.svg".to_owned()));
    }

    #[test]
    fn checks_folder_names() {
        for id in ["frost", "my-theme-2", "9", &"a".repeat(MAX_ID_LEN)] {
            assert!(is_valid_id(id), "{id}");
        }
        for id in [
            "",
            "-x",
            "Frost",
            "a b",
            "../x",
            "a/b",
            "a\\b",
            "é",
            &"a".repeat(41),
        ] {
            assert!(!is_valid_id(id), "{id}");
        }
    }

    #[test]
    fn refuses_files_a_theme_cant_hold() {
        assert!(reason(&[]).contains("no theme.css"));
        assert!(reason(&[("theme.css", b"x"), ("notes.txt", b"x")]).contains("notes.txt is not"));
        assert!(reason(&[("Theme.css", b"x")]).contains("Theme.css is not"));
        assert!(reason(&[("theme.css", b"x"), ("15.svg", b"<svg/>")]).contains("15.svg"));
        assert!(reason(&[("theme.css", &[0xff, 0xfe])]).contains("not UTF-8"));
    }

    #[test]
    fn refuses_subfolders_and_crowded_folders() {
        let (_root, dir) = theme(&[("theme.css", CSS.as_bytes())]);
        fs::create_dir(dir.join("icons")).unwrap();
        assert!(
            read_folder(&dir)
                .unwrap_err()
                .to_string()
                .contains("icons is a folder")
        );

        let every: Vec<(String, Vec<u8>)> = allowed_files()
            .into_iter()
            .map(|name| {
                let bytes = match name.as_str() {
                    "theme.css" => CSS.as_bytes().to_vec(),
                    "preview.png" => png(1, 1),
                    _ => b"<svg/>".to_vec(),
                };
                (name, bytes)
            })
            .collect();
        let files: Vec<(&str, &[u8])> = every.iter().map(|(n, b)| (n.as_str(), &b[..])).collect();
        let (_root, dir) = theme(&files);
        assert_eq!(read_folder(&dir).unwrap().glyphs.len(), GLYPHS.len());
        for i in 0..MAX_ENTRIES {
            fs::write(dir.join(format!(".hidden-{i}")), b"x").unwrap();
        }
        assert!(matches!(read_folder(&dir), Err(ThemeError::TooManyFiles)));
    }

    #[test]
    fn holds_every_file_to_its_size() {
        let big_css = vec![b' '; MAX_CSS_BYTES as usize + 1];
        assert!(reason(&[("theme.css", &big_css)]).contains("larger than 32 KiB"));
        let big_svg = vec![b' '; MAX_SVG_BYTES as usize + 1];
        assert!(reason(&[("theme.css", b"x"), ("1.svg", &big_svg)]).contains("1.svg is larger"));
        // Every file at its own limit adds up to more than the folder's.
        let full: Vec<(String, Vec<u8>)> = allowed_files()
            .into_iter()
            .map(|name| {
                let limit = Kind::of(&name).unwrap().limit();
                (name, vec![b' '; limit as usize])
            })
            .collect();
        let all: Vec<(&str, &[u8])> = full.iter().map(|(n, b)| (n.as_str(), &b[..])).collect();
        assert!(reason(&all).contains("add up to more than 1024 KiB"));
    }

    #[test]
    fn refuses_what_could_load_or_run() {
        for css in [
            "--a: url(x.png);",
            "@import 'x';",
            "--a: \\75rl(x);",
            "--a: URL(x);",
            "--u: url; --a: var(--u)(x.png);",
            "--u: url; --a: var(--u)/* */(x.png);",
        ] {
            let refused = reason(&[("theme.css", css.as_bytes())]);
            assert!(
                refused.contains("which themes can't use"),
                "{css}: {refused}"
            );
        }
        for svg in [
            "<svg><script>alert(1)</script></svg>",
            "<!DOCTYPE svg [<!ENTITY a 'b'>]><svg/>",
            "<svg><foreignObject/></svg>",
            "<svg><a href='javascript:x'/></svg>",
        ] {
            let refused = reason(&[("theme.css", b"x"), ("flag.svg", svg.as_bytes())]);
            assert!(refused.contains("flag.svg contains"), "{svg}: {refused}");
        }
        assert!(reason(&[("theme.css", b"x"), ("flag.svg", b"<html/>")]).contains("not an SVG"));
    }

    #[test]
    fn checks_the_preview_is_a_png_of_a_sensible_size() {
        assert!(reason(&[("theme.css", b"x"), ("preview.png", b"GIF89a")]).contains("not a PNG"));
        let huge = png(20_000, 20_000);
        assert!(reason(&[("theme.css", b"x"), ("preview.png", &huge)]).contains("20000 by 20000"));
        assert!(reason(&[("theme.css", b"x"), ("preview.png", &png(0, 5))]).contains("0 by 5"));
    }

    #[cfg(unix)]
    #[test]
    fn never_follows_links() {
        let secret = tempfile::tempdir().unwrap();
        fs::write(secret.path().join("key"), b"secret").unwrap();
        let (root, dir) = theme(&[]);
        std::os::unix::fs::symlink(secret.path().join("key"), dir.join("theme.css")).unwrap();
        assert!(
            read_folder(&dir)
                .unwrap_err()
                .to_string()
                .contains("theme.css is a link")
        );

        std::os::unix::fs::symlink(secret.path(), root.path().join("linked")).unwrap();
        let err = read_theme(root.path(), "linked").unwrap_err();
        assert!(err.to_string().contains("is a link"), "{err}");
    }

    #[test]
    fn refuses_a_hard_link_to_a_file_outside_the_folder() {
        let secret = tempfile::tempdir().unwrap();
        fs::write(secret.path().join("key.css"), CSS.as_bytes()).unwrap();
        let (_root, dir) = theme(&[]);
        fs::hard_link(secret.path().join("key.css"), dir.join("theme.css")).unwrap();
        let err = read_folder(&dir).unwrap_err();
        assert!(err.to_string().contains("theme.css is a link"), "{err}");
    }

    #[test]
    fn reads_only_valid_ids_inside_the_folder() {
        let (root, _dir) = theme(&[("theme.css", CSS.as_bytes())]);
        assert!(read_theme(root.path(), "ok").is_ok());
        assert!(matches!(
            read_theme(root.path(), "../ok"),
            Err(ThemeError::InvalidId)
        ));
        assert!(matches!(
            read_theme(root.path(), "gone"),
            Err(ThemeError::NotFound(_))
        ));
        fs::write(root.path().join("file"), b"x").unwrap();
        assert!(matches!(
            read_theme(root.path(), "file"),
            Err(ThemeError::NotAFolder)
        ));
    }

    #[test]
    fn lists_themes_in_name_order_and_says_why_others_are_skipped() {
        let root = tempfile::tempdir().unwrap();
        for id in ["zeta", "alpha", "Bad Name", "empty", ".staging-dusk"] {
            fs::create_dir(root.path().join(id)).unwrap();
        }
        for id in ["zeta", "alpha", ".staging-dusk"] {
            fs::write(root.path().join(id).join("theme.css"), CSS).unwrap();
        }
        fs::write(root.path().join("themes.zip"), b"PK").unwrap();
        let listing = list(root.path()).unwrap();
        let ids: Vec<_> = listing.themes.iter().map(|t| t.id.as_str()).collect();
        assert_eq!(ids, ["alpha", "zeta"]);
        let skipped: Vec<_> = listing.skipped.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(skipped, ["Bad Name", "empty"]);
        assert!(listing.skipped[1].reason.contains("no theme.css"));
    }

    #[test]
    fn lists_no_more_than_the_limit() {
        let root = tempfile::tempdir().unwrap();
        for i in 0..=MAX_THEMES {
            let dir = root.path().join(format!("t{i:03}"));
            fs::create_dir(&dir).unwrap();
            fs::write(dir.join("theme.css"), CSS).unwrap();
        }
        let listing = list(root.path()).unwrap();
        assert_eq!(listing.themes.len(), MAX_THEMES);
        assert_eq!(listing.skipped.len(), 1);
        assert!(listing.skipped[0].reason.contains("more than 64 themes"));
    }

    #[test]
    fn holds_the_built_in_themes_to_the_player_rules() {
        let built_in = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../ui/src/themes");
        let listing = list(&built_in).unwrap();
        assert_eq!(listing.skipped, []);
        let ids: Vec<_> = listing.themes.iter().map(|t| t.id.as_str()).collect();
        assert!(ids.contains(&"frost") && ids.len() >= 6, "{ids:?}");
        for theme in &listing.themes {
            let read = read_theme(&built_in, &theme.id).unwrap();
            let names: Vec<_> = read.glyphs.iter().map(|g| g.name.as_str()).collect();
            assert_eq!(names, theme.glyphs, "{}", theme.id);
        }
    }

    #[test]
    fn a_listing_names_glyphs_without_reading_them() {
        let (root, dir) = theme(&[
            ("theme.css", CSS.as_bytes()),
            ("flag.svg", b"<svg><script>alert(1)</script></svg>"),
            ("mine.svg", b"<svg/>"),
        ]);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let unreadable = fs::Permissions::from_mode(0o000);
            fs::set_permissions(dir.join("mine.svg"), unreadable).unwrap();
        }
        let listing = list(root.path()).unwrap();
        assert_eq!(listing.skipped, []);
        assert_eq!(listing.themes[0].glyphs, ["mine", "flag"]);
        assert_eq!(listing.themes[0].css, CSS);
        // Reading the theme, as choosing it does, checks the glyphs.
        let err = read_theme(root.path(), "ok").unwrap_err().to_string();
        assert!(
            err.contains("mine.svg") || err.contains("flag.svg"),
            "{err}"
        );

        let big = vec![b' '; MAX_SVG_BYTES as usize + 1];
        fs::write(dir.join("1.svg"), big).unwrap();
        let listing = list(root.path()).unwrap();
        assert!(listing.skipped[0].reason.contains("1.svg is larger"));
    }

    #[test]
    fn lists_nothing_when_the_folder_is_missing() {
        let root = tempfile::tempdir().unwrap();
        assert_eq!(list(&root.path().join("none")).unwrap(), Listing::default());
        assert_eq!(themes_dir(root.path()), root.path().join("themes"));
    }
}
