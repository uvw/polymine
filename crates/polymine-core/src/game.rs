//! Game rules: opening cells, marks, smart click, winning and losing.

use std::collections::VecDeque;

use rand::SeedableRng;
use rand_chacha::ChaCha8Rng;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::board::{Board, CellId};
use crate::config::{ConfigError, GameConfig};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum Mark {
    #[default]
    None,
    Flag,
    Question,
}

/// What the player can see of a cell.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CellView {
    Closed {
        mark: Mark,
    },
    Open {
        adjacent: u8,
    },
    /// A mine shown after a loss. `exploded` marks the one that was opened.
    Mine {
        exploded: bool,
    },
    /// A flag on a safe cell, shown after a loss.
    WrongFlag,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum GameStatus {
    /// The board is fresh. Mines are placed on the first open, away from it.
    Ready,
    Playing,
    Won,
    Lost,
}

impl GameStatus {
    pub fn is_over(self) -> bool {
        matches!(self, Self::Won | Self::Lost)
    }
}

/// Player options that change how clicks behave. They can change mid-game.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Rules {
    /// Clicking a number flags its closed neighbors when they must all be
    /// mines, then opens the rest once the flags match the number. When off,
    /// clicking a number skips the flagging step.
    pub smart_click: bool,
    /// Right click cycles through a `?` mark after the flag.
    pub question_marks: bool,
}

impl Default for Rules {
    fn default() -> Self {
        Self {
            smart_click: true,
            question_marks: true,
        }
    }
}

/// One cell's new look. `wave` is the step at which the change happened,
/// counted outward from the click, so the UI can animate a ripple.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct CellChange {
    pub cell: CellId,
    pub view: CellView,
    pub wave: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Counters {
    /// Mines minus flags. Goes negative when the player over-flags.
    pub mines_left: i32,
    pub opened: u32,
    pub safe_cells: u32,
    pub clicks: u32,
}

/// The result of one player action.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct Update {
    pub changes: Vec<CellChange>,
    pub status: GameStatus,
    pub counters: Counters,
}

impl Update {
    pub fn is_noop(&self) -> bool {
        self.changes.is_empty()
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Error)]
pub enum GameError {
    #[error(transparent)]
    Config(#[from] ConfigError),
    #[error("mine layout lists cell {0} more than once or outside the board")]
    MineLayout(u32),
}

#[derive(Clone, Copy, Debug, Default)]
struct Cell {
    mine: bool,
    open: bool,
    mark: Mark,
    adjacent: u8,
}

#[derive(Clone, Debug)]
pub struct Game {
    config: GameConfig,
    seed: u64,
    board: Board,
    cells: Vec<Cell>,
    status: GameStatus,
    rules: Rules,
    mines_placed: bool,
    twins_clear: bool,
    exploded: Option<CellId>,
    opened: u32,
    flags: u32,
    clicks: u32,
}

impl Game {
    /// Starts a game whose mines are placed by `seed` on the first open.
    pub fn new(config: GameConfig, seed: u64) -> Result<Self, GameError> {
        config.validate()?;
        let board = Board::new(config.tiling, config.cols, config.rows);
        Ok(Self {
            cells: vec![Cell::default(); board.len()],
            board,
            config,
            seed,
            status: GameStatus::Ready,
            rules: Rules::default(),
            mines_placed: false,
            twins_clear: false,
            exploded: None,
            opened: 0,
            flags: 0,
            clicks: 0,
        })
    }

    /// Starts a game with a fixed mine layout. The first open gets no
    /// protection, which suits hand-made and loaded games.
    pub fn with_mines(config: GameConfig, mines: &[CellId]) -> Result<Self, GameError> {
        let config = GameConfig {
            mines: mines.len() as u32,
            ..config
        };
        let mut game = Self::new(config, 0)?;
        for &mine in mines {
            let cell = game
                .cells
                .get_mut(mine.index())
                .ok_or(GameError::MineLayout(mine.0))?;
            if cell.mine {
                return Err(GameError::MineLayout(mine.0));
            }
            cell.mine = true;
        }
        game.finish_placement();
        Ok(game)
    }

