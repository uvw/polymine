//! The checks a request passes before it plays a move, shared so the app and
//! headless games refuse a bad move with the same error.

use polymine_core::{CellId, Game};

use crate::protocol::{ErrorBody, ErrorCode};

/// Refuses a move on a finished game.
pub fn check_playable(game: &Game) -> Result<(), ErrorBody> {
    if game.status().is_over() {
        return Err(ErrorBody::new(ErrorCode::NotPlayable, "the game is over")
            .with_hint("start another with `new`"));
    }
    Ok(())
}

/// Refuses a move on a finished game first, then an empty list, then a list
/// naming a cell off the board, before any of it is played.
pub fn check_move(game: &Game, cells: &[CellId]) -> Result<(), ErrorBody> {
    check_playable(game)?;
    if cells.is_empty() {
        return Err(ErrorBody::new(ErrorCode::Usage, "name at least one cell"));
    }
    let len = game.board().len() as u32;
    match cells.iter().find(|c| c.0 >= len) {
        Some(bad) => Err(invalid_cell(
            format!("cell {} is outside the board", bad.0),
            len,
        )),
        None => Ok(()),
    }
}

/// An error for a cell off a board of `len` cells.
pub fn invalid_cell(message: impl Into<String>, len: u32) -> ErrorBody {
    ErrorBody::new(ErrorCode::InvalidCell, message).with_hint(format!(
        "cell ids run from 0 to {}; `board` lists them",
        len.saturating_sub(1)
    ))
}

#[cfg(test)]
mod tests {
    use polymine_core::{GameConfig, Level, TilingId};

    use super::*;

    fn new_game() -> Game {
        Game::new(GameConfig::preset(TilingId::Square, Level::Beginner), 7).unwrap()
    }

    #[test]
    fn a_finished_game_is_refused_before_the_cells_are_checked() {
        let mut game = new_game();
        for id in 0..game.board().len() as u32 {
            if game.status().is_over() {
                break;
            }
            game.reveal(CellId(id));
        }
        assert!(game.status().is_over());
        for cells in [vec![], vec![CellId(99_999)], vec![CellId(0)]] {
            let e = check_move(&game, &cells).unwrap_err();
            assert_eq!(e.code, ErrorCode::NotPlayable, "{cells:?}");
        }
    }

    #[test]
    fn a_game_in_play_refuses_empty_lists_and_cells_off_the_board() {
        let game = new_game();
        assert_eq!(check_move(&game, &[]).unwrap_err().code, ErrorCode::Usage);
        let e = check_move(&game, &[CellId(0), CellId(99_999)]).unwrap_err();
        assert_eq!(e.code, ErrorCode::InvalidCell);
        let last = game.board().len() - 1;
        assert!(e.hint.unwrap().contains(&format!("0 to {last};")));
        assert!(check_move(&game, &[CellId(0)]).is_ok());
    }
}
