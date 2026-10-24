//! Plane geometry for cell polygons.

use serde::{Deserialize, Serialize};

/// Distance below which two points or a point and an edge count as touching.
pub const EPSILON: f64 = 1e-6;

/// A point or vector in board space. The y axis points down, matching screen space.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize, specta::Type)]
pub struct Point {
    #[specta(type = crate::Finite)]
    pub x: f64,
    #[specta(type = crate::Finite)]
    pub y: f64,
}

impl Point {
    pub const fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }

    #[must_use]
    pub fn translate(self, dx: f64, dy: f64) -> Self {
        Self::new(self.x + dx, self.y + dy)
    }

    pub fn distance(self, other: Self) -> f64 {
        (self.x - other.x).hypot(self.y - other.y)
    }
}

/// Axis-aligned bounding box.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Bounds {
    #[specta(type = crate::Finite)]
    pub min_x: f64,
    #[specta(type = crate::Finite)]
    pub min_y: f64,
    #[specta(type = crate::Finite)]
    pub max_x: f64,
    #[specta(type = crate::Finite)]
    pub max_y: f64,
}

impl Bounds {
    pub fn of(points: &[Point]) -> Self {
        points.iter().fold(Self::EMPTY, |b, p| b.include(*p))
    }

    pub const EMPTY: Self = Self {
        min_x: f64::INFINITY,
        min_y: f64::INFINITY,
        max_x: f64::NEG_INFINITY,
        max_y: f64::NEG_INFINITY,
    };

    #[must_use]
    pub fn include(self, p: Point) -> Self {
        Self {
            min_x: self.min_x.min(p.x),
            min_y: self.min_y.min(p.y),
            max_x: self.max_x.max(p.x),
            max_y: self.max_y.max(p.y),
        }
    }

    #[must_use]
    pub fn union(self, other: Self) -> Self {
        Self {
            min_x: self.min_x.min(other.min_x),
            min_y: self.min_y.min(other.min_y),
            max_x: self.max_x.max(other.max_x),
            max_y: self.max_y.max(other.max_y),
        }
    }

    pub fn width(&self) -> f64 {
        self.max_x - self.min_x
    }

    pub fn height(&self) -> f64 {
        self.max_y - self.min_y
    }

    /// True when the boxes overlap or lie within `margin` of each other.
    pub fn near(&self, other: &Self, margin: f64) -> bool {
        self.min_x <= other.max_x + margin
            && other.min_x <= self.max_x + margin
            && self.min_y <= other.max_y + margin
            && other.min_y <= self.max_y + margin
    }
}

/// Unsigned polygon area (shoelace formula).
pub fn area(polygon: &[Point]) -> f64 {
    let n = polygon.len();
    let twice: f64 = (0..n)
        .map(|i| {
            let (a, b) = (polygon[i], polygon[(i + 1) % n]);
            a.x * b.y - b.x * a.y
        })
        .sum();
    twice.abs() / 2.0
}

/// Area centroid of a simple polygon.
pub fn centroid(polygon: &[Point]) -> Point {
    let n = polygon.len();
    let (mut cx, mut cy, mut twice_area) = (0.0, 0.0, 0.0);
    for i in 0..n {
        let (a, b) = (polygon[i], polygon[(i + 1) % n]);
        let cross = a.x * b.y - b.x * a.y;
        twice_area += cross;
        cx += (a.x + b.x) * cross;
        cy += (a.y + b.y) * cross;
    }
    Point::new(cx / (3.0 * twice_area), cy / (3.0 * twice_area))
}

/// Even-odd point-in-polygon test. Points exactly on an edge may land either way.
pub fn contains(polygon: &[Point], p: Point) -> bool {
    let n = polygon.len();
    let mut inside = false;
    let mut j = n - 1;
    for i in 0..n {
        let (a, b) = (polygon[i], polygon[j]);
        if (a.y > p.y) != (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x {
            inside = !inside;
        }
        j = i;
    }
    inside
}

/// Shortest distance from `p` to the segment `a`-`b`.
pub fn distance_to_segment(p: Point, a: Point, b: Point) -> f64 {
    let (dx, dy) = (b.x - a.x, b.y - a.y);
    let len_sq = dx * dx + dy * dy;
    if len_sq == 0.0 {
        return p.distance(a);
    }
    let t = (((p.x - a.x) * dx + (p.y - a.y) * dy) / len_sq).clamp(0.0, 1.0);
    p.distance(Point::new(a.x + t * dx, a.y + t * dy))
}

/// True when two polygons share at least one boundary point: an edge, a corner,
/// or a corner lying on the other polygon's edge.
pub fn touches(a: &[Point], b: &[Point]) -> bool {
    vertex_on_boundary(a, b) || vertex_on_boundary(b, a)
}

fn vertex_on_boundary(vertices: &[Point], polygon: &[Point]) -> bool {
    let n = polygon.len();
    vertices.iter().any(|&v| {
        (0..n).any(|i| distance_to_segment(v, polygon[i], polygon[(i + 1) % n]) < EPSILON)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unit_square() -> Vec<Point> {
        vec![
            Point::new(0.0, 0.0),
            Point::new(1.0, 0.0),
            Point::new(1.0, 1.0),
            Point::new(0.0, 1.0),
        ]
    }

    #[test]
    fn area_and_centroid_of_unit_square() {
        let sq = unit_square();
        assert!((area(&sq) - 1.0).abs() < EPSILON);
        assert!(centroid(&sq).distance(Point::new(0.5, 0.5)) < EPSILON);
    }

    #[test]
    fn contains_inside_and_outside_points() {
        let sq = unit_square();
        assert!(contains(&sq, Point::new(0.5, 0.5)));
        assert!(!contains(&sq, Point::new(1.5, 0.5)));
    }

    #[test]
    fn squares_touch_at_edge_and_corner_but_not_apart() {
        let sq = unit_square();
        let shifted = |dx, dy| sq.iter().map(|p| p.translate(dx, dy)).collect::<Vec<_>>();
        assert!(touches(&sq, &shifted(1.0, 0.0)));
        assert!(touches(&sq, &shifted(1.0, 1.0)));
        assert!(!touches(&sq, &shifted(2.0, 0.0)));
    }

    #[test]
    fn corner_on_edge_counts_as_touching() {
        let sq = unit_square();
        let brick: Vec<_> = sq.iter().map(|p| p.translate(0.5, 1.0)).collect();
        assert!(touches(&sq, &brick));
    }
}
