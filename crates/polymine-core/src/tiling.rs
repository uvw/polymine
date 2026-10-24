//! Periodic tilings described as data.
//!
//! A tiling is a small patch of polygons repeated on a rectangular lattice. Each
//! polygon in the patch occupies one logical slot, so a board of `cols` x `rows`
//! logical cells maps every `(col, row)` to exactly one polygon. Neighbors are
//! derived from geometry: two cells are neighbors when they share an edge or a
//! corner. Adding a tiling therefore needs coordinates only, no new rules.

mod catalog;

use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

use crate::geometry::{self, Bounds, Point};

#[derive(
    Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize, specta::Type,
)]
#[serde(rename_all = "camelCase")]
pub enum TilingId {
    Square,
    OffsetSquare,
    Herringbone,
    Pinwheel,
    Kite,
    Trapezoid,
    TrapezoidTriangle,
    TrapezoidHexagon,
    Triangle,
    OffsetTriangle,
    RightTriangle,
    ObtuseTriangle,
    Cairo,
    Floret,
    Hexagon,
    SnubSquare,
    SquareTriangle,
    SquareTriangleHexagon,
}

impl TilingId {
    /// Every tiling in declaration order, which [`TilingId::tiling`] relies on.
    pub const ALL: [Self; 18] = [
        Self::Square,
        Self::OffsetSquare,
        Self::Herringbone,
        Self::Pinwheel,
        Self::Kite,
        Self::Trapezoid,
        Self::TrapezoidTriangle,
        Self::TrapezoidHexagon,
        Self::Triangle,
        Self::OffsetTriangle,
        Self::RightTriangle,
        Self::ObtuseTriangle,
        Self::Cairo,
        Self::Floret,
        Self::Hexagon,
        Self::SnubSquare,
        Self::SquareTriangle,
        Self::SquareTriangleHexagon,
    ];

    pub fn tiling(self) -> &'static Tiling {
        static CATALOG: OnceLock<Vec<Tiling>> = OnceLock::new();
        let catalog =
            CATALOG.get_or_init(|| Self::ALL.iter().map(|&id| catalog::build(id)).collect());
        &catalog[self as usize]
    }

    /// How much harder the shape makes the game at the same mine density, from
    /// 1, which plays like squares, to 5.
    ///
    /// Each rating comes from [`TilingId::rating_for`] applied to the
    /// assistant's mean win rate over 400 Amateur and 400 Professional games,
    /// as the `complexity` example measures it: `Square` wins 75% and
    /// `SquareTriangleHexagon` 16%. Rerun it after changing a tiling or the
    /// solver.
    pub const fn complexity(self) -> u8 {
        match self {
            Self::Square
            | Self::OffsetSquare
            | Self::Herringbone
            | Self::Trapezoid
            | Self::Triangle
            | Self::OffsetTriangle
            | Self::ObtuseTriangle
            | Self::Hexagon
            | Self::SnubSquare => 1,
            Self::Cairo | Self::SquareTriangle => 2,
            Self::Pinwheel
            | Self::Kite
            | Self::TrapezoidTriangle
            | Self::TrapezoidHexagon
            | Self::Floret => 3,
            Self::RightTriangle => 4,
            Self::SquareTriangleHexagon => 5,
        }
    }

    /// The complexity rating for the assistant's mean win rate at Amateur and
    /// Professional. Each step down in win rate is one step up in rating.
    pub fn rating_for(win_rate: f64) -> u8 {
        const STEPS: [f64; 4] = [0.70, 0.50, 0.35, 0.20];
        1 + STEPS.iter().filter(|&&step| win_rate < step).count() as u8
    }
}

#[derive(Debug)]
pub struct Tiling {
    id: TilingId,
    period: Point,
    patch_cols: u32,
    patch_rows: u32,
    /// One polygon per logical slot, row-major, in patch coordinates.
    slots: Vec<Vec<Point>>,
    /// Logical `(dcol, drow)` offsets to every neighbor, per slot.
    stencils: Vec<Vec<(i32, i32)>>,
}

impl Tiling {
    /// Builds a tiling and derives its neighbor stencils.
    ///
    /// `period` is the lattice translation between patches. Patch polygons may
    /// stick out of the period rectangle, as long as the translated copies tile
    /// the plane without gaps or overlaps.
    fn new(
        id: TilingId,
        period: Point,
        patch_cols: u32,
        patch_rows: u32,
        slots: Vec<Vec<Point>>,
    ) -> Self {
        assert_eq!(
            slots.len(),
            (patch_cols * patch_rows) as usize,
            "one polygon per slot"
        );
        let mut tiling = Self {
            id,
            period,
            patch_cols,
            patch_rows,
            slots,
            stencils: Vec::new(),
        };
        tiling.stencils = (0..tiling.slots.len()).map(|s| tiling.stencil(s)).collect();
        tiling
    }

