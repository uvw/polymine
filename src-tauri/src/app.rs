//! The app's state and every operation the UI can request, independent of
//! Tauri so it can be tested directly. `commands` exposes these as Tauri
//! commands.

use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use polymine_core::{
    Board, CellId, ChampionEntry, Game, GameConfig, GameRecord, GameStatus, Level, Mark,
    PlayerStats, Point, Suggestion, TilingId, Update, stats,
};
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::history::History;
use crate::session::{GameSnapshot, NewGameRequest, SavedGame, Session};
use crate::settings::Settings;

/// Champions shown per tiling and level.
pub const CHAMPION_LIMIT: usize = 10;

#[derive(Clone, Debug, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ActionResult {
    pub update: Update,
    pub elapsed_ms: u64,
    /// Set on the action that ends the game.
    pub game_over: Option<GameOver>,
    /// Counts changes to the game, across new games too, so the window can
    /// drop an update older than one it already shows.
    pub revision: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GameOver {
    pub record: GameRecord,
    /// One-based place in the champions table, if the win made it in.
    pub champion_rank: Option<u32>,
}

#[derive(Clone, Debug, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AssistResult {
    pub suggestion: Suggestion,
    /// `None` when the move was a guess the assistant wasn't allowed to make.
    pub result: Option<ActionResult>,
}

#[derive(Clone, Debug, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct StatsView {
    pub players: Vec<PlayerStats>,
    pub champions: Vec<ChampionEntry>,
}

/// A small board of one tiling for the tiling picker to draw.
#[derive(Clone, Debug, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct TilingPreview {
    pub tiling: TilingId,
    pub polygons: Vec<Vec<Point>>,
    /// From 1 to 5; see `TilingId::complexity`.
    pub complexity: u8,
}

/// Cells in a preview board, enough that its middle shows the full pattern.
const PREVIEW_CELLS: u32 = 48;

pub struct App {
    session: Mutex<Session>,
    settings: Mutex<Settings>,
    history: Mutex<History>,
    settings_path: Option<PathBuf>,
    /// Where an unfinished game is saved between runs.
    game_path: Option<PathBuf>,
    /// Where named saves go.
    saves_dir: Option<PathBuf>,
    /// Held while the game is saved.
    saving: Mutex<()>,
}

impl std::fmt::Debug for App {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("App").finish_non_exhaustive()
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    // A panic in one command shouldn't lock the player out of the game.
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn unix_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as i64)
}

impl App {
    /// Loads settings and history from the given directories and starts the
    /// last tiling and level. A missing directory keeps that data in memory.
    ///
    /// Without a settings file, the defaults are saved right away. The same
    /// goes for a settings file too broken to parse, which moves aside. A
    /// settings file that exists but can't be read, say while another program
    /// holds it, is left alone: the session keeps its settings in memory
    /// rather than save defaults over the player's own.
    pub fn load(config_dir: Option<&Path>, data_dir: Option<&Path>) -> Self {
        let mut settings_path = config_dir.map(|d| d.join("settings.json"));
        let settings = settings_path
            .clone()
            .map_or_else(Settings::default, |path| {
                let (settings, error) = Settings::load(&path);
                if let Some(e) = error {
                    log::warn!("settings at {} didn't load cleanly: {e}", path.display());
                    if e.kind() != io::ErrorKind::Other {
                        log::warn!("settings won't be saved this session");
                        settings_path = None;
                    }
                }
                settings
            })
            .normalized();
        let history = data_dir.map_or_else(
            || {
                log::error!("no data directory, games won't be saved");
                History::in_memory()
            },
            |dir| load_history(&dir.join(polymine_ipc::history::HISTORY_FILE)),
        );
        let game_path = data_dir.map(|d| d.join("game.json"));
        let saves_dir = data_dir.map(|d| d.join("saves"));
        let session = game_path
            .as_deref()
            .and_then(restore_game)
            .unwrap_or_else(|| {
                let request = NewGameRequest {
                    tiling: settings.tiling,
                    level: settings.level,
                    custom: (settings.level == Level::Custom).then_some(settings.custom),
                };
                let config = request
                    .config()
                    .unwrap_or_else(|_| GameConfig::preset(settings.tiling, Level::Beginner));
                Session::new(config, rand::random(), settings.rules)
                    .expect("preset configurations are always valid")
            });
        let app = Self {
            session: Mutex::new(session),
            settings: Mutex::new(settings),
            history: Mutex::new(history),
            settings_path,
            game_path,
            saves_dir,
            saving: Mutex::new(()),
        };
        let missing = app.settings_path.as_deref().is_some_and(|p| !p.exists());
        if missing && let Err(e) = app.save_settings(&app.settings()) {
            log::warn!("could not save the default settings: {e}");
        }
        app
    }

