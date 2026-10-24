//! Difficulty levels and validated game configurations.

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::tiling::TilingId;

pub const MIN_SIDE: u32 = 3;
pub const MAX_SIDE: u32 = 200;

#[derive(
    Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize, specta::Type,
)]
#[serde(rename_all = "camelCase")]
pub enum Level {
    Beginner,
    Amateur,
    Professional,
    Crazy,
    Custom,
}

impl Level {
    pub const PRESETS: [Self; 4] = [
        Self::Beginner,
        Self::Amateur,
        Self::Professional,
        Self::Crazy,
    ];

    /// Size of the preset on a square board. Other tilings get about the same
    /// cell count and the same aspect ratio.
    fn square_size(self) -> Option<(u32, u32)> {
        match self {
            Self::Beginner => Some((10, 10)),
            Self::Amateur => Some((20, 15)),
            Self::Professional => Some((30, 20)),
            Self::Crazy => Some((45, 25)),
            Self::Custom => None,
        }
    }

    /// Share of cells that hold a mine. It is the same on every tiling: the
    /// level sets the mines, and the tiling's shape adds its own difficulty,
    /// which [`TilingId::complexity`] rates.
    pub fn mine_density(self) -> f64 {
        match self {
            Self::Beginner => 0.13,
            Self::Amateur => 0.16,
            Self::Professional => 0.19,
            Self::Custom | Self::Crazy => 0.23,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct GameConfig {
    pub tiling: TilingId,
    pub level: Level,
    pub cols: u32,
    pub rows: u32,
    pub mines: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Error)]
pub enum ConfigError {
    #[error("board sides must be between {MIN_SIDE} and {MAX_SIDE} cells, got {cols} x {rows}")]
    Size { cols: u32, rows: u32 },
    #[error("a {cells}-cell board needs between 1 and {max} mines, got {mines}")]
    Mines { mines: u32, cells: u32, max: u32 },
}

impl GameConfig {
    /// Builds a preset level. `Level::Custom` falls back to the beginner size.
    pub fn preset(tiling: TilingId, level: Level) -> Self {
        let (square_cols, square_rows) = level.square_size().unwrap_or((10, 10));
        let layout = tiling.tiling();
        let (cols, rows) = layout.dimensions_for(
            square_cols * square_rows,
            f64::from(square_cols) / f64::from(square_rows),
        );
        let cells = cols * rows;
        let mines = (f64::from(cells) * level.mine_density()).round() as u32;
        Self {
            tiling,
            level,
            cols,
            rows,
            mines: mines.clamp(1, Self::max_mines(cells)),
        }
    }

    pub fn custom(tiling: TilingId, cols: u32, rows: u32, mines: u32) -> Result<Self, ConfigError> {
        let config = Self {
            tiling,
            level: Level::Custom,
            cols,
            rows,
            mines,
        };
        config.validate()?;
        Ok(config)
    }

    pub fn validate(&self) -> Result<(), ConfigError> {
        let side = MIN_SIDE..=MAX_SIDE;
        if !side.contains(&self.cols) || !side.contains(&self.rows) {
            return Err(ConfigError::Size {
                cols: self.cols,
                rows: self.rows,
            });
        }
        let cells = self.cells();
        let max = Self::max_mines(cells);
        if self.mines == 0 || self.mines > max {
            return Err(ConfigError::Mines {
                mines: self.mines,
                cells,
                max,
            });
        }
        Ok(())
    }

    pub fn cells(&self) -> u32 {
        self.cols * self.rows
    }

    /// At least one cell must stay safe for the first click.
    pub fn max_mines(cells: u32) -> u32 {
        cells.saturating_sub(1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn square_presets_keep_classic_sizes() {
        let beginner = GameConfig::preset(TilingId::Square, Level::Beginner);
        assert_eq!((beginner.cols, beginner.rows, beginner.mines), (10, 10, 13));
        let crazy = GameConfig::preset(TilingId::Square, Level::Crazy);
        assert_eq!((crazy.cols, crazy.rows), (45, 25));
    }

    #[test]
    fn every_preset_is_valid_on_every_tiling() {
        for tiling in TilingId::ALL {
            for level in Level::PRESETS {
                let config = GameConfig::preset(tiling, level);
                assert_eq!(config.validate(), Ok(()), "{tiling:?} {level:?}");
            }
        }
    }

    #[test]
    fn every_tiling_gets_the_level_density() {
        for tiling in TilingId::ALL {
            for level in Level::PRESETS {
                let config = GameConfig::preset(tiling, level);
                let density = f64::from(config.mines) / f64::from(config.cells());
                let rounding = 0.5 / f64::from(config.cells());
                assert!(
                    (density - level.mine_density()).abs() <= rounding,
                    "{tiling:?} {level:?}: {density}"
                );
            }
        }
    }

    #[test]
    fn custom_rejects_bad_sizes_and_mine_counts() {
        assert!(matches!(
            GameConfig::custom(TilingId::Square, 2, 10, 5),
            Err(ConfigError::Size { .. })
        ));
        assert!(matches!(
            GameConfig::custom(TilingId::Square, 5, 5, 25),
            Err(ConfigError::Mines { .. })
        ));
        assert!(GameConfig::custom(TilingId::Hexagon, 5, 5, 24).is_ok());
    }
}
