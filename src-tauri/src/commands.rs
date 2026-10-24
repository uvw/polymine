//! Tauri commands: thin wrappers that expose `App` to the UI.
//!
//! Sync commands run on the main thread and block the window while they work.
//! Commands that can take long on a big board, through the solver, a new
//! board, or a full snapshot, are `async`: Tauri runs them on its thread pool.
//! The UI queues its game calls, so they still land in order.
#![allow(
    clippy::needless_pass_by_value,
    reason = "Tauri injects command arguments by value"
)]

use polymine_core::{CellId, Level, Suggestion, TilingId};
use tauri::State;

use crate::app::{ActionResult, App, AssistResult, StatsView, TilingPreview};
use crate::error::AppError;
use crate::session::{GameSnapshot, NewGameRequest};
use crate::settings::Settings;

/// The game in play: the board, each cell's view, the status, and the clock.
#[tauri::command(async)]
#[specta::specta]
pub fn snapshot(app: State<'_, App>) -> GameSnapshot {
    app.snapshot()
}

/// One small board per tiling, in menu order, for the tiling picker.
#[tauri::command]
#[specta::specta]
pub fn tiling_previews() -> Vec<TilingPreview> {
    App::previews()
}

/// Starts a game from a random seed and saves its tiling and level in the
/// settings. An unfinished game is dropped without a record.
#[tauri::command(async)]
#[specta::specta]
pub fn new_game(app: State<'_, App>, request: NewGameRequest) -> Result<GameSnapshot, AppError> {
    app.new_game(request)
}

/// A left click on `cell`: opens a closed cell or runs smart click on a
/// number. A paused game ignores it.
#[tauri::command(async)]
#[specta::specta]
pub fn primary(app: State<'_, App>, cell: CellId) -> Result<ActionResult, AppError> {
    app.primary(cell)
}

/// A right click on `cell`: cycles the mark on a closed cell. A paused game,
/// or one before its first open, ignores it.
#[tauri::command(async)]
#[specta::specta]
pub fn secondary(app: State<'_, App>, cell: CellId) -> Result<ActionResult, AppError> {
    app.secondary(cell)
}

/// The assistant's next move without playing it, or `None` once the game is
/// over. A hint counts the game as assisted.
#[tauri::command(async)]
#[specta::specta]
pub fn hint(app: State<'_, App>) -> Option<Suggestion> {
    app.hint()
}

/// Lets the assistant play one move, which counts the game as assisted.
/// Without `allow_guess`, a guess comes back unplayed. `None` while the game is
/// paused or over.
#[tauri::command(async)]
#[specta::specta]
pub fn assist(app: State<'_, App>, allow_guess: bool) -> Result<Option<AssistResult>, AppError> {
    app.assist(allow_guess)
}

/// Pauses or resumes the clock of a game in play. Pausing saves the game.
#[tauri::command(async)]
#[specta::specta]
pub fn set_paused(app: State<'_, App>, paused: bool) -> GameSnapshot {
    app.set_paused(paused)
}

/// The player's settings.
#[tauri::command]
#[specta::specta]
pub fn get_settings(app: State<'_, App>) -> Settings {
    app.settings()
}

/// Replaces the settings and saves them, and the game in play takes the new
/// rules at once. Returns the settings with the player names tidied.
#[tauri::command]
#[specta::specta]
pub fn update_settings(app: State<'_, App>, settings: Settings) -> Result<Settings, AppError> {
    app.update_settings(settings)
}

/// Statistics and champions for one board, of one player or, with `None`, of
/// all.
#[tauri::command]
#[specta::specta]
pub fn get_stats(
    app: State<'_, App>,
    tiling: TilingId,
    level: Level,
    player: Option<String>,
) -> StatsView {
    app.stats(tiling, level, player.as_deref())
}

/// A board size in logical columns and rows.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct BoardSize {
    pub cols: u32,
    pub rows: u32,
}

/// The largest board of `tiling` that fills `width` by `height` pixels when
/// its smallest cell has an inradius of `inradius` pixels. Whole pixels are
/// plenty here and reach TypeScript as plain numbers.
#[tauri::command(async)]
#[specta::specta]
pub fn fit_board(tiling: TilingId, width: u32, height: u32, inradius: u32) -> BoardSize {
    let (cols, rows) = polymine_core::Board::fit(
        tiling,
        f64::from(width),
        f64::from(height),
        f64::from(inradius),
    );
    BoardSize { cols, rows }
}

/// The named saves, newest first.
#[tauri::command]
#[specta::specta]
pub fn list_saves(app: State<'_, App>) -> Vec<crate::saves::SaveInfo> {
    app.list_saves()
}

/// Keeps the game in play as `name`, replacing a save of that name.
#[tauri::command]
#[specta::specta]
pub fn save_as(app: State<'_, App>, name: String) -> Result<crate::saves::SaveInfo, AppError> {
    app.save_as(&name)
}

/// Replaces the game in play with the save `name`. It comes back paused and
/// counts as assisted.
#[tauri::command]
#[specta::specta]
pub fn load_save(app: State<'_, App>, name: String) -> Result<GameSnapshot, AppError> {
    app.load_save(&name)
}

/// Deletes the save `name`.
#[tauri::command]
#[specta::specta]
pub fn delete_save(app: State<'_, App>, name: String) -> Result<(), AppError> {
    app.delete_save(&name)
}