    /// The game in play, as the window draws it.
    pub fn snapshot(&self) -> GameSnapshot {
        lock(&self.session).snapshot(Instant::now())
    }

    /// Starts a game from a random seed; see [`Self::new_game_with_seed`].
    pub fn new_game(&self, request: NewGameRequest) -> Result<GameSnapshot, AppError> {
        self.new_game_with_seed(request, rand::random())
    }

    /// Starts a game from a fixed seed and saves its tiling and level in the
    /// settings. An unfinished game is dropped without a record, as it is on
    /// exit.
    pub fn new_game_with_seed(
        &self,
        request: NewGameRequest,
        seed: u64,
    ) -> Result<GameSnapshot, AppError> {
        let config = request.config()?;
        let now = Instant::now();
        // Lock the session before the settings, in the order every move takes
        // them, so the two locks can't deadlock.
        let mut session = lock(&self.session);
        let mut settings = lock(&self.settings);
        let mut next = Session::new(config, seed, settings.rules)?;
        next.follow(&session);
        *session = next;

        settings.tiling = request.tiling;
        settings.level = request.level;
        if let Some(custom) = request.custom.filter(|_| request.level == Level::Custom) {
            settings.custom = custom;
        }
        self.save_settings(&settings)?;
        Ok(session.snapshot(now))
    }

    /// A left click from the window. A paused game ignores it.
    pub fn primary(&self, cell: CellId) -> Result<ActionResult, AppError> {
        self.act(|session, now| CellAction::Primary.apply(session, cell, now))
    }

    /// A right click from the window. A paused game ignores it.
    pub fn secondary(&self, cell: CellId) -> Result<ActionResult, AppError> {
        self.act(|session, now| CellAction::Secondary.apply(session, cell, now))
    }

    /// Plays a move sent from outside the window. It counts as help, and a
    /// paused game resumes, as a click in the window would. Returns whether
    /// the game resumed.
    pub fn play_from_outside(
        &self,
        cell: CellId,
        action: CellAction,
    ) -> Result<(ActionResult, bool), AppError> {
        let mut resumed = false;
        let result = self.act(|session, now| {
            check_cell(session, cell)?;
            session.mark_assisted();
            if session.is_paused() {
                session.set_paused(false, now);
                resumed = true;
            }
            action.apply(session, cell, now)
        })?;
        Ok((result, resumed))
    }

    /// The assistant's next move without playing it. A hint counts the game as
    /// assisted.
    pub fn hint(&self) -> Option<Suggestion> {
        lock(&self.session).hint()
    }

    /// Runs `f` on the current game, for read-only views of it.
    pub fn with_game<T>(&self, f: impl FnOnce(&Game) -> T) -> T {
        f(lock(&self.session).game())
    }

    pub fn is_paused(&self) -> bool {
        lock(&self.session).is_paused()
    }

    /// Lets the assistant play one move. `None` while the game is paused or
    /// over.
    pub fn assist(&self, allow_guess: bool) -> Result<Option<AssistResult>, AppError> {
        let mut outcome = None;
        let result = self.act(|session, now| {
            let Some((suggestion, update)) = session.assist(now, allow_guess) else {
                return Ok(None);
            };
            outcome = Some((suggestion, update.is_some()));
            Ok(update)
        })?;
        Ok(outcome.map(|(suggestion, played)| AssistResult {
            suggestion,
            result: played.then_some(result),
        }))
    }

    /// Pauses or resumes the clock of a game in play. Pausing saves the game.
    pub fn set_paused(&self, paused: bool) -> GameSnapshot {
        let now = Instant::now();
        let snapshot = {
            let mut session = lock(&self.session);
            session.set_paused(paused, now);
            session.advance();
            session.snapshot(now)
        };
        // Pausing often means stepping away.
        if paused && let Err(e) = self.save_game() {
            log::warn!("could not save the game: {e}");
        }
        snapshot
    }

    /// Pauses a game in play as of `at`, which may be in the past: the clock
    /// stops there. Returns whether it paused.
    pub fn pause_for_sleep(&self, at: Instant) -> bool {
        let mut session = lock(&self.session);
        if session.is_paused() || session.game().status() != GameStatus::Playing {
            return false;
        }
        session.set_paused(true, at);
        session.advance();
        true
    }

    /// The named saves, newest first.
    pub fn list_saves(&self) -> Vec<crate::saves::SaveInfo> {
        self.saves_dir
            .as_deref()
            .map(crate::saves::list)
            .unwrap_or_default()
    }