    fn stencil(&self, slot: usize) -> Vec<(i32, i32)> {
        // Patches two lattice steps away cover every tiling whose polygons stay
        // within one period of their own patch.
        const REACH: i32 = 2;
        let (sc, sr) = self.slot_coords(slot);
        let own = &self.slots[slot];
        let own_bounds = Bounds::of(own);
        let mut offsets = Vec::new();
        for py in -REACH..=REACH {
            for px in -REACH..=REACH {
                for other in 0..self.slots.len() {
                    if (px, py, other) == (0, 0, slot) {
                        continue;
                    }
                    let candidate = self.translated(other, px, py);
                    if own_bounds.near(&Bounds::of(&candidate), geometry::EPSILON)
                        && geometry::touches(own, &candidate)
                    {
                        let (oc, or) = self.slot_coords(other);
                        offsets.push((
                            px * self.patch_cols as i32 + oc - sc,
                            py * self.patch_rows as i32 + or - sr,
                        ));
                    }
                }
            }
        }
        offsets.sort_unstable();
        offsets
    }

    fn slot_coords(&self, slot: usize) -> (i32, i32) {
        (
            (slot as u32 % self.patch_cols) as i32,
            (slot as u32 / self.patch_cols) as i32,
        )
    }

    fn slot_of(&self, col: u32, row: u32) -> usize {
        ((row % self.patch_rows) * self.patch_cols + col % self.patch_cols) as usize
    }

    fn translated(&self, slot: usize, px: i32, py: i32) -> Vec<Point> {
        let (dx, dy) = (f64::from(px) * self.period.x, f64::from(py) * self.period.y);
        self.slots[slot]
            .iter()
            .map(|p| p.translate(dx, dy))
            .collect()
    }

    pub fn id(&self) -> TilingId {
        self.id
    }

    /// Polygon of the logical cell at `(col, row)` in board space.
    pub fn polygon(&self, col: u32, row: u32) -> Vec<Point> {
        let slot = self.slot_of(col, row);
        self.translated(
            slot,
            (col / self.patch_cols) as i32,
            (row / self.patch_rows) as i32,
        )
    }

    /// Logical offsets from `(col, row)` to its neighbors. Callers drop the ones
    /// that fall outside the board.
    pub fn neighbor_offsets(&self, col: u32, row: u32) -> &[(i32, i32)] {
        &self.stencils[self.slot_of(col, row)]
    }

    /// Neighbor count of every slot, in slot order.
    pub fn neighbor_counts(&self) -> Vec<usize> {
        self.stencils.iter().map(Vec::len).collect()
    }

    /// Width of one logical column and height of one logical row.
    pub fn logical_cell_size(&self) -> (f64, f64) {
        (
            self.period.x / f64::from(self.patch_cols),
            self.period.y / f64::from(self.patch_rows),
        )
    }

    /// Picks `(cols, rows)` holding about `cells` cells with roughly the given
    /// width-to-height `aspect`.
    pub fn dimensions_for(&self, cells: u32, aspect: f64) -> (u32, u32) {
        let (w, h) = self.logical_cell_size();
        let rows = (f64::from(cells) * w / (aspect * h))
            .sqrt()
            .round()
            .max(2.0);
        let cols = (f64::from(cells) / rows).round().max(2.0);
        (cols as u32, rows as u32)
    }

    #[cfg(test)]
    pub(crate) fn period(&self) -> Point {
        self.period
    }

