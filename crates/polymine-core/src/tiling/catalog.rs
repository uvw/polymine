//! Coordinates for each tiling. Every patch is laid out row-major by logical slot.

use super::{Tiling, TilingId};
use crate::geometry::Point;

pub(super) fn build(id: TilingId) -> Tiling {
    match id {
        TilingId::Square => square(),
        TilingId::OffsetSquare => offset_square(),
        TilingId::Herringbone => herringbone(),
        TilingId::Pinwheel => pinwheel(),
        TilingId::Kite => kite(),
        TilingId::Trapezoid => trapezoid(),
        TilingId::TrapezoidTriangle => trapezoid_triangle(),
        TilingId::TrapezoidHexagon => trapezoid_hexagon(),
        TilingId::Triangle => triangle(),
        TilingId::OffsetTriangle => offset_triangle(),
        TilingId::RightTriangle => right_triangle(),
        TilingId::ObtuseTriangle => obtuse_triangle(),
        TilingId::Cairo => cairo(),
        TilingId::Floret => floret(),
        TilingId::Hexagon => hexagon(),
        TilingId::SnubSquare => snub_square(),
        TilingId::SquareTriangle => square_triangle(),
        TilingId::SquareTriangleHexagon => square_triangle_hexagon(),
    }
}

fn p(x: f64, y: f64) -> Point {
    Point::new(x, y)
}

fn rect(x0: f64, y0: f64, x1: f64, y1: f64) -> Vec<Point> {
    vec![p(x0, y0), p(x1, y0), p(x1, y1), p(x0, y1)]
}

/// Turns a polygon 45 degrees about the origin, mapping `(1, 1)` onto `(sqrt 2, 0)`.
fn rotate_45(polygon: &[Point]) -> Vec<Point> {
    let s = std::f64::consts::FRAC_1_SQRT_2;
    polygon
        .iter()
        .map(|q| p(s * (q.x + q.y), s * (q.y - q.x)))
        .collect()
}

fn translate(polygon: &[Point], dx: f64, dy: f64) -> Vec<Point> {
    polygon.iter().map(|q| q.translate(dx, dy)).collect()
}

fn vertex_mean(polygon: &[Point]) -> Point {
    let n = polygon.len() as f64;
    let (x, y) = polygon
        .iter()
        .fold((0.0, 0.0), |(x, y), q| (x + q.x, y + q.y));
    p(x / n, y / n)
}

/// Which of two polygons level in x comes first in a row.
#[derive(Clone, Copy)]
enum Ties {
    TopFirst,
    BottomFirst,
}

/// Sorts polygons left to right, breaking ties in x as `ties` says.
///
/// The means are compared on a grid much finer than any tiling's detail and
/// much coarser than rounding noise. Means equal in exact math can differ by
/// an ulp, and `sin` and `cos` round differently on each platform, so a raw
/// comparison would let the platform pick the slot order.
fn by_x(mut polygons: Vec<Vec<Point>>, ties: Ties) -> Vec<Vec<Point>> {
    let grid = |v: f64| (v * 1e9).round() as i64;
    polygons.sort_by_key(|polygon| {
        let m = vertex_mean(polygon);
        let y = match ties {
            Ties::TopFirst => grid(m.y),
            Ties::BottomFirst => -grid(m.y),
        };
        (grid(m.x), y)
    });
    polygons
}

/// Turns a polygon by `degrees` about `center`.
fn rotate(polygon: &[Point], degrees: f64, center: Point) -> Vec<Point> {
    let (sin, cos) = degrees.to_radians().sin_cos();
    polygon
        .iter()
        .map(|q| {
            let (dx, dy) = (q.x - center.x, q.y - center.y);
            p(
                center.x + dx * cos - dy * sin,
                center.y + dx * sin + dy * cos,
            )
        })
        .collect()
}

/// A regular polygon with `sides` corners at `radius` from `center`, the
/// first at `start` degrees.
fn regular(sides: u32, radius: f64, center: Point, start: f64) -> Vec<Point> {
    (0..sides)
        .map(|k| {
            let angle = (start + 360.0 * f64::from(k) / f64::from(sides)).to_radians();
            p(
                center.x + radius * angle.cos(),
                center.y + radius * angle.sin(),
            )
        })
        .collect()
}

