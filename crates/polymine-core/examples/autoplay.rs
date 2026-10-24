//! Lets the assistant play many games and reports its win rate and speed.
//!
//! `cargo run --release -p polymine-core --example autoplay -- [games] [tiling...]`
//!
//! Tilings are named as in the enum or the CLI, in any case, for example `Kite`
//! or `snubSquare`. With none named, every tiling plays; an unknown name stops
//! the run.

use std::time::{Duration, Instant};

use polymine_core::{Action, Game, GameConfig, GameStatus, Level, Mark, TilingId, solver};

fn main() {
    let games: u64 = std::env::args()
        .nth(1)
        .and_then(|a| a.parse().ok())
        .unwrap_or(200);
    let only: Vec<String> = std::env::args().skip(2).map(|a| a.to_lowercase()).collect();
    let name = |t: &TilingId| format!("{t:?}").to_lowercase();
    if let Some(unknown) = only
        .iter()
        .find(|a| !TilingId::ALL.iter().any(|t| name(t) == **a))
    {
        eprintln!("no tiling is called {unknown}");
        std::process::exit(2);
    }
    println!(
        "{:<22} {:<13} {:>6} {:>10} {:>10}",
        "tiling", "level", "win %", "avg move", "worst"
    );
    let chosen = TilingId::ALL
        .into_iter()
        .filter(|t| only.is_empty() || only.contains(&name(t)));
    for tiling in chosen {
        for level in Level::PRESETS {
            let (mut wins, mut moves, mut total, mut worst) =
                (0, 0u32, Duration::ZERO, Duration::ZERO);
            for seed in 0..games {
                let mut game = Game::new(GameConfig::preset(tiling, level), seed).unwrap();
                loop {
                    let start = Instant::now();
                    let Some(s) = solver::suggest(&game) else {
                        break;
                    };
                    let spent = start.elapsed();
                    total += spent;
                    worst = worst.max(spent);
                    moves += 1;
                    match s.action {
                        Action::Open => game.reveal(s.cell),
                        Action::Flag => game.set_mark(s.cell, Mark::Flag),
                        Action::Unflag => game.set_mark(s.cell, Mark::None),
                    };
                }
                wins += u32::from(game.status() == GameStatus::Won);
            }
            println!(
                "{:<22} {:<13} {:>6.1} {:>10.2?} {:>10.2?}",
                format!("{tiling:?}"),
                format!("{level:?}"),
                f64::from(wins) * 100.0 / games as f64,
                total / moves,
                worst
            );
        }
    }
}
