//! Measures how hard each tiling's shape makes the game, for the ratings in
//! `TilingId::complexity`.
//!
//! `cargo run --release -p polymine-core --example complexity -- [games] [tiling...]`
//!
//! The assistant plays every tiling at the Amateur and Professional presets,
//! which share one mine density across tilings, on the same seeds. Its win
//! rate there shows what the shape alone adds: Beginner is too easy to tell
//! tilings apart, and Crazy too slow to measure well. Tilings are named as in
//! the enum, and with none named, every tiling plays.

use std::collections::VecDeque;
use std::sync::Mutex;

use polymine_core::{Action, Game, GameConfig, GameStatus, Level, Mark, TilingId, solver};

const LEVELS: [Level; 2] = [Level::Amateur, Level::Professional];
/// Seeds per job. Small batches keep every core busy until the end.
const BATCH: u64 = 20;

fn wins(tiling: TilingId, level: Level, seeds: std::ops::Range<u64>) -> u32 {
    let config = GameConfig::preset(tiling, level);
    let mut wins = 0;
    for seed in seeds {
        let mut game = Game::new(config, seed).expect("presets are valid");
        while let Some(s) = solver::suggest(&game) {
            match s.action {
                Action::Open => game.reveal(s.cell),
                Action::Flag => game.set_mark(s.cell, Mark::Flag),
                Action::Unflag => game.set_mark(s.cell, Mark::None),
            };
        }
        wins += u32::from(game.status() == GameStatus::Won);
    }
    wins
}

fn main() {
    let mut args = std::env::args().skip(1);
    let games: u64 = args.next().and_then(|a| a.parse().ok()).unwrap_or(400);
    let only: Vec<String> = args.collect();
    let tilings: Vec<TilingId> = TilingId::ALL
        .into_iter()
        .filter(|t| only.is_empty() || only.contains(&format!("{t:?}")))
        .collect();

    let jobs: VecDeque<(usize, usize, u64)> = (0..tilings.len())
        .flat_map(|t| {
            (0..LEVELS.len()).flat_map(move |l| (0..games.div_ceil(BATCH)).map(move |b| (t, l, b)))
        })
        .collect();
    let queue = Mutex::new(jobs);
    let totals = Mutex::new(vec![[0u32; LEVELS.len()]; tilings.len()]);
    let threads = std::thread::available_parallelism().map_or(4, usize::from);
    std::thread::scope(|scope| {
        for _ in 0..threads {
            scope.spawn(|| {
                loop {
                    // A separate statement drops the lock before the games run;
                    // in a `while let` condition it would live through the body.
                    let Some((t, l, b)) = queue.lock().unwrap().pop_front() else {
                        break;
                    };
                    let seeds = b * BATCH..((b + 1) * BATCH).min(games);
                    let won = wins(tilings[t], LEVELS[l], seeds);
                    totals.lock().unwrap()[t][l] += won;
                }
            });
        }
    });

    println!(
        "{:<22} {:>9} {:>13} {:>9} {:>8}",
        "tiling", "amateur", "professional", "mean", "rating"
    );
    for (tiling, won) in tilings.iter().zip(totals.into_inner().unwrap()) {
        let rates = won.map(|w| f64::from(w) / games as f64);
        let mean = rates.iter().sum::<f64>() / rates.len() as f64;
        println!(
            "{:<22} {:>8.1}% {:>12.1}% {:>8.1}% {:>8}",
            format!("{tiling:?}"),
            rates[0] * 100.0,
            rates[1] * 100.0,
            mean * 100.0,
            TilingId::rating_for(mean),
        );
    }
}
