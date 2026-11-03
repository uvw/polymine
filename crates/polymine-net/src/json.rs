//! Typed JSON requests to a web API, such as an online leaderboard.

use serde::Serialize;
use serde::de::DeserializeOwned;

use crate::client::{Client, Request, Token};
use crate::error::{Error, Result};

/// A JSON API under one base URL. Every request goes through the client's
/// policy, so the API's host must be on its allowlist.
#[derive(Clone, Debug)]
pub struct JsonApi {
    client: Client,
    base: String,
    token: Option<Token>,
}

impl JsonApi {
    /// An API under `base`, such as `https://scores.example.com/v1`.
    pub fn new(client: Client, base: impl Into<String>) -> Self {
        Self {
            client,
            base: base.into().trim_end_matches('/').to_owned(),
            token: None,
        }
    }

    /// Sends `token` as a bearer token with every request.
    #[must_use]
    pub fn with_token(mut self, token: Token) -> Self {
        self.token = Some(token);
        self
    }

    /// GETs `path` below the base URL and parses the answer as `T`.
    pub fn get<T: DeserializeOwned>(&self, path: &str) -> Result<T> {
        let request = Request::get(self.url(path));
        self.call(request)
    }

    /// POSTs `body` as JSON to `path` below the base URL and parses the
    /// answer as `T`. An empty answer, such as a 204, parses as JSON `null`,
    /// so `T = ()` accepts it.
    pub fn post<B, T>(&self, path: &str, body: &B) -> Result<T>
    where
        B: Serialize + ?Sized,
        T: DeserializeOwned,
    {
        let body = serde_json::to_vec(body).map_err(|err| Error::Io(err.into()))?;
        let request = Request::post(self.url(path), "application/json", body);
        self.call(request)
    }

    /// Sends `body` as JSON in a PATCH to `path` below the base URL and parses
    /// the answer as `T`.
    pub fn patch<B, T>(&self, path: &str, body: &B) -> Result<T>
    where
        B: Serialize + ?Sized,
        T: DeserializeOwned,
    {
        let body = serde_json::to_vec(body).map_err(|err| Error::Io(err.into()))?;
        let request = Request::patch(self.url(path), "application/json", body);
        self.call(request)
    }

    fn url(&self, path: &str) -> String {
        format!("{}/{}", self.base, path.trim_start_matches('/'))
    }

    fn call<T: DeserializeOwned>(&self, request: Request) -> Result<T> {
        let request = request
            .header("accept", "application/json")
            .bearer(self.token.as_ref());
        let response = self.client.send(&request)?;
        let body: &[u8] = if response.body.iter().all(u8::is_ascii_whitespace) {
            b"null"
        } else {
            &response.body
        };
        serde_json::from_slice(body).map_err(|err| {
            Error::BadResponse(format!(
                "{} answered with unexpected JSON: {err}",
                response.url
            ))
        })
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use serde::{Deserialize, Serialize};

    use super::*;
    use crate::client::tests::local_policy;
    use crate::policy::Policy;
    use crate::test_server::{Reply, TestServer};

    #[derive(Debug, PartialEq, Serialize, Deserialize)]
    struct Score {
        player: String,
        seconds: u32,
    }

    fn api(server: &TestServer) -> JsonApi {
        JsonApi::new(Client::new(local_policy()), server.url("/v1/"))
            .with_token(Token::new("board-token"))
    }

    #[test]
    fn get_parses_typed_json_and_sends_the_token() {
        let server = TestServer::start(|req| match req.path.as_str() {
            "/v1/scores?board=classic" => {
                Reply::json(r#"[{"player":"ada","seconds":42,"extra":true}]"#)
            }
            _ => Reply::status(404),
        });
        let scores: Vec<Score> = api(&server).get("/scores?board=classic").unwrap();
        assert_eq!(
            scores,
            [Score {
                player: "ada".into(),
                seconds: 42
            }]
        );
        let seen = &server.requests()[0];
        assert_eq!(seen.method, "GET");
        assert_eq!(seen.header("accept"), Some("application/json"));
        assert_eq!(seen.header("authorization"), Some("Bearer board-token"));
    }

    #[test]
    fn post_sends_json_and_parses_the_answer() {
        #[derive(Deserialize)]
        struct Rank {
            rank: u32,
        }
        let server = TestServer::start(|req| {
            let score: Score = serde_json::from_slice(&req.body).unwrap();
            Reply::json(&format!(r#"{{"rank":{}}}"#, score.seconds / 10))
        });
        let score = Score {
            player: "ada".into(),
            seconds: 42,
        };
        let rank: Rank = api(&server).post("scores", &score).unwrap();
        assert_eq!(rank.rank, 4);
        let seen = &server.requests()[0];
        assert_eq!(seen.method, "POST");
        assert_eq!(seen.path, "/v1/scores");
        assert_eq!(seen.header("content-type"), Some("application/json"));
    }

    #[test]
    fn patch_sends_json_with_its_method() {
        let server = TestServer::start(|_| Reply::status(204));
        let score = Score {
            player: "ada".into(),
            seconds: 42,
        };
        let (): () = api(&server).patch("scores/1", &score).unwrap();
        let seen = &server.requests()[0];
        assert_eq!(seen.method, "PATCH");
        assert_eq!(seen.path, "/v1/scores/1");
        assert_eq!(seen.header("content-type"), Some("application/json"));
    }

    #[test]
    fn an_empty_answer_parses_as_unit() {
        let server = TestServer::start(|_| Reply::status(204));
        let score = Score {
            player: "ada".into(),
            seconds: 42,
        };
        let (): () = api(&server).post("scores", &score).unwrap();
    }

    #[test]
    fn failures_map_to_the_error_enum() {
        let server = TestServer::start(|req| match req.path.as_str() {
            "/v1/bad" => Reply::json("{\"player\":"),
            "/v1/shape" => Reply::json("{\"player\":7}"),
            "/v1/denied" => Reply::status(401),
            "/v1/busy" => Reply::status(429).header("retry-after", "5"),
            "/v1/huge" => Reply::json(&format!("\"{}\"", "x".repeat(5000))),
            "/v1/slow" => Reply::json("1").delay(Duration::from_secs(3)),
            _ => Reply::status(404),
        });
        let client = Client::new(
            local_policy()
                .with_max_response_bytes(1000)
                .with_timeout(Duration::from_millis(300)),
        );
        let api = JsonApi::new(client, server.url("/v1"));
        let get = |path: &str| api.get::<Score>(path).unwrap_err();
        assert!(matches!(get("bad"), Error::BadResponse(_)));
        assert!(matches!(get("shape"), Error::BadResponse(_)));
        assert!(matches!(get("denied"), Error::Status(401)));
        assert!(matches!(
            get("busy"),
            Error::RateLimited { retry_after: Some(d) } if d == Duration::from_secs(5)
        ));
        assert!(matches!(get("huge"), Error::TooLarge(_)));
        assert!(matches!(get("slow"), Error::Timeout));
    }

    #[test]
    fn a_host_off_the_allowlist_is_never_contacted() {
        let server = TestServer::start(|_| Reply::json("1"));
        let client = Client::new(Policy::new(["scores.example.com"]));
        let api = JsonApi::new(client, server.url("/v1"));
        assert!(matches!(api.get::<u32>("x"), Err(Error::NotAllowed(_))));
        assert!(server.requests().is_empty());
    }
}
