//! Notices when the computer slept, so the game can pause as of then.
//!
//! `Instant` stops during sleep on macOS but keeps counting on Windows, so the
//! clock alone would treat a game left open overnight differently on each.
//! Comparing both clocks between short ticks catches sleep on either: one of
//! them jumps far past the tick.

use std::time::{Duration, Instant, SystemTime};

/// How often the watch ticks.
pub const TICK: Duration = Duration::from_secs(1);
/// A gap between ticks this long means the computer slept. It sits well above
/// [`TICK`], so a busy moment doesn't count.
const SLEEP_GAP: Duration = Duration::from_secs(10);

#[derive(Debug)]
pub struct SleepWatch {
    wall: SystemTime,
    mono: Instant,
}

impl SleepWatch {
    pub fn new(wall: SystemTime, mono: Instant) -> Self {
        Self { wall, mono }
    }

    /// Records a tick. Returns the previous tick's time when the computer
    /// slept since it, which is when the game should count as paused.
    pub fn tick(&mut self, wall: SystemTime, mono: Instant) -> Option<Instant> {
        // A wall clock set back gives no gap rather than an error.
        let wall_gap = wall.duration_since(self.wall).unwrap_or_default();
        let mono_gap = mono.saturating_duration_since(self.mono);
        let last = self.mono;
        self.wall = wall;
        self.mono = mono;
        (wall_gap.max(mono_gap) >= SLEEP_GAP).then_some(last)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Clocks {
        wall: SystemTime,
        mono: Instant,
    }

    impl Clocks {
        fn new() -> Self {
            Self {
                wall: SystemTime::now(),
                mono: Instant::now(),
            }
        }

        fn advance(&mut self, wall: Duration, mono: Duration) -> (SystemTime, Instant) {
            self.wall += wall;
            self.mono += mono;
            (self.wall, self.mono)
        }
    }

    #[test]
    fn steady_ticks_are_awake() {
        let mut clocks = Clocks::new();
        let mut watch = SleepWatch::new(clocks.wall, clocks.mono);
        for _ in 0..5 {
            let (wall, mono) = clocks.advance(TICK, TICK);
            assert_eq!(watch.tick(wall, mono), None);
        }
        let (wall, mono) = clocks.advance(Duration::from_secs(3), Duration::from_secs(3));
        assert_eq!(watch.tick(wall, mono), None, "a slow tick isn't sleep");
    }

    #[test]
    fn sleep_on_macos_shows_in_the_wall_clock() {
        let mut clocks = Clocks::new();
        let mut watch = SleepWatch::new(clocks.wall, clocks.mono);
        let (wall, mono) = clocks.advance(TICK, TICK);
        watch.tick(wall, mono);
        let (wall, after) = clocks.advance(Duration::from_secs(3600), TICK);
        assert_eq!(watch.tick(wall, after), Some(mono));
        let (wall, next) = clocks.advance(TICK, TICK);
        assert_eq!(watch.tick(wall, next), None, "it reports a sleep once");
    }

    #[test]
    fn sleep_on_windows_shows_in_both_clocks() {
        let mut clocks = Clocks::new();
        let start = clocks.mono;
        let mut watch = SleepWatch::new(clocks.wall, clocks.mono);
        let hour = Duration::from_secs(3600);
        let (wall, mono) = clocks.advance(hour, hour);
        assert_eq!(watch.tick(wall, mono), Some(start));
    }

    #[test]
    fn a_wall_clock_set_back_is_not_sleep() {
        let mut clocks = Clocks::new();
        let mut watch = SleepWatch::new(clocks.wall, clocks.mono);
        clocks.wall -= Duration::from_secs(3600);
        let (wall, mono) = clocks.advance(Duration::ZERO, TICK);
        assert_eq!(watch.tick(wall, mono), None);
    }
}
