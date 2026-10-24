//! Polymine game engine: tilings, board layout, rules, solver, and statistics.
//!
//! The crate does no I/O and has no UI dependencies. Mines are placed from a
//! seed, so every game is reproducible.

pub mod board;
pub mod config;
pub mod game;
pub mod geometry;
pub mod solver;
pub mod stats;
pub mod tiling;

pub use board::{Board, CellId};
pub use config::{ConfigError, GameConfig, Level};
pub use game::{CellChange, CellView, Counters, Game, GameError, GameStatus, Mark, Rules, Update};
pub use geometry::{Bounds, Point};
pub use solver::{Action, Analysis, Suggestion};
pub use stats::{ChampionEntry, GameRecord, Outcome, PlayerStats};
pub use tiling::{Tiling, TilingId};

/// Types a finite `f64` as `number` in the TypeScript bindings. specta types
/// every float as `number | null` because JSON writes NaN and the infinities
/// as `null`. Fields marked with it never hold those.
#[doc(hidden)]
#[derive(Debug)]
pub struct Finite;

impl specta::Type for Finite {
    fn definition(types: &mut specta::Types) -> specta::datatype::DataType {
        i32::definition(types)
    }
}
