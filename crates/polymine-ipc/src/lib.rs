//! What the Polymine app and `polymine-cli` share.
//!
//! An app instance listens on a local socket named after its instance and
//! registers itself in a per-user folder. The CLI finds it by name, sends one
//! JSON request line and reads one JSON response line. Boards are described
//! through [`view`] and moves checked through [`moves`], so the app and the
//! CLI's headless games answer alike.
//! [`themes`] reads player theme folders for the app, and for anything that
//! downloads one. [`history`] reads the history file for the app and for
//! `polymine-cli sync`.

pub mod history;
pub mod instance;
pub mod moves;
pub mod names;
pub mod protocol;
pub mod themes;
pub mod transport;
pub mod view;

pub use instance::{InstanceName, Registration, Registry};
pub use protocol::{ErrorBody, ErrorCode, Request, Response};
