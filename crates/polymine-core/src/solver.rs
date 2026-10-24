//! The assistant: certain moves first, then the safest guess.
//!
//! The solver sees only what a player sees: open numbers, the total mine
//! count, and whether the placement kept mines off twin cells, which the rules
//! decide from the board, the first click, and the mine count. Marks are
//! ignored because players can place them wrongly.
//!
//! 1. Local deduction settles cells that a single number, or one number nested
//!    inside another, forces.
//! 2. The remaining frontier (closed cells next to numbers) splits into regions
//!    that share no numbers. Each region is enumerated exactly, counting
//!    solutions by how many mines they use.
//! 3. Regions are combined with the closed cells away from any number, weighted
//!    by the number of ways to place the leftover mines there. That gives exact
//!    probabilities and, from the solution supports, exact certainties.
//!
//! A region too large to enumerate within budget is treated as unconstrained.
//! That only widens the solution set, so certainties stay sound; its
//! probabilities become estimates and [`Analysis::exact`] turns false. The
//! budget covers one whole call, so a large board costs bounded time.

use std::collections::{HashMap, VecDeque};
use std::ops::Range;

use serde::{Deserialize, Serialize};

use crate::board::{Board, CellId};
use crate::game::{Game, Mark};

/// Regions with more cells than this skip enumeration.
const MAX_REGION_CELLS: usize = 64;
/// Search nodes one region may use before it counts as too large.
const REGION_NODE_BUDGET: u64 = 2_000_000;
/// Search nodes one [`analyze`] call may use across all of its regions.
const CALL_NODE_BUDGET: u64 = 2 * REGION_NODE_BUDGET;
/// Probabilities closer than this count as a tie.
const TIE: f64 = 1e-9;