    pub fn config(&self) -> &GameConfig {
        &self.config
    }

    pub fn board(&self) -> &Board {
        &self.board
    }

    pub fn status(&self) -> GameStatus {
        self.status
    }

    /// False until the first open places the mines, unless the layout was given.
    pub fn mines_placed(&self) -> bool {
        self.mines_placed
    }

    /// True when the seeded placement kept mines off every twin cell, which
    /// it does whenever the board has room. False for a given layout.
    pub fn twins_clear(&self) -> bool {
        self.twins_clear
    }

    pub fn mark_of(&self, cell: CellId) -> Mark {
        self.cells[cell.index()].mark
    }

    pub fn rules(&self) -> Rules {
        self.rules
    }

    pub fn set_rules(&mut self, rules: Rules) {
        self.rules = rules;
    }

    pub fn counters(&self) -> Counters {
        Counters {
            mines_left: self.config.mines as i32 - self.flags as i32,
            opened: self.opened,
            safe_cells: self.safe_cells(),
            clicks: self.clicks,
        }
    }

    fn safe_cells(&self) -> u32 {
        self.config.cells() - self.config.mines
    }

    /// What the player sees at `cell`.
    ///
    /// # Panics
    ///
    /// When `cell` is off the board.
    pub fn view(&self, cell: CellId) -> CellView {
        let c = self.cells[cell.index()];
        if c.open {
            return CellView::Open {
                adjacent: c.adjacent,
            };
        }
        if self.status == GameStatus::Lost {
            if c.mine && c.mark != Mark::Flag {
                return CellView::Mine {
                    exploded: self.exploded == Some(cell),
                };
            }
            if !c.mine && c.mark == Mark::Flag {
                return CellView::WrongFlag;
            }
        }
        CellView::Closed { mark: c.mark }
    }

    pub fn views(&self) -> Vec<CellView> {
        self.board.cells().map(|cell| self.view(cell)).collect()
    }

    /// What a player may know: `Some(n)` for an open cell showing `n`, `None`
    /// for a closed one. Marks are left out because they can be wrong.
    pub fn knowledge(&self) -> Vec<Option<u8>> {
        self.cells
            .iter()
            .map(|c| c.open.then_some(c.adjacent))
            .collect()
    }

    /// The answer key. Empty until mines are placed. Never send it to the UI
    /// during play.
    pub fn mines(&self) -> Vec<CellId> {
        self.board
            .cells()
            .filter(|c| self.cells[c.index()].mine)
            .collect()
    }

    /// Left click: opens a closed cell, or runs smart click on a number.
    ///
    /// # Panics
    ///
    /// When `cell` is off the board and the game isn't over.
    pub fn primary(&mut self, cell: CellId) -> Update {
        if self.status.is_over() {
            return self.update(Vec::new());
        }
        let c = self.cells[cell.index()];
        let changes = if !c.open {
            let mut changes = self.open(cell);
            // A number just opened flags its neighbors when they must all be
            // mines, but opens none of them: with a wrong flag nearby, that
            // could lose a click that opened a safe cell.
            let opened = self.cells[cell.index()];
            if self.rules.smart_click && opened.open && opened.adjacent > 0 {
                changes.extend(self.flag_forced(cell));
            }
            changes
        } else if c.adjacent > 0 {
            self.smart_click(cell)
        } else {
            Vec::new()
        };
        self.finish_action(changes)
    }

    /// Right click: cycles the mark on a closed cell. Does nothing before the
    /// first open, since there is nothing to deduce yet.
    ///
    /// # Panics
    ///
    /// When `cell` is off the board after the first open.
    pub fn secondary(&mut self, cell: CellId) -> Update {
        if self.status == GameStatus::Ready {
            return self.update(Vec::new());
        }
        let next = match self.cells[cell.index()].mark {
            Mark::None => Mark::Flag,
            Mark::Flag if self.rules.question_marks => Mark::Question,
            Mark::Flag | Mark::Question => Mark::None,
        };
        self.set_mark(cell, next)
    }

