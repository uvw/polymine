//! Requests and responses, one JSON object per line.

use polymine_core::{CellId, Level, TilingId};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Bumped when a request or reply changes shape. The app refuses other
/// versions, so a stale CLI fails clearly instead of misreading replies.
pub const VERSION: u32 = 2;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "method", content = "params", rename_all = "camelCase")]
pub enum Request {
    /// The instance, its folders and the current game's status.
    Status,
    /// Everything a player can see on the board.
    Board,
    /// Starts a game. Missing fields keep the current tiling or level.
    NewGame {
        tiling: Option<TilingId>,
        level: Option<Level>,
        seed: Option<u64>,
    },
    /// Clicks each cell in turn, as a left click would: opens a closed cell or
    /// chords an open number. Stops when the game ends.
    Open {
        cells: Vec<CellId>,
    },
    Flag {
        cells: Vec<CellId>,
    },
    Unflag {
        cells: Vec<CellId>,
    },
    /// The assistant's next move, without playing it.
    Hint,
    /// Lets the assistant play one move.
    Step,
    /// Statistics and champions for a tiling and level.
    Stats {
        tiling: Option<TilingId>,
        level: Option<Level>,
    },
}

/// A request line: the protocol version next to the request itself.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Envelope {
    pub version: u32,
    #[serde(flatten)]
    pub request: Request,
}

/// A reply line: `{"result": ...}` or `{"error": {...}}`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Response {
    Result(Value),
    Error(ErrorBody),
}

/// Defines [`ErrorCode`] and its `ALL` list from one variant list, so the
/// list can't miss a code.
macro_rules! error_codes {
    ($($(#[$doc:meta])* $code:ident,)*) => {
        #[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
        #[serde(rename_all = "snake_case")]
        pub enum ErrorCode {
            $($(#[$doc])* $code,)*
        }

        impl ErrorCode {
            /// Every code, in declaration order.
            pub const ALL: &[Self] = &[$(Self::$code,)*];
        }
    };
}

error_codes! {
    /// No instance of that name answers.
    NotRunning,
    /// The instance didn't reply in time.
    Timeout,
    /// The instance is answering as many requests as it takes at once.
    /// Retrying in a moment works.
    Busy,
    /// The request is malformed or names something that doesn't exist.
    Usage,
    /// CLI and app speak different protocol versions.
    VersionMismatch,
    /// A cell id is outside the board.
    InvalidCell,
    /// The game is over, so it takes no more moves.
    NotPlayable,
    /// The value is out of range.
    InvalidValue,
    /// Something failed inside the app or on disk.
    Internal,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorBody {
    pub code: ErrorCode,
    pub message: String,
    /// What to do next, for agents and people alike.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hint: Option<String>,
}

impl ErrorBody {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            hint: None,
        }
    }

    #[must_use]
    pub fn with_hint(mut self, hint: impl Into<String>) -> Self {
        self.hint = Some(hint.into());
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn requests_travel_as_method_and_params() {
        let line = serde_json::to_string(&Envelope {
            version: VERSION,
            request: Request::Open {
                cells: vec![CellId(3)],
            },
        })
        .unwrap();
        assert_eq!(
            line,
            r#"{"version":2,"method":"open","params":{"cells":[3]}}"#
        );
        let back: Envelope = serde_json::from_str(&line).unwrap();
        assert_eq!(
            back.request,
            Request::Open {
                cells: vec![CellId(3)]
            }
        );
        let status: Envelope = serde_json::from_str(r#"{"version":2,"method":"status"}"#).unwrap();
        assert_eq!(status.request, Request::Status);
    }

    #[test]
    fn replies_are_result_or_error() {
        let ok = serde_json::to_string(&Response::Result(serde_json::json!({"a": 1}))).unwrap();
        assert_eq!(ok, r#"{"result":{"a":1}}"#);
        let error =
            Response::Error(ErrorBody::new(ErrorCode::NotRunning, "no").with_hint("start it"));
        assert_eq!(
            serde_json::to_string(&error).unwrap(),
            r#"{"error":{"code":"not_running","message":"no","hint":"start it"}}"#
        );
    }

    #[test]
    fn every_error_code_has_its_wire_name() {
        let names: Vec<String> = ErrorCode::ALL
            .iter()
            .map(|code| {
                serde_json::to_value(code)
                    .unwrap()
                    .as_str()
                    .unwrap()
                    .to_owned()
            })
            .collect();
        assert_eq!(
            names,
            [
                "not_running",
                "timeout",
                "busy",
                "usage",
                "version_mismatch",
                "invalid_cell",
                "not_playable",
                "invalid_value",
                "internal",
            ]
        );
    }
}
