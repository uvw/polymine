//! Board layout: cell polygons and the neighbor graph for one game.

use serde::{Deserialize, Serialize};

use crate::config::{MAX_SIDE, MIN_SIDE};
use crate::geometry::{Bounds, Point, centroid, distance_to_segment};
use crate::tiling::TilingId;

/// The distance from a convex cell's centroid to its nearest edge.
fn inradius_of(polygon: &[Point]) -> f64 {
    let c = centroid(polygon);
    (0..polygon.len())
        .map(|i| distance_to_segment(c, polygon[i], polygon[(i + 1) % polygon.len()]))
        .fold(f64::INFINITY, f64::min)
}

/// The largest side in `MIN_SIDE..=MAX_SIDE` that `fits`, or `MIN_SIDE` when
/// none does. `fits` must hold for every side below one that fits.
fn largest_side(fits: impl Fn(u32) -> bool) -> u32 {
    let (mut lo, mut hi) = (MIN_SIDE, MAX_SIDE);
    if fits(hi) {
        return hi;
    }
    while hi - lo > 1 {
        let mid = lo + (hi - lo) / 2;
        if fits(mid) {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    lo
}

/// Index of a cell on its board.
#[derive(
    Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize, specta::Type,
)]
pub struct CellId(pub u32);

impl CellId {
    pub fn index(self) -> usize {
        self.0 as usize
    }
}

/// Immutable layout of a board: which polygons exist and which ones touch.
#[derive(Clone, Debug)]
pub struct Board {
    tiling: TilingId,
    cols: u32,
    rows: u32,
    polygons: Vec<Vec<Point>>,
    neighbors: Vec<Vec<CellId>>,
    twins: Vec<bool>,
    bounds: Bounds,
}

impl Board {
    /// Lays out a board of `cols` by `rows` logical cells.
    ///
    /// # Panics
    ///
    /// When a side is outside `MIN_SIDE..=MAX_SIDE`, the same range that
    /// [`GameConfig::validate`](crate::GameConfig::validate) enforces.
    pub fn new(tiling: TilingId, cols: u32, rows: u32) -> Self {
        let sides = MIN_SIDE..=MAX_SIDE;
        assert!(
            sides.contains(&cols) && sides.contains(&rows),
            "board sides must be between {MIN_SIDE} and {MAX_SIDE} cells, got {cols} x {rows}"
        );
        let layout = tiling.tiling();
        let id = |col: u32, row: u32| CellId(row * cols + col);
        let mut polygons = Vec::with_capacity((cols * rows) as usize);
        let mut neighbors = Vec::with_capacity((cols * rows) as usize);
        for row in 0..rows {
            for col in 0..cols {
                polygons.push(layout.polygon(col, row));
                let adjacent = layout
                    .neighbor_offsets(col, row)
                    .iter()
                    .map(|&(dc, dr)| {
                        (
                            i64::from(col) + i64::from(dc),
                            i64::from(row) + i64::from(dr),
                        )
                    })
                    .filter(|&(c, r)| {
                        (0..i64::from(cols)).contains(&c) && (0..i64::from(rows)).contains(&r)
                    })
                    .map(|(c, r)| id(c as u32, r as u32))
                    .collect();
                neighbors.push(adjacent);
            }
        }
        let bounds = polygons
            .iter()
            .map(|p| Bounds::of(p))
            .fold(Bounds::EMPTY, Bounds::union);
        let twins = find_twins(&neighbors);
        Self {
            tiling,
            cols,
            rows,
            polygons,
            neighbors,
            twins,
            bounds,
        }
    }

    pub fn tiling(&self) -> TilingId {
        self.tiling
    }

    pub fn cols(&self) -> u32 {
        self.cols
    }

    pub fn rows(&self) -> u32 {
        self.rows
    }

    pub fn len(&self) -> usize {
        self.polygons.len()
    }

    pub fn is_empty(&self) -> bool {
        self.polygons.is_empty()
    }

    pub fn cells(&self) -> impl Iterator<Item = CellId> + use<> {
        (0..self.polygons.len() as u32).map(CellId)
    }

    /// The corners of `cell`.
    ///
    /// # Panics
    ///
    /// When `cell` is off the board.
    pub fn polygon(&self, cell: CellId) -> &[Point] {
        &self.polygons[cell.index()]
    }

    pub fn neighbors(&self, cell: CellId) -> &[CellId] {
        &self.neighbors[cell.index()]
    }

    pub fn bounds(&self) -> Bounds {
        self.bounds
    }

    /// The largest `(cols, rows)` of `tiling` whose board fits `width` by
    /// `height` when its smallest cell has an inradius of `inradius`, all in
    /// one unit such as pixels. Each side stays within `MIN_SIDE..=MAX_SIDE`, so
    /// a tiny area still gets the smallest board.
    pub fn fit(tiling: TilingId, width: f64, height: f64, inradius: f64) -> (u32, u32) {
        let probe = Self::new(tiling, MIN_SIDE, MIN_SIDE);
        let smallest = probe
            .cells()
            .map(|cell| inradius_of(probe.polygon(cell)))
            .fold(f64::INFINITY, f64::min);
        let scale = inradius / smallest;
        let cols =
            largest_side(|c| Self::new(tiling, c, MIN_SIDE).bounds().width() * scale <= width);
        let rows =
            largest_side(|r| Self::new(tiling, MIN_SIDE, r).bounds().height() * scale <= height);
        (cols, rows)
    }

