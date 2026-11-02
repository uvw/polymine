//! What a player can see, shaped for agents: cell states, numbers, positions,
//! and neighbor ids. Nothing here reveals a closed cell.

use polymine_core::{
    CellChange, CellId, CellView, Counters, Game, GameStatus, Level, Mark, TilingId, Update,
    geometry,
};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CellState {
    Closed,
    Flagged,
    Question,
    Open,
    /// Shown after a loss.
    Mine,
    /// The mine that was opened.
    Exploded,
    /// A flag on a safe cell, shown after a loss.
    WrongFlag,
}

/// One cell's visible state. `number` counts adjacent mines on open cells.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellStatus {
    pub id: u32,
    pub state: CellState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub number: Option<u8>,
}

impl CellStatus {
    pub fn of(id: CellId, view: CellView) -> Self {
        let (state, number) = match view {
            CellView::Closed { mark: Mark::None } => (CellState::Closed, None),
            CellView::Closed { mark: Mark::Flag } => (CellState::Flagged, None),
            CellView::Closed {
                mark: Mark::Question,
            } => (CellState::Question, None),
            CellView::Open { adjacent } => (CellState::Open, Some(adjacent)),
            CellView::Mine { exploded: false } => (CellState::Mine, None),
            CellView::Mine { exploded: true } => (CellState::Exploded, None),
            CellView::WrongFlag => (CellState::WrongFlag, None),
        };
        Self {
            id: id.0,
            state,
            number,
        }
    }
}

/// A cell on the board, with where it is and what it touches.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellInfo {
    #[serde(flatten)]
    pub status: CellStatus,
    /// The polygon's center in board units, rounded to 0.001.
    pub center: [f64; 2],
    /// Ids of the cells this one touches, ascending.
    pub neighbors: Vec<u32>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardView {
    pub tiling: TilingId,
    pub level: Level,
    pub cols: u32,
    pub rows: u32,
    pub mines: u32,
    pub status: GameStatus,
    pub counters: Counters,
    pub cells: Vec<CellInfo>,
}

fn round(v: f64) -> f64 {
    (v * 1000.0).round() / 1000.0
}

pub fn board(game: &Game) -> BoardView {
    let config = game.config();
    let board = game.board();
    let cells = board
        .cells()
        .map(|cell| {
            let c = geometry::centroid(board.polygon(cell));
            let mut neighbors: Vec<u32> = board.neighbors(cell).iter().map(|n| n.0).collect();
            neighbors.sort_unstable();
            CellInfo {
                status: CellStatus::of(cell, game.view(cell)),
                center: [round(c.x), round(c.y)],
                neighbors,
            }
        })
        .collect();
    BoardView {
        tiling: config.tiling,
        level: config.level,
        cols: config.cols,
        rows: config.rows,
        mines: config.mines,
        status: game.status(),
        counters: game.counters(),
        cells,
    }
}

/// What one or more moves changed.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveView {
    /// True when any cell changed.
    pub changed: bool,
    pub cells: Vec<CellStatus>,
    pub status: GameStatus,
    pub counters: Counters,
}

impl MoveView {
    pub fn from_updates<'a>(updates: impl IntoIterator<Item = &'a Update>, game: &Game) -> Self {
        let mut cells: Vec<CellStatus> = Vec::new();
        for change in updates.into_iter().flat_map(|u| &u.changes) {
            let CellChange { cell, view, .. } = *change;
            let status = CellStatus::of(cell, view);
            match cells.iter_mut().find(|c| c.id == cell.0) {
                Some(existing) => *existing = status,
                None => cells.push(status),
            }
        }
        Self {
            changed: !cells.is_empty(),
            cells,
            status: game.status(),
            counters: game.counters(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use polymine_core::GameConfig;

    fn game() -> Game {
        let config = GameConfig::custom(TilingId::Square, 3, 3, 1).unwrap();
        Game::with_mines(config, &[CellId(8)]).unwrap()
    }

    #[test]
    fn a_fresh_board_shows_nothing_but_closed_cells() {
        let view = board(&game());
        assert_eq!(view.cells.len(), 9);
        assert!(
            view.cells
                .iter()
                .all(|c| c.status.state == CellState::Closed)
        );
        assert_eq!(view.cells[4].center, [1.5, 1.5]);
        assert_eq!(view.cells[0].neighbors, [1, 3, 4]);
        let json = serde_json::to_value(&view.cells[0]).unwrap();
        assert_eq!(json["state"], "closed");
        assert!(json.get("number").is_none());
    }

    #[test]
    fn moves_report_each_changed_cell_once() {
        let mut game = game();
        let first = game.primary(CellId(0));
        let second = game.set_mark(CellId(8), Mark::Flag);
        let view = MoveView::from_updates([&first, &second], &game);
        assert!(view.changed);
        let ids: Vec<u32> = view.cells.iter().map(|c| c.id).collect();
        let mut unique = ids.clone();
        unique.dedup();
        assert_eq!(ids, unique);
        assert_eq!(view.status, game.status());
        let opened = view.cells.iter().find(|c| c.id == 4).unwrap();
        assert_eq!((opened.state, opened.number), (CellState::Open, Some(1)));
    }

    #[test]
    fn marks_and_loss_reveals_have_their_own_states() {
        let cases = [
            (
                CellView::Closed {
                    mark: Mark::Question,
                },
                CellState::Question,
            ),
            (CellView::Mine { exploded: true }, CellState::Exploded),
            (CellView::Mine { exploded: false }, CellState::Mine),
            (CellView::WrongFlag, CellState::WrongFlag),
        ];
        for (view, state) in cases {
            assert_eq!(CellStatus::of(CellId(0), view).state, state);
        }
    }
}