    /// Keeps the game in play as `name`, replacing a save of that name.
    pub fn save_as(&self, name: &str) -> Result<crate::saves::SaveInfo, AppError> {
        let dir = self.saves_dir.as_deref().ok_or(AppError::NoSavesFolder)?;
        let saved = lock(&self.session)
            .saved(Instant::now())
            .ok_or(AppError::NothingToSave)?;
        crate::saves::write(dir, name, &saved)
    }

    /// Replaces the game in play with the save `name`, paused. A loaded game
    /// counts as assisted, since loading lets a player retry a position.
    pub fn load_save(&self, name: &str) -> Result<GameSnapshot, AppError> {
        let dir = self.saves_dir.as_deref().ok_or(AppError::NoSavesFolder)?;
        let mut saved = crate::saves::read(dir, name)?;
        saved.assisted = true;
        let mut session =
            Session::restore(&saved).ok_or_else(|| AppError::NoSave(name.trim().to_owned()))?;
        session.mark_unsaved();
        let mut current = lock(&self.session);
        session.follow(&current);
        *current = session;
        Ok(current.snapshot(Instant::now()))
    }

    /// Deletes the save `name`.
    pub fn delete_save(&self, name: &str) -> Result<(), AppError> {
        let dir = self.saves_dir.as_deref().ok_or(AppError::NoSavesFolder)?;
        crate::saves::delete(dir, name)
    }

    /// Saves the current game if it changed since the last save. A fresh or
    /// finished game removes the save instead, so the next start is a new game.
    ///
    /// Finished games an earlier move failed to record are written first.
    pub fn save_game(&self) -> Result<(), AppError> {
        let history = lock(&self.history).save_pending();
        let game = self.save_session();
        history?;
        game
    }

    /// Writes the game outside the session lock, so moves go on meanwhile.
    /// Saves run one at a time: they share a temporary file, and a failed one
    /// counts the game as changed again for the next.
    fn save_session(&self) -> Result<(), AppError> {
        let Some(path) = &self.game_path else {
            return Ok(());
        };
        let _saving = lock(&self.saving);
        let saved = {
            let mut session = lock(&self.session);
            if !session.take_unsaved() {
                return Ok(());
            }
            session.saved(Instant::now())
        };
        let written = match saved {
            Some(game) => serde_json::to_string(&game)
                .map_err(std::io::Error::other)
                .and_then(|json| crate::files::replace(path, json.as_bytes())),
            None => match std::fs::remove_file(path) {
                Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e),
                _ => Ok(()),
            },
        };
        if written.is_err() {
            lock(&self.session).mark_unsaved();
        }
        Ok(written?)
    }

    pub fn settings(&self) -> Settings {
        lock(&self.settings).clone()
    }

    /// Replaces the settings and saves them. The game in play takes the new
    /// rules at once.
    pub fn update_settings(&self, settings: Settings) -> Result<Settings, AppError> {
        let mut settings = settings.normalized();
        lock(&self.session).set_rules(settings.rules);
        let mut current = lock(&self.settings);
        // The window never sees keys from a newer build, so they come from here.
        settings.extra = std::mem::take(&mut current.extra);
        *current = settings;
        self.save_settings(&current)?;
        Ok(current.clone())
    }

    /// One preview board per tiling, in menu order.
    pub fn previews() -> Vec<TilingPreview> {
        TilingId::ALL
            .into_iter()
            .map(|tiling| {
                let (cols, rows) = tiling.tiling().dimensions_for(PREVIEW_CELLS, 1.4);
                let board = Board::new(tiling, cols, rows);
                TilingPreview {
                    tiling,
                    polygons: board.cells().map(|c| board.polygon(c).to_vec()).collect(),
                    complexity: tiling.complexity(),
                }
            })
            .collect()
    }

    /// Statistics and champions for one board, of one player or, with `None`, of all.
    pub fn stats(&self, tiling: TilingId, level: Level, player: Option<&str>) -> StatsView {
        let history = lock(&self.history);
        let theirs: Vec<GameRecord>;
        let records = match player {
            Some(player) => {
                theirs = history
                    .ranked()
                    .iter()
                    .filter(|r| r.player == player)
                    .cloned()
                    .collect();
                &theirs
            }
            None => history.ranked(),
        };
        StatsView {
            players: stats::player_stats(records, tiling, level),
            champions: stats::champions(records, tiling, level, CHAMPION_LIMIT),
        }
    }

    fn save_settings(&self, settings: &Settings) -> Result<(), AppError> {
        if let Some(path) = &self.settings_path {
            settings.save(path)?;
        }
        Ok(())
    }

    /// Runs a session action, then records the game if that action ended it.
    /// The action may return `None` to signal that it did nothing.
    fn act<U: Into<Option<Update>>>(
        &self,
        action: impl FnOnce(&mut Session, Instant) -> Result<U, AppError>,
    ) -> Result<ActionResult, AppError> {
        let now = Instant::now();
        let mut session = lock(&self.session);
        let update = action(&mut session, now)?.into().unwrap_or_else(|| {
            let game = session.game();
            Update {
                changes: Vec::new(),
                status: game.status(),
                counters: game.counters(),
            }
        });
        let player = lock(&self.settings).player_name.clone();
        let game_over = match session.take_finished_record(&player, now, unix_ms()) {
            Some(record) => {
                let mut history = lock(&self.history);
                // The record stays in memory and is written with the next
                // append or save, so the move's result still goes out.
                if let Err(e) = history.append(record.clone()) {
                    log::error!("could not save the finished game, will retry: {e}");
                }
                let champion_rank = champion_rank(history.ranked(), &record);
                Some(GameOver {
                    record,
                    champion_rank,
                })
            }
            None => None,
        };
        Ok(ActionResult {
            update,
            elapsed_ms: session.elapsed_ms(now),
            game_over,
            revision: session.advance(),
        })
    }
}

