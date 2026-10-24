//! One game in progress: the rules engine plus its clock and bookkeeping.
//!
//! Every method that depends on time takes `now`, so tests can drive the clock.

use std::time::{Duration, Instant};

use polymine_core::{
    Action, CellId, CellView, Counters, Game, GameConfig, GameError, GameRecord, GameStatus, Level,
    Mark, Outcome, Point, Rules, Suggestion, TilingId, Update, solver,
};
use serde::{Deserialize, Serialize};

/// Board layout and current state, sent when a game starts or the UI reloads.
#[derive(Clone, Debug, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GameSnapshot {
    pub config: GameConfig,
    pub cells: Vec<CellGeometry>,
    pub views: Vec<CellView>,
    pub status: GameStatus,
    pub counters: Counters,
    pub elapsed_ms: u64,
    pub paused: bool,
    pub assisted: bool,
    /// The change count when this was taken; see `ActionResult::revision`.
    pub revision: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize, specta::Type)]
pub struct CellGeometry {
    pub polygon: Vec<Point>,
    pub neighbors: Vec<CellId>,
}

#[derive(Clone, Copy, Debug, Default)]
struct Stopwatch {
    banked: Duration,
    running_since: Option<Instant>,
}

impl Stopwatch {
    fn start(&mut self, now: Instant) {
        self.running_since.get_or_insert(now);
    }

    fn stop(&mut self, now: Instant) {
        if let Some(since) = self.running_since.take() {
            self.banked += now.saturating_duration_since(since);
        }
    }

    fn elapsed(&self, now: Instant) -> Duration {
        self.banked
            + self
                .running_since
                .map_or(Duration::ZERO, |s| now.saturating_duration_since(s))
    }
}

/// One move, as replaying a saved game needs it. A rules change is logged as
/// a move too, so each move replays under the rules it was played with.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Move {
    /// A left click: opens, chords, or smart-clicks.
    Primary {
        cell: u32,
    },
    /// A right click: cycles the mark.
    Secondary {
        cell: u32,
    },
    Mark {
        cell: u32,
        mark: Mark,
    },
    /// The assistant's open: the cell alone.
    Reveal {
        cell: u32,
    },
    /// The player changed the rules. Later moves replay under these.
    Rules {
        rules: Rules,
    },
}

impl Move {
    fn apply(self, game: &mut Game) -> Update {
        match self {
            Self::Primary { cell } => game.primary(CellId(cell)),
            Self::Secondary { cell } => game.secondary(CellId(cell)),
            Self::Mark { cell, mark } => game.set_mark(CellId(cell), mark),
            Self::Reveal { cell } => game.reveal(CellId(cell)),
            Self::Rules { rules } => {
                game.set_rules(rules);
                unchanged(game)
            }
        }
    }

    fn cell(self) -> Option<u32> {
        match self {
            Self::Primary { cell }
            | Self::Secondary { cell }
            | Self::Mark { cell, .. }
            | Self::Reveal { cell } => Some(cell),
            Self::Rules { .. } => None,
        }
    }
}

fn unchanged(game: &Game) -> Update {
    Update {
        changes: Vec::new(),
        status: game.status(),
        counters: game.counters(),
    }
}

/// An unfinished game, saved so it survives closing the app. Mines are placed
/// from the seed, so the moves rebuild the board exactly.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedGame {
    pub config: GameConfig,
    pub seed: u64,
    /// The rules the game started under. Saves from older builds hold the
    /// rules at save time and no rules entries in `moves`.
    pub rules: Rules,
    pub moves: Vec<Move>,
    pub elapsed_ms: u64,
    pub assisted: bool,
}

#[derive(Debug)]
#[allow(
    clippy::struct_excessive_bools,
    reason = "independent facts about one game, not a state machine"
)]
pub struct Session {
    game: Game,
    seed: u64,
    /// The rules in effect before the first move.
    start_rules: Rules,
    moves: Vec<Move>,
    /// True when the game changed since it was last saved.
    unsaved: bool,
    clock: Stopwatch,
    paused: bool,
    assisted: bool,
    recorded: bool,
    /// Counts changes the window must show. It only grows, also across new
    /// games, so the window can drop an update older than one it applied.
    revision: u64,
}

impl Session {
    pub fn new(config: GameConfig, seed: u64, rules: Rules) -> Result<Self, GameError> {
        let mut game = Game::new(config, seed)?;
        game.set_rules(rules);
        Ok(Self {
            game,
            seed,
            start_rules: rules,
            moves: Vec::new(),
            unsaved: true,
            clock: Stopwatch::default(),
            paused: false,
            assisted: false,
            recorded: false,
            revision: 0,
        })
    }

