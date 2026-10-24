//! Answers `polymine-cli` requests through the same `App` methods the window
//! uses, and tells the window what changed so it can show it.

use std::path::PathBuf;

use polymine_core::{CellId, Level, Mark};
use polymine_ipc::moves;
use polymine_ipc::view::{self, MoveView};
use polymine_ipc::{ErrorBody, ErrorCode, InstanceName, Request, Response};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::app::{ActionResult, App, CellAction};
use crate::error::AppError;
use crate::session::NewGameRequest;

/// The event the window listens to for changes made from outside it.
pub const EXTERNAL_EVENT: &str = "polymine://external";

/// A change made from outside the window: one action to animate, or a new
/// game or state the window should reload.
#[derive(Clone, Debug, Serialize, Deserialize, specta::Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ExternalChange {
    Action { result: ActionResult },
    Reload,
}

/// What `status` reports about the instance itself.
#[derive(Clone, Debug)]
pub struct InstanceInfo {
    pub name: InstanceName,
    pub config_dir: Option<PathBuf>,
    pub data_dir: Option<PathBuf>,
}

fn app_error(error: &AppError) -> ErrorBody {
    match error {
        AppError::Game(e) => ErrorBody::new(ErrorCode::InvalidValue, e.to_string()),
        AppError::InvalidCell { len, .. } => moves::invalid_cell(error.to_string(), *len),
        AppError::Io(e) => ErrorBody::new(ErrorCode::Internal, e.to_string()),
        // Only the window's theme and save commands raise these.
        AppError::Theme(_)
        | AppError::NoThemesFolder
        | AppError::OpenFolder(_)
        | AppError::SaveName(_)
        | AppError::NoSave(_)
        | AppError::NothingToSave
        | AppError::NoSavesFolder => ErrorBody::new(ErrorCode::Internal, error.to_string()),
    }
}

fn check_playable(app: &App) -> Result<(), ErrorBody> {
    app.with_game(moves::check_playable)
}

/// Plays `action` on each cell in turn, stopping if the game ends. Each move
/// checks its cell again as it lands, since a new game may have changed the
/// board since [`moves::check_move`].
fn play(
    app: &App,
    cells: &[CellId],
    changes: &mut Vec<ExternalChange>,
    action: CellAction,
) -> Result<Value, ErrorBody> {
    app.with_game(|g| moves::check_move(g, cells))?;
    let mut updates = Vec::new();
    for &cell in cells {
        let (result, resumed) = app
            .play_from_outside(cell, action)
            .map_err(|e| app_error(&e))?;
        if resumed {
            changes.push(ExternalChange::Reload);
        }
        let over = result.update.status.is_over();
        updates.push(result.update.clone());
        changes.push(ExternalChange::Action { result });
        if over {
            break;
        }
    }
    let view = app.with_game(|g| MoveView::from_updates(&updates, g));
    Ok(json!(view))
}

/// Answers one request. Returns the reply and the changes to show.
pub fn handle(app: &App, info: &InstanceInfo, request: Request) -> (Response, Vec<ExternalChange>) {
    let mut changes = Vec::new();
    let result = answer(app, info, request, &mut changes);
    let response = match result {
        Ok(value) => Response::Result(value),
        Err(error) => Response::Error(error),
    };
    (response, changes)
}