    /// True when another cell has exactly the same neighbors as this one,
    /// counting the two cells themselves when they touch. No number can tell
    /// twins apart, so a single mine between them is a forced guess.
    pub fn is_twin(&self, cell: CellId) -> bool {
        self.twins[cell.index()]
    }

    /// The cell nearest the middle of the board.
    pub fn center_cell(&self) -> CellId {
        CellId((self.rows / 2) * self.cols + self.cols / 2)
    }
}

/// Marks every cell whose neighborhood, open or closed, matches another cell's.
/// Board edges can create twins on tilings that have none in the open plane.
fn find_twins(neighbors: &[Vec<CellId>]) -> Vec<bool> {
    let mut twins = vec![false; neighbors.len()];
    let mut mark = |keys: Vec<(Vec<CellId>, usize)>| {
        let mut keys = keys;
        keys.sort_unstable();
        for pair in keys.windows(2) {
            if pair[0].0 == pair[1].0 {
                twins[pair[0].1] = true;
                twins[pair[1].1] = true;
            }
        }
    };
    let sorted = |cell: usize, include_self: bool| {
        let mut set = neighbors[cell].clone();
        if include_self {
            set.push(CellId(cell as u32));
        }
        set.sort_unstable();
        set
    };
    mark(
        (0..neighbors.len())
            .map(|c| (sorted(c, false), c))
            .collect(),
    );
    mark((0..neighbors.len()).map(|c| (sorted(c, true), c)).collect());
    twins
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fits_the_largest_board_into_an_area() {
        // Unit squares have an inradius of 0.5, so an inradius of 5 makes
        // them 10 pixels wide.
        assert_eq!(Board::fit(TilingId::Square, 100.0, 50.0, 5.0), (10, 5));
        assert_eq!(
            Board::fit(TilingId::Square, 10.0, 10.0, 5.0),
            (MIN_SIDE, MIN_SIDE)
        );
        assert_eq!(
            Board::fit(TilingId::Square, 1e6, 1e6, 5.0),
            (MAX_SIDE, MAX_SIDE)
        );
    }

    #[test]
    fn a_fitted_board_fits_and_one_more_side_would_not() {
        for tiling in TilingId::ALL {
            let (w, h, r) = (900.0, 600.0, 12.0);
            let (cols, rows) = Board::fit(tiling, w, h, r);
            let probe = Board::new(tiling, MIN_SIDE, MIN_SIDE);
            let smallest = probe
                .cells()
                .map(|c| inradius_of(probe.polygon(c)))
                .fold(f64::INFINITY, f64::min);
            let scale = r / smallest;
            let width = |c| Board::new(tiling, c, MIN_SIDE).bounds().width() * scale;
            let height = |rr| Board::new(tiling, MIN_SIDE, rr).bounds().height() * scale;
            assert!(
                width(cols) <= w && width(cols + 1) > w,
                "{tiling:?} columns"
            );
            assert!(height(rows) <= h && height(rows + 1) > h, "{tiling:?} rows");
        }
    }

    #[test]
    #[should_panic(expected = "board sides")]
    fn a_side_above_the_limit_panics() {
        // 70000 x 70000 cells would also overflow a u32 cell count.
        Board::new(TilingId::Square, 70_000, 70_000);
    }

    #[test]
    #[should_panic(expected = "board sides")]
    fn a_side_below_the_limit_panics() {
        Board::new(TilingId::Square, MIN_SIDE - 1, 10);
    }

    #[test]
    fn square_board_corner_and_inner_neighbors() {
        let board = Board::new(TilingId::Square, 4, 3);
        assert_eq!(board.len(), 12);
        let mut corner = board.neighbors(CellId(0)).to_vec();
        corner.sort_unstable();
        assert_eq!(corner, [CellId(1), CellId(4), CellId(5)]);
        assert_eq!(board.neighbors(CellId(5)).len(), 8);
    }

    #[test]
    fn finds_twins_by_open_and_closed_neighborhoods() {
        // 0 and 1 touch and see the same cells; 3 and 4 see the same cells
        // without touching; 2 is unique.
        let neighbors = [vec![1, 2], vec![0, 2], vec![0, 1, 3, 4], vec![2], vec![2]]
            .map(|n| n.into_iter().map(CellId).collect());
        assert_eq!(find_twins(&neighbors), [true, true, false, true, true]);
    }

    #[test]
    fn square_boards_have_no_twins() {
        let board = Board::new(TilingId::Square, 9, 7);
        assert!(board.cells().all(|c| !board.is_twin(c)));
    }

    #[test]
    fn neighbor_graph_is_symmetric_on_every_tiling() {
        for id in TilingId::ALL {
            let board = Board::new(id, 9, 7);
            for cell in board.cells() {
                for &n in board.neighbors(cell) {
                    assert!(
                        board.neighbors(n).contains(&cell),
                        "{id:?}: {cell:?} -> {n:?}"
                    );
                }
            }
        }
    }
}