/// The unit equilateral triangle standing outward on edge `k` of a convex
/// polygon.
fn triangle_on_edge(polygon: &[Point], k: usize) -> Vec<Point> {
    let (a, b) = (polygon[k], polygon[(k + 1) % polygon.len()]);
    let c = vertex_mean(polygon);
    let mid = p(f64::midpoint(a.x, b.x), f64::midpoint(a.y, b.y));
    let (nx, ny) = (mid.x - c.x, mid.y - c.y);
    let height = 3f64.sqrt() / 2.0 * a.distance(b) / nx.hypot(ny);
    vec![a, b, p(mid.x + nx * height, mid.y + ny * height)]
}

/// One copy of every polygon in a periodic tiling, for the period rectangle.
///
/// The tiling repeats `motif` along the lattice vectors `a` and `b`, which may
/// be oblique. `period` must be a rectangle of lattice vectors. Of all the
/// translated copies, those whose vertex mean falls inside the rectangle are
/// kept, once each, so the motif may list a polygon more than once.
fn lattice_patch(motif: &[Vec<Point>], a: Point, b: Point, period: Point) -> Vec<Vec<Point>> {
    // Nudges means that sit exactly on the rectangle's edge to one side.
    const NUDGE: f64 = 1e-6;
    let mut kept: Vec<Vec<Point>> = Vec::new();
    for i in -8..=8 {
        for j in -8..=8 {
            let (dx, dy) = (
                f64::from(i) * a.x + f64::from(j) * b.x,
                f64::from(i) * a.y + f64::from(j) * b.y,
            );
            for polygon in motif {
                let copy = translate(polygon, dx, dy);
                let m = vertex_mean(&copy);
                let inside = (0.0..period.x).contains(&(m.x + NUDGE))
                    && (0.0..period.y).contains(&(m.y + NUDGE));
                if inside && !kept.iter().any(|k| vertex_mean(k).distance(m) < NUDGE) {
                    kept.push(copy);
                }
            }
        }
    }
    kept
}

/// Orders polygons into `rows` logical rows, top to bottom, each left to right.
fn rows_of(mut polygons: Vec<Vec<Point>>, rows: usize, ties: Ties) -> Vec<Vec<Point>> {
    polygons.sort_by(|a, b| vertex_mean(a).y.total_cmp(&vertex_mean(b).y));
    let per_row = polygons.len() / rows;
    polygons
        .chunks(per_row)
        .flat_map(|row| by_x(row.to_vec(), ties))
        .collect()
}

/// Pointy-top hexagons one unit wide, two per period, the second shifted half
/// a hexagon right.
struct HexLattice {
    radius: f64,
}

impl HexLattice {
    fn new() -> Self {
        Self {
            radius: 1.0 / 3f64.sqrt(),
        }
    }

    fn period(&self) -> Point {
        p(1.0, 3.0 * self.radius)
    }

    fn centers(&self) -> [Point; 2] {
        [p(0.5, self.radius), p(1.0, 2.5 * self.radius)]
    }

    /// Corners clockwise from the top, since y points down.
    fn corners(&self, c: Point) -> [Point; 6] {
        std::array::from_fn(|k| {
            let angle = (-90.0 + 60.0 * k as f64).to_radians();
            p(
                c.x + self.radius * angle.cos(),
                c.y + self.radius * angle.sin(),
            )
        })
    }
}

fn square() -> Tiling {
    let cell = vec![p(0.0, 0.0), p(1.0, 0.0), p(1.0, 1.0), p(0.0, 1.0)];
    Tiling::new(TilingId::Square, p(1.0, 1.0), 1, 1, vec![cell])
}

/// Rows of unit squares, each shifted half a square from the one above.
fn offset_square() -> Tiling {
    let slots = vec![rect(0.0, 0.0, 1.0, 1.0), rect(0.5, 1.0, 1.5, 2.0)];
    Tiling::new(TilingId::OffsetSquare, p(1.0, 2.0), 1, 2, slots)
}