#[derive(Clone, Debug, PartialEq)]
pub struct Analysis {
    /// Mine probability per cell. `None` for open cells.
    pub probabilities: Vec<Option<f64>>,
    /// Closed cells that cannot hold a mine.
    pub safe: Vec<CellId>,
    /// Closed cells that must hold a mine.
    pub mines: Vec<CellId>,
    /// False when some region was too large for the search budget, so its
    /// odds are estimates.
    pub exact: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum Action {
    Open,
    Flag,
    /// Remove a flag from a cell that is certainly safe or, when every
    /// uncertain cell is flagged, from the one least likely to hold a mine.
    Unflag,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Suggestion {
    pub action: Action,
    pub cell: CellId,
    /// True when the move follows from the numbers; false for a best guess.
    pub certain: bool,
    /// Chance that the cell holds a mine.
    #[specta(type = crate::Finite)]
    pub mine_probability: f64,
    /// False when `mine_probability` is an estimate, because part of the
    /// board was too large to work out exactly. Certain moves are exact.
    pub exact: bool,
}

/// The assistant's next move, or `None` once the game is over.
pub fn suggest(game: &Game) -> Option<Suggestion> {
    if game.status().is_over() {
        return None;
    }
    let board = game.board();
    if !game.mines_placed() {
        // The rules keep the first open safe.
        let cell = board.center_cell();
        return Some(Suggestion {
            action: Action::Open,
            cell,
            certain: true,
            mine_probability: 0.0,
            exact: true,
        });
    }
    let analysis = analyze(
        board,
        &game.knowledge(),
        game.config().mines,
        game.twins_clear(),
    );
    choose(game, &analysis)
}

/// The best move given what `analysis` says about a game with mines placed.
fn choose(game: &Game, analysis: &Analysis) -> Option<Suggestion> {
    let board = game.board();
    let mark = |cell: CellId| game.mark_of(cell);
    let probability = |cell: CellId| analysis.probabilities[cell.index()].unwrap_or(0.0);

    if let Some(&cell) = analysis.safe.iter().find(|&&c| mark(c) == Mark::Flag) {
        return Some(Suggestion {
            action: Action::Unflag,
            cell,
            certain: true,
            mine_probability: 0.0,
            exact: true,
        });
    }
    if let Some(&cell) = analysis.safe.first() {
        return Some(Suggestion {
            action: Action::Open,
            cell,
            certain: true,
            mine_probability: 0.0,
            exact: true,
        });
    }
    if let Some(&cell) = analysis.mines.iter().find(|&&c| mark(c) != Mark::Flag) {
        return Some(Suggestion {
            action: Action::Flag,
            cell,
            certain: true,
            mine_probability: 1.0,
            exact: true,
        });
    }
    let mut certain_mine = vec![false; board.len()];
    for cell in &analysis.mines {
        certain_mine[cell.index()] = true;
    }
    // The safest uncertain cell, among the unflagged or the flagged ones.
    let safest = |flagged: bool| {
        board
            .cells()
            .filter(|&c| analysis.probabilities[c.index()].is_some() && !certain_mine[c.index()])
            .filter(|&c| (mark(c) == Mark::Flag) == flagged)
            .min_by(|&a, &b| {
                let (pa, pb) = (probability(a), probability(b));
                if (pa - pb).abs() < TIE {
                    a.cmp(&b)
                } else {
                    pa.total_cmp(&pb)
                }
            })
    };
    let (action, cell) = match safest(false) {
        Some(cell) => (Action::Open, cell),
        None => (Action::Unflag, safest(true)?),
    };
    Some(Suggestion {
        action,
        cell,
        certain: false,
        mine_probability: probability(cell),
        exact: analysis.exact,
    })
}

/// Works out what the open numbers imply about every closed cell.
///
/// `knowledge` holds `Some(number)` for open cells and `None` for closed ones.
/// `twins_clear` says the placement kept mines off every twin cell, as
/// [`Game::twins_clear`] reports.
///
/// # Panics
///
/// When `knowledge` has fewer entries than `board` has cells.
pub fn analyze(
    board: &Board,
    knowledge: &[Option<u8>],
    total_mines: u32,
    twins_clear: bool,
) -> Analysis {
    let mut known: Vec<Option<bool>> = vec![None; board.len()];
    if twins_clear {
        let closed_twins = board
            .cells()
            .filter(|&c| board.is_twin(c) && knowledge[c.index()].is_none());
        for cell in closed_twins {
            known[cell.index()] = Some(false);
        }
    }
    let reduced = deduce_locally(&constraints(board, knowledge), &mut known);

    let deduced_mines = known.iter().filter(|k| **k == Some(true)).count() as u32;
    let mines_left = total_mines.saturating_sub(deduced_mines) as usize;

    let regions = split_regions(&reduced, board.len());
    // Small regions go first, so a huge one cannot use up the budget they need.
    let mut order: Vec<usize> = (0..regions.len()).collect();
    order.sort_by_key(|&i| regions[i].0.len());
    let mut budget = CALL_NODE_BUDGET;
    let mut enumerated: Vec<Option<Region>> = regions.iter().map(|_| None).collect();
    for i in order {
        let (cells, cons) = &regions[i];
        enumerated[i] = Region::enumerate(cells, cons, mines_left, &mut budget);
    }

    let in_exact_region: Vec<bool> = {
        let mut flags = vec![false; board.len()];
        for region in enumerated.iter().flatten() {
            for cell in &region.cells {
                flags[cell.index()] = true;
            }
        }
        flags
    };
    // Every undecided closed cell outside an enumerated region counts as free.
    let free: Vec<CellId> = board
        .cells()
        .filter(|c| knowledge[c.index()].is_none() && known[c.index()].is_none())
        .filter(|c| !in_exact_region[c.index()])
        .collect();

    let exact_regions: Vec<&Region> = enumerated.iter().flatten().collect();
    let combined = Combination::new(&exact_regions, free.len(), mines_left);
    let (region_weights, free_odds) = combined.weigh();

    let mut probabilities: Vec<Option<f64>> = vec![None; board.len()];
    let mut safe = Vec::new();
    let mut mines = Vec::new();
    for cell in board.cells().filter(|c| knowledge[c.index()].is_none()) {
        match known[cell.index()] {
            Some(true) => {
                probabilities[cell.index()] = Some(1.0);
                mines.push(cell);
            }
            Some(false) => {
                probabilities[cell.index()] = Some(0.0);
                safe.push(cell);
            }
            None => {}
        }
    }
    for (region, weights) in exact_regions.iter().zip(&region_weights) {
        let scales = scales(weights);
        for (var, &cell) in region.cells.iter().enumerate() {
            probabilities[cell.index()] = Some(region.probability(var, &scales));
            if region.never_mine(var, weights) {
                safe.push(cell);
            } else if region.always_mine(var, weights) {
                mines.push(cell);
            }
        }
    }
    for &cell in &free {
        probabilities[cell.index()] = Some(free_odds.probability);
        if free_odds.safe {
            safe.push(cell);
        } else if free_odds.mine {
            mines.push(cell);
        }
    }
    safe.sort_unstable();
    mines.sort_unstable();
    Analysis {
        probabilities,
        safe,
        mines,
        exact: enumerated.iter().all(Option::is_some),
    }
}

/// A number and the closed cells around it.
#[derive(Clone, Debug)]
struct Constraint {
    cells: Vec<CellId>,
    mines: usize,
}

fn constraints(board: &Board, knowledge: &[Option<u8>]) -> Vec<Constraint> {
    board
        .cells()
        .filter_map(|cell| {
            let number = knowledge[cell.index()]?;
            let cells: Vec<CellId> = board
                .neighbors(cell)
                .iter()
                .copied()
                .filter(|n| knowledge[n.index()].is_none())
                .collect();
            (!cells.is_empty()).then_some(Constraint {
                cells,
                mines: usize::from(number),
            })
        })
        .collect()
}

/// A constraint without its decided cells and with its mine count lowered to
/// match, or `None` when no cell is left.
fn reduce_one(c: &Constraint, known: &[Option<bool>]) -> Option<Constraint> {
    let found = c
        .cells
        .iter()
        .filter(|x| known[x.index()] == Some(true))
        .count();
    let cells: Vec<CellId> = c
        .cells
        .iter()
        .copied()
        .filter(|x| known[x.index()].is_none())
        .collect();
    (!cells.is_empty()).then(|| Constraint {
        cells,
        mines: c.mines.saturating_sub(found),
    })
}

/// Applies the single-number and nested-number rules until nothing changes,
/// then returns the constraints reduced by what they settled.
///
/// A worklist revisits only the numbers around newly decided cells. Every
/// deduction is sound and stays possible once enabled, so the order of the
/// work does not change the result.
fn deduce_locally(constraints: &[Constraint], known: &mut [Option<bool>]) -> Vec<Constraint> {
    // The constraints covering cell `c` are `covering[first[c]..first[c + 1]]`.
    let mut first = vec![0; known.len() + 1];
    for c in constraints {
        for cell in &c.cells {
            first[cell.index() + 1] += 1;
        }
    }
    for i in 0..known.len() {
        first[i + 1] += first[i];
    }
    let mut covering = vec![0; first[known.len()]];
    let mut next = first.clone();
    for (i, c) in constraints.iter().enumerate() {
        for cell in &c.cells {
            covering[next[cell.index()]] = i;
            next[cell.index()] += 1;
        }
    }
    let by_cell = |cell: &CellId| &covering[first[cell.index()]..first[cell.index() + 1]];
    let mut reduced: Vec<Option<Constraint>> =
        constraints.iter().map(|c| reduce_one(c, known)).collect();
    let mut queued = vec![true; constraints.len()];
    let mut queue: VecDeque<usize> = (0..constraints.len()).collect();
    let mut partners = Vec::new();
    while let Some(i) = queue.pop_front() {
        queued[i] = false;
        let Some(a) = &reduced[i] else {
            continue;
        };
        let mut decided = Vec::new();
        if a.mines == 0 || a.mines == a.cells.len() {
            decided.push((a.cells.clone(), a.mines > 0));
        } else {
            partners.clear();
            partners.extend(
                a.cells
                    .iter()
                    .flat_map(|cell| by_cell(cell).iter().copied())
                    .filter(|&j| j != i),
            );
            partners.sort_unstable();
            partners.dedup();
            for &j in &partners {
                if let Some(b) = &reduced[j] {
                    decided.extend(nested(a, b));
                    decided.extend(nested(b, a));
                }
            }
        }
        for (cells, mine) in decided {
            for cell in cells {
                if known[cell.index()].is_none() {
                    known[cell.index()] = Some(mine);
                    for &j in by_cell(&cell) {
                        reduced[j] = reduce_one(&constraints[j], known);
                        if !queued[j] {
                            queued[j] = true;
                            queue.push_back(j);
                        }
                    }
                }
            }
        }
    }
    reduced.into_iter().flatten().collect()
}

/// The nested rule: if `inner`'s cells all sit inside `outer`'s, the cells
/// only `outer` covers hold exactly its count minus `inner`'s. Returns those
/// cells and whether they are mines, when the counts force them.
fn nested(inner: &Constraint, outer: &Constraint) -> Option<(Vec<CellId>, bool)> {
    if outer.cells.len() <= inner.cells.len()
        || !inner.cells.iter().all(|x| outer.cells.contains(x))
    {
        return None;
    }
    let only_outer: Vec<CellId> = outer
        .cells
        .iter()
        .copied()
        .filter(|x| !inner.cells.contains(x))
        .collect();
    let extra = outer.mines.saturating_sub(inner.mines);
    if extra == 0 {
        Some((only_outer, false))
    } else if extra == only_outer.len() {
        Some((only_outer, true))
    } else {
        None
    }
}

/// Groups constraints into regions that share no cells with each other.
fn split_regions(
    constraints: &[Constraint],
    board_cells: usize,
) -> Vec<(Vec<CellId>, Vec<Constraint>)> {
    let mut by_cell: HashMap<CellId, Vec<usize>> = HashMap::new();
    for (i, c) in constraints.iter().enumerate() {
        for &cell in &c.cells {
            by_cell.entry(cell).or_default().push(i);
        }
    }
    let mut seen = vec![false; constraints.len()];
    let mut in_region = vec![false; board_cells];
    let mut regions = Vec::new();
    for start in 0..constraints.len() {
        if seen[start] {
            continue;
        }
        seen[start] = true;
        let mut queue = VecDeque::from([start]);
        let mut members = Vec::new();
        let mut cells = Vec::new();
        while let Some(i) = queue.pop_front() {
            members.push(constraints[i].clone());
            for cell in &constraints[i].cells {
                if !in_region[cell.index()] {
                    in_region[cell.index()] = true;
                    cells.push(*cell);
                }
                for &j in &by_cell[cell] {
                    if !seen[j] {
                        seen[j] = true;
                        queue.push_back(j);
                    }
                }
            }
        }
        regions.push((cells, members));
    }
    regions
}

/// Exact solution counts for one region.
#[derive(Debug)]
struct Region {
    cells: Vec<CellId>,
    /// `solutions[m]`: solutions that place `m` mines in the region.
    solutions: Vec<u64>,
    /// `mine_counts[m][v]`: of those, how many put a mine on cell `v`.
    mine_counts: Vec<Vec<u64>>,
}

impl Region {
    /// Enumerates every mine layout that satisfies the region's numbers.
    /// Returns `None` when the region is too large or `budget` runs out. The
    /// nodes it searched come off `budget` either way.
    fn enumerate(
        cells: &[CellId],
        constraints: &[Constraint],
        max_mines: usize,
        budget: &mut u64,
    ) -> Option<Self> {
        if cells.len() > MAX_REGION_CELLS {
            return None;
        }
        let index: HashMap<CellId, usize> =
            cells.iter().enumerate().map(|(i, &c)| (c, i)).collect();
        let cons: Vec<(Vec<usize>, usize)> = constraints
            .iter()
            .map(|c| (c.cells.iter().map(|x| index[x]).collect(), c.mines))
            .collect();
        let mut search = Search {
            touching: (0..cells.len())
                .map(|v| {
                    (0..cons.len())
                        .filter(|&ci| cons[ci].0.contains(&v))
                        .collect()
                })
                .collect(),
            placed: vec![0; cons.len()],
            open_slots: cons.iter().map(|c| c.0.len()).collect(),
            targets: cons.iter().map(|c| c.1).collect(),
            assignment: vec![false; cells.len()],
            mines: 0,
            max_mines,
            nodes: 0,
            node_limit: REGION_NODE_BUDGET.min(*budget),
            solutions: vec![0; cells.len() + 1],
            mine_counts: vec![vec![0; cells.len()]; cells.len() + 1],
        };
        let finished = search.run(0);
        *budget -= search.nodes.min(*budget);
        finished.then(|| Self {
            cells: cells.to_vec(),
            solutions: search.solutions,
            mine_counts: search.mine_counts,
        })
    }

    /// Mine probability of cell `var`. `scales[m]` weighs the layouts with
    /// `m` mines in the region.
    fn probability(&self, var: usize, scales: &[f64]) -> f64 {
        let (mut hit, mut total) = (0.0, 0.0);
        for (m, &scale) in scales.iter().enumerate() {
            hit += self.mine_counts[m][var] as f64 * scale;
            total += self.solutions[m] as f64 * scale;
        }
        if total > 0.0 { hit / total } else { 0.0 }
    }

    fn never_mine(&self, var: usize, weights: &[Option<f64>]) -> bool {
        every_feasible(weights, |m| self.mine_counts[m][var] == 0)
    }

    fn always_mine(&self, var: usize, weights: &[Option<f64>]) -> bool {
        every_feasible(weights, |m| self.mine_counts[m][var] == self.solutions[m])
    }
}

/// True when `test` holds for every mine count a region can take alongside
/// the rest of the board. False when it can take none, which only happens
/// when the knowledge contradicts itself.
fn every_feasible(weights: &[Option<f64>], test: impl Fn(usize) -> bool) -> bool {
    let mut feasible = (0..weights.len())
        .filter(|&m| weights[m].is_some())
        .peekable();
    feasible.peek().is_some() && feasible.all(test)
}

/// Turns log weights into factors with the largest at 1, so the likely mine
/// counts never underflow.
fn scales(weights: &[Option<f64>]) -> Vec<f64> {
    let peak = weights
        .iter()
        .flatten()
        .copied()
        .fold(f64::NEG_INFINITY, f64::max);
    weights
        .iter()
        .map(|w| w.map_or(0.0, |w| (w - peak).exp()))
        .collect()
}

/// Depth-first search state for [`Region::enumerate`].
struct Search {
    touching: Vec<Vec<usize>>,
    placed: Vec<usize>,
    open_slots: Vec<usize>,
    targets: Vec<usize>,
    assignment: Vec<bool>,
    mines: usize,
    max_mines: usize,
    nodes: u64,
    node_limit: u64,
    solutions: Vec<u64>,
    mine_counts: Vec<Vec<u64>>,
}

impl Search {
    /// Returns false when the node budget runs out.
    fn run(&mut self, var: usize) -> bool {
        self.nodes += 1;
        if self.nodes > self.node_limit {
            return false;
        }
        if var == self.assignment.len() {
            self.solutions[self.mines] += 1;
            for (v, &mine) in self.assignment.iter().enumerate() {
                if mine {
                    self.mine_counts[self.mines][v] += 1;
                }
            }
            return true;
        }
        for mine in [false, true] {
            if mine && self.mines == self.max_mines {
                continue;
            }
            if self.try_assign(var, mine) {
                let finished = self.run(var + 1);
                self.unassign(var, mine);
                if !finished {
                    return false;
                }
            } else {
                self.unassign(var, mine);
            }
        }
        true
    }

    /// Assigns `var` and reports whether every touched number can still be met.
    fn try_assign(&mut self, var: usize, mine: bool) -> bool {
        self.assignment[var] = mine;
        self.mines += usize::from(mine);
        let mut ok = true;
        for &c in &self.touching[var] {
            self.open_slots[c] -= 1;
            self.placed[c] += usize::from(mine);
            if self.placed[c] > self.targets[c]
                || self.placed[c] + self.open_slots[c] < self.targets[c]
            {
                ok = false;
            }
        }
        ok
    }

    fn unassign(&mut self, var: usize, mine: bool) {
        self.assignment[var] = false;
        self.mines -= usize::from(mine);
        for &c in &self.touching[var] {
            self.open_slots[c] += 1;
            self.placed[c] -= usize::from(mine);
        }
    }
}

/// Adds numbers held as natural logs without leaving log space, so a sum of
/// weights far below `f64::MIN_POSITIVE` keeps its size.
#[derive(Clone, Copy, Debug, Default)]
struct LogSum(Option<(f64, f64)>);

impl LogSum {
    fn add(&mut self, ln: f64) {
        self.0 = Some(match self.0 {
            None => (ln, 1.0),
            Some((max, sum)) if ln > max => (ln, sum * (max - ln).exp() + 1.0),
            Some((max, sum)) => (max, sum + (ln - max).exp()),
        });
    }

    /// The log of the sum, or `None` when nothing was added.
    fn ln(self) -> Option<f64> {
        self.0.map(|(max, sum)| max + sum.ln())
    }
}

/// Log weights by mine total over `window`. `None` marks a total that no
/// layout reaches. That comes from counting, never from the size of a float.
#[derive(Debug)]
struct Span {
    window: Range<usize>,
    ln: Vec<Option<f64>>,
}

impl Span {
    fn get(&self, total: usize) -> Option<f64> {
        if self.window.contains(&total) {
            self.ln[total - self.window.start]
        } else {
            None
        }
    }
}

/// Combines region solution counts with the free cells.
///
/// A layout weighs its regions' solution counts times the ways to put the
/// leftover mines on the free cells. On a large board those weights span far
/// more than an `f64` holds, so they stay in log space.
struct Combination {
    /// Per region, `(m, ln(solutions[m]))` for every mine count it can hold.
    regions: Vec<Vec<(usize, f64)>>,
    /// Length of each region's solution table.
    region_lens: Vec<usize>,
    /// `windows[r]`: totals of the regions before `r` that the later regions
    /// and the free cells can still complete. Never above `mines_left`.
    windows: Vec<Range<usize>>,
    free_cells: usize,
    mines_left: usize,
    ln_factorial: Vec<f64>,
}

impl Combination {
    fn new(regions: &[&Region], free_cells: usize, mines_left: usize) -> Self {
        let region_lens = regions.iter().map(|r| r.solutions.len()).collect();
        let regions: Vec<Vec<(usize, f64)>> = regions
            .iter()
            .map(|r| {
                (0..r.solutions.len())
                    .filter(|&m| r.solutions[m] > 0)
                    .map(|m| (m, (r.solutions[m] as f64).ln()))
                    .collect()
            })
            .collect();
        let bounds: Option<Vec<(usize, usize)>> = regions
            .iter()
            .map(|support| Some((support.first()?.0, support.last()?.0)))
            .collect();
        let windows = match bounds {
            Some(bounds) => windows(&bounds, free_cells, mines_left),
            // A region with no solution: the knowledge contradicts itself.
            None => vec![0..0; regions.len() + 1],
        };
        let mut ln_factorial = vec![0.0; free_cells + 1];
        for i in 1..=free_cells {
            ln_factorial[i] = ln_factorial[i - 1] + (i as f64).ln();
        }
        Self {
            regions,
            region_lens,
            windows,
            free_cells,
            mines_left,
            ln_factorial,
        }
    }

    /// Natural log of the ways to put `mines` mines on the free cells.
    fn ln_ways(&self, mines: usize) -> Option<f64> {
        let n = self.free_cells;
        (mines <= n)
            .then(|| self.ln_factorial[n] - self.ln_factorial[mines] - self.ln_factorial[n - mines])
    }

    /// Each region's log weight for every mine count `m`, from all the ways
    /// the other regions and the free cells complete it, plus the free cells'
    /// odds. `None` means that count cannot happen.
    ///
    /// One pass backward and one forward, so each region sees the others
    /// without convolving them again.
    fn weigh(&self) -> (Vec<Vec<Option<f64>>>, FreeOdds) {
        let count = self.regions.len();
        // `rest[r]`: by the total `s` of the regions before `r`, every way for
        // regions `r..` and the free cells to finish the board.
        let mut rest = Vec::with_capacity(count + 1);
        let end = self.windows[count].clone();
        rest.push(Span {
            ln: end
                .clone()
                .map(|s| self.ln_ways(self.mines_left - s))
                .collect(),
            window: end,
        });
        for r in (0..count).rev() {
            let later = &rest[rest.len() - 1];
            let ln = self.windows[r]
                .clone()
                .map(|s| {
                    let mut sum = LogSum::default();
                    for &(m, w) in &self.regions[r] {
                        if let Some(after) = later.get(s + m) {
                            sum.add(w + after);
                        }
                    }
                    sum.ln()
                })
                .collect();
            rest.push(Span {
                window: self.windows[r].clone(),
                ln,
            });
        }
        rest.reverse();

        // `before`: by total, the ways for the regions before `r` to hold it.
        let start = self.windows[0].clone();
        let mut before = Span {
            ln: start.clone().map(|a| (a == 0).then_some(0.0)).collect(),
            window: start,
        };
        let mut weights = Vec::with_capacity(count);
        for r in 0..count {
            let after = &rest[r + 1];
            let window = self.windows[r + 1].clone();
            let mut own = vec![LogSum::default(); self.region_lens[r]];
            let mut next = vec![LogSum::default(); window.len()];
            for a in before.window.clone() {
                let Some(b) = before.get(a) else { continue };
                for &(m, w) in &self.regions[r] {
                    if let Some(after) = after.get(a + m) {
                        own[m].add(b + after);
                    }
                    if window.contains(&(a + m)) {
                        next[a + m - window.start].add(b + w);
                    }
                }
            }
            weights.push(own.into_iter().map(LogSum::ln).collect());
            before = Span {
                window,
                ln: next.into_iter().map(LogSum::ln).collect(),
            };
        }
        (weights, self.free_cell_odds(&before))
    }

    /// `regions_total` weighs the totals of all regions together.
    fn free_cell_odds(&self, regions_total: &Span) -> FreeOdds {
        let unknown = |probability| FreeOdds {
            probability,
            safe: false,
            mine: false,
        };
        if self.free_cells == 0 {
            return unknown(0.0);
        }
        // Log weight and free-cell mines of every total that can happen.
        let outcomes: Vec<(f64, usize)> = regions_total
            .window
            .clone()
            .filter_map(|t| {
                let left = self.mines_left - t;
                Some((regions_total.get(t)? + self.ln_ways(left)?, left))
            })
            .collect();
        if outcomes.is_empty() {
            return unknown(self.mines_left as f64 / self.free_cells as f64);
        }
        let peak = outcomes
            .iter()
            .map(|&(w, _)| w)
            .fold(f64::NEG_INFINITY, f64::max);
        let (mut weight, mut expected) = (0.0, 0.0);
        for &(w, left) in &outcomes {
            let scale = (w - peak).exp();
            weight += scale;
            expected += scale * left as f64;
        }
        FreeOdds {
            probability: expected / weight / self.free_cells as f64,
            safe: outcomes.iter().all(|&(_, left)| left == 0),
            mine: outcomes.iter().all(|&(_, left)| left == self.free_cells),
        }
    }
}

/// Mine probability of every free cell, and whether they are all certainly
/// safe or all certainly mines.
#[derive(Clone, Copy, Debug)]
struct FreeOdds {
    probability: f64,
    safe: bool,
    mine: bool,
}

/// For each `r` up to the region count, the totals the regions before `r` can
/// hold while the rest still fits. The later regions take between their fewest
/// and most mines, and the free cells take the remainder, from none to all of
/// them. `bounds` holds each region's fewest and most.
fn windows(bounds: &[(usize, usize)], free_cells: usize, mines_left: usize) -> Vec<Range<usize>> {
    let (mut rest_lo, mut rest_hi) = bounds
        .iter()
        .fold((0, 0), |(lo, hi), &(l, h)| (lo + l, hi + h));
    let (mut before_lo, mut before_hi) = (0, 0);
    let mut windows = Vec::with_capacity(bounds.len() + 1);
    for r in 0..=bounds.len() {
        let lo = before_lo.max(mines_left.saturating_sub(free_cells + rest_hi));
        let hi = mines_left
            .checked_sub(rest_lo)
            .map_or(0, |most| before_hi.min(most) + 1);
        windows.push(lo..hi.max(lo));
        if let Some(&(l, h)) = bounds.get(r) {
            before_lo += l;
            before_hi += h;
            rest_lo -= l;
            rest_hi -= h;
        }
    }
    windows
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{GameConfig, Level};
    use crate::game::GameStatus;
    use crate::tiling::TilingId;
    use proptest::prelude::*;

    /// Knowledge for a square board: digits are open numbers, `.` is closed.
    fn square(rows: &[&str]) -> (Board, Vec<Option<u8>>) {
        let board = Board::new(TilingId::Square, rows[0].len() as u32, rows.len() as u32);
        let knowledge = rows
            .iter()
            .flat_map(|r| r.chars())
            .map(|ch| ch.to_digit(10).map(|d| d as u8))
            .collect();
        (board, knowledge)
    }

    fn cell(board: &Board, col: u32, row: u32) -> CellId {
        CellId(row * board.cols() + col)
    }

    #[test]
    fn one_two_one_pattern() {
        let (board, knowledge) = square(&["...", "121", "000"]);
        let a = analyze(&board, &knowledge, 2, false);
        assert_eq!(a.mines, vec![cell(&board, 0, 0), cell(&board, 2, 0)]);
        assert_eq!(a.safe, vec![cell(&board, 1, 0)]);
        assert!(a.exact);
    }

    #[test]
    fn symmetric_guess_is_fifty_fifty() {
        // The 0 settles the right column, so the 1s share one mine between
        // the two top-left cells.
        let (board, knowledge) = square(&["...", "11.", "00."]);
        let a = analyze(&board, &knowledge, 1, false);
        assert!((a.probabilities[0].unwrap() - 0.5).abs() < 1e-12);
        assert!((a.probabilities[1].unwrap() - 0.5).abs() < 1e-12);
        assert_eq!(a.safe, [CellId(2), CellId(5), CellId(8)]);
        assert_eq!(a.mines, Vec::<CellId>::new());
    }

    /// `pairs` pairs of open 1s spread over a `side` x `side` square board,
    /// plus the four closed cells each pair shares.
    fn pairs_of_ones(side: u32, pairs: usize) -> (Board, Vec<Option<u8>>, Vec<CellId>) {
        let board = Board::new(TilingId::Square, side, side);
        let at = |col: u32, row: u32| CellId(row * side + col).index();
        let mut knowledge = vec![None; board.len()];
        let mut shared = Vec::new();
        let spots = (0..(side - 2) / 4).flat_map(|y| (0..(side - 3) / 5).map(move |x| (x, y)));
        for (x, y) in spots.take(pairs) {
            let (col, row) = (1 + 5 * x, 1 + 4 * y);
            knowledge[at(col, row)] = Some(1);
            knowledge[at(col + 1, row)] = Some(1);
            for (c, r) in [
                (col, row - 1),
                (col + 1, row - 1),
                (col, row + 1),
                (col + 1, row + 1),
            ] {
                shared.push(CellId(at(c, r) as u32));
            }
        }
        (board, knowledge, shared)
    }

    #[test]
    fn many_regions_keep_their_odds_when_weights_leave_the_f64_range() {
        // With one mine per pair in total, each pair holds its mine on a
        // shared cell, one time in four, and every other closed cell is safe.
        // At these sizes some totals weigh less than the smallest positive
        // f64, so plain float sums would round them to zero.
        for (side, pairs) in [(70, 144), (200, 95)] {
            let (board, knowledge, shared) = pairs_of_ones(side, pairs);
            let a = analyze(&board, &knowledge, pairs as u32, false);
            assert!(a.exact);
            for cell in &shared {
                let p = a.probabilities[cell.index()].unwrap();
                assert!((p - 0.25).abs() < 1e-9, "{side}: {cell:?} has {p}");
            }
            let closed = knowledge.iter().filter(|k| k.is_none()).count();
            assert_eq!(a.safe.len(), closed - shared.len(), "{side}");
            assert_eq!(a.mines, Vec::<CellId>::new());
        }
    }

    #[test]
    fn unflags_the_safest_cell_once_every_uncertain_cell_is_flagged() {
        // Seven mines around the first click: each closed cell is 7/8 a mine.
        let config = GameConfig::custom(TilingId::Square, 3, 3, 7).unwrap();
        let mut game = Game::new(config, 1).unwrap();
        game.primary(CellId(4));
        for cell in game.board().cells().filter(|&c| c != CellId(4)) {
            game.set_mark(cell, Mark::Flag);
        }
        assert_eq!(game.status(), GameStatus::Playing);
        let s = suggest(&game).unwrap();
        assert_eq!(
            (s.action, s.cell, s.certain),
            (Action::Unflag, CellId(0), false)
        );
        assert!((s.mine_probability - 7.0 / 8.0).abs() < 1e-12);
        apply(&mut game, s);
        let s = suggest(&game).unwrap();
        assert_eq!((s.action, s.cell), (Action::Open, CellId(0)));
    }

    #[test]
    fn a_guess_says_whether_its_odds_are_exact() {
        let config = GameConfig::custom(TilingId::Square, 3, 3, 7).unwrap();
        let mut game = Game::new(config, 1).unwrap();
        game.primary(CellId(4));
        let mut analysis = analyze(game.board(), &game.knowledge(), 7, game.twins_clear());
        let s = choose(&game, &analysis).unwrap();
        assert!(!s.certain);
        assert!(s.exact);
        analysis.exact = false;
        assert!(!choose(&game, &analysis).unwrap().exact);
        assert!(suggest(&game).unwrap().exact);
    }

    #[test]
    fn enumeration_spends_the_shared_budget() {
        let (board, knowledge) = square(&["...", "121", "000"]);
        let (cells, cons) = &split_regions(&constraints(&board, &knowledge), board.len())[0];
        let mut budget = 3;
        assert!(Region::enumerate(cells, cons, 2, &mut budget).is_none());
        assert_eq!(budget, 0);
        assert!(Region::enumerate(cells, cons, 2, &mut budget).is_none());
        let mut budget = 1000;
        assert!(Region::enumerate(cells, cons, 2, &mut budget).is_some());
        assert!((900..1000).contains(&budget), "{budget}");
    }

    #[test]
    fn mine_total_settles_free_cells() {
        // The 1 owns the only mine, so the far corner is safe.
        let (board, knowledge) = square(&["1..", "...", "..."]);
        let a = analyze(&board, &knowledge, 1, false);
        assert!(a.safe.contains(&cell(&board, 2, 2)));
    }

    #[test]
    fn mine_total_weights_competing_layouts() {
        // Two 1s share two cells. One mine in the shared pair satisfies both;
        // otherwise each 1 needs its own outer cell. Three free cells take the rest.
        let (board, knowledge) = square(&["1.1", "...", "..."]);
        let outer = cell(&board, 0, 1).index();
        let free = cell(&board, 1, 2).index();

        let one_mine = analyze(&board, &knowledge, 1, false);
        assert!(one_mine.safe.contains(&CellId(outer as u32)));

        // Shared layouts: 2 ways x C(3,2) = 6. Outer layout: 1 way x C(3,1) = 3.
        let three_mines = analyze(&board, &knowledge, 3, false);
        assert!((three_mines.probabilities[outer].unwrap() - 3.0 / 9.0).abs() < 1e-12);
        assert!((three_mines.probabilities[free].unwrap() - 5.0 / 9.0).abs() < 1e-12);
    }

    #[test]
    fn a_closed_twin_is_safe_when_the_placement_kept_twins_clear() {
        // Kite boards are full of twins. Blind to the placement rule, the
        // solver guessed on risky cells while a closed twin was certainly
        // safe. Follow its games and check each of those guesses.
        let config = GameConfig::preset(TilingId::Kite, Level::Amateur);
        let mut caught = 0;
        for seed in 0..10 {
            let mut game = Game::new(config, seed).unwrap();
            game.primary(game.board().center_cell());
            assert!(game.twins_clear());
            while !game.status().is_over() {
                let board = game.board();
                let knowledge = game.knowledge();
                let blind =
                    choose(&game, &analyze(board, &knowledge, config.mines, false)).unwrap();
                let closed_twin = board
                    .cells()
                    .any(|c| board.is_twin(c) && knowledge[c.index()].is_none());
                if !blind.certain && closed_twin {
                    let s = suggest(&game).unwrap();
                    assert!(s.certain, "seed {seed}: {s:?}");
                    assert_eq!(s.action, Action::Open);
                    assert!(!game.mines().contains(&s.cell));
                    caught += 1;
                }
                apply(&mut game, blind);
            }
        }
        assert!(caught > 0);
    }

    #[test]
    fn twins_count_as_safe_only_when_the_placement_kept_them_clear() {
        let config = GameConfig::preset(TilingId::Kite, Level::Amateur);
        let mut game = Game::new(config, 3).unwrap();
        game.primary(game.board().center_cell());
        let board = game.board();
        let knowledge = game.knowledge();
        let closed_twins: Vec<CellId> = board
            .cells()
            .filter(|&c| board.is_twin(c) && knowledge[c.index()].is_none())
            .collect();
        assert_ne!(closed_twins.len(), 0);
        let clear = analyze(board, &knowledge, config.mines, true);
        let blind = analyze(board, &knowledge, config.mines, false);
        for cell in &closed_twins {
            assert!(clear.safe.contains(cell));
            assert_eq!(clear.probabilities[cell.index()], Some(0.0));
            assert!(blind.probabilities[cell.index()].unwrap() > 0.0);
        }
        let sum: f64 = clear.probabilities.iter().flatten().sum();
        assert!((sum - f64::from(config.mines)).abs() < 1e-6, "sum {sum}");
    }

    #[test]
    fn first_suggestion_opens_the_center() {
        let game = Game::new(GameConfig::preset(TilingId::Square, Level::Beginner), 1).unwrap();
        let s = suggest(&game).unwrap();
        assert_eq!(
            (s.action, s.cell, s.certain),
            (Action::Open, game.board().center_cell(), true)
        );
    }

    /// Whether the placement rule keeps mines off twins after a first open at
    /// `start`: it does when the cells outside the opening's neighborhood that
    /// are not twins can hold every mine.
    fn twins_kept_clear(board: &Board, start: CellId, mines: u32) -> bool {
        let opening = |c: CellId| c == start || board.neighbors(start).contains(&c);
        let room = board
            .cells()
            .filter(|&c| !opening(c) && !board.is_twin(c))
            .count();
        room >= mines as usize
    }

    /// Closed cells and, for each, how many layouts put a mine there, out of
    /// every layout of `total` mines that fits the open numbers and, when
    /// `twins_clear`, leaves every twin empty. Lists every subset of the
    /// closed cells, so it only suits a few of them.
    fn brute_force(
        board: &Board,
        knowledge: &[Option<u8>],
        total: u32,
        twins_clear: bool,
    ) -> (Vec<CellId>, Vec<u64>, u64) {
        let closed: Vec<CellId> = board
            .cells()
            .filter(|c| knowledge[c.index()].is_none())
            .collect();
        assert!(closed.len() <= 20);
        let mut bit = vec![0u32; board.len()];
        for (j, c) in closed.iter().enumerate() {
            bit[c.index()] = 1 << j;
        }
        let numbers: Vec<(u32, u32)> = board
            .cells()
            .filter_map(|c| {
                let number = knowledge[c.index()]?;
                let mask = board.neighbors(c).iter().fold(0, |m, n| m | bit[n.index()]);
                Some((mask, u32::from(number)))
            })
            .collect();
        let twins = closed
            .iter()
            .filter(|c| twins_clear && board.is_twin(**c))
            .fold(0, |m, c| m | bit[c.index()]);
        let (mut layouts, mut hits) = (0, vec![0; closed.len()]);
        for layout in 0u32..1 << closed.len() {
            if layout.count_ones() != total
                || layout & twins != 0
                || numbers
                    .iter()
                    .any(|&(mask, n)| (layout & mask).count_ones() != n)
            {
                continue;
            }
            layouts += 1;
            for (j, hit) in hits.iter_mut().enumerate() {
                *hit += u64::from(layout >> j & 1);
            }
        }
        (closed, hits, layouts)
    }

    fn apply(game: &mut Game, s: Suggestion) {
        match s.action {
            Action::Open => game.reveal(s.cell),
            Action::Flag => game.set_mark(s.cell, Mark::Flag),
            Action::Unflag => game.set_mark(s.cell, Mark::None),
        };
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(48))]

        #[test]
        fn certain_moves_are_always_right(seed in any::<u64>(), tiling in 0..TilingId::ALL.len(), level in 0usize..2) {
            let config = GameConfig::preset(TilingId::ALL[tiling], Level::PRESETS[level]);
            let mut game = Game::new(config, seed).unwrap();
            while let Some(s) = suggest(&game) {
                if s.certain && game.mines_placed() {
                    let is_mine = game.mines().contains(&s.cell);
                    prop_assert_eq!(is_mine, s.action == Action::Flag, "{:?}", s);
                }
                apply(&mut game, s);
            }
            prop_assert!(game.status().is_over());
        }

        #[test]
        fn probabilities_add_up_to_the_mine_count(seed in any::<u64>(), tiling in 0..TilingId::ALL.len()) {
            let config = GameConfig::preset(TilingId::ALL[tiling], Level::Beginner);
            let mut game = Game::new(config, seed).unwrap();
            game.primary(game.board().center_cell());
            prop_assume!(game.status() == GameStatus::Playing);
            let a = analyze(game.board(), &game.knowledge(), config.mines, game.twins_clear());
            prop_assume!(a.exact);
            let sum: f64 = a.probabilities.iter().flatten().sum();
            prop_assert!((sum - f64::from(config.mines)).abs() < 1e-6, "sum {}", sum);
        }
    }