    /// Sets a mark directly. Used by the assistant and the CLI. Like right
    /// click, it does nothing before the first open: a flag there would let
    /// the first click's smart click open a mine.
    ///
    /// # Panics
    ///
    /// When `cell` is off the board while the game is in play.
    pub fn set_mark(&mut self, cell: CellId, mark: Mark) -> Update {
        if self.status.is_over()
            || self.status == GameStatus::Ready
            || self.cells[cell.index()].open
        {
            return self.update(Vec::new());
        }
        let changes = self.mark(cell, mark, 0).into_iter().collect();
        self.finish_action(changes)
    }

    /// Opens a closed, unflagged cell without smart click. Used by the
    /// assistant and the CLI.
    ///
    /// # Panics
    ///
    /// When `cell` is off the board.
    pub fn reveal(&mut self, cell: CellId) -> Update {
        let c = self.cells[cell.index()];
        if self.status.is_over() || c.open || c.mark == Mark::Flag {
            return self.update(Vec::new());
        }
        let changes = self.open(cell);
        self.finish_action(changes)
    }

    fn finish_action(&mut self, mut changes: Vec<CellChange>) -> Update {
        if !changes.is_empty() {
            self.clicks += 1;
        }
        if self.status == GameStatus::Playing && self.opened == self.safe_cells() {
            let last = changes.last().map_or(CellId(0), |c| c.cell);
            changes.extend(self.win(last));
        }
        self.update(changes)
    }

    fn update(&self, changes: Vec<CellChange>) -> Update {
        Update {
            changes,
            status: self.status,
            counters: self.counters(),
        }
    }

    fn mark(&mut self, cell: CellId, mark: Mark, wave: u32) -> Option<CellChange> {
        let c = &mut self.cells[cell.index()];
        if c.mark == mark {
            return None;
        }
        match (c.mark, mark) {
            (Mark::Flag, _) => self.flags -= 1,
            (_, Mark::Flag) => self.flags += 1,
            _ => {}
        }
        c.mark = mark;
        Some(CellChange {
            cell,
            view: CellView::Closed { mark },
            wave,
        })
    }

    fn open(&mut self, start: CellId) -> Vec<CellChange> {
        if self.cells[start.index()].mark == Mark::Flag {
            return Vec::new();
        }
        if !self.mines_placed {
            self.place_mines(start);
        }
        if self.status == GameStatus::Ready {
            self.status = GameStatus::Playing;
        }
        if self.cells[start.index()].mine {
            return self.lose(start);
        }
        self.flood(start, 0)
    }

    /// Opens `start` and spreads through cells with no adjacent mines.
    fn flood(&mut self, start: CellId, first_wave: u32) -> Vec<CellChange> {
        let mut changes = Vec::new();
        let mut queue = VecDeque::from([(start, first_wave)]);
        while let Some((cell, wave)) = queue.pop_front() {
            let c = &mut self.cells[cell.index()];
            if c.open || c.mine || c.mark == Mark::Flag {
                continue;
            }
            c.open = true;
            c.mark = Mark::None;
            self.opened += 1;
            changes.push(CellChange {
                cell,
                view: CellView::Open {
                    adjacent: c.adjacent,
                },
                wave,
            });
            if c.adjacent == 0 {
                for &n in self.board.neighbors(cell) {
                    if !self.cells[n.index()].open {
                        queue.push_back((n, wave + 1));
                    }
                }
            }
        }
        changes
    }

    fn smart_click(&mut self, cell: CellId) -> Vec<CellChange> {
        let mut changes = if self.rules.smart_click {
            self.flag_forced(cell)
        } else {
            Vec::new()
        };
        changes.extend(self.chord(cell));
        changes
    }

