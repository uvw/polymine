//! The HTTP client. Every request, and every redirect it follows, goes through
//! the [`Policy`].

use std::fmt;
use std::io;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use ureq::http::{self, HeaderMap, Uri};
use ureq::tls::{RootCerts, TlsConfig, TlsProvider};
use ureq::{AsSendBody, Body};

use crate::error::{Error, Result};
use crate::policy::{Policy, USER_AGENT};

/// A secret sent as a bearer token. Its `Debug` output hides the value, so it
/// never lands in a log.
#[derive(Clone, PartialEq, Eq)]
pub struct Token(String);

impl Token {
    pub fn new(token: impl Into<String>) -> Self {
        Self(token.into())
    }
}

impl fmt::Debug for Token {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Token(..)")
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Method {
    Get,
    Patch,
    Post,
}

/// One request to send through a [`Client`].
#[derive(Clone, Debug)]
pub struct Request {
    method: Method,
    url: String,
    headers: Vec<(&'static str, String)>,
    token: Option<Token>,
    body: Option<Vec<u8>>,
    max_bytes: Option<u64>,
}

impl Request {
    pub fn get(url: impl Into<String>) -> Self {
        Self::new(Method::Get, url.into(), None)
    }

    pub fn post(url: impl Into<String>, content_type: &str, body: Vec<u8>) -> Self {
        Self::new(Method::Post, url.into(), Some(body)).header("content-type", content_type)
    }

    /// A PATCH, such as GitHub's for editing a gist. Like a POST, it never
    /// follows redirects and skips the cache.
    pub fn patch(url: impl Into<String>, content_type: &str, body: Vec<u8>) -> Self {
        Self::new(Method::Patch, url.into(), Some(body)).header("content-type", content_type)
    }

    fn new(method: Method, url: String, body: Option<Vec<u8>>) -> Self {
        Self {
            method,
            url,
            headers: Vec::new(),
            token: None,
            body,
            max_bytes: None,
        }
    }

    #[must_use]
    pub fn header(mut self, name: &'static str, value: impl Into<String>) -> Self {
        self.headers.push((name, value.into()));
        self
    }

    /// Sends `token` as `Authorization: Bearer`, to this URL's origin only. A
    /// redirect to another scheme, host, or port drops it.
    #[must_use]
    pub fn bearer(mut self, token: Option<&Token>) -> Self {
        self.token = token.cloned();
        self
    }

    /// Caps the response body below the policy's cap.
    #[must_use]
    pub fn max_bytes(mut self, bytes: u64) -> Self {
        self.max_bytes = Some(bytes);
        self
    }

    pub fn url(&self) -> &str {
        &self.url
    }

    pub(crate) fn is_get(&self) -> bool {
        self.method == Method::Get
    }

    pub(crate) fn header_value(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(n, _)| n.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }
}

/// A response read to the end.
#[derive(Clone, Debug)]
pub struct Response {
    pub status: u16,
    /// The URL that answered, after redirects.
    pub url: String,
    pub body: Vec<u8>,
    /// Whether the server answered 304 and the body came from the cache.
    pub from_cache: bool,
    headers: HeaderMap,
}

impl Response {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.get(name).and_then(|v| v.to_str().ok())
    }

    pub(crate) fn headers(&self) -> &HeaderMap {
        &self.headers
    }
}

/// Sends requests under a [`Policy`]. Cloning is cheap and clones share
/// connections.
#[derive(Clone, Debug)]
pub struct Client {
    agent: ureq::Agent,
    policy: Arc<Policy>,
}

impl Client {
    pub fn new(policy: Policy) -> Self {
        let tls = TlsConfig::builder()
            .provider(TlsProvider::Rustls)
            .root_certs(RootCerts::PlatformVerifier)
            .unversioned_rustls_crypto_provider(Arc::new(rustls::crypto::ring::default_provider()))
            .build();
        // Redirects are followed by hand so each hop meets the policy, and
        // the proxy is off because ureq would otherwise read one from the
        // environment.
        let agent = ureq::Agent::config_builder()
            .https_only(policy.https_only())
            .http_status_as_error(false)
            .max_redirects(0)
            .max_redirects_will_error(false)
            .proxy(None)
            .user_agent(USER_AGENT)
            .timeout_connect(Some(policy.connect_timeout()))
            .tls_config(tls)
            .build()
            .new_agent();
        Self {
            agent,
            policy: Arc::new(policy),
        }
    }

