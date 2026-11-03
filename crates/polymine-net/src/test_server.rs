//! A small HTTP/1.1 server on a loopback port, for tests that must never touch
//! the real network. Each connection carries one request and is then closed.
//! Other crates reach it through the `test-support` feature.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

/// A request the server received.
#[derive(Clone, Debug)]
pub struct Seen {
    pub method: String,
    /// The request target: the path and any query.
    pub path: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Seen {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(n, _)| n.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }
}

/// What the server answers.
#[derive(Clone, Debug)]
pub struct Reply {
    status: u16,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
    delay: Duration,
    stall_body: Duration,
    send_length: bool,
}

impl Reply {
    pub fn status(status: u16) -> Self {
        Self {
            status,
            headers: Vec::new(),
            body: Vec::new(),
            delay: Duration::ZERO,
            stall_body: Duration::ZERO,
            send_length: true,
        }
    }

    pub fn ok(body: &str) -> Self {
        Self::bytes(body.as_bytes().to_vec())
    }

    pub fn bytes(body: Vec<u8>) -> Self {
        Self {
            body,
            ..Self::status(200)
        }
    }

    pub fn json(body: &str) -> Self {
        Self::ok(body).header("content-type", "application/json; charset=utf-8")
    }

    pub fn redirect(status: u16, location: &str) -> Self {
        Self::status(status).header("location", location)
    }

    #[must_use]
    pub fn with_status(mut self, status: u16) -> Self {
        self.status = status;
        self
    }

    #[must_use]
    pub fn header(mut self, name: &str, value: &str) -> Self {
        self.headers.push((name.to_owned(), value.to_owned()));
        self
    }

    /// Waits before sending anything.
    #[must_use]
    pub fn delay(mut self, delay: Duration) -> Self {
        self.delay = delay;
        self
    }

    /// Sends the head, then waits before sending the body.
    #[must_use]
    pub fn stall_body(mut self, delay: Duration) -> Self {
        self.stall_body = delay;
        self
    }

    /// Leaves out `content-length`, so the body ends when the connection
    /// closes.
    #[must_use]
    pub fn without_length(mut self) -> Self {
        self.send_length = false;
        self
    }
}

type Handler = dyn Fn(&Seen) -> Reply + Send + Sync;

#[derive(Debug)]
pub struct TestServer {
    addr: SocketAddr,
    seen: Arc<Mutex<Vec<Seen>>>,
    stop: Arc<AtomicBool>,
}

impl TestServer {
    pub fn start(handler: impl Fn(&Seen) -> Reply + Send + Sync + 'static) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind a loopback port");
        let addr = listener.local_addr().expect("local address");
        let seen = Arc::new(Mutex::new(Vec::new()));
        let stop = Arc::new(AtomicBool::new(false));
        let handler: Arc<Handler> = Arc::new(handler);
        {
            let seen = Arc::clone(&seen);
            let stop = Arc::clone(&stop);
            thread::spawn(move || {
                for stream in listener.incoming() {
                    if stop.load(Ordering::SeqCst) {
                        break;
                    }
                    let Ok(stream) = stream else { continue };
                    let seen = Arc::clone(&seen);
                    let handler = Arc::clone(&handler);
                    thread::spawn(move || serve(stream, &seen, &*handler));
                }
            });
        }
        Self { addr, seen, stop }
    }

    pub fn url(&self, path: &str) -> String {
        format!("http://{}{path}", self.addr)
    }

    pub fn requests(&self) -> Vec<Seen> {
        self.seen.lock().unwrap().clone()
    }
}

impl Drop for TestServer {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        // Wakes the accept loop so it sees the flag.
        let _ = TcpStream::connect(self.addr);
    }
}

fn serve(stream: TcpStream, seen: &Mutex<Vec<Seen>>, handler: &Handler) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let Some(request) = read_request(&stream) else {
        return;
    };
    seen.lock().unwrap().push(request.clone());
    let reply = handler(&request);
    thread::sleep(reply.delay);
    let _ = write_reply(stream, &reply);
}

fn read_request(stream: &TcpStream) -> Option<Seen> {
    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    reader.read_line(&mut line).ok()?;
    let mut parts = line.split_whitespace();
    let method = parts.next()?.to_owned();
    let path = parts.next()?.to_owned();
    let mut headers = Vec::new();
    loop {
        line.clear();
        reader.read_line(&mut line).ok()?;
        let header = line.trim_end();
        if header.is_empty() {
            break;
        }
        let (name, value) = header.split_once(':')?;
        headers.push((name.trim().to_ascii_lowercase(), value.trim().to_owned()));
    }
    let length = headers
        .iter()
        .find(|(n, _)| n == "content-length")
        .and_then(|(_, v)| v.parse::<usize>().ok())
        .unwrap_or(0);
    let mut body = vec![0; length];
    reader.read_exact(&mut body).ok()?;
    Some(Seen {
        method,
        path,
        headers,
        body,
    })
}

fn write_reply(mut stream: TcpStream, reply: &Reply) -> std::io::Result<()> {
    let has_body = !matches!(reply.status, 204 | 304);
    let mut head = Vec::new();
    write!(
        head,
        "HTTP/1.1 {} Test\r\nconnection: close\r\n",
        reply.status
    )?;
    for (name, value) in &reply.headers {
        write!(head, "{name}: {value}\r\n")?;
    }
    if has_body && reply.send_length {
        write!(head, "content-length: {}\r\n", reply.body.len())?;
    }
    head.extend_from_slice(b"\r\n");
    stream.write_all(&head)?;
    stream.flush()?;
    thread::sleep(reply.stall_body);
    if has_body {
        stream.write_all(&reply.body)?;
    }
    stream.flush()
}
