//! Headless games: the same requests the app answers, played on the engine
//! alone. A game is a file holding its configuration, seed, and moves, and
//! every call replays it, which the seeded engine makes exact.

use std::fs;
use std::path::{Path, PathBuf};

use polymine_core::{Action, CellId, Game, GameConfig, Level, Mark, TilingId, solver};
use polymine_ipc::moves;
use polymine_ipc::view::{self, MoveView};
use polymine_ipc::{ErrorBody, ErrorCode, Request, Response};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum MoveKind {
    /// A click: opens a closed cell, or chords an open number.
    Open,
    /// The assistant's open: the cell alone, never a chord or smart click.
    Reveal,
    Flag,
    Unflag,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
struct Move {
    kind: MoveKind,
    cell: u32,
}

#[derive(Debug, Serialize, Deserialize)]
struct SavedGame {
    config: GameConfig,
    seed: u64,
    moves: Vec<Move>,
}

impl SavedGame {
    /// The game this file describes. A file that parses but describes no
    /// playable game, say hand-edited or from another build, is an error.
    fn replay(&self) -> Result<Game, ErrorBody> {
        let broken = |what: String| {
            ErrorBody::new(ErrorCode::Internal, format!("the saved game {what}"))
                .with_hint("start over with `new`")
        };
        let mut game = Game::new(self.config, self.seed)
            .map_err(|e| broken(format!("has a configuration this build can't play: {e}")))?;
        let cells = game.board().len();
        for m in &self.moves {
            if m.cell as usize >= cells {
                return Err(broken(format!(
                    "has a move off the board, at cell {}",
                    m.cell
                )));
            }
            apply(&mut game, *m);
        }
        Ok(game)
    }
}

fn apply(game: &mut Game, m: Move) -> polymine_core::Update {
    let cell = CellId(m.cell);
    match m.kind {
        MoveKind::Open => game.primary(cell),
        MoveKind::Reveal => game.reveal(cell),
        MoveKind::Flag => game.set_mark(cell, Mark::Flag),
        MoveKind::Unflag => game.set_mark(cell, Mark::None),
    }
}

/// Where the headless games of this user live.
pub fn games_dir() -> PathBuf {
    polymine_ipc::instance::data_dir_override()
        .unwrap_or_else(polymine_ipc::instance::runtime_dir)
        .join("games")
}

fn file(dir: &Path, name: &str) -> Result<PathBuf, ErrorBody> {
    let valid = !name.is_empty()
        && name.len() <= 32
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        && !polymine_ipc::names::is_device_name(name);
    if valid {
        Ok(dir.join(format!("{name}.json")))
    } else {
        Err(ErrorBody::new(
            ErrorCode::Usage,
            format!(
                "game names use 1 to 32 ASCII letters, digits, '-', or '_', and aren't a                  Windows device name, got {name:?}"
            ),
        ))
    }
}

fn load(path: &Path) -> Result<Option<SavedGame>, ErrorBody> {
    match fs::read_to_string(path) {
        Ok(text) => serde_json::from_str(&text).map(Some).map_err(|e| {
            ErrorBody::new(
                ErrorCode::Internal,
                format!("{} is unreadable: {e}", path.display()),
            )
            .with_hint("start over with `new`")
        }),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(ErrorBody::new(ErrorCode::Internal, e.to_string())),
    }
}

/// Writes `game` to a temporary file and renames it over `path`, so a crash
/// mid-write leaves the old file whole. The temporary name carries the process
/// id, so two processes never share one.
fn save(path: &Path, game: &SavedGame) -> Result<(), ErrorBody> {
    let json = serde_json::to_string(game).expect("games always serialize");
    let mut temp = path.as_os_str().to_owned();
    temp.push(format!(".{}.tmp", std::process::id()));
    let temp = PathBuf::from(temp);
    let written = fs::File::create(&temp)
        .and_then(|mut file| {
            std::io::Write::write_all(&mut file, json.as_bytes())?;
            file.sync_all()
        })
        .and_then(|()| fs::rename(&temp, path));
    if written.is_err() {
        let _ = fs::remove_file(&temp);
    }
    written.map_err(crate::internal)
}

/// Holds an exclusive lock on `name`'s game until dropped, so calls on one game
/// from several processes take turns instead of overwriting each other's moves.
fn lock(dir: &Path, name: &str) -> Result<fs::File, ErrorBody> {
    fs::create_dir_all(dir).map_err(crate::internal)?;
    let file = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(dir.join(format!("{name}.lock")))
        .map_err(crate::internal)?;
    file.lock().map_err(crate::internal)?;
    Ok(file)
}

fn no_game() -> ErrorBody {
    ErrorBody::new(ErrorCode::Usage, "there is no game under this name yet")
        .with_hint("start one with `new`")
}

/// Answers a request on the headless game `name` in `dir`.
pub fn handle(dir: &Path, name: &str, request: Request) -> Response {
    match answer(dir, name, request) {
        Ok(value) => Response::Result(value),
        Err(error) => Response::Error(error),
    }
}

fn answer(dir: &Path, name: &str, request: Request) -> Result<Value, ErrorBody> {
    let path = file(dir, name)?;
    let _lock = lock(dir, name)?;
    let saved = load(&path)?;
    match request {
        Request::NewGame {
            tiling,
            level,
            seed,
        } => {
            let config = GameConfig::preset(
                tiling
                    .or(saved.as_ref().map(|s| s.config.tiling))
                    .unwrap_or(TilingId::Square),
                level
                    .or(saved.as_ref().map(|s| s.config.level))
                    .filter(|l| *l != Level::Custom)
                    .unwrap_or(Level::Beginner),
            );
            let fresh = SavedGame {
                config,
                seed: seed.unwrap_or_else(rand_seed),
                moves: Vec::new(),
            };
            let game = fresh.replay()?;
            save(&path, &fresh)?;
            Ok(json!(view::board(&game)))
        }
        Request::Stats { .. } => Err(ErrorBody::new(
            ErrorCode::Usage,
            "statistics belong to the app; headless games keep none",
        )
        .with_hint("drop --local to ask a running instance")),
        Request::Themes | Request::UseTheme { .. } => Err(ErrorBody::new(
            ErrorCode::Usage,
            "themes belong to the app; headless games have none",
        )
        .with_hint("drop --local to ask a running instance")),
        request => {
            let mut saved = saved.ok_or_else(no_game)?;
            let mut game = saved.replay()?;
            let value = play(&mut saved, &mut game, request, name, &path)?;
            save(&path, &saved)?;
            Ok(value)
        }
    }
}

fn rand_seed() -> u64 {
    // Clock nanoseconds are plenty for a game's seed.
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_nanos() as u64)
}