    pub fn policy(&self) -> &Policy {
        &self.policy
    }

    /// Sends `request` and reads the response. Statuses outside 2xx become
    /// [`Error::Status`] or [`Error::RateLimited`].
    pub fn send(&self, request: &Request) -> Result<Response> {
        let response = self.execute(request, &[])?;
        if (200..300).contains(&response.status) {
            Ok(response)
        } else {
            Err(status_error(response.status, &response.headers))
        }
    }

    /// Sends `request` plus `extra` headers, follows redirects for GET, and
    /// returns whatever status the last hop answered.
    pub(crate) fn execute(
        &self,
        request: &Request,
        extra: &[(&'static str, String)],
    ) -> Result<Response> {
        let deadline = Instant::now() + self.policy.timeout();
        let cap = request
            .max_bytes
            .map_or(self.policy.max_response_bytes(), |bytes| {
                bytes.min(self.policy.max_response_bytes())
            });
        let mut uri = self.policy.check(&request.url)?;
        let origin = Origin::of(&uri);
        let mut redirects = 0;
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(Error::Timeout);
            }
            let send_token = Origin::of(&uri) == origin;
            let mut response = self.hop(request, extra, &uri, send_token, remaining)?;
            let status = response.status().as_u16();
            if request.method == Method::Get && is_redirect(status) {
                redirects += 1;
                if redirects > self.policy.max_redirects() {
                    return Err(Error::BadResponse(format!(
                        "more than {} redirects from {}",
                        self.policy.max_redirects(),
                        request.url
                    )));
                }
                let location = response
                    .headers()
                    .get(http::header::LOCATION)
                    .and_then(|v| v.to_str().ok())
                    .ok_or_else(|| {
                        Error::BadResponse(format!("a redirect from {uri} has no location"))
                    })?;
                uri = self.policy.check(&resolve(&uri, location))?;
                continue;
            }
            let body = read_body(&mut response, cap, &uri)?;
            return Ok(Response {
                status,
                url: uri.to_string(),
                body,
                from_cache: false,
                headers: response.headers().clone(),
            });
        }
    }