    #[cfg(test)]
    pub(crate) fn patch_polygons(&self) -> &[Vec<Point>] {
        &self.slots
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn neighbor_counts_match_the_geometry() {
        let expected = [
            (TilingId::Square, vec![8]),
            (TilingId::OffsetSquare, vec![6; 2]),
            (TilingId::Herringbone, vec![6; 2]),
            (TilingId::Pinwheel, vec![7; 4]),
            (TilingId::Kite, vec![9; 12]),
            (TilingId::Trapezoid, vec![6; 2]),
            (TilingId::TrapezoidTriangle, vec![8; 12]),
            (
                TilingId::TrapezoidHexagon,
                vec![6, 10, 10, 6, 11, 11, 11, 11, 10, 6, 6, 10, 11, 11, 11, 11],
            ),
            (TilingId::Triangle, vec![12; 4]),
            (TilingId::OffsetTriangle, vec![8; 2]),
            (TilingId::RightTriangle, vec![14; 4]),
            (TilingId::ObtuseTriangle, vec![12; 4]),
            (TilingId::Cairo, vec![7; 8]),
            (TilingId::Floret, vec![8; 12]),
            (TilingId::Hexagon, vec![6; 2]),
            (TilingId::SnubSquare, vec![12, 9, 9, 12, 9, 9]),
            (TilingId::SquareTriangle, vec![12, 9, 9, 12, 9, 9]),
            (
                TilingId::SquareTriangleHexagon,
                vec![12, 6, 8, 6, 8, 8, 6, 8, 12, 8, 6, 8],
            ),
        ];
        for (id, counts) in expected {
            assert_eq!(id.tiling().neighbor_counts(), counts, "{id:?}");
        }
    }

    #[test]
    fn ratings_step_with_the_win_rate() {
        let ratings = [0.9, 0.7, 0.69, 0.5, 0.4, 0.3, 0.19, 0.0].map(TilingId::rating_for);
        assert_eq!(ratings, [1, 1, 2, 2, 3, 4, 5, 5]);
    }

    #[test]
    fn squares_set_the_simplest_complexity() {
        assert_eq!(TilingId::Square.complexity(), 1);
        assert!(
            TilingId::ALL
                .iter()
                .all(|t| (1..=5).contains(&t.complexity()))
        );
    }

    #[test]
    fn catalog_follows_declaration_order() {
        for (i, id) in TilingId::ALL.into_iter().enumerate() {
            assert_eq!(id as usize, i);
            assert_eq!(id.tiling().id(), id);
        }
    }

    #[test]
    fn stencils_are_symmetric() {
        for id in TilingId::ALL {
            let tiling = id.tiling();
            // Probe cells far from the origin so every neighbor coordinate stays positive.
            let (pc, pr) = (tiling.patch_cols, tiling.patch_rows);
            for row in 4 * pr..5 * pr {
                for col in 4 * pc..5 * pc {
                    for &(dc, dr) in tiling.neighbor_offsets(col, row) {
                        let (nc, nr) = ((col as i32 + dc) as u32, (row as i32 + dr) as u32);
                        assert!(
                            tiling.neighbor_offsets(nc, nr).contains(&(-dc, -dr)),
                            "{id:?}: ({col},{row}) -> ({nc},{nr}) is one-way"
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn patch_area_matches_period_area() {
        for id in TilingId::ALL {
            let tiling = id.tiling();
            let total: f64 = tiling
                .patch_polygons()
                .iter()
                .map(|p| geometry::area(p))
                .sum();
            let period = tiling.period();
            assert!(
                (total - period.x * period.y).abs() < 1e-9,
                "{id:?}: patch leaves gaps or overlaps"
            );
        }
    }

    #[test]
    fn sample_points_are_covered_exactly_once() {
        for id in TilingId::ALL {
            let tiling = id.tiling();
            let period = tiling.period();
            let copies: Vec<Vec<Point>> = (-2..=2)
                .flat_map(|py| (-2..=2).map(move |px| (px, py)))
                .flat_map(|(px, py)| {
                    (0..tiling.slots.len()).map(move |s| tiling.translated(s, px, py))
                })
                .collect();
            // Irrational steps keep the samples off polygon edges.
            for i in 0..2000 {
                let fx = ((f64::from(i) + 0.5) * 0.618_033_988_7).fract();
                let fy = ((f64::from(i) + 0.5) * 0.414_213_562_3).fract();
                let p = Point::new(fx * period.x, fy * period.y);
                let hits = copies
                    .iter()
                    .filter(|poly| geometry::contains(poly, p))
                    .count();
                assert_eq!(hits, 1, "{id:?}: point {p:?} covered {hits} times");
            }
        }
    }

    #[test]
    fn slot_order_is_pinned_on_every_tiling() {
        // Saved games and seeds rebuild boards by cell index, so the slot
        // order must not change. Each checksum covers the cell centers of an
        // 8 by 8 board, rounded to 1e-6, in cell order.
        let expected: [u64; 18] = [
            0xcdb7_65a2_3c97_20f5,
            0x6212_e76e_6222_5aed,
            0xa739_57cf_a791_2465,
            0xb4b8_91be_6166_3519,
            0x7f8f_220d_e4eb_8979,
            0xe664_6ed7_b715_a539,
            0x9ed4_fa9c_e24d_6daa,
            0x229c_4b3c_9e05_c551,
            0xb455_ed97_7617_6609,
            0x4ac2_c874_f0bb_3469,
            0xb007_ea56_9e0c_2935,
            0x59d4_0554_5f2a_5b61,
            0xf1a4_85fc_10f5_6f61,
            0x2b17_d602_4a67_78c1,
            0x43bd_b542_6317_946d,
            0x1a73_5c47_cb17_2d1b,
            0x448b_3665_8e97_513d,
            0x391d_acb5_62bb_ec51,
        ];
        let checksum = |tiling: &Tiling| {
            // FNV-1a, whose output, unlike std's hashers, is fixed.
            let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
            for row in 0..8 {
                for col in 0..8 {
                    let polygon = tiling.polygon(col, row);
                    let n = polygon.len() as f64;
                    let (x, y) = polygon
                        .iter()
                        .fold((0.0, 0.0), |(x, y), q| (x + q.x, y + q.y));
                    for v in [x / n, y / n] {
                        for byte in ((v * 1e6).round() as i64).to_le_bytes() {
                            hash = (hash ^ u64::from(byte)).wrapping_mul(0x0100_0000_01b3);
                        }
                    }
                }
            }
            hash
        };
        let actual = TilingId::ALL.map(|id| checksum(id.tiling()));
        assert_eq!(actual, expected);
    }

    #[test]
    fn dimensions_follow_requested_aspect() {
        let (cols, rows) = TilingId::Square.tiling().dimensions_for(300, 4.0 / 3.0);
        assert_eq!((cols, rows), (20, 15));
    }
}
