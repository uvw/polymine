//! Errors returned to the UI.

use polymine_core::GameError;
use serde::{Serialize, Serializer};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error(transparent)]
    Game(#[from] GameError),
    /// The board has `len` cells, so `cell` names none of them.
    #[error("cell {cell} is outside the board")]
    InvalidCell { cell: u32, len: u32 },
    #[error("could not save data: {0}")]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Theme(#[from] polymine_ipc::themes::ThemeError),
    #[error("this system has no data folder for themes")]
    NoThemesFolder,
    #[error("could not open the themes folder: {0}")]
    OpenFolder(std::io::Error),
    #[error(
        r#"{0:?} can't name a save. Use 1 to 40 characters, without < > : " / \ | ? * or control characters. Don't end it with a dot or use a Windows device name such as CON or COM1."#
    )]
    SaveName(String),
    #[error("there's no save named {0:?}")]
    NoSave(String),
    #[error("only a game in play can be saved")]
    NothingToSave,
    #[error("this system has no data folder for saves")]
    NoSavesFolder,
    #[error("this copy of Polymine doesn't update itself")]
    UpdatesOff,
    #[error("could not check for updates: {0}")]
    UpdateCheck(String),
    #[error("there's no update to install; check for updates first")]
    NoUpdate,
    #[error("the update is already installing")]
    UpdateBusy,
    #[error("could not install the update: {0}")]
    UpdateInstall(String),
    #[error("could not open the release notes: {0}")]
    OpenLink(std::io::Error),
    /// The command of that name panicked; see [`crate::guard`].
    #[error("{0} failed with an internal error; the log has the details")]
    Panicked(&'static str),
}

impl From<polymine_core::ConfigError> for AppError {
    fn from(e: polymine_core::ConfigError) -> Self {
        Self::Game(e.into())
    }
}

/// Tauri sends command errors to JavaScript as their message.
impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

/// The UI sees an error as the string its [`Serialize`] impl writes.
impl specta::Type for AppError {
    fn definition(types: &mut specta::Types) -> specta::datatype::DataType {
        String::definition(types)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn errors_reach_the_ui_as_their_message() {
        let error = AppError::from(std::io::Error::other("disk full"));
        assert_eq!(
            serde_json::to_string(&error).unwrap(),
            "\"could not save data: disk full\""
        );
    }

    #[test]
    fn config_errors_convert_through_game_errors() {
        let config = polymine_core::GameConfig::custom(polymine_core::TilingId::Square, 1, 1, 1);
        let error = AppError::from(config.unwrap_err());
        assert!(matches!(error, AppError::Game(_)));
        assert!(error.to_string().contains("board sides"));
    }
}