/// A move on one cell, as the window or `polymine-cli` asks for it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CellAction {
    /// A left click: opens, chords, or smart-clicks.
    Primary,
    /// A right click: cycles the mark.
    Secondary,
    Mark(Mark),
}

impl CellAction {
    /// Plays the move, refusing a cell the current board doesn't have. The
    /// caller holds the session lock, so the board can't change in between.
    fn apply(self, session: &mut Session, cell: CellId, now: Instant) -> Result<Update, AppError> {
        check_cell(session, cell)?;
        Ok(match self {
            Self::Primary => session.primary(cell, now),
            Self::Secondary => session.secondary(cell, now),
            Self::Mark(mark) => session.set_mark(cell, mark, now),
        })
    }
}

fn check_cell(session: &Session, cell: CellId) -> Result<(), AppError> {
    let len = session.game().board().len() as u32;
    if cell.0 < len {
        Ok(())
    } else {
        Err(AppError::InvalidCell { cell: cell.0, len })
    }
}

fn load_history(path: &Path) -> History {
    match History::open(path.to_path_buf()) {
        Ok(loaded) => {
            if loaded.skipped_lines > 0 {
                log::warn!(
                    "skipped {} unreadable lines in {}",
                    loaded.skipped_lines,
                    path.display()
                );
            }
            loaded.history
        }
        Err(e) => {
            log::error!(
                "history at {} is unreadable: {e}; this session's games are still                  written, and statistics leave out older games until it reads",
                path.display()
            );
            History::unread(path.to_path_buf())
        }
    }
}

/// The game saved at `path`, if there is one this build can replay. A save it
/// can't replay, such as one from a newer build, moves to `game.json.bad`, so
/// the next autosave doesn't overwrite it.
fn restore_game(path: &Path) -> Option<Session> {
    let text = std::fs::read_to_string(path).ok()?;
    let session = serde_json::from_str::<SavedGame>(&text)
        .ok()
        .and_then(|saved| Session::restore(&saved));
    if session.is_none() {
        let aside = crate::settings::bad_path(path);
        match std::fs::rename(path, &aside) {
            Ok(()) => log::warn!(
                "the saved game at {} can't be restored; it's kept as {}",
                path.display(),
                aside.display()
            ),
            Err(e) => log::warn!(
                "the saved game at {} can't be restored or kept aside: {e}",
                path.display()
            ),
        }
    }
    session
}