    fn hop(
        &self,
        request: &Request,
        extra: &[(&'static str, String)],
        uri: &Uri,
        send_token: bool,
        remaining: Duration,
    ) -> Result<http::Response<Body>> {
        let method = match request.method {
            Method::Get => http::Method::GET,
            Method::Post => http::Method::POST,
            Method::Patch => http::Method::PATCH,
        };
        let mut builder = http::Request::builder().method(method).uri(uri.clone());
        for (name, value) in request.headers.iter().chain(extra) {
            builder = builder.header(*name, value);
        }
        if let Some(token) = request.token.as_ref().filter(|_| send_token) {
            builder = builder.header(http::header::AUTHORIZATION, format!("Bearer {}", token.0));
        }
        let result = match &request.body {
            None => self.run(builder.body(()), remaining),
            Some(body) => self.run(builder.body(body.as_slice()), remaining),
        };
        result.map_err(|err| map_error(err, uri))
    }

    fn run<S: AsSendBody>(
        &self,
        request: http::Result<http::Request<S>>,
        remaining: Duration,
    ) -> Result<http::Response<Body>, ureq::Error> {
        let request = self
            .agent
            .configure_request(request?)
            .timeout_global(Some(remaining))
            .timeout_connect(Some(self.policy.connect_timeout().min(remaining)))
            .build();
        self.agent.run(request)
    }
}

/// Scheme, host, and port: where a bearer token may go.
#[derive(PartialEq, Eq)]
struct Origin(Option<String>, Option<String>, Option<u16>);

impl Origin {
    fn of(uri: &Uri) -> Self {
        Self(
            uri.scheme_str().map(str::to_ascii_lowercase),
            uri.host().map(str::to_ascii_lowercase),
            uri.port_u16(),
        )
    }
}

fn is_redirect(status: u16) -> bool {
    matches!(status, 301 | 302 | 303 | 307 | 308)
}

/// Resolves a `Location` header against the URL that sent it.
fn resolve(base: &Uri, location: &str) -> String {
    if location.contains("://") {
        return location.to_owned();
    }
    let scheme = base.scheme_str().unwrap_or("https");
    if let Some(rest) = location.strip_prefix("//") {
        return format!("{scheme}://{rest}");
    }
    let authority = base.authority().map_or("", |a| a.as_str());
    if location.starts_with('/') {
        return format!("{scheme}://{authority}{location}");
    }
    let dir = base.path().rsplit_once('/').map_or("", |(dir, _)| dir);
    format!("{scheme}://{authority}{dir}/{location}")
}

fn read_body(response: &mut http::Response<Body>, cap: u64, uri: &Uri) -> Result<Vec<u8>> {
    if response
        .body()
        .content_length()
        .is_some_and(|len| len > cap)
    {
        return Err(too_large(cap, uri));
    }
    // ureq's limit fails the read after the last allowed byte, even at the
    // end of the body, so it gets one byte of slack.
    match response
        .body_mut()
        .with_config()
        .limit(cap.saturating_add(1))
        .read_to_vec()
    {
        Ok(body) if body.len() as u64 <= cap => Ok(body),
        Ok(_) | Err(ureq::Error::BodyExceedsLimit(_)) => Err(too_large(cap, uri)),
        Err(err) => Err(map_error(err, uri)),
    }
}

fn too_large(cap: u64, uri: &Uri) -> Error {
    Error::TooLarge(format!("the response from {uri} is over {cap} bytes"))
}

fn map_error(err: ureq::Error, uri: &Uri) -> Error {
    let host = uri.host().unwrap_or_default();
    match err {
        ureq::Error::Timeout(_) => Error::Timeout,
        ureq::Error::Io(e) if e.kind() == io::ErrorKind::TimedOut => Error::Timeout,
        ureq::Error::RequireHttpsOnly(_) => Error::NotAllowed(format!("{uri} is not HTTPS")),
        ureq::Error::Http(e) => Error::NotAllowed(format!("a request to {uri} is malformed: {e}")),
        ureq::Error::Protocol(_) | ureq::Error::LargeResponseHeader(..) => {
            Error::BadResponse(format!("{host}: {err}"))
        }
        other => Error::Offline(format!("{host}: {other}")),
    }
}

/// The error for a status outside 2xx. GitHub signals rate limits with 403 or
/// 429 and `x-ratelimit-*` or `retry-after` headers.
pub(crate) fn status_error(status: u16, headers: &HeaderMap) -> Error {
    let header = |name: &str| {
        headers
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(str::trim)
    };
    let seconds = |name: &str| header(name).and_then(|v| v.parse::<u64>().ok());
    let retry_after = seconds("retry-after").map(Duration::from_secs);
    let exhausted = header("x-ratelimit-remaining") == Some("0");
    if status == 429 || (status == 403 && (exhausted || retry_after.is_some())) {
        let until_reset = seconds("x-ratelimit-reset")
            .filter(|_| exhausted)
            .map(|reset| {
                let now = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map_or(0, |d| d.as_secs());
                Duration::from_secs(reset.saturating_sub(now))
            });
        return Error::RateLimited {
            retry_after: retry_after.or(until_reset),
        };
    }
    Error::Status(status)
}

#[cfg(test)]
pub(crate) mod tests {
    use std::net::TcpListener;
    use std::thread;

    use super::*;
    use crate::test_server::{Reply, TestServer};

    pub(crate) fn local_policy() -> Policy {
        Policy::new(["127.0.0.1"])
            .allow_plain_http_to_loopback()
            .with_timeout(Duration::from_secs(5))
    }

    fn client() -> Client {
        Client::new(local_policy())
    }

    #[test]
    fn a_plain_get_sends_the_user_agent_and_no_cookies() {
        let server = TestServer::start(|_| Reply::ok("hello").header("set-cookie", "a=1"));
        let client = client();
        for _ in 0..2 {
            let response = client.send(&Request::get(server.url("/x"))).unwrap();
            assert_eq!(response.status, 200);
            assert_eq!(response.body, b"hello");
            assert!(!response.from_cache);
        }
        let seen = server.requests();
        assert_eq!(seen.len(), 2);
        for request in &seen {
            assert_eq!(request.header("user-agent"), Some(USER_AGENT));
            assert_eq!(request.header("cookie"), None);
            assert_eq!(request.header("authorization"), None);
        }
    }

    #[test]
    fn the_strict_policy_refuses_plain_http_before_connecting() {
        let server = TestServer::start(|_| Reply::ok("hello"));
        let client = Client::new(Policy::new(["127.0.0.1"]));
        let err = client.send(&Request::get(server.url("/x"))).unwrap_err();
        assert!(matches!(err, Error::NotAllowed(_)), "{err:?}");
        assert!(server.requests().is_empty());
    }

    #[test]
    fn redirects_are_followed_and_rechecked_on_every_hop() {
        let server = TestServer::start(|req| match req.path.as_str() {
            "/a" => Reply::redirect(302, "/b"),
            "/b" => Reply::redirect(301, "c"),
            "/c" => Reply::ok("done"),
            "/away" => Reply::redirect(302, "https://example.com/x"),
            "/plain" => Reply::redirect(302, "http://localhost/x"),
            _ => Reply::status(404),
        });
        let client = client();
        let response = client.send(&Request::get(server.url("/a"))).unwrap();
        assert_eq!(response.body, b"done");
        assert!(response.url.ends_with("/c"), "{}", response.url);

        for path in ["/away", "/plain"] {
            let err = client.send(&Request::get(server.url(path))).unwrap_err();
            assert!(matches!(err, Error::NotAllowed(_)), "{path}: {err:?}");
        }
    }

    #[test]
    fn a_redirect_loop_stops_at_the_limit() {
        let server = TestServer::start(|_| Reply::redirect(302, "/loop"));
        let client = Client::new(local_policy().with_max_redirects(3));
        let err = client.send(&Request::get(server.url("/loop"))).unwrap_err();
        assert!(matches!(err, Error::BadResponse(_)), "{err:?}");
        assert_eq!(server.requests().len(), 4);
    }

    #[test]
    fn a_redirect_without_a_location_is_a_bad_response() {
        let server = TestServer::start(|_| Reply::status(302));
        let err = client().send(&Request::get(server.url("/"))).unwrap_err();
        assert!(matches!(err, Error::BadResponse(_)), "{err:?}");
    }

    #[test]
    fn the_token_goes_to_the_first_origin_only() {
        let other = TestServer::start(|_| Reply::ok("other"));
        let target = other.url("/landing");
        let first = TestServer::start(move |req| match req.path.as_str() {
            "/same" => Reply::redirect(302, "/after"),
            "/cross" => Reply::redirect(302, &target),
            _ => Reply::ok("first"),
        });
        let client = client();
        let token = Token::new("secret");

        let request = Request::get(first.url("/same")).bearer(Some(&token));
        client.send(&request).unwrap();
        let seen = first.requests();
        assert_eq!(seen.len(), 2);
        for req in &seen {
            assert_eq!(req.header("authorization"), Some("Bearer secret"));
        }

        let request = Request::get(first.url("/cross")).bearer(Some(&token));
        assert_eq!(client.send(&request).unwrap().body, b"other");
        assert_eq!(other.requests()[0].header("authorization"), None);
    }

    #[test]
    fn the_token_never_shows_in_debug_output() {
        let request = Request::get("https://example.com").bearer(Some(&Token::new("secret")));
        assert!(!format!("{request:?}").contains("secret"));
    }

    #[test]
    fn bodies_over_the_cap_are_refused() {
        let big = "x".repeat(2000);
        let server = TestServer::start(move |req| match req.path.as_str() {
            "/sized" => Reply::ok(&big),
            "/unsized" => Reply::ok(&big).without_length(),
            _ => Reply::ok("small"),
        });
        let client = Client::new(local_policy().with_max_response_bytes(1000));
        for path in ["/sized", "/unsized"] {
            let err = client.send(&Request::get(server.url(path))).unwrap_err();
            assert!(matches!(err, Error::TooLarge(_)), "{path}: {err:?}");
        }
        let request = Request::get(server.url("/small")).max_bytes(3);
        assert!(matches!(client.send(&request), Err(Error::TooLarge(_))));
        let request = Request::get(server.url("/small")).max_bytes(5);
        assert_eq!(client.send(&request).unwrap().body, b"small");
    }

    #[test]
    fn a_request_cannot_raise_the_policy_cap() {
        let server = TestServer::start(|_| Reply::ok(&"x".repeat(2000)));
        let client = Client::new(local_policy().with_max_response_bytes(1000));
        let request = Request::get(server.url("/")).max_bytes(10_000);
        assert!(matches!(client.send(&request), Err(Error::TooLarge(_))));
    }

    #[test]
    fn a_slow_server_times_out() {
        let server = TestServer::start(|req| match req.path.as_str() {
            "/head" => Reply::ok("late").delay(Duration::from_secs(3)),
            _ => Reply::ok("late body").stall_body(Duration::from_secs(3)),
        });
        let client = Client::new(local_policy().with_timeout(Duration::from_millis(300)));
        for path in ["/head", "/body"] {
            let started = Instant::now();
            let err = client.send(&Request::get(server.url(path))).unwrap_err();
            assert!(matches!(err, Error::Timeout), "{path}: {err:?}");
            assert!(started.elapsed() < Duration::from_secs(2), "{path}");
        }
    }

    #[test]
    fn nothing_listening_is_offline() {
        let port = {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            listener.local_addr().unwrap().port()
        };
        let err = client()
            .send(&Request::get(format!("http://127.0.0.1:{port}/")))
            .unwrap_err();
        assert!(matches!(err, Error::Offline(_)), "{err:?}");
    }

    #[test]
    fn rate_limits_are_recognized() {
        let reset = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs()
            + 120;
        let server = TestServer::start(move |req| match req.path.as_str() {
            "/primary" => Reply::status(403)
                .header("x-ratelimit-remaining", "0")
                .header("x-ratelimit-reset", &reset.to_string()),
            "/secondary" => Reply::status(403).header("retry-after", "30"),
            "/too-many" => Reply::status(429),
            "/forbidden" => Reply::status(403).header("x-ratelimit-remaining", "12"),
            _ => Reply::status(500),
        });
        let client = client();
        let get = |path: &str| client.send(&Request::get(server.url(path))).unwrap_err();

        let Error::RateLimited {
            retry_after: Some(wait),
        } = get("/primary")
        else {
            panic!("expected a rate limit");
        };
        assert!((110..=120).contains(&wait.as_secs()), "{wait:?}");
        assert!(matches!(
            get("/secondary"),
            Error::RateLimited { retry_after: Some(d) } if d == Duration::from_secs(30)
        ));
        assert!(matches!(
            get("/too-many"),
            Error::RateLimited { retry_after: None }
        ));
        assert!(matches!(get("/forbidden"), Error::Status(403)));
        assert!(matches!(get("/other"), Error::Status(500)));
    }

    #[test]
    fn post_sends_its_body_and_does_not_follow_redirects() {
        let server = TestServer::start(|req| match req.path.as_str() {
            "/moved" => Reply::redirect(307, "/elsewhere"),
            _ => Reply::ok(&format!("got {}", String::from_utf8_lossy(&req.body))),
        });
        let client = client();
        let request = Request::post(server.url("/echo"), "text/plain", b"ping".to_vec());
        assert_eq!(client.send(&request).unwrap().body, b"got ping");
        let seen = &server.requests()[0];
        assert_eq!(seen.method, "POST");
        assert_eq!(seen.header("content-type"), Some("text/plain"));

        let request = Request::post(server.url("/moved"), "text/plain", Vec::new());
        assert!(matches!(client.send(&request), Err(Error::Status(307))));
    }

    #[test]
    fn locations_resolve_against_the_redirecting_url() {
        let base: Uri = "https://a.example/one/two?q=1".parse().unwrap();
        assert_eq!(resolve(&base, "https://b.example/x"), "https://b.example/x");
        assert_eq!(resolve(&base, "//c.example/y"), "https://c.example/y");
        assert_eq!(resolve(&base, "/root"), "https://a.example/root");
        assert_eq!(resolve(&base, "three"), "https://a.example/one/three");
    }

    #[test]
    fn concurrent_requests_share_one_client() {
        let server = TestServer::start(|_| Reply::ok("ok"));
        let client = client();
        let handles: Vec<_> = (0..4)
            .map(|_| {
                let client = client.clone();
                let url = server.url("/");
                thread::spawn(move || client.send(&Request::get(url)).unwrap().body)
            })
            .collect();
        for handle in handles {
            assert_eq!(handle.join().unwrap(), b"ok");
        }
    }
}
