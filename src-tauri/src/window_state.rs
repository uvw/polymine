//! The main window's size, position, and maximized state, saved as
//! `window.json` beside the settings.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{LogicalPosition, LogicalSize, PhysicalPosition, PhysicalSize, Position, Size, Window};

const FILE_NAME: &str = "window.json";
/// How much of the window's top edge must lie on a monitor for the player to
/// grab it there and drag it back.
const GRIP: i64 = 32;
/// macOS lays out every display in points, and tao converts pixels with the
/// scale of the display the window is on now. Pixels saved on a 1x display
/// would land at twice the size and place on a 2x one, so macOS saves points.
/// Windows positions windows in physical pixels, which restore as they were.
const SAVE_LOGICAL: bool = cfg!(target_os = "macos");

/// The window's outer top left and its inner size: logical points when
/// `logical` is set, physical pixels otherwise.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct WindowState {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub maximized: bool,
    /// Missing from files that older builds saved in physical pixels.
    #[serde(default)]
    pub logical: bool,
}

/// A monitor's area, in the units of the state it's checked against.
#[derive(Clone, Copy, Debug)]
pub struct Area {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl WindowState {
    /// Whether a strip of the window's top edge lies on one of `monitors`, so
    /// a window saved on a monitor that's gone doesn't open out of reach.
    pub fn reachable(&self, monitors: &[Area]) -> bool {
        let (x, y) = (i64::from(self.x), i64::from(self.y));
        let right = x + i64::from(self.width);
        monitors.iter().any(|m| {
            let (mx, my) = (i64::from(m.x), i64::from(m.y));
            let overlap = right.min(mx + i64::from(m.width)) - x.max(mx);
            let top_inside = y >= my && y + GRIP <= my + i64::from(m.height);
            overlap >= GRIP * 2 && top_inside
        })
    }
}

pub fn load(dir: &Path) -> Option<WindowState> {
    let text = fs::read_to_string(dir.join(FILE_NAME)).ok()?;
    serde_json::from_str(&text).ok()
}

pub fn store(dir: &Path, state: &WindowState) -> io::Result<()> {
    fs::create_dir_all(dir)?;
    let text = serde_json::to_string_pretty(state).map_err(io::Error::other)?;
    crate::files::replace(&dir.join(FILE_NAME), text.as_bytes())
}

/// Applies the saved state to `window`. The position only applies while it
/// is still reachable on a monitor; otherwise the window keeps its centered
/// place.
pub fn restore(window: &Window, dir: &Path) {
    let Some(state) = load(dir) else { return };
    let monitors: Vec<Area> = window
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|m| monitor_area(*m.position(), *m.size(), m.scale_factor(), state.logical))
        .collect();
    let (size, position): (Size, Position) = if state.logical {
        (
            LogicalSize::new(f64::from(state.width), f64::from(state.height)).into(),
            LogicalPosition::new(f64::from(state.x), f64::from(state.y)).into(),
        )
    } else {
        (
            PhysicalSize::new(state.width, state.height).into(),
            PhysicalPosition::new(state.x, state.y).into(),
        )
    };
    let mut applied = window.set_size(size);
    if state.reachable(&monitors) {
        applied = applied.and(window.set_position(position));
    }
    if state.maximized {
        applied = applied.and(window.maximize());
    }
    if let Err(e) = applied {
        log::warn!("could not restore the window's size and position: {e}");
    }
}

/// The window's bounds as they change, so they can be saved on exit. Quitting
/// with Cmd+Q, the menu, or a system shutdown never asks the window to close,
/// and by the exit the window may be gone.
#[derive(Debug)]
pub struct Tracker {
    dir: PathBuf,
    latest: Mutex<Option<WindowState>>,
}

impl Tracker {
    pub fn new(dir: PathBuf) -> Self {
        Self {
            dir,
            latest: Mutex::new(None),
        }
    }

    /// Notes `window`'s current bounds.
    pub fn update(&self, window: &Window) {
        let mut latest = self
            .latest
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(state) = capture(window, || latest.or_else(|| load(&self.dir))) {
            *latest = Some(state);
        }
    }

    /// Writes the last bounds noted, if any.
    pub fn save(&self) {
        let latest = *self
            .latest
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(state) = latest
            && let Err(e) = store(&self.dir, &state)
        {
            log::warn!("could not save the window's size and position: {e}");
        }
    }
}