    /// Counts one more change and returns the new count.
    pub fn advance(&mut self) -> u64 {
        self.revision += 1;
        self.revision
    }

    /// Takes over the change count of the game this one replaces.
    pub fn follow(&mut self, previous: &Self) {
        self.revision = previous.revision + 1;
    }

    /// Rebuilds a saved game by replaying its moves. It comes back paused.
    /// Returns `None` for a save this build can't replay.
    pub fn restore(saved: &SavedGame) -> Option<Self> {
        let mut session = Self::new(saved.config, saved.seed, saved.rules).ok()?;
        let board_len = session.game.board().len() as u32;
        for m in &saved.moves {
            if m.cell().is_some_and(|cell| cell >= board_len) {
                return None;
            }
            m.apply(&mut session.game);
        }
        session.moves.clone_from(&saved.moves);
        session.clock.banked = Duration::from_millis(saved.elapsed_ms);
        session.assisted = saved.assisted;
        session.paused = session.game.status() == GameStatus::Playing;
        session.unsaved = false;
        Some(session)
    }

    /// The game to save, or `None` when there is nothing worth restoring: a
    /// fresh board or a finished game.
    pub fn saved(&self, now: Instant) -> Option<SavedGame> {
        (self.game.status() == GameStatus::Playing).then(|| SavedGame {
            config: *self.game.config(),
            seed: self.seed,
            rules: self.start_rules,
            moves: self.moves.clone(),
            elapsed_ms: self.elapsed_ms(now),
            assisted: self.assisted,
        })
    }

    /// Whether the game changed since the last call.
    pub fn take_unsaved(&mut self) -> bool {
        std::mem::take(&mut self.unsaved)
    }

    /// Counts the game as changed again, after a save of it failed.
    pub fn mark_unsaved(&mut self) {
        self.unsaved = true;
    }

    pub fn game(&self) -> &Game {
        &self.game
    }

    /// Changes the rules. After the first move the change joins the move log,
    /// so a restored game replays each move under the rules it was played with.
    pub fn set_rules(&mut self, rules: Rules) {
        if rules == self.game.rules() {
            return;
        }
        self.game.set_rules(rules);
        if self.moves.is_empty() {
            self.start_rules = rules;
        } else {
            self.moves.push(Move::Rules { rules });
            self.unsaved = true;
        }
    }

    pub fn elapsed_ms(&self, now: Instant) -> u64 {
        self.clock.elapsed(now).as_millis() as u64
    }

    pub fn primary(&mut self, cell: CellId, now: Instant) -> Update {
        self.act(now, Move::Primary { cell: cell.0 })
    }

    pub fn set_mark(&mut self, cell: CellId, mark: Mark, now: Instant) -> Update {
        self.act(now, Move::Mark { cell: cell.0, mark })
    }

    /// Marks the game as helped, so it never counts toward statistics or
    /// champions. Moves from outside the window count as help.
    pub fn mark_assisted(&mut self) {
        if !self.assisted {
            self.assisted = true;
            self.unsaved = true;
        }
    }

    pub fn is_paused(&self) -> bool {
        self.paused
    }

    pub fn secondary(&mut self, cell: CellId, now: Instant) -> Update {
        self.act(now, Move::Secondary { cell: cell.0 })
    }

    /// Asks the assistant for a move without playing it. Counts as assistance.
    pub fn hint(&mut self) -> Option<Suggestion> {
        let suggestion = solver::suggest(&self.game)?;
        self.mark_assisted();
        Some(suggestion)
    }

    /// Lets the assistant play one move. When the best move is a guess and
    /// `allow_guess` is false, returns the suggestion without playing it.
    pub fn assist(
        &mut self,
        now: Instant,
        allow_guess: bool,
    ) -> Option<(Suggestion, Option<Update>)> {
        if self.paused {
            return None;
        }
        let suggestion = solver::suggest(&self.game)?;
        if !suggestion.certain && !allow_guess {
            return Some((suggestion, None));
        }
        self.mark_assisted();
        let cell = suggestion.cell.0;
        let update = self.act(
            now,
            match suggestion.action {
                Action::Open => Move::Reveal { cell },
                Action::Flag => Move::Mark {
                    cell,
                    mark: Mark::Flag,
                },
                Action::Unflag => Move::Mark {
                    cell,
                    mark: Mark::None,
                },
            },
        );
        Some((suggestion, Some(update)))
    }

