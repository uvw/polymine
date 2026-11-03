//! What the client may contact, and how long and how much it may read.

use std::time::Duration;

use ureq::http::Uri;

use crate::error::{Error, Result};

/// Sent with every request. It names the app and its version and nothing about
/// the player or the machine.
pub const USER_AGENT: &str = concat!("Polymine/", env!("CARGO_PKG_VERSION"));

/// The rules every request goes through. Only HTTPS to the listed hosts on
/// port 443 passes; redirects are checked against the same rules hop by hop.
#[derive(Clone, Debug)]
pub struct Policy {
    hosts: Vec<String>,
    connect_timeout: Duration,
    timeout: Duration,
    max_response_bytes: u64,
    max_redirects: u32,
    #[cfg(any(test, feature = "test-support"))]
    plain_http_loopback: bool,
}

impl Policy {
    /// A policy for these hosts, matched exactly and without regard to case,
    /// with a 10 second connect timeout, a 30 second total timeout, a 4 MiB
    /// response cap, and up to five redirects.
    pub fn new<I, S>(hosts: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        Self {
            hosts: hosts
                .into_iter()
                .map(|h| normalize_host(h.as_ref()))
                .collect(),
            connect_timeout: Duration::from_secs(10),
            timeout: Duration::from_secs(30),
            max_response_bytes: 4 * 1024 * 1024,
            max_redirects: 5,
            #[cfg(any(test, feature = "test-support"))]
            plain_http_loopback: false,
        }
    }

    /// The time to set up a connection, including DNS and the TLS handshake.
    #[must_use]
    pub fn with_connect_timeout(mut self, timeout: Duration) -> Self {
        self.connect_timeout = timeout;
        self
    }

    /// The time for a whole request, from the first connection through every
    /// redirect to the end of the response body.
    #[must_use]
    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }

    /// The largest response body any request may read. A request can ask for
    /// a lower cap, never a higher one.
    #[must_use]
    pub fn with_max_response_bytes(mut self, bytes: u64) -> Self {
        self.max_response_bytes = bytes;
        self
    }

    #[must_use]
    pub fn with_max_redirects(mut self, redirects: u32) -> Self {
        self.max_redirects = redirects;
        self
    }

    /// Lets tests reach a local server over plain HTTP. Only loopback
    /// addresses qualify, and the switch exists only in this crate's tests and
    /// under the `test-support` feature, which only dev-dependencies turn on.
    #[cfg(any(test, feature = "test-support"))]
    #[must_use]
    pub fn allow_plain_http_to_loopback(mut self) -> Self {
        self.plain_http_loopback = true;
        self
    }

    pub fn hosts(&self) -> &[String] {
        &self.hosts
    }

    pub fn connect_timeout(&self) -> Duration {
        self.connect_timeout
    }

    pub fn timeout(&self) -> Duration {
        self.timeout
    }

    pub fn max_response_bytes(&self) -> u64 {
        self.max_response_bytes
    }

    pub fn max_redirects(&self) -> u32 {
        self.max_redirects
    }

    pub(crate) fn https_only(&self) -> bool {
        !self.plain_http_switch()
    }

    /// Parses `url` and checks it against the policy.
    pub fn check(&self, url: &str) -> Result<Uri> {
        let uri: Uri = url
            .parse()
            .map_err(|_| Error::NotAllowed(format!("{url} is not a valid URL")))?;
        let authority = uri
            .authority()
            .ok_or_else(|| Error::NotAllowed(format!("{url} names no host")))?;
        if authority.as_str().contains('@') {
            return Err(Error::NotAllowed(format!("{url} carries credentials")));
        }
        let host = normalize_host(authority.host());
        let plain = self.plain_allowed(&uri, &host);
        if uri.scheme_str() != Some("https") && !plain {
            return Err(Error::NotAllowed(format!("{url} is not HTTPS")));
        }
        if !self.hosts.contains(&host) {
            return Err(Error::NotAllowed(format!("{host} is not an allowed host")));
        }
        if !plain && uri.port_u16().is_some_and(|port| port != 443) {
            return Err(Error::NotAllowed(format!(
                "{url} uses a port other than 443"
            )));
        }
        Ok(uri)
    }

    fn plain_allowed(&self, uri: &Uri, host: &str) -> bool {
        self.plain_http_switch()
            && uri.scheme_str() == Some("http")
            && host
                .parse::<std::net::IpAddr>()
                .is_ok_and(|ip| ip.is_loopback())
    }

    #[cfg(any(test, feature = "test-support"))]
    fn plain_http_switch(&self) -> bool {
        self.plain_http_loopback
    }

    #[cfg(not(any(test, feature = "test-support")))]
    #[allow(clippy::unused_self)]
    fn plain_http_switch(&self) -> bool {
        false
    }
}

fn normalize_host(host: &str) -> String {
    host.trim_end_matches('.').to_ascii_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn github() -> Policy {
        Policy::new(["api.github.com", "Raw.GitHubusercontent.com"])
    }

    #[test]
    fn https_to_a_listed_host_passes() {
        let policy = github();
        assert!(policy.check("https://api.github.com/repos/a/b").is_ok());
        assert!(policy.check("https://API.github.com./x").is_ok());
        assert!(
            policy
                .check("https://raw.githubusercontent.com:443/a")
                .is_ok()
        );
    }

    #[test]
    fn everything_else_is_refused() {
        let policy = github();
        for url in [
            "http://api.github.com/x",
            "ftp://api.github.com/x",
            "https://example.com/x",
            "https://api.github.com.example.com/x",
            "https://github.com/x",
            "https://api.github.com:8443/x",
            "https://user:pass@api.github.com/x",
            "https://token@api.github.com/x",
            "/relative/path",
            "not a url",
            "",
        ] {
            assert!(
                matches!(policy.check(url), Err(Error::NotAllowed(_))),
                "{url} should be refused"
            );
        }
    }

    #[test]
    fn plain_http_needs_the_test_switch_and_a_loopback_address() {
        let strict = Policy::new(["127.0.0.1", "example.com"]);
        assert!(strict.check("http://127.0.0.1:8080/x").is_err());
        assert!(strict.https_only());

        let local = strict.allow_plain_http_to_loopback();
        assert!(local.check("http://127.0.0.1:8080/x").is_ok());
        assert!(local.check("http://example.com/x").is_err());
        assert!(local.check("http://example.com:8080/x").is_err());
        assert!(!local.https_only());
    }

    #[test]
    fn the_user_agent_names_only_the_app_and_version() {
        assert_eq!(
            USER_AGENT,
            format!("Polymine/{}", env!("CARGO_PKG_VERSION"))
        );
    }
}