fn answer(
    app: &App,
    info: &InstanceInfo,
    request: Request,
    changes: &mut Vec<ExternalChange>,
) -> Result<Value, ErrorBody> {
    match request {
        Request::Status => {
            let (config, status, counters) =
                app.with_game(|g| (*g.config(), g.status(), g.counters()));
            Ok(json!({
                "instance": info.name,
                "version": env!("CARGO_PKG_VERSION"),
                "pid": std::process::id(),
                "configDir": info.config_dir,
                "dataDir": info.data_dir,
                "log": polymine_ipc::instance::log_file(&info.name),
                "game": {
                    "tiling": config.tiling,
                    "level": config.level,
                    "status": status,
                    "paused": app.is_paused(),
                    "counters": counters,
                },
            }))
        }
        Request::Board => Ok(json!(app.with_game(view::board))),
        Request::NewGame {
            tiling,
            level,
            seed,
        } => {
            let settings = app.settings();
            let level = level.unwrap_or(settings.level);
            let request = NewGameRequest {
                tiling: tiling.unwrap_or(settings.tiling),
                level,
                custom: (level == Level::Custom).then_some(settings.custom),
            };
            let started = match seed {
                Some(seed) => app.new_game_with_seed(request, seed),
                None => app.new_game(request),
            };
            started.map_err(|e| app_error(&e))?;
            changes.push(ExternalChange::Reload);
            Ok(json!(app.with_game(view::board)))
        }
        Request::Open { cells } => play(app, &cells, changes, CellAction::Primary),
        Request::Flag { cells } => play(app, &cells, changes, CellAction::Mark(Mark::Flag)),
        Request::Unflag { cells } => play(app, &cells, changes, CellAction::Mark(Mark::None)),
        Request::Hint => {
            check_playable(app)?;
            Ok(json!(app.hint()))
        }
        Request::Step => {
            check_playable(app)?;
            if app.is_paused() {
                app.set_paused(false);
                changes.push(ExternalChange::Reload);
            }
            let Some(assisted) = app.assist(true).map_err(|e| app_error(&e))? else {
                return Ok(Value::Null);
            };
            let updates: Vec<_> = assisted.result.iter().map(|r| r.update.clone()).collect();
            if let Some(result) = assisted.result {
                changes.push(ExternalChange::Action { result });
            }
            let moved = app.with_game(|g| MoveView::from_updates(&updates, g));
            Ok(json!({ "suggestion": assisted.suggestion, "move": moved }))
        }
        Request::Stats { tiling, level } => {
            let current = app.with_game(|g| *g.config());
            let level = match level.unwrap_or(current.level) {
                Level::Custom => Level::Beginner,
                level => level,
            };
            Ok(json!(app.stats(
                tiling.unwrap_or(current.tiling),
                level,
                None
            )))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use polymine_core::{GameStatus, TilingId};

    fn ended(game: &Value) -> bool {
        game["status"] == json!(GameStatus::Won) || game["status"] == json!(GameStatus::Lost)
    }

    fn setup() -> (tempfile::TempDir, App, InstanceInfo) {
        let dir = tempfile::tempdir().unwrap();
        let app = App::load(Some(&dir.path().join("c")), Some(&dir.path().join("d")));
        let info = InstanceInfo {
            name: InstanceName::new("test").unwrap(),
            config_dir: None,
            data_dir: None,
        };
        (dir, app, info)
    }

    fn result(response: Response) -> Value {
        match response {
            Response::Result(value) => value,
            Response::Error(e) => panic!("unexpected error {e:?}"),
        }
    }

    fn error(response: Response) -> ErrorBody {
        match response {
            Response::Error(e) => e,
            Response::Result(v) => panic!("unexpected result {v}"),
        }
    }

    fn new_square(app: &App, info: &InstanceInfo) -> Vec<ExternalChange> {
        let request = Request::NewGame {
            tiling: Some(TilingId::Square),
            level: Some(Level::Beginner),
            seed: Some(42),
        };
        let (response, changes) = handle(app, info, request);
        assert_eq!(result(response)["cells"].as_array().unwrap().len(), 100);
        changes
    }

    #[test]
    fn status_names_the_instance_and_its_game() {
        let (_dir, app, info) = setup();
        let status = result(handle(&app, &info, Request::Status).0);
        assert_eq!(status["instance"], "test");
        assert_eq!(status["game"]["status"], "ready");
    }

    #[test]
    fn a_new_game_reloads_the_window() {
        let (_dir, app, info) = setup();
        let changes = new_square(&app, &info);
        assert!(matches!(changes.as_slice(), [ExternalChange::Reload]));
    }

    #[test]
    fn moves_report_changes_and_animate_in_the_window() {
        let (_dir, app, info) = setup();
        new_square(&app, &info);
        let (response, changes) = handle(
            &app,
            &info,
            Request::Open {
                cells: vec![CellId(55)],
            },
        );
        let moved = result(response);
        assert_eq!(moved["changed"], true);
        assert_eq!(moved["status"], "playing");
        assert!(matches!(
            changes.as_slice(),
            [ExternalChange::Action { .. }]
        ));
        let board = result(handle(&app, &info, Request::Board).0);
        assert_eq!(board["cells"][55]["state"], "open");
    }

    #[test]
    fn flags_go_on_and_off() {
        let (_dir, app, info) = setup();
        new_square(&app, &info);
        handle(
            &app,
            &info,
            Request::Open {
                cells: vec![CellId(55)],
            },
        );
        let closed = result(handle(&app, &info, Request::Board).0)["cells"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["state"] == "closed")
            .map(|c| c["id"].as_u64().unwrap() as u32)
            .unwrap();
        let flagged = result(
            handle(
                &app,
                &info,
                Request::Flag {
                    cells: vec![CellId(closed)],
                },
            )
            .0,
        );
        assert_eq!(flagged["cells"][0]["state"], "flagged");
        let cleared = result(
            handle(
                &app,
                &info,
                Request::Unflag {
                    cells: vec![CellId(closed)],
                },
            )
            .0,
        );
        assert_eq!(cleared["cells"][0]["state"], "closed");
    }

    #[test]
    fn bad_cells_and_empty_lists_are_refused_with_a_hint() {
        let (_dir, app, info) = setup();
        new_square(&app, &info);
        let e = error(
            handle(
                &app,
                &info,
                Request::Open {
                    cells: vec![CellId(100)],
                },
            )
            .0,
        );
        assert_eq!(e.code, ErrorCode::InvalidCell);
        assert!(e.hint.unwrap().contains("0 to 99"));
        let e = error(handle(&app, &info, Request::Flag { cells: vec![] }).0);
        assert_eq!(e.code, ErrorCode::Usage);
    }

    #[test]
    fn the_assistant_plays_to_the_end_and_then_refuses() {
        let (_dir, app, info) = setup();
        new_square(&app, &info);
        let hint = result(handle(&app, &info, Request::Hint).0);
        assert!(hint["cell"].is_u64());
        for _ in 0..500 {
            let (response, _) = handle(&app, &info, Request::Step);
            if let Response::Error(e) = response {
                assert_eq!(e.code, ErrorCode::NotPlayable);
                break;
            }
        }
        let status = result(handle(&app, &info, Request::Status).0);
        assert!(ended(&status["game"]));
        // Headless games give the same code: the game is over before the
        // cell is off the board.
        for cell in [0, 99_999] {
            let e = error(
                handle(
                    &app,
                    &info,
                    Request::Open {
                        cells: vec![CellId(cell)],
                    },
                )
                .0,
            );
            assert_eq!(e.code, ErrorCode::NotPlayable);
        }
        // Played from outside, so it never reaches the champions table.
        let records = result(
            handle(
                &app,
                &info,
                Request::Stats {
                    tiling: None,
                    level: None,
                },
            )
            .0,
        );
        assert_eq!(records["champions"], json!([]));
    }

    #[test]
    fn a_move_resumes_a_paused_game() {
        let (_dir, app, info) = setup();
        new_square(&app, &info);
        handle(
            &app,
            &info,
            Request::Open {
                cells: vec![CellId(55)],
            },
        );
        app.set_paused(true);
        let (_, changes) = handle(&app, &info, Request::Step);
        assert!(matches!(changes.first(), Some(ExternalChange::Reload)));
        assert!(!app.is_paused());
    }
}