/// `window`'s state, or `None` while it's minimized. A maximized window keeps
/// the bounds it had before, from `previous`, so restoring it later returns to
/// them.
fn capture(window: &Window, previous: impl FnOnce() -> Option<WindowState>) -> Option<WindowState> {
    if window.is_minimized().unwrap_or(false) {
        return None;
    }
    let maximized = window.is_maximized().unwrap_or(false);
    if maximized && let Some(state) = previous() {
        return Some(WindowState { maximized, ..state });
    }
    let (Ok(position), Ok(size)) = (window.outer_position(), window.inner_size()) else {
        return None;
    };
    if SAVE_LOGICAL {
        let scale = window.scale_factor().ok()?;
        let position = position.to_logical::<f64>(scale);
        let size = size.to_logical::<f64>(scale);
        return Some(WindowState {
            x: position.x.round() as i32,
            y: position.y.round() as i32,
            width: size.width.round() as u32,
            height: size.height.round() as u32,
            maximized,
            logical: true,
        });
    }
    Some(WindowState {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
        maximized,
        logical: false,
    })
}

/// A monitor's area in logical points or physical pixels. Each monitor
/// converts with its own scale, as macOS lays them out.
fn monitor_area(
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    scale: f64,
    logical: bool,
) -> Area {
    if !logical {
        return Area {
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
        };
    }
    let position = position.to_logical::<f64>(scale);
    let size = size.to_logical::<f64>(scale);
    Area {
        x: position.x.round() as i32,
        y: position.y.round() as i32,
        width: size.width.round() as u32,
        height: size.height.round() as u32,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCREEN: Area = Area {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
    };

    fn at(x: i32, y: i32) -> WindowState {
        WindowState {
            x,
            y,
            width: 1100,
            height: 800,
            maximized: false,
            logical: false,
        }
    }

    #[test]
    fn a_window_on_screen_is_reachable() {
        assert!(at(100, 100).reachable(&[SCREEN]));
        assert!(at(1920 - 64, 0).reachable(&[SCREEN]));
    }

    #[test]
    fn a_window_off_every_monitor_is_not() {
        assert!(!at(3000, 100).reachable(&[SCREEN]));
        assert!(!at(100, -40).reachable(&[SCREEN]));
        assert!(!at(100, 1080 - 10).reachable(&[SCREEN]));
        assert!(!at(-1100 + 20, 100).reachable(&[SCREEN]));
        assert!(!at(100, 100).reachable(&[]));
    }

    #[test]
    fn a_second_monitor_counts() {
        let left = Area {
            x: -2560,
            y: 0,
            width: 2560,
            height: 1440,
        };
        assert!(at(-2000, 200).reachable(&[SCREEN, left]));
        assert!(!at(-2000, 200).reachable(&[SCREEN]));
    }

    #[test]
    fn saves_and_loads_the_state() {
        let dir = tempfile::tempdir().unwrap();
        let state = WindowState {
            maximized: true,
            ..at(10, 20)
        };
        store(dir.path(), &state).unwrap();
        assert_eq!(load(dir.path()), Some(state));
    }

    #[test]
    fn ignores_a_missing_or_broken_file() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(load(dir.path()), None);
        fs::write(dir.path().join(FILE_NAME), "not json").unwrap();
        assert_eq!(load(dir.path()), None);
    }

    #[test]
    fn files_from_older_builds_hold_physical_pixels() {
        let dir = tempfile::tempdir().unwrap();
        let old = r#"{ "x": 10, "y": 20, "width": 1100, "height": 800, "maximized": false }"#;
        fs::write(dir.path().join(FILE_NAME), old).unwrap();
        assert_eq!(load(dir.path()), Some(at(10, 20)));
    }

    #[test]
    fn logical_monitors_convert_with_their_own_scale() {
        // A 1x display at the origin and a 2x one to its right, as tao
        // reports them in physical pixels.
        let left = monitor_area(
            PhysicalPosition::new(0, 0),
            PhysicalSize::new(1920, 1080),
            1.0,
            true,
        );
        let right = monitor_area(
            PhysicalPosition::new(3840, 0),
            PhysicalSize::new(3024, 1964),
            2.0,
            true,
        );
        assert_eq!((right.x, right.width, right.height), (1920, 1512, 982));
        let saved = WindowState {
            logical: true,
            ..at(2200, 100)
        };
        assert!(saved.reachable(&[left, right]));
        assert!(!saved.reachable(&[left]));
        let physical = monitor_area(
            PhysicalPosition::new(3840, 0),
            PhysicalSize::new(3024, 1964),
            2.0,
            false,
        );
        assert_eq!((physical.x, physical.width), (3840, 3024));
    }
}