    /// Flags the closed neighbors of a number when there are just as many as
    /// the number says.
    fn flag_forced(&mut self, cell: CellId) -> Vec<CellChange> {
        let number = usize::from(self.cells[cell.index()].adjacent);
        let closed: Vec<CellId> = self
            .board
            .neighbors(cell)
            .iter()
            .copied()
            .filter(|n| !self.cells[n.index()].open)
            .collect();
        if closed.len() != number {
            return Vec::new();
        }
        closed
            .into_iter()
            .filter_map(|n| self.mark(n, Mark::Flag, 0))
            .collect()
    }

    /// Opens the unflagged closed neighbors of a number once its flags match.
    fn chord(&mut self, cell: CellId) -> Vec<CellChange> {
        let number = usize::from(self.cells[cell.index()].adjacent);
        let neighbors = self.board.neighbors(cell);
        let flagged = neighbors
            .iter()
            .filter(|n| self.cells[n.index()].mark == Mark::Flag)
            .count();
        if flagged != number {
            return Vec::new();
        }
        let unflagged: Vec<CellId> = neighbors
            .iter()
            .copied()
            .filter(|n| {
                let c = self.cells[n.index()];
                !c.open && c.mark != Mark::Flag
            })
            .collect();
        let mut changes = Vec::new();
        for n in unflagged {
            if self.cells[n.index()].mine {
                changes.extend(self.lose(n));
                return changes;
            }
            changes.extend(self.flood(n, 1));
        }
        changes
    }

    fn place_mines(&mut self, start: CellId) {
        let mines = self.config.mines as usize;
        let board = &self.board;
        let opening: Vec<CellId> = std::iter::once(start)
            .chain(board.neighbors(start).iter().copied())
            .collect();
        // Keep the first click's whole neighborhood clear so it opens an area,
        // and keep mines off twin cells so no number pair forces a coin flip.
        // Each wish is dropped, twins first, when the board lacks the room.
        let filters: [&dyn Fn(CellId) -> bool; 3] = [
            &|c| !opening.contains(&c) && !board.is_twin(c),
            &|c| !opening.contains(&c),
            &|c| c != start,
        ];
        let (filter, candidates) = filters
            .iter()
            .map(|keep| board.cells().filter(|&c| keep(c)).collect::<Vec<_>>())
            .enumerate()
            .find(|(_, cells)| cells.len() >= mines)
            .unwrap_or_default();
        // The rule is public, so the solver may rely on it as a player may.
        self.twins_clear = filter == 0;
        // ChaCha8 output is stable across releases, unlike `StdRng`, so a seed
        // always rebuilds the same board.
        let mut rng = ChaCha8Rng::seed_from_u64(self.seed);
        for i in rand::seq::index::sample(&mut rng, candidates.len(), mines) {
            self.cells[candidates[i].index()].mine = true;
        }
        self.finish_placement();
    }

    fn finish_placement(&mut self) {
        for cell in self.board.cells() {
            let adjacent = self
                .board
                .neighbors(cell)
                .iter()
                .filter(|n| self.cells[n.index()].mine)
                .count();
            self.cells[cell.index()].adjacent = adjacent as u8;
        }
        self.mines_placed = true;
    }

    fn lose(&mut self, exploded: CellId) -> Vec<CellChange> {
        self.status = GameStatus::Lost;
        self.exploded = Some(exploded);
        let distance = self.distances_from(exploded);
        self.board
            .cells()
            .filter_map(|cell| match self.view(cell) {
                view @ (CellView::Mine { .. } | CellView::WrongFlag) => Some(CellChange {
                    cell,
                    view,
                    wave: distance[cell.index()],
                }),
                _ => None,
            })
            .collect()
    }

    /// Ends the game as won, once every safe cell is open: flags every mine,
    /// rippling out from `origin`.
    fn win(&mut self, origin: CellId) -> Vec<CellChange> {
        self.status = GameStatus::Won;
        let distance = self.distances_from(origin);
        let mut changes = Vec::new();
        for cell in self.board.cells() {
            if self.cells[cell.index()].mine {
                changes.extend(self.mark(cell, Mark::Flag, distance[cell.index()]));
            }
        }
        changes
    }