/// Two-by-one bricks in a herringbone, turned 45 degrees so the zigzag runs
/// across the board.
///
/// Unturned, a horizontal brick on `[0, 2] x [0, 1]` and a vertical one on
/// `[2, 3] x [-1, 1]` repeat along `(1, 1)` and `(2, -2)`. The turn maps that
/// lattice onto a rectangle of `sqrt 2` by `2 sqrt 2`.
fn herringbone() -> Tiling {
    let s2 = std::f64::consts::SQRT_2;
    let horizontal = rotate_45(&rect(0.0, 0.0, 2.0, 1.0));
    let vertical = rotate_45(&rect(2.0, -1.0, 3.0, 1.0));
    let slots = vec![
        translate(&vertical, -s2, 2.0 * s2),
        translate(&horizontal, 0.0, 2.0 * s2),
    ];
    Tiling::new(TilingId::Herringbone, p(s2, 2.0 * s2), 1, 2, slots)
}

/// Two-by-one bricks in pinwheels of four, each brick's end against the side
/// of the next, turned 45 degrees.
///
/// Unturned, the pinwheel repeats along `(2, 2)` and `(2, -2)`, which the turn
/// maps onto a square of side `2 sqrt 2`.
fn pinwheel() -> Tiling {
    let s2 = std::f64::consts::SQRT_2;
    let brick = |x0, y0, x1, y1| translate(&rotate_45(&rect(x0, y0, x1, y1)), s2, s2);
    let slots = vec![
        brick(0.0, -2.0, 1.0, 0.0),
        brick(0.0, 0.0, 2.0, 1.0),
        brick(-2.0, -1.0, 0.0, 0.0),
        brick(-1.0, 0.0, 0.0, 2.0),
    ];
    Tiling::new(TilingId::Pinwheel, p(2.0 * s2, 2.0 * s2), 2, 2, slots)
}

/// Kites with angles of 120, 90, 60, and 90 degrees, six to a hexagon. Each
/// kite runs from the hexagon's center through two edge midpoints to a corner.
fn kite() -> Tiling {
    let lattice = HexLattice::new();
    let mut slots = Vec::with_capacity(12);
    for c in lattice.centers() {
        let v = lattice.corners(c);
        let mid = |k: usize| {
            let (a, b) = (v[k % 6], v[(k + 1) % 6]);
            p(f64::midpoint(a.x, b.x), f64::midpoint(a.y, b.y))
        };
        let around = |k: usize| vec![c, mid(k + 5), v[k], mid(k)];
        // The upper three kites fill one logical row, the lower three the next.
        slots.extend(by_x(vec![around(5), around(0), around(1)], Ties::TopFirst));
        slots.extend(by_x(vec![around(4), around(3), around(2)], Ties::TopFirst));
    }
    Tiling::new(TilingId::Kite, lattice.period(), 3, 4, slots)
}

/// Trapezoids made of three unit triangles, in rows that alternate pointing
/// up and down.
fn trapezoid() -> Tiling {
    let h = 3f64.sqrt() / 2.0;
    let slots = vec![
        vec![p(0.0, h), p(0.5, 0.0), p(1.5, 0.0), p(2.0, h)],
        vec![p(1.5, 0.0), p(3.5, 0.0), p(3.0, h), p(2.0, h)],
    ];
    Tiling::new(TilingId::Trapezoid, p(3.0, h), 2, 1, slots)
}

/// Trapezoids in threes, each set turning around the middle of an
/// equilateral triangle three units wide.
fn trapezoid_triangle() -> Tiling {
    let h = 3f64.sqrt() / 2.0;
    let center = p(1.5, 2.0 * h);
    let first = vec![
        p(0.0, 3.0 * h),
        p(2.0, 3.0 * h),
        p(1.5, 2.0 * h),
        p(0.5, 2.0 * h),
    ];
    let up: Vec<Vec<Point>> = [0.0, 120.0, 240.0]
        .iter()
        .map(|&angle| rotate(&first, angle, center))
        .collect();
    // The downward triangle beside it is the same set turned half a circle
    // about the middle of their shared edge.
    let shared = p(2.25, 1.5 * h);
    let down = up.iter().map(|t| rotate(t, 180.0, shared));
    let motif: Vec<Vec<Point>> = up.iter().cloned().chain(down).collect();
    let period = p(3.0, 6.0 * h);
    let slots = rows_of(
        lattice_patch(&motif, p(3.0, 0.0), p(1.5, 3.0 * h), period),
        4,
        Ties::TopFirst,
    );
    Tiling::new(TilingId::TrapezoidTriangle, period, 3, 4, slots)
}