fn play(
    saved: &mut SavedGame,
    game: &mut Game,
    request: Request,
    name: &str,
    path: &Path,
) -> Result<Value, ErrorBody> {
    let (kind, cells) = match request {
        Request::Status => {
            return Ok(json!({
                "local": name,
                "file": path,
                "game": {
                    "tiling": game.config().tiling,
                    "level": game.config().level,
                    "status": game.status(),
                    "counters": game.counters(),
                },
            }));
        }
        Request::Board => return Ok(json!(view::board(game))),
        Request::Hint => {
            moves::check_playable(game)?;
            return Ok(json!(solver::suggest(game)));
        }
        Request::Step => {
            moves::check_playable(game)?;
            let Some(s) = solver::suggest(game) else {
                return Ok(Value::Null);
            };
            let kind = match s.action {
                Action::Open => MoveKind::Reveal,
                Action::Flag => MoveKind::Flag,
                Action::Unflag => MoveKind::Unflag,
            };
            let m = Move {
                kind,
                cell: s.cell.0,
            };
            let update = apply(game, m);
            saved.moves.push(m);
            let moved = MoveView::from_updates([&update], game);
            return Ok(json!({ "suggestion": s, "move": moved }));
        }
        Request::Open { cells } => (MoveKind::Open, cells),
        Request::Flag { cells } => (MoveKind::Flag, cells),
        Request::Unflag { cells } => (MoveKind::Unflag, cells),
        Request::NewGame { .. }
        | Request::Stats { .. }
        | Request::Themes
        | Request::UseTheme { .. } => unreachable!("answered before replay"),
    };
    moves::check_move(game, &cells)?;
    let mut updates = Vec::new();
    for cell in cells {
        let m = Move { kind, cell: cell.0 };
        updates.push(apply(game, m));
        saved.moves.push(m);
        if game.status().is_over() {
            break;
        }
    }
    Ok(json!(MoveView::from_updates(&updates, game)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ok(response: Response) -> Value {
        match response {
            Response::Result(v) => v,
            Response::Error(e) => panic!("unexpected error {e:?}"),
        }
    }

    fn new_game(dir: &Path) -> Value {
        ok(handle(
            dir,
            "t",
            Request::NewGame {
                tiling: Some(TilingId::Kite),
                level: Some(Level::Beginner),
                seed: Some(7),
            },
        ))
    }

    fn error(response: Response) -> ErrorBody {
        match response {
            Response::Result(v) => panic!("unexpected result {v}"),
            Response::Error(e) => e,
        }
    }

    #[test]
    fn a_hand_edited_game_is_an_error_not_a_crash() {
        let dir = tempfile::tempdir().unwrap();
        new_game(dir.path());
        let path = dir.path().join("t.json");
        let mut saved: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        saved["moves"] = json!([{ "kind": "open", "cell": 99_999 }]);
        fs::write(&path, saved.to_string()).unwrap();
        let off_board = error(handle(dir.path(), "t", Request::Board));
        assert_eq!(off_board.code, ErrorCode::Internal);
        assert!(
            off_board.message.contains("off the board"),
            "{}",
            off_board.message
        );
        saved["moves"] = json!([]);
        saved["config"]["cols"] = json!(900);
        fs::write(&path, saved.to_string()).unwrap();
        let too_big = error(handle(dir.path(), "t", Request::Board));
        assert!(
            too_big.message.contains("configuration"),
            "{}",
            too_big.message
        );
    }

    #[test]
    fn device_names_cant_name_a_game() {
        let dir = tempfile::tempdir().unwrap();
        for name in ["con", "NUL", "com1"] {
            assert_eq!(
                error(handle(dir.path(), name, Request::Board)).code,
                ErrorCode::Usage
            );
        }
    }

    #[test]
    fn calls_from_several_threads_keep_every_move_and_a_readable_file() {
        let dir = tempfile::tempdir().unwrap();
        new_game(dir.path());
        let center = ok(handle(dir.path(), "t", Request::Board))["cells"]
            .as_array()
            .unwrap()
            .len() as u32
            / 2;
        ok(handle(
            dir.path(),
            "t",
            Request::Open {
                cells: vec![CellId(center)],
            },
        ));
        let closed: Vec<u32> = ok(handle(dir.path(), "t", Request::Board))["cells"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|c| c["state"] == "closed")
            .map(|c| c["id"].as_u64().unwrap() as u32)
            .take(2)
            .collect();
        std::thread::scope(|scope| {
            for &cell in &closed {
                let dir = dir.path();
                scope.spawn(move || {
                    for _ in 0..20 {
                        ok(handle(
                            dir,
                            "t",
                            Request::Flag {
                                cells: vec![CellId(cell)],
                            },
                        ));
                        ok(handle(
                            dir,
                            "t",
                            Request::Unflag {
                                cells: vec![CellId(cell)],
                            },
                        ));
                    }
                });
            }
        });
        let text = fs::read_to_string(dir.path().join("t.json")).unwrap();
        let saved: SavedGame = serde_json::from_str(&text).unwrap();
        // One open, then 40 marks from each thread.
        assert_eq!(saved.moves.len(), 1 + 40 * closed.len());
    }

    #[test]
    fn a_saved_game_replays_between_calls() {
        let dir = tempfile::tempdir().unwrap();
        let board = new_game(dir.path());
        assert_eq!(board["tiling"], "kite");
        let center = board["cells"].as_array().unwrap().len() as u32 / 2;
        let moved = ok(handle(
            dir.path(),
            "t",
            Request::Open {
                cells: vec![CellId(center)],
            },
        ));
        assert_eq!(moved["changed"], true);
        let again = ok(handle(dir.path(), "t", Request::Board));
        assert_eq!(again["cells"][center as usize]["state"], "open");
        assert_eq!(
            ok(handle(dir.path(), "t", Request::Status))["game"]["status"],
            "playing"
        );
    }

    #[test]
    fn the_assistant_finishes_a_game_and_then_it_is_over() {
        let dir = tempfile::tempdir().unwrap();
        new_game(dir.path());
        assert!(ok(handle(dir.path(), "t", Request::Hint))["cell"].is_u64());
        let mut last = Value::Null;
        for _ in 0..1000 {
            match handle(dir.path(), "t", Request::Step) {
                Response::Result(v) => last = v,
                Response::Error(e) => {
                    assert_eq!(e.code, ErrorCode::NotPlayable);
                    break;
                }
            }
        }
        let status = &last["move"]["status"];
        assert!(status == "won" || status == "lost", "{last}");
        // The app gives the same code: the game is over before the cell is
        // off the board.
        let far = Request::Open {
            cells: vec![CellId(99_999)],
        };
        let Response::Error(e) = handle(dir.path(), "t", far) else {
            panic!("a move on a finished game was played");
        };
        assert_eq!(e.code, ErrorCode::NotPlayable);
    }

    #[test]
    fn missing_games_bad_names_bad_cells_and_stats_are_refused() {
        let dir = tempfile::tempdir().unwrap();
        let code = |r: Response| match r {
            Response::Error(e) => e.code,
            Response::Result(v) => panic!("unexpected result {v}"),
        };
        assert_eq!(
            code(handle(dir.path(), "t", Request::Board)),
            ErrorCode::Usage
        );
        assert_eq!(
            code(handle(dir.path(), "../x", Request::Board)),
            ErrorCode::Usage
        );
        let long = "x".repeat(33);
        let Response::Error(e) = handle(dir.path(), &long, Request::Board) else {
            panic!("a 33-character name was accepted");
        };
        assert!(e.message.contains("1 to 32 ASCII"), "{}", e.message);
        new_game(dir.path());
        let far = Request::Flag {
            cells: vec![CellId(100_000)],
        };
        assert_eq!(code(handle(dir.path(), "t", far)), ErrorCode::InvalidCell);
        let stats = Request::Stats {
            tiling: None,
            level: None,
        };
        assert_eq!(code(handle(dir.path(), "t", stats)), ErrorCode::Usage);
        assert_eq!(
            code(handle(dir.path(), "t", Request::Themes)),
            ErrorCode::Usage
        );
    }

    #[test]
    fn a_new_game_keeps_the_last_tiling_unless_told_otherwise() {
        let dir = tempfile::tempdir().unwrap();
        new_game(dir.path());
        let next = ok(handle(
            dir.path(),
            "t",
            Request::NewGame {
                tiling: None,
                level: None,
                seed: Some(1),
            },
        ));
        assert_eq!(next["tiling"], "kite");
    }
}
