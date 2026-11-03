//! Polymine's network layer.
//!
//! Every request goes through a [`Client`] built from a [`Policy`]: HTTPS only,
//! to the hosts the caller lists, with timeouts, a response size cap, and a
//! redirect limit that rechecks every hop. Requests carry a `User-Agent` of
//! `Polymine/<version>` and never cookies. TLS uses rustls with the operating
//! system's certificate verifier.
//!
//! A [`Cache`] keeps GET responses on disk and revalidates them with `ETag` and
//! `Last-Modified`. [`GitHub`] lists and downloads a repository folder or a
//! gist into a staging folder under the caller's [`Limits`]. [`JsonApi`] sends
//! typed GET and POST requests to a web API, such as a leaderboard.
//!
//! The client is blocking. Call it from a worker thread, such as Tauri's
//! `spawn_blocking`, never from the UI thread.

mod cache;
mod client;
mod error;
mod github;
mod json;
mod policy;
#[cfg(any(test, feature = "test-support"))]
pub mod test_server;

pub use cache::Cache;
pub use client::{Client, Request, Response, Token};
pub use error::{Error, Result};
pub use github::{
    Download, GITHUB_HOSTS, GitHub, Limits, Listing, RemoteFile, Source, remove_partial_downloads,
};
pub use json::JsonApi;
pub use policy::{Policy, USER_AGENT};