/// Trapezoids in eights: hexagons two units on a side, each a ring of six
/// trapezoids around a unit hexagon cut in half.
fn trapezoid_hexagon() -> Tiling {
    let outer = regular(6, 2.0, p(0.0, 0.0), -90.0);
    let inner = regular(6, 1.0, p(0.0, 0.0), -90.0);
    let mut motif: Vec<Vec<Point>> = (0..6)
        .map(|k| vec![outer[k], outer[(k + 1) % 6], inner[(k + 1) % 6], inner[k]])
        .collect();
    motif.push(vec![inner[0], inner[1], inner[2], inner[3]]);
    motif.push(vec![inner[3], inner[4], inner[5], inner[0]]);
    let s3 = 3f64.sqrt();
    let period = p(2.0 * s3, 6.0);
    let slots = rows_of(
        lattice_patch(&motif, p(2.0 * s3, 0.0), p(s3, 3.0), period),
        4,
        Ties::TopFirst,
    );
    Tiling::new(TilingId::TrapezoidHexagon, period, 4, 4, slots)
}

/// Pointy-top hexagons, one unit wide. Odd rows shift half a cell right.
fn hexagon() -> Tiling {
    let lattice = HexLattice::new();
    let slots = lattice
        .centers()
        .iter()
        .map(|&c| lattice.corners(c).to_vec())
        .collect();
    Tiling::new(TilingId::Hexagon, lattice.period(), 1, 2, slots)
}

/// Equilateral triangles with unit sides, alternating up and down.
fn triangle() -> Tiling {
    let h = 3f64.sqrt() / 2.0;
    let slots = vec![
        vec![p(0.0, h), p(0.5, 0.0), p(1.0, h)],
        vec![p(0.5, 0.0), p(1.5, 0.0), p(1.0, h)],
        vec![p(0.0, h), p(1.0, h), p(0.5, 2.0 * h)],
        vec![p(1.0, h), p(1.5, 2.0 * h), p(0.5, 2.0 * h)],
    ];
    Tiling::new(TilingId::Triangle, p(1.0, 2.0 * h), 2, 2, slots)
}

/// Rows of equilateral triangles stacked without flipping, so each row's
/// corners meet the middle of the edges above and below.
fn offset_triangle() -> Tiling {
    let h = 3f64.sqrt() / 2.0;
    let slots = vec![
        vec![p(0.0, h), p(0.5, 0.0), p(1.0, h)],
        vec![p(0.5, 0.0), p(1.5, 0.0), p(1.0, h)],
    ];
    Tiling::new(TilingId::OffsetTriangle, p(1.0, h), 2, 1, slots)
}

/// Triangles with angles of 45, 90, and 45 degrees: squares cut along both
/// diagonals. Each logical row and column holds one diagonal half of a square.
fn right_triangle() -> Tiling {
    let c = p(1.0, 1.0);
    let (nw, ne, se, sw) = (p(0.0, 0.0), p(2.0, 0.0), p(2.0, 2.0), p(0.0, 2.0));
    let slots = vec![
        vec![sw, nw, c],
        vec![nw, ne, c],
        vec![se, sw, c],
        vec![ne, se, c],
    ];
    Tiling::new(TilingId::RightTriangle, p(2.0, 2.0), 2, 2, slots)
}