fn champion_rank(records: &[GameRecord], record: &GameRecord) -> Option<u32> {
    if !record.is_ranked() {
        return None;
    }
    stats::champions(records, record.tiling, record.level, CHAMPION_LIMIT)
        .iter()
        .position(|c| {
            c.finished_at == record.finished_at
                && c.duration_ms == record.duration_ms
                && c.player == record.player
        })
        .map(|i| i as u32 + 1)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::CustomSize;
    use polymine_core::{Outcome, solver};

    fn request(level: Level) -> NewGameRequest {
        NewGameRequest {
            tiling: TilingId::Square,
            level,
            custom: None,
        }
    }

    fn app(dir: &tempfile::TempDir) -> App {
        App::load(
            Some(&dir.path().join("config")),
            Some(&dir.path().join("data")),
        )
    }

    /// Plays the current game to the end with the assistant.
    fn autoplay(app: &App) -> ActionResult {
        let mut last = None;
        while let Some(outcome) = app.assist(true).unwrap() {
            last = outcome.result;
        }
        last.expect("the assistant made at least one move")
    }

    #[test]
    fn starts_from_saved_settings() {
        let dir = tempfile::tempdir().unwrap();
        let settings = Settings {
            tiling: TilingId::Cairo,
            level: Level::Amateur,
            ..Settings::default()
        };
        settings
            .save(&dir.path().join("config").join("settings.json"))
            .unwrap();
        let snapshot = app(&dir).snapshot();
        assert_eq!(snapshot.config.tiling, TilingId::Cairo);
        assert_eq!(snapshot.config.level, Level::Amateur);
    }

    #[test]
    fn starts_from_a_saved_custom_level() {
        let dir = tempfile::tempdir().unwrap();
        let settings = Settings {
            level: Level::Custom,
            custom: CustomSize {
                cols: 7,
                rows: 5,
                mines: 4,
            },
            ..Settings::default()
        };
        settings
            .save(&dir.path().join("config").join("settings.json"))
            .unwrap();
        let snapshot = app(&dir).snapshot();
        assert_eq!(
            (
                snapshot.config.cols,
                snapshot.config.rows,
                snapshot.config.mines
            ),
            (7, 5, 4)
        );
    }

    #[test]
    fn falls_back_to_beginner_when_the_saved_custom_level_is_invalid() {
        let dir = tempfile::tempdir().unwrap();
        let settings = Settings {
            level: Level::Custom,
            custom: CustomSize {
                cols: 1,
                rows: 1,
                mines: 9,
            },
            ..Settings::default()
        };
        settings
            .save(&dir.path().join("config").join("settings.json"))
            .unwrap();
        assert_eq!(app(&dir).snapshot().config.level, Level::Beginner);
    }

    #[test]
    fn corrupt_settings_are_kept_aside_and_replaced_with_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let config = dir.path().join("config");
        std::fs::create_dir_all(&config).unwrap();
        std::fs::write(config.join("settings.json"), "{ nope").unwrap();
        let app = app(&dir);
        assert_eq!(app.settings(), Settings::default().normalized());
        let (saved, error) = Settings::load(&config.join("settings.json"));
        assert!(error.is_none());
        assert_eq!(saved, Settings::default().normalized());
        assert_eq!(
            std::fs::read_to_string(config.join("settings.json.bad")).unwrap(),
            "{ nope"
        );
    }

    #[test]
    fn every_tiling_has_a_preview() {
        let previews = App::previews();
        assert_eq!(previews.len(), TilingId::ALL.len());
        for preview in previews {
            assert!(
                preview.polygons.len() >= PREVIEW_CELLS as usize / 2,
                "{preview:?}"
            );
        }
    }

    #[test]
    fn the_first_start_saves_the_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let app = app(&dir);
        assert!(dir.path().join("config").join("settings.json").exists());
        assert_eq!(app.settings(), Settings::default().normalized());
    }

    #[test]
    fn an_unfinished_game_survives_a_restart_paused() {
        let dir = tempfile::tempdir().unwrap();
        let first = app(&dir);
        first
            .new_game_with_seed(request(Level::Beginner), 7)
            .unwrap();
        first.primary(CellId(55)).unwrap();
        first
            .act(|session, now| CellAction::Mark(Mark::Flag).apply(session, CellId(0), now))
            .unwrap();
        let before = first.snapshot();
        first.save_game().unwrap();
        let after = app(&dir).snapshot();
        assert_eq!(after.views, before.views);
        assert_eq!(after.counters, before.counters);
        assert_eq!(after.status, GameStatus::Playing);
        assert!(after.paused);
    }

    #[test]
    fn named_saves_come_back_paused_and_assisted() {
        let dir = tempfile::tempdir().unwrap();
        let app = app(&dir);
        app.new_game_with_seed(request(Level::Beginner), 7).unwrap();
        assert!(matches!(app.save_as("fresh"), Err(AppError::NothingToSave)));
        app.primary(CellId(55)).unwrap();
        let before = app.snapshot();
        assert_eq!(app.save_as(" corner ").unwrap().name, "corner");
        app.new_game_with_seed(request(Level::Amateur), 8).unwrap();
        assert_eq!(app.list_saves().len(), 1);
        let loaded = app.load_save("corner").unwrap();
        assert_eq!(loaded.views, before.views);
        assert!(loaded.paused);
        assert!(loaded.assisted);
        app.delete_save("corner").unwrap();
        assert_eq!(app.list_saves().len(), 0);
        assert!(matches!(app.load_save("corner"), Err(AppError::NoSave(_))));
    }

    #[test]
    fn loading_a_save_keeps_the_revision_rising() {
        let dir = tempfile::tempdir().unwrap();
        let app = app(&dir);
        app.new_game_with_seed(request(Level::Beginner), 7).unwrap();
        app.primary(CellId(55)).unwrap();
        app.save_as("corner").unwrap();
        app.set_paused(true);
        let before = app.snapshot().revision;
        let loaded = app.load_save("corner").unwrap();
        assert!(
            loaded.revision > before,
            "{before} then {}",
            loaded.revision
        );
        assert_eq!(app.snapshot().revision, loaded.revision);
    }

    #[test]
    fn saves_skip_unchanged_games_and_never_keep_finished_ones() {
        let dir = tempfile::tempdir().unwrap();
        let app = app(&dir);
        let path = dir.path().join("data").join("game.json");
        app.new_game_with_seed(request(Level::Beginner), 7).unwrap();
        app.save_game().unwrap();
        assert!(!path.exists(), "a fresh board has nothing to restore");
        app.primary(CellId(55)).unwrap();
        app.save_game().unwrap();
        assert!(path.exists());
        std::fs::remove_file(&path).unwrap();
        app.save_game().unwrap();
        assert!(!path.exists(), "nothing changed since the last save");
        autoplay(&app);
        app.save_game().unwrap();
        assert!(!path.exists(), "a finished game is already recorded");
    }

    #[test]
    fn a_failed_save_is_tried_again_on_the_next_one() {
        let dir = tempfile::tempdir().unwrap();
        let app = app(&dir);
        let path = dir.path().join("data").join("game.json");
        app.new_game_with_seed(request(Level::Beginner), 7).unwrap();
        app.primary(CellId(55)).unwrap();
        // A folder where the temporary file goes makes the write fail.
        let temp = dir.path().join("data").join("game.json.tmp");
        std::fs::create_dir_all(&temp).unwrap();
        assert!(app.save_game().is_err());
        assert!(!path.exists());

        std::fs::remove_dir(&temp).unwrap();
        app.save_game().unwrap();
        assert!(path.exists(), "the game still counted as unsaved");
    }

    #[test]
    fn a_broken_save_starts_a_new_game() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("data").join("game.json");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "{ not a game").unwrap();
        assert_eq!(app(&dir).snapshot().status, GameStatus::Ready);
        assert!(!path.exists());
        let aside = crate::settings::bad_path(&path);
        assert_eq!(std::fs::read_to_string(aside).unwrap(), "{ not a game");
    }

    #[test]
    fn settings_from_the_window_keep_keys_it_never_saw() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config").join("settings.json");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, r#"{ "futureKey": true }"#).unwrap();
        let app = app(&dir);
        let mut from_window = app.settings();
        from_window.extra.clear();
        from_window.theme = "graphite".to_owned();
        app.update_settings(from_window).unwrap();
        let saved = std::fs::read_to_string(&path).unwrap();
        assert!(saved.contains("futureKey"), "{saved}");
        assert!(saved.contains("graphite"), "{saved}");
    }

    #[test]
    fn unreadable_settings_are_never_saved_over() {
        let dir = tempfile::tempdir().unwrap();
        // A folder where the file should be can't be read, like a locked file.
        let path = dir.path().join("config").join("settings.json");
        std::fs::create_dir_all(&path).unwrap();
        let app = app(&dir);
        app.new_game(request(Level::Amateur)).unwrap();
        assert!(path.is_dir());
    }

    #[test]
    fn works_without_any_directories() {
        let app = App::load(None, None);
        app.new_game(request(Level::Amateur)).unwrap();
        assert_eq!(app.settings().level, Level::Amateur);
    }

    #[test]
    fn new_game_saves_the_choice_and_drops_the_unfinished_game() {
        let dir = tempfile::tempdir().unwrap();
        let app = app(&dir);
        let center = app.snapshot().cells.len() as u32 / 2;
        app.primary(CellId(center)).unwrap();
        app.new_game_with_seed(request(Level::Professional), 3)
            .unwrap();

        let reloaded = App::load(
            Some(&dir.path().join("config")),
            Some(&dir.path().join("data")),
        );
        assert_eq!(reloaded.settings().level, Level::Professional);
        let history = dir.path().join("data").join("history.jsonl");
        assert_eq!(crate::history::read_all(&history), []);
    }

    #[test]
    fn new_game_remembers_custom_sizes() {
        let app = App::load(None, None);
        let custom = CustomSize {
            cols: 9,
            rows: 8,
            mines: 10,
        };
        let snapshot = app
            .new_game(NewGameRequest {
                tiling: TilingId::Hexagon,
                level: Level::Custom,
                custom: Some(custom),
            })
            .unwrap();
        assert_eq!(snapshot.config.cols, 9);
        assert_eq!(app.settings().custom, custom);
    }

    #[test]
    fn new_game_rejects_invalid_custom_sizes() {
        let app = App::load(None, None);
        let custom = CustomSize {
            cols: 2,
            rows: 2,
            mines: 1,
        };
        let result = app.new_game(NewGameRequest {
            tiling: TilingId::Square,
            level: Level::Custom,
            custom: Some(custom),
        });
        assert!(matches!(result, Err(AppError::Game(_))));
    }

    #[test]
    fn finished_games_are_recorded_once() {
        let app = App::load(None, None);
        app.new_game_with_seed(request(Level::Beginner), 11)
            .unwrap();
        let last = autoplay(&app);
        let over = last.game_over.expect("the last move ends the game");
        assert!(over.record.assisted);
        assert_eq!(over.champion_rank, None);
        let again = app.primary(CellId(0)).unwrap();
        assert!(again.game_over.is_none());
    }

    #[test]
    fn unassisted_wins_rank_as_champions() {
        let app = App::load(None, None);
        app.new_game_with_seed(request(Level::Beginner), 5).unwrap();
        // Play the assistant's moves by hand, so the game isn't marked as assisted.
        let mut last = None;
        for _ in 0..500 {
            let snapshot_status = app.snapshot().status;
            if snapshot_status == GameStatus::Won || snapshot_status == GameStatus::Lost {
                break;
            }
            let suggestion = lock(&app.session).game().clone();
            let Some(s) = solver::suggest(&suggestion) else {
                break;
            };
            last = Some(match s.action {
                polymine_core::Action::Open => app.primary(s.cell).unwrap(),
                _ => app.secondary(s.cell).unwrap(),
            });
        }
        let over = last.and_then(|r| r.game_over).expect("game ended");
        if over.record.outcome == Outcome::Won {
            assert_eq!(over.champion_rank, Some(1));
            let stats = app.stats(TilingId::Square, Level::Beginner, None);
            assert_eq!(stats.champions.len(), 1);
            assert_eq!(stats.players[0].wins, 1);
        } else {
            assert_eq!(over.champion_rank, None);
        }
    }

    #[test]
    fn assist_holds_back_guesses_when_asked() {
        let app = App::load(None, None);
        app.new_game_with_seed(request(Level::Crazy), 2).unwrap();
        loop {
            let outcome = app.assist(false).unwrap().expect("game still running");
            if outcome.result.is_none() {
                assert!(!outcome.suggestion.certain);
                break;
            }
            if outcome
                .result
                .as_ref()
                .is_some_and(|r| r.game_over.is_some())
            {
                break;
            }
        }
    }

    #[test]
    fn cells_off_the_board_are_refused_without_a_move() {
        let app = App::load(None, None);
        app.new_game_with_seed(request(Level::Beginner), 7).unwrap();
        for result in [
            app.primary(CellId(100)),
            app.secondary(CellId(10_000)),
            app.act(|session, now| {
                CellAction::Mark(Mark::Flag).apply(session, CellId(u32::MAX), now)
            }),
        ] {
            assert!(
                matches!(result, Err(AppError::InvalidCell { len: 100, .. })),
                "{result:?}"
            );
        }
        assert_eq!(app.snapshot().status, GameStatus::Ready);
    }

    #[test]
    fn a_move_from_outside_checks_the_board_it_lands_on() {
        let app = App::load(None, None);
        app.new_game_with_seed(request(Level::Crazy), 1).unwrap();
        // The CLI checked cell 150 against this Crazy board, then a new game
        // shrank it before the move landed.
        app.new_game_with_seed(request(Level::Beginner), 1).unwrap();
        let result = app.play_from_outside(CellId(150), CellAction::Primary);
        assert!(matches!(
            result,
            Err(AppError::InvalidCell { cell: 150, .. })
        ));
        assert!(!app.snapshot().assisted, "a refused move is no help");

        app.set_paused(true);
        let (played, resumed) = app
            .play_from_outside(CellId(55), CellAction::Primary)
            .unwrap();
        assert_eq!(played.update.status, GameStatus::Playing);
        assert!(!resumed, "a game that never started can't pause");
        assert!(app.snapshot().assisted);
    }

    #[test]
    fn every_change_raises_the_revision_across_games() {
        let app = App::load(None, None);
        let start = app.snapshot().revision;
        let first = app.primary(CellId(40)).unwrap().revision;
        let second = app.secondary(CellId(0)).unwrap().revision;
        let paused = app.set_paused(true).revision;
        let fresh = app.new_game(request(Level::Beginner)).unwrap().revision;
        let next = app.primary(CellId(40)).unwrap().revision;
        assert!(start < first && first < second && second < paused);
        assert!(paused < fresh && fresh < next, "a new game keeps counting");
        assert_eq!(app.snapshot().revision, next);
    }

    #[test]
    fn sleep_pauses_only_a_game_in_play() {
        let app = App::load(None, None);
        assert!(!app.pause_for_sleep(Instant::now()), "nothing to pause yet");
        let center = app.with_game(|g| g.board().center_cell());
        app.primary(center).unwrap();
        let before = app.snapshot().revision;
        assert!(app.pause_for_sleep(Instant::now()));
        let snapshot = app.snapshot();
        assert!(snapshot.paused);
        assert!(snapshot.revision > before, "the window learns of the pause");
        assert!(
            !app.pause_for_sleep(Instant::now()),
            "it was paused already"
        );
    }

    #[test]
    fn hints_and_pause_go_through_the_session() {
        let app = App::load(None, None);
        assert!(app.hint().is_some());
        app.primary(CellId(app.snapshot().cells.len() as u32 / 2))
            .unwrap();
        assert!(app.set_paused(true).paused);
        assert!(!app.set_paused(false).paused);
    }

    #[test]
    fn settings_updates_apply_rules_and_persist() {
        let dir = tempfile::tempdir().unwrap();
        let app = app(&dir);
        let mut next = app.settings();
        next.player_name = "  bob  ".to_owned();
        next.rules.question_marks = false;
        next.theme = "charcoal".to_owned();
        let saved = app.update_settings(next).unwrap();
        assert_eq!(saved.player_name, "bob");
        assert!(!lock(&app.session).game().rules().question_marks);
        let (reloaded, _) = Settings::load(&dir.path().join("config").join("settings.json"));
        assert_eq!(reloaded.theme, "charcoal");
    }

    #[test]
    fn unreadable_history_falls_back_to_memory() {
        let dir = tempfile::tempdir().unwrap();
        // A directory where the history file should be makes it unreadable.
        std::fs::create_dir_all(dir.path().join("data").join("history.jsonl")).unwrap();
        let app = app(&dir);
        let stats = app.stats(TilingId::Square, Level::Beginner, None);
        assert_eq!(stats.players.len(), 0);
    }

    #[test]
    fn a_game_that_cannot_be_recorded_still_reports_its_end() {
        let dir = tempfile::tempdir().unwrap();
        let app = app(&dir);
        app.new_game_with_seed(request(Level::Beginner), 11)
            .unwrap();
        let history = dir.path().join("data").join("history.jsonl");
        // A folder where the history file should be makes the append fail.
        std::fs::create_dir_all(&history).unwrap();
        let over = autoplay(&app).game_over.expect("the last move ends it");

        std::fs::remove_dir(&history).unwrap();
        app.save_game().unwrap();
        assert_eq!(crate::history::read_all(&history), [over.record]);
    }

    #[test]
    fn champion_rank_skips_unranked_records() {
        let record = GameRecord {
            player: "ann".into(),
            tiling: TilingId::Square,
            level: Level::Custom,
            cols: 5,
            rows: 5,
            mines: 3,
            outcome: Outcome::Won,
            duration_ms: 1,
            clicks: 1,
            opened: 22,
            safe_cells: 22,
            assisted: false,
            finished_at: 1,
        };
        assert_eq!(champion_rank(std::slice::from_ref(&record), &record), None);
    }

    #[test]
    fn stats_narrow_to_one_player_on_request() {
        let app = App::load(None, None);
        for (player, duration_ms) in [("ann", 30), ("bob", 20), ("ann", 10)] {
            let record = GameRecord {
                player: player.into(),
                tiling: TilingId::Square,
                level: Level::Beginner,
                cols: 9,
                rows: 9,
                mines: 10,
                outcome: Outcome::Won,
                duration_ms,
                clicks: 5,
                opened: 71,
                safe_cells: 71,
                assisted: false,
                finished_at: i64::try_from(duration_ms).unwrap(),
            };
            lock(&app.history).append(record).unwrap();
        }
        let all = app.stats(TilingId::Square, Level::Beginner, None);
        assert_eq!(all.players.len(), 2);
        assert_eq!(all.champions.len(), 3);
        let ann = app.stats(TilingId::Square, Level::Beginner, Some("ann"));
        assert_eq!(ann.players.len(), 1);
        assert_eq!(ann.players[0].games, 2);
        assert!(ann.champions.iter().all(|c| c.player == "ann"));
        assert_eq!(ann.champions[0].duration_ms, 10);
        let cy = app.stats(TilingId::Square, Level::Beginner, Some("cy"));
        assert_eq!(cy.players, []);
    }
}
