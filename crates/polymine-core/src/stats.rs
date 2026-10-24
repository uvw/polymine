//! Finished-game records, per-player statistics, and the champions table.
//!
//! Records are the source of truth. Statistics and champions are computed from
//! them on demand, so new views never need a storage migration.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::config::Level;
use crate::tiling::TilingId;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum Outcome {
    Won,
    Lost,
    /// A new game started before this one ended. Only history files from
    /// older builds hold it; statistics skip it.
    Abandoned,
}

/// Two records are the same game when every field matches.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GameRecord {
    pub player: String,
    pub tiling: TilingId,
    pub level: Level,
    pub cols: u32,
    pub rows: u32,
    pub mines: u32,
    pub outcome: Outcome,
    pub duration_ms: u64,
    pub clicks: u32,
    pub opened: u32,
    pub safe_cells: u32,
    /// The assistant made at least one move.
    pub assisted: bool,
    /// Unix time in milliseconds.
    pub finished_at: i64,
}

impl GameRecord {
    /// Whether the game counts toward statistics and champions. Custom levels
    /// aren't comparable, assisted games aren't the player's own, and
    /// abandoned games never finished.
    pub fn is_ranked(&self) -> bool {
        self.level != Level::Custom && !self.assisted && self.outcome != Outcome::Abandoned
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PlayerStats {
    pub player: String,
    pub games: u32,
    pub wins: u32,
    /// Average share of safe cells opened, from 0 to 100.
    #[specta(type = crate::Finite)]
    pub avg_opened_percent: f64,
    /// Average over wins only; zero when there are none.
    #[specta(type = crate::Finite)]
    pub avg_duration_ms: f64,
    /// Average over wins only; zero when there are none.
    #[specta(type = crate::Finite)]
    pub avg_clicks: f64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ChampionEntry {
    pub player: String,
    pub duration_ms: u64,
    pub clicks: u32,
    pub finished_at: i64,
}

/// Ranked statistics for one tiling and level, one row per player, by name.
pub fn player_stats(records: &[GameRecord], tiling: TilingId, level: Level) -> Vec<PlayerStats> {
    #[derive(Default)]
    struct Totals {
        games: u32,
        wins: u32,
        opened_percent: f64,
        duration_ms: f64,
        clicks: f64,
    }
    let mut by_player: BTreeMap<&str, Totals> = BTreeMap::new();
    for r in matching(records, tiling, level) {
        let t = by_player.entry(&r.player).or_default();
        t.games += 1;
        t.wins += u32::from(r.outcome == Outcome::Won);
        t.opened_percent += f64::from(r.opened) * 100.0 / f64::from(r.safe_cells.max(1));
        // Time and clicks describe how fast a player clears a board, so only
        // wins count toward them.
        if r.outcome == Outcome::Won {
            t.duration_ms += r.duration_ms as f64;
            t.clicks += f64::from(r.clicks);
        }
    }
    by_player
        .into_iter()
        .map(|(player, t)| {
            let wins = f64::from(t.wins.max(1));
            PlayerStats {
                player: player.to_owned(),
                games: t.games,
                wins: t.wins,
                avg_opened_percent: t.opened_percent / f64::from(t.games),
                avg_duration_ms: t.duration_ms / wins,
                avg_clicks: t.clicks / wins,
            }
        })
        .collect()
}

/// Fastest ranked wins for one tiling and level. Earlier wins break ties.
pub fn champions(
    records: &[GameRecord],
    tiling: TilingId,
    level: Level,
    limit: usize,
) -> Vec<ChampionEntry> {
    let mut wins: Vec<&GameRecord> = matching(records, tiling, level)
        .filter(|r| r.outcome == Outcome::Won)
        .collect();
    wins.sort_by_key(|r| (r.duration_ms, r.finished_at));
    wins.into_iter()
        .take(limit)
        .map(|r| ChampionEntry {
            player: r.player.clone(),
            duration_ms: r.duration_ms,
            clicks: r.clicks,
            finished_at: r.finished_at,
        })
        .collect()
}

fn matching(
    records: &[GameRecord],
    tiling: TilingId,
    level: Level,
) -> impl Iterator<Item = &GameRecord> {
    records
        .iter()
        .filter(move |r| r.is_ranked() && r.tiling == tiling && r.level == level)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(player: &str, outcome: Outcome, duration_ms: u64) -> GameRecord {
        GameRecord {
            player: player.into(),
            tiling: TilingId::Square,
            level: Level::Beginner,
            cols: 10,
            rows: 10,
            mines: 13,
            outcome,
            duration_ms,
            clicks: 20,
            opened: 87,
            safe_cells: 87,
            assisted: false,
            finished_at: duration_ms as i64,
        }
    }

    #[test]
    fn stats_average_per_player() {
        let mut lost = record("ann", Outcome::Lost, 3_000);
        lost.opened = 0;
        let records = vec![
            record("ann", Outcome::Won, 1_000),
            lost,
            record("bob", Outcome::Won, 5_000),
        ];
        let stats = player_stats(&records, TilingId::Square, Level::Beginner);
        assert_eq!(stats.len(), 2);
        assert_eq!(
            (stats[0].player.as_str(), stats[0].games, stats[0].wins),
            ("ann", 2, 1)
        );
        assert!((stats[0].avg_opened_percent - 50.0).abs() < 1e-9);
        // The loss counts toward games and opened cells, not toward time.
        assert!((stats[0].avg_duration_ms - 1_000.0).abs() < 1e-9);
        assert!((stats[0].avg_clicks - 20.0).abs() < 1e-9);
    }

    #[test]
    fn players_without_wins_average_to_zero_time() {
        let records = vec![record("ann", Outcome::Lost, 3_000)];
        let stats = player_stats(&records, TilingId::Square, Level::Beginner);
        assert_eq!(stats[0].avg_duration_ms, 0.0);
        assert_eq!(stats[0].avg_clicks, 0.0);
    }

    #[test]
    fn abandoned_records_from_older_files_are_skipped() {
        let records = vec![
            record("ann", Outcome::Abandoned, 10),
            record("ann", Outcome::Won, 20),
        ];
        let stats = player_stats(&records, TilingId::Square, Level::Beginner);
        assert_eq!(stats[0].games, 1);
    }

    #[test]
    fn champions_rank_fastest_unassisted_wins() {
        let mut assisted = record("bot", Outcome::Won, 100);
        assisted.assisted = true;
        let mut custom = record("cus", Outcome::Won, 200);
        custom.level = Level::Custom;
        let records = vec![
            record("slow", Outcome::Won, 9_000),
            record("fast", Outcome::Won, 1_000),
            record("lost", Outcome::Lost, 500),
            assisted,
            custom,
        ];
        let top = champions(&records, TilingId::Square, Level::Beginner, 10);
        let names: Vec<&str> = top.iter().map(|c| c.player.as_str()).collect();
        assert_eq!(names, ["fast", "slow"]);
    }

    #[test]
    fn record_round_trips_through_json() {
        let r = record("ann", Outcome::Abandoned, 42);
        let json = serde_json::to_string(&r).unwrap();
        assert!(json.contains("\"durationMs\":42"));
        assert_eq!(serde_json::from_str::<GameRecord>(&json).unwrap(), r);
    }
}