/// Triangles with angles of 30, 30, and 120 degrees: rows of 120-degree
/// rhombuses, each cut along its long diagonal.
///
/// Cutting equilateral triangles into three from their centers gives the same
/// shape, but then every triangle has a twin across its long edge with exactly
/// the same neighbors.
fn obtuse_triangle() -> Tiling {
    let h = 3f64.sqrt() / 2.0;
    let halves = |x: f64, y: f64| {
        let (a, b) = (p(x, y), p(x + 1.0, y));
        let (c, d) = (p(x + 1.5, y + h), p(x + 0.5, y + h));
        by_x(vec![vec![a, b, c], vec![a, c, d]], Ties::TopFirst)
    };
    let slots = [halves(0.0, 0.0), halves(0.5, h)].concat();
    Tiling::new(TilingId::ObtuseTriangle, p(1.0, 2.0 * h), 2, 2, slots)
}

/// Cairo pentagonal tiling with angles of 120, 120, 90, 120, and 90 degrees.
///
/// Built on a checkerboard of unit squares. Each square holds a short segment
/// through its center, horizontal on even squares and vertical on odd ones, with
/// its ends joined to the nearest corners. That cuts each square into two
/// trapezoids and two triangles. Every grid edge gets one pentagon: the
/// trapezoid on one side of the edge plus the triangle on the other.
fn cairo() -> Tiling {
    // Half the segment length that makes the three non-right angles 120 degrees.
    let t = 0.5 - 1.0 / (2.0 * 3f64.sqrt());
    let horizontal_segment = |sx: i32, sy: i32| (sx + sy).rem_euclid(2) == 0;

    // Pentagon on the top edge of square (sx, sy): the horizontal edge at y = sy.
    let top_edge = |sx: i32, sy: i32| -> Vec<Point> {
        let (x, y) = (f64::from(sx), f64::from(sy));
        if horizontal_segment(sx, sy) {
            // Trapezoid from this square, triangle from the square above.
            vec![
                p(x, y),
                p(x + 0.5, y - 0.5 + t),
                p(x + 1.0, y),
                p(x + 0.5 + t, y + 0.5),
                p(x + 0.5 - t, y + 0.5),
            ]
        } else {
            // Trapezoid from the square above, triangle from this square.
            vec![
                p(x, y),
                p(x + 0.5 - t, y - 0.5),
                p(x + 0.5 + t, y - 0.5),
                p(x + 1.0, y),
                p(x + 0.5, y + 0.5 - t),
            ]
        }
    };
    // Pentagon on the left edge of square (sx, sy): the vertical edge at x = sx.
    let left_edge = |sx: i32, sy: i32| -> Vec<Point> {
        let (x, y) = (f64::from(sx), f64::from(sy));
        if horizontal_segment(sx, sy) {
            // Triangle from this square, trapezoid from the square on the left.
            vec![
                p(x, y),
                p(x + 0.5 - t, y + 0.5),
                p(x, y + 1.0),
                p(x - 0.5, y + 0.5 + t),
                p(x - 0.5, y + 0.5 - t),
            ]
        } else {
            // Trapezoid from this square, triangle from the square on the left.
            vec![
                p(x, y),
                p(x + 0.5, y + 0.5 - t),
                p(x + 0.5, y + 0.5 + t),
                p(x, y + 1.0),
                p(x - 0.5 + t, y + 0.5),
            ]
        }
    };

    // Logical columns alternate the left-edge and top-edge pentagons of each square.
    let mut slots = Vec::with_capacity(8);
    for sy in 0..2 {
        for sx in 0..2 {
            slots.push(left_edge(sx, sy));
            slots.push(top_edge(sx, sy));
        }
    }
    Tiling::new(TilingId::Cairo, p(2.0, 2.0), 4, 2, slots)
}

/// Unit squares and triangles with three triangles and two squares at every
/// corner (3.3.4.3.4).
///
/// Squares sit on a square lattice in two orientations, 30 degrees apart, with
/// a triangle standing on every square edge.
fn snub_square() -> Tiling {
    let side = (1.0 + 3f64.sqrt()) / std::f64::consts::SQRT_2;
    let radius = std::f64::consts::FRAC_1_SQRT_2;
    let squares = [
        regular(4, radius, p(0.0, 0.0), 30.0),
        regular(4, radius, p(side / 2.0, side / 2.0), 60.0),
    ];
    let mut motif = squares.to_vec();
    for square in &squares {
        motif.extend((0..4).map(|k| triangle_on_edge(square, k)));
    }
    let period = p(side, side);
    let slots = rows_of(
        lattice_patch(&motif, p(side, 0.0), p(0.0, side), period),
        3,
        Ties::TopFirst,
    );
    Tiling::new(TilingId::SnubSquare, period, 2, 3, slots)
}