    proptest! {
        // Cases are cheap: each checks a few positions of a tiny board.
        #![proptest_config(ProptestConfig::with_cases(384))]

        #[test]
        fn analysis_matches_every_layout_on_small_boards(
            tiling in 0..TilingId::ALL.len(),
            cols in 3u32..=6,
            rows in 3u32..=6,
            density in 0.0..1.0f64,
            seed in any::<u64>(),
            picks in proptest::collection::vec(any::<u32>(), 40),
        ) {
            let cells = cols * rows;
            // At most 19 mines, so the game reaches 20 closed cells.
            let mines = 1 + (f64::from(cells.min(20) - 2) * density).round() as u32;
            let config = GameConfig::custom(TilingId::ALL[tiling], cols, rows, mines).unwrap();
            let mut game = Game::new(config, seed).unwrap();
            let start = CellId(picks[0] % cells);
            game.primary(start);
            let twins_clear = twins_kept_clear(game.board(), start, mines);
            prop_assert_eq!(game.twins_clear(), twins_clear);
            for pick in &picks[1..] {
                if game.status() != GameStatus::Playing {
                    break;
                }
                let knowledge = game.knowledge();
                let key = game.mines();
                let closed: Vec<CellId> = game.board().cells().filter(|c| knowledge[c.index()].is_none()).collect();
                if closed.len() <= 20 {
                    let (cells, hits, layouts) = brute_force(game.board(), &knowledge, mines, twins_clear);
                    let a = analyze(game.board(), &knowledge, mines, twins_clear);
                    prop_assert!(a.exact);
                    for (cell, &hit) in cells.iter().zip(&hits) {
                        let truth = hit as f64 / layouts as f64;
                        let p = a.probabilities[cell.index()].unwrap();
                        prop_assert!((p - truth).abs() < 1e-9, "{:?}: {} vs {}", cell, p, truth);
                    }
                    let certain = |n: u64| -> Vec<CellId> {
                        cells.iter().zip(&hits).filter(|&(_, &h)| h == n).map(|(&c, _)| c).collect()
                    };
                    prop_assert_eq!(&a.safe, &certain(0));
                    prop_assert_eq!(&a.mines, &certain(layouts));
                }
                let safe: Vec<CellId> = closed.into_iter().filter(|c| !key.contains(c)).collect();
                if safe.is_empty() {
                    break;
                }
                game.reveal(safe[*pick as usize % safe.len()]);
            }
        }
    }
}
