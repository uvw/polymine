//! Keeps a panic inside the call that hit it. Tauri never answers a command
//! that panics on its thread pool, so the UI's queue would wait forever, and on
//! macOS a panic on the main thread unwinds into the webview's handler and
//! aborts. Every command and every `polymine-cli` request runs through here and
//! answers with an error instead. The panic hook has already logged the
//! panic's place and backtrace by then.

use std::future::Future;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::task::Poll;

use crate::error::AppError;

/// Runs `body`, or returns `None` after logging that `what` panicked.
pub fn catch<T>(what: &str, body: impl FnOnce() -> T) -> Option<T> {
    catch_unwind(AssertUnwindSafe(body))
        .inspect_err(|_| log::error!("{what} panicked and answered with an error"))
        .ok()
}

/// Runs the body of the command `name`, turning a panic into
/// [`AppError::Panicked`].
pub fn command<T>(
    name: &'static str,
    body: impl FnOnce() -> Result<T, AppError>,
) -> Result<T, AppError> {
    catch(name, body).unwrap_or(Err(AppError::Panicked(name)))
}

/// [`command`] for an `async` command's body.
pub async fn command_async<T>(
    name: &'static str,
    body: impl Future<Output = Result<T, AppError>>,
) -> Result<T, AppError> {
    let mut body = std::pin::pin!(body);
    std::future::poll_fn(|cx| {
        catch(name, || body.as_mut().poll(cx)).unwrap_or(Poll::Ready(Err(AppError::Panicked(name))))
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::App;
    use crate::session::NewGameRequest;
    use polymine_core::{Level, TilingId};

    fn app() -> (tempfile::TempDir, App) {
        let dir = tempfile::tempdir().unwrap();
        let app = App::load(Some(&dir.path().join("c")), Some(&dir.path().join("d")));
        (dir, app)
    }

    #[test]
    fn a_panicking_command_answers_and_the_next_one_runs() {
        let (_dir, app) = app();
        let result: Result<(), AppError> = command("hint", || {
            app.with_game(|_| panic!("solver bug"));
            Ok(())
        });
        let error = result.unwrap_err();
        assert!(matches!(error, AppError::Panicked("hint")));
        assert_eq!(
            serde_json::to_string(&error).unwrap(),
            "\"hint failed with an internal error; the log has the details\""
        );
        // The panic poisoned the session's lock while it held it.
        let request = NewGameRequest {
            tiling: TilingId::Square,
            level: Level::Beginner,
            custom: None,
        };
        let started = command("new_game", || app.new_game(request)).unwrap();
        assert_eq!(started.config.tiling, TilingId::Square);
        assert_eq!(app.snapshot().revision, started.revision);
    }

    #[test]
    fn a_command_that_returns_passes_its_result_through() {
        assert_eq!(command("fit_board", || Ok(7)).unwrap(), 7);
        let refused: Result<(), AppError> = command("load_save", || Err(AppError::NothingToSave));
        assert!(matches!(refused, Err(AppError::NothingToSave)));
    }

    #[test]
    fn a_panicking_async_command_answers() {
        fn download() -> Result<(), AppError> {
            panic!("download bug")
        }
        let panicked = tauri::async_runtime::block_on(command_async("install_update", async {
            std::future::ready(()).await;
            download()
        }));
        assert!(matches!(
            panicked,
            Err(AppError::Panicked("install_update"))
        ));
        let answered = tauri::async_runtime::block_on(command_async("check_for_update", async {
            Ok(Some(3))
        }));
        assert_eq!(answered.unwrap(), Some(3));
    }
}