    pub fn set_paused(&mut self, paused: bool, now: Instant) {
        if self.game.status() != GameStatus::Playing {
            self.paused = false;
            return;
        }
        self.paused = paused;
        self.unsaved = true;
        if paused {
            self.clock.stop(now);
        } else {
            self.clock.start(now);
        }
    }

    fn act(&mut self, now: Instant, m: Move) -> Update {
        if self.paused {
            return unchanged(&self.game);
        }
        let update = m.apply(&mut self.game);
        self.moves.push(m);
        self.unsaved = true;
        match update.status {
            GameStatus::Playing => self.clock.start(now),
            GameStatus::Won | GameStatus::Lost => self.clock.stop(now),
            GameStatus::Ready => {}
        }
        update
    }

    /// The record for a game that just ended. Returns `None` if the game is
    /// still running or was already recorded.
    pub fn take_finished_record(
        &mut self,
        player: &str,
        now: Instant,
        unix_ms: i64,
    ) -> Option<GameRecord> {
        let outcome = match self.game.status() {
            GameStatus::Won => Outcome::Won,
            GameStatus::Lost => Outcome::Lost,
            GameStatus::Ready | GameStatus::Playing => return None,
        };
        self.take_record(outcome, player, now, unix_ms)
    }

    fn take_record(
        &mut self,
        outcome: Outcome,
        player: &str,
        now: Instant,
        unix_ms: i64,
    ) -> Option<GameRecord> {
        if self.recorded {
            return None;
        }
        self.recorded = true;
        let config = self.game.config();
        let counters = self.game.counters();
        Some(GameRecord {
            player: player.to_owned(),
            tiling: config.tiling,
            level: config.level,
            cols: config.cols,
            rows: config.rows,
            mines: config.mines,
            outcome,
            duration_ms: self.elapsed_ms(now),
            clicks: counters.clicks,
            opened: counters.opened,
            safe_cells: counters.safe_cells,
            assisted: self.assisted,
            finished_at: unix_ms,
        })
    }

    pub fn snapshot(&self, now: Instant) -> GameSnapshot {
        let board = self.game.board();
        GameSnapshot {
            config: *self.game.config(),
            cells: board
                .cells()
                .map(|c| CellGeometry {
                    polygon: board.polygon(c).to_vec(),
                    neighbors: board.neighbors(c).to_vec(),
                })
                .collect(),
            views: self.game.views(),
            status: self.game.status(),
            counters: self.game.counters(),
            elapsed_ms: self.elapsed_ms(now),
            paused: self.paused,
            assisted: self.assisted,
            revision: self.revision,
        }
    }
}

/// What the UI asks for when it starts a new game.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct NewGameRequest {
    pub tiling: TilingId,
    pub level: Level,
    /// Board size and mines for `Level::Custom`. Ignored for presets.
    pub custom: Option<CustomSize>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct CustomSize {
    pub cols: u32,
    pub rows: u32,
    pub mines: u32,
}