/// Rows of unit squares between rows of triangles, each square row shifted
/// half a square from the last (3.3.3.4.4).
fn square_triangle() -> Tiling {
    let h = 3f64.sqrt() / 2.0;
    let motif = [
        rect(0.0, 0.0, 1.0, 1.0),
        vec![p(0.0, 1.0), p(1.0, 1.0), p(0.5, 1.0 + h)],
        vec![p(1.0, 1.0), p(1.5, 1.0 + h), p(0.5, 1.0 + h)],
    ];
    let period = p(1.0, 2.0 * (1.0 + h));
    let slots = rows_of(
        lattice_patch(&motif, p(1.0, 0.0), p(0.5, 1.0 + h), period),
        3,
        Ties::TopFirst,
    );
    Tiling::new(TilingId::SquareTriangle, period, 2, 3, slots)
}

/// Unit hexagons joined by squares, with triangles in the gaps (3.4.6.4).
fn square_triangle_hexagon() -> Tiling {
    let hexagon = regular(6, 1.0, p(0.0, 0.0), 30.0);
    let mut motif = vec![hexagon.clone()];
    for k in 0..6 {
        let (a, b) = (hexagon[k], hexagon[(k + 1) % 6]);
        let (dx, dy) = (b.y - a.y, a.x - b.x);
        // Outward is away from the hexagon's center at the origin.
        let sign = if dx * (a.x + b.x) + dy * (a.y + b.y) > 0.0 {
            1.0
        } else {
            -1.0
        };
        let square = vec![
            a,
            b,
            p(b.x + sign * dx, b.y + sign * dy),
            p(a.x + sign * dx, a.y + sign * dy),
        ];
        motif.push(triangle_on_edge(&square, 1));
        motif.push(triangle_on_edge(&square, 3));
        motif.push(square);
    }
    let d = 1.0 + 3f64.sqrt();
    let period = p(d, d * 3f64.sqrt());
    let a = p(d, 0.0);
    let b = p(d / 2.0, d * 3f64.sqrt() / 2.0);
    // Each square here shares a row with the triangle below it, at the same x.
    // The triangle comes first so saved games and seeds keep their boards.
    let slots = rows_of(lattice_patch(&motif, a, b, period), 4, Ties::BottomFirst);
    Tiling::new(TilingId::SquareTriangleHexagon, period, 3, 4, slots)
}

/// Pentagons with one 60-degree corner and four of 120 degrees, six to a
/// flower around their sharp corners (pentagon type 5).
///
/// Each pentagon has sides 2, 1, 1, 1, and 2. The flowers sit on a triangular
/// lattice of spacing `sqrt 21`, turned `atan(sqrt 3 / 5)` from the flower's
/// own axes. Turning the flowers back instead makes one lattice vector
/// horizontal, so two flowers fill a rectangular period.
fn floret() -> Tiling {
    let s3 = 3f64.sqrt();
    let petal = vec![
        p(0.0, 0.0),
        p(s3, -1.0),
        p(1.5 * s3, -0.5),
        p(1.5 * s3, 0.5),
        p(s3, 1.0),
    ];
    let turn = (s3 / 5.0).atan().to_degrees();
    let motif: Vec<Vec<Point>> = (0..6)
        .map(|k| rotate(&petal, 60.0 * f64::from(k) - turn, p(0.0, 0.0)))
        .collect();
    let d = 21f64.sqrt();
    let period = p(d, d * s3);
    let slots = rows_of(
        lattice_patch(&motif, p(d, 0.0), p(d / 2.0, d * s3 / 2.0), period),
        4,
        Ties::TopFirst,
    );
    Tiling::new(TilingId::Floret, period, 3, 4, slots)
}