    /// Breadth-first step count from `origin` to every cell.
    fn distances_from(&self, origin: CellId) -> Vec<u32> {
        let mut distance = vec![u32::MAX; self.board.len()];
        distance[origin.index()] = 0;
        let mut queue = VecDeque::from([origin]);
        while let Some(cell) = queue.pop_front() {
            for &n in self.board.neighbors(cell) {
                if distance[n.index()] == u32::MAX {
                    distance[n.index()] = distance[cell.index()] + 1;
                    queue.push_back(n);
                }
            }
        }
        distance
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{Level, MIN_SIDE};
    use crate::tiling::TilingId;
    use proptest::prelude::*;

    /// A square board from an ASCII picture: `*` is a mine, anything else is safe.
    fn square_game(rows: &[&str]) -> Game {
        let cols = rows[0].len() as u32;
        let mines: Vec<CellId> = rows
            .iter()
            .enumerate()
            .flat_map(|(r, line)| {
                line.chars()
                    .enumerate()
                    .filter(|&(_, ch)| ch == '*')
                    .map(move |(c, _)| CellId(r as u32 * cols + c as u32))
            })
            .collect();
        let config = GameConfig {
            tiling: TilingId::Square,
            level: Level::Custom,
            cols,
            rows: rows.len() as u32,
            mines: 1,
        };
        Game::with_mines(config, &mines).unwrap()
    }

    fn at(game: &Game, col: u32, row: u32) -> CellId {
        CellId(row * game.config().cols + col)
    }

    #[test]
    fn first_click_is_always_safe_and_opens_an_area() {
        for tiling in TilingId::ALL {
            for seed in 0..20 {
                let mut game =
                    Game::new(GameConfig::preset(tiling, Level::Professional), seed).unwrap();
                let center = game.board().center_cell();
                let update = game.primary(center);
                assert_eq!(update.status, GameStatus::Playing, "{tiling:?} seed {seed}");
                assert_eq!(game.view(center), CellView::Open { adjacent: 0 });
                assert_eq!(game.mines().len() as u32, game.config().mines);
            }
        }
    }

    proptest! {
        #[test]
        fn first_click_never_loses_and_opens_a_zero_when_there_is_room(
            tiling in 0..TilingId::ALL.len(),
            cols in MIN_SIDE..=14,
            rows in MIN_SIDE..=14,
            density in prop_oneof![0.0..1.0f64, 0.9..1.0f64],
            seed in any::<u64>(),
            start in any::<u32>(),
        ) {
            let cells = cols * rows;
            let mines = 1 + (f64::from(cells - 2) * density).round() as u32;
            let config = GameConfig::custom(TilingId::ALL[tiling], cols, rows, mines).unwrap();
            let mut game = Game::new(config, seed).unwrap();
            let start = CellId(start % cells);
            let update = game.primary(start);
            prop_assert_ne!(update.status, GameStatus::Lost);
            let neighbors = game.board().neighbors(start).len() as u32;
            let room = cells - 1 - neighbors >= mines;
            let zero = game.view(start) == CellView::Open { adjacent: 0 };
            prop_assert_eq!(zero, room, "{} mines on {} cells", mines, cells);
        }
    }

    #[test]
    fn same_seed_same_board() {
        let config = GameConfig::preset(TilingId::Hexagon, Level::Amateur);
        let mut a = Game::new(config, 42).unwrap();
        let mut b = Game::new(config, 42).unwrap();
        a.primary(CellId(7));
        b.primary(CellId(7));
        assert_eq!(a.mines(), b.mines());
    }

    #[test]
    fn seed_layouts_are_stable_across_releases() {
        // Saved games and shared seeds depend on these exact layouts. If one
        // changes, the RNG or the placement order changed: treat it as a
        // breaking change, not a test to update. rand picks its sampling
        // algorithm by mine count and board size, so the boards cover a dense
        // level, a board with few mines, and a large sparse board.
        let layout = |config: GameConfig| {
            let mut game = Game::new(config, 42).unwrap();
            game.primary(game.board().center_cell());
            game.mines().iter().map(|c| c.0).collect::<Vec<u32>>()
        };
        assert_eq!(
            layout(GameConfig::preset(TilingId::Square, Level::Beginner)),
            [1, 15, 20, 22, 32, 35, 36, 41, 68, 71, 78, 80, 95]
        );
        assert_eq!(
            layout(GameConfig::custom(TilingId::Square, 10, 10, 10).unwrap()),
            [12, 18, 26, 30, 37, 61, 62, 75, 89, 98]
        );
        assert_eq!(
            layout(GameConfig::custom(TilingId::Square, 100, 100, 40).unwrap()),
            [
                763, 1040, 1457, 1494, 1637, 1715, 1788, 1977, 2230, 2378, 2688, 2874, 3069, 3076,
                3134, 3426, 3775, 4256, 4435, 5060, 5358, 5754, 5845, 5926, 6256, 6270, 6405, 6795,
                7283, 7351, 7697, 7698, 7710, 8021, 8237, 8942, 9004, 9468, 9556, 9918
            ]
        );
    }

    #[test]
    fn flood_fill_opens_zeros_and_their_border_with_growing_waves() {
        let mut game = square_game(&["....", "....", "...*"]);
        let update = game.primary(at(&game, 0, 0));
        assert_eq!(update.counters.opened, 11);
        assert_eq!(update.status, GameStatus::Won);
        let waves: Vec<u32> = update
            .changes
            .iter()
            .filter(|c| c.cell != at(&game, 3, 2))
            .map(|c| c.wave)
            .collect();
        assert!(waves.windows(2).all(|w| w[0] <= w[1]));
        assert_eq!(
            game.view(at(&game, 3, 2)),
            CellView::Closed { mark: Mark::Flag }
        );
    }

    #[test]
    fn flags_block_opening_and_marks_cycle() {
        let mut game = square_game(&["*..", "...", "..."]);
        game.primary(at(&game, 1, 1));
        let corner = at(&game, 2, 2);
        game.secondary(corner);
        assert!(game.primary(corner).is_noop());
        assert_eq!(game.counters().mines_left, 0);
        game.secondary(corner);
        assert_eq!(
            game.view(corner),
            CellView::Closed {
                mark: Mark::Question
            }
        );
        game.secondary(corner);
        assert_eq!(game.view(corner), CellView::Closed { mark: Mark::None });

        game.set_rules(Rules {
            question_marks: false,
            ..Rules::default()
        });
        game.secondary(corner);
        game.secondary(corner);
        assert_eq!(game.view(corner), CellView::Closed { mark: Mark::None });
    }

    #[test]
    fn smart_click_flags_forced_mines_then_opens_the_rest() {
        let mut game = square_game(&["*.*..", ".....", "....."]);
        game.primary(at(&game, 4, 2));
        // The 1 at (3,1) has a single closed neighbor, so it must be the mine.
        let update = game.primary(at(&game, 3, 1));
        assert_eq!(
            game.view(at(&game, 2, 0)),
            CellView::Closed { mark: Mark::Flag }
        );
        assert_eq!(update.status, GameStatus::Playing);
        // The 1 at (2,1) now has its flag, so its other closed neighbor opens.
        let update = game.primary(at(&game, 2, 1));
        assert_eq!(game.view(at(&game, 1, 0)), CellView::Open { adjacent: 2 });
        assert_eq!(update.status, GameStatus::Won);
    }

    #[test]
    fn smart_click_opens_neighbors_once_flags_match() {
        let mut game = square_game(&["*..*", "....", "...."]);
        let number = at(&game, 1, 1);
        game.primary(number);
        game.secondary(at(&game, 0, 0));
        game.primary(number);
        assert_eq!(game.view(at(&game, 1, 0)), CellView::Open { adjacent: 1 });
        assert_eq!(game.view(at(&game, 2, 2)), CellView::Open { adjacent: 0 });
    }

    #[test]
    fn without_smart_click_numbers_only_open_when_flags_match() {
        let mut game = square_game(&["*..", "...", "...", "..."]);
        game.set_rules(Rules {
            smart_click: false,
            ..Rules::default()
        });
        game.primary(at(&game, 2, 3));
        assert!(game.primary(at(&game, 1, 1)).is_noop());
    }

    #[test]
    fn opening_a_mine_loses_and_reveals_the_board() {
        let mut game = square_game(&["*..", "...", "..*"]);
        game.primary(at(&game, 1, 1));
        let wrong_flag = at(&game, 1, 0);
        game.secondary(wrong_flag);
        let update = game.primary(at(&game, 2, 2));
        assert_eq!(update.status, GameStatus::Lost);
        assert_eq!(
            game.view(at(&game, 2, 2)),
            CellView::Mine { exploded: true }
        );
        assert_eq!(
            game.view(at(&game, 0, 0)),
            CellView::Mine { exploded: false }
        );
        assert_eq!(game.view(wrong_flag), CellView::WrongFlag);
        assert!(game.primary(at(&game, 1, 1)).is_noop());
    }

    #[test]
    fn marks_wait_for_the_first_open() {
        let mut game = Game::new(GameConfig::preset(TilingId::Square, Level::Beginner), 1).unwrap();
        assert!(game.secondary(CellId(0)).is_noop());
        assert!(game.set_mark(CellId(0), Mark::Flag).is_noop());
        assert_eq!(game.status(), GameStatus::Ready);
        assert_eq!(game.counters().mines_left, 13);
    }

    #[test]
    fn a_flag_before_the_first_open_cannot_lose_it() {
        // One mine on a 3x3 board: the first click shows a 1. With a flag
        // already beside it, smart click would open every other neighbor.
        let config = GameConfig::custom(TilingId::Square, 3, 3, 1).unwrap();
        for seed in 0..200 {
            let mut game = Game::new(config, seed).unwrap();
            game.set_mark(CellId(0), Mark::Flag);
            let update = game.primary(CellId(4));
            assert_eq!(update.status, GameStatus::Playing, "seed {seed}");
        }
    }

    #[test]
    fn opening_a_number_flags_its_forced_neighbors_in_the_same_click() {
        let mut game = square_game(&["*.*..", ".....", "....."]);
        game.primary(at(&game, 4, 2));
        // (1,0) shows 2 and its only closed neighbors are the two mines.
        let update = game.primary(at(&game, 1, 0));
        assert_eq!(
            game.view(at(&game, 0, 0)),
            CellView::Closed { mark: Mark::Flag }
        );
        assert_eq!(
            game.view(at(&game, 2, 0)),
            CellView::Closed { mark: Mark::Flag }
        );
        assert_eq!(update.status, GameStatus::Won);
    }

    #[test]
    fn opening_a_number_leaves_neighbors_alone_without_smart_click() {
        let mut game = square_game(&["*.*.*", ".....", "....."]);
        game.set_rules(Rules {
            smart_click: false,
            ..Rules::default()
        });
        game.primary(at(&game, 4, 2));
        game.primary(at(&game, 1, 0));
        assert_eq!(
            game.view(at(&game, 0, 0)),
            CellView::Closed { mark: Mark::None }
        );
    }

    #[test]
    fn marks_alone_never_win() {
        // A win by marks would let a player settle any guess by trying flag
        // layouts until one wins, so only opening every safe cell wins.
        let mut game = square_game(&["*..", "...", "..*"]);
        game.primary(at(&game, 1, 1));
        game.secondary(at(&game, 0, 0));
        let update = game.secondary(at(&game, 2, 2));
        assert_eq!(update.status, GameStatus::Playing);
        game.set_mark(at(&game, 2, 2), Mark::Question);
        assert_eq!(game.status(), GameStatus::Playing);
        game.set_mark(at(&game, 2, 2), Mark::Flag);
        let update = game.primary(at(&game, 1, 1));
        assert_eq!(update.status, GameStatus::Won);
        assert_eq!(update.counters.opened, update.counters.safe_cells);
    }

    #[test]
    fn winning_flags_the_mines_left_unmarked() {
        let mut game = square_game(&["*..", "...", "..*"]);
        game.primary(at(&game, 1, 1));
        game.secondary(at(&game, 2, 2));
        game.set_mark(at(&game, 0, 0), Mark::Question);
        for (col, row) in [(1, 0), (2, 0), (0, 1), (2, 1), (0, 2), (1, 2)] {
            game.reveal(at(&game, col, row));
        }
        assert_eq!(game.status(), GameStatus::Won);
        for (col, row) in [(0, 0), (2, 2)] {
            assert_eq!(
                game.view(at(&game, col, row)),
                CellView::Closed { mark: Mark::Flag }
            );
        }
        assert_eq!(game.counters().mines_left, 0);
    }

    #[test]
    fn twins_stay_clear_when_the_board_has_room() {
        let config = GameConfig::preset(TilingId::Kite, Level::Amateur);
        for seed in 0..20 {
            let mut game = Game::new(config, seed).unwrap();
            assert!(!game.twins_clear());
            game.primary(game.board().center_cell());
            assert!(game.twins_clear(), "seed {seed}");
            let board = game.board();
            assert!(game.mines().iter().all(|&m| !board.is_twin(m)));
        }
        // Too many mines to keep off every twin.
        let crowded = GameConfig::custom(TilingId::Kite, 6, 6, 30).unwrap();
        let mut game = Game::new(crowded, 1).unwrap();
        game.primary(CellId(0));
        assert!(!game.twins_clear());
        assert!(
            !Game::with_mines(config, &[CellId(0)])
                .unwrap()
                .twins_clear()
        );
    }

    #[test]
    fn the_opening_click_never_opens_neighbors() {
        let mut game = square_game(&["*..", "...", "..*"]);
        game.primary(at(&game, 1, 1));
        game.secondary(at(&game, 1, 0));
        // (0,1) opens as a 1 beside the wrong flag. Opening its neighbors
        // now would hit the mine at (0,0).
        let update = game.primary(at(&game, 0, 1));
        assert_eq!(update.status, GameStatus::Playing);
        assert_eq!(game.view(at(&game, 0, 1)), CellView::Open { adjacent: 1 });
        assert_eq!(
            game.view(at(&game, 0, 2)),
            CellView::Closed { mark: Mark::None }
        );
        // Clicking the open number does open them.
        let update = game.primary(at(&game, 0, 1));
        assert_eq!(update.status, GameStatus::Lost);
    }

    #[test]
    fn the_opening_click_opens_nothing_even_when_flags_match() {
        let mut game = square_game(&["*..", "...", "..*"]);
        game.primary(at(&game, 1, 1));
        game.secondary(at(&game, 0, 0));
        // (1,0) opens as a 1 whose flag already matches.
        let update = game.primary(at(&game, 1, 0));
        assert_eq!(update.changes.len(), 1);
        assert_eq!(
            game.view(at(&game, 2, 0)),
            CellView::Closed { mark: Mark::None }
        );
        game.primary(at(&game, 1, 0));
        assert_eq!(game.view(at(&game, 2, 0)), CellView::Open { adjacent: 0 });
    }

    #[test]
    fn smart_click_on_a_wrong_flag_loses() {
        let mut game = square_game(&["*..", "...", "..."]);
        game.primary(at(&game, 1, 1));
        game.secondary(at(&game, 1, 0));
        let update = game.primary(at(&game, 1, 1));
        assert_eq!(update.status, GameStatus::Lost);
    }
}