impl NewGameRequest {
    pub fn config(&self) -> Result<GameConfig, GameError> {
        match (self.level, self.custom) {
            (Level::Custom, Some(size)) => Ok(GameConfig::custom(
                self.tiling,
                size.cols,
                size.rows,
                size.mines,
            )?),
            (Level::Custom, None) => Ok(GameConfig::preset(self.tiling, Level::Beginner)),
            (level, _) => Ok(GameConfig::preset(self.tiling, level)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session() -> Session {
        let config = GameConfig::preset(TilingId::Square, Level::Beginner);
        Session::new(config, 7, Rules::default()).unwrap()
    }

    #[test]
    fn a_saved_game_replays_every_kind_of_move() {
        let t0 = Instant::now();
        let mut original = session();
        original.primary(CellId(55), t0);
        original.secondary(CellId(0), t0);
        original.assist(t0, true);
        original.set_mark(CellId(1), Mark::Flag, t0);
        let saved = original
            .saved(t0 + Duration::from_millis(1500))
            .expect("a game in play");
        assert_eq!(saved.moves.len(), 4);
        let restored = Session::restore(&saved).unwrap();
        assert_eq!(restored.game().views(), original.game().views());
        assert_eq!(restored.elapsed_ms(t0), 1500);
        assert!(restored.is_paused());
    }

    #[test]
    fn a_rules_change_replays_where_it_happened() {
        let t0 = Instant::now();
        let config = GameConfig::preset(TilingId::Square, Level::Beginner);
        let mut live = Session::new(config, 0, Rules::default()).unwrap();
        let center = live.game().board().center_cell();
        live.primary(center, t0);
        for _ in 0..3 {
            live.secondary(CellId(2), t0);
        }
        live.set_rules(Rules {
            question_marks: false,
            ..Rules::default()
        });
        let saved = live.saved(t0).expect("a game in play");
        assert_eq!(saved.rules, Rules::default());

        let restored = Session::restore(&saved).unwrap();
        assert_eq!(
            live.game().view(CellId(2)),
            CellView::Closed { mark: Mark::None }
        );
        assert_eq!(restored.game().views(), live.game().views());
        assert_eq!(restored.game().rules(), live.game().rules());
    }

    #[test]
    fn rules_set_before_the_first_move_are_the_starting_rules() {
        let mut s = session();
        let rules = Rules {
            smart_click: false,
            question_marks: false,
        };
        s.set_rules(rules);
        s.primary(CellId(55), Instant::now());
        let saved = s.saved(Instant::now()).unwrap();
        assert_eq!(saved.rules, rules);
        assert_eq!(saved.moves.len(), 1, "no rules entry before any move");
    }

    #[test]
    fn a_save_without_rules_entries_still_loads() {
        let json = r#"{"config":{"tiling":"square","level":"beginner","cols":9,"rows":9,"mines":10},
            "seed":7,"rules":{"smartClick":true,"questionMarks":false},
            "moves":[{"kind":"primary","cell":55},{"kind":"secondary","cell":0}],
            "elapsedMs":1000,"assisted":false}"#;
        let saved: SavedGame = serde_json::from_str(json).unwrap();
        let restored = Session::restore(&saved).unwrap();
        assert!(!restored.game().rules().question_marks);
    }

    #[test]
    fn a_save_with_a_cell_off_the_board_is_refused() {
        let t0 = Instant::now();
        let mut original = session();
        original.primary(CellId(55), t0);
        let mut saved = original.saved(t0).unwrap();
        saved.moves.push(Move::Primary { cell: 10_000 });
        assert!(Session::restore(&saved).is_none());
    }

    #[test]
    fn clock_starts_on_first_open_and_skips_pauses() {
        let t0 = Instant::now();
        let at = |ms| t0 + Duration::from_millis(ms);
        let mut s = session();
        assert_eq!(s.elapsed_ms(at(500)), 0);

        let center = s.game().board().center_cell();
        s.primary(center, at(1_000));
        s.set_paused(true, at(3_000));
        assert!(s.primary(CellId(0), at(3_500)).is_noop());
        s.set_paused(false, at(10_000));
        assert_eq!(s.elapsed_ms(at(11_000)), 3_000);
    }

    #[test]
    fn a_pause_dated_back_drops_the_time_since() {
        let t0 = Instant::now();
        let at = |s| t0 + Duration::from_secs(s);
        let mut s = session();
        s.primary(s.game().board().center_cell(), t0);
        // Noticed an hour late, the pause still counts from second 2.
        s.set_paused(true, at(2));
        assert_eq!(s.elapsed_ms(at(3600)), 2_000);
    }

    #[test]
    fn records_are_taken_once_and_mark_assistance() {
        let t0 = Instant::now();
        let mut s = session();

        while s.assist(t0, true).is_some() {}
        let record = s.take_finished_record("ann", t0, 0).unwrap();
        assert!(record.assisted);
        assert!(s.take_finished_record("ann", t0, 0).is_none());
    }

    #[test]
    fn help_marks_the_game_unsaved_once() {
        let t0 = Instant::now();
        let mut s = session();
        s.primary(CellId(55), t0);
        assert!(s.take_unsaved());
        s.hint();
        assert!(s.take_unsaved(), "the hint made the game assisted");
        s.hint();
        s.mark_assisted();
        assert!(!s.take_unsaved(), "it was assisted already");

        let mut s = session();
        s.primary(CellId(55), t0);
        s.take_unsaved();
        s.mark_assisted();
        assert!(s.take_unsaved());
    }

    #[test]
    fn custom_request_validates_size() {
        let request = NewGameRequest {
            tiling: TilingId::Cairo,
            level: Level::Custom,
            custom: Some(CustomSize {
                cols: 1,
                rows: 1,
                mines: 1,
            }),
        };
        assert!(request.config().is_err());
    }
}
