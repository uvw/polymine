//! The errors every part of the crate returns.

use std::io;
use std::time::Duration;

pub type Result<T, E = Error> = std::result::Result<T, E>;

/// Why a request or a download failed. Each variant is something the UI can
/// tell the player in its own words.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum Error {
    /// The policy refused the URL or a redirect to it: not HTTPS, a host off
    /// the allowlist, a port other than 443, or credentials in the URL.
    #[error("not allowed: {0}")]
    NotAllowed(String),
    /// The host couldn't be reached: no network, a failed DNS lookup, a
    /// refused connection, a failed TLS handshake, or a dropped connection.
    #[error("offline: {0}")]
    Offline(String),
    /// The request ran past the policy's connect or total timeout.
    #[error("the request timed out")]
    Timeout,
    /// A response, a file, or a folder is over one of the caller's limits.
    #[error("too large: {0}")]
    TooLarge(String),
    /// The server is rate limiting this client. `retry_after` is how long it
    /// asked to wait, when it said.
    #[error("rate limited")]
    RateLimited { retry_after: Option<Duration> },
    /// The server answered with a status other than success.
    #[error("HTTP status {0}")]
    Status(u16),
    /// The server's answer couldn't be used: malformed JSON, a redirect
    /// without a location, or too many redirects.
    #[error("bad response: {0}")]
    BadResponse(String),
    /// A source URL this crate can't read, such as a GitHub URL that names no
    /// repository.
    #[error("invalid URL: {0}")]
    InvalidUrl(String),
    /// Remote content that is never written to disk: a symlink, a submodule,
    /// or a file name that could escape the target folder.
    #[error("refused: {0}")]
    Refused(String),
    /// Reading or writing the cache or the download folder failed.
    #[error(transparent)]
    Io(#[from] io::Error),
}
