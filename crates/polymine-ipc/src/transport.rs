//! One request line and one reply line over a local socket: a named pipe on
//! Windows, a socket file on Unix. Nothing stays connected between calls.

use std::io::{self, BufRead, BufReader, Read, Write};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, mpsc};
use std::thread;
use std::time::Duration;

use interprocess::local_socket::{ListenerOptions, Name, Stream, prelude::*};

use crate::instance::{InstanceName, endpoint};
use crate::protocol::{Envelope, ErrorBody, ErrorCode, Request, Response, VERSION};

/// The socket address of an instance, as shown in its registry entry.
#[cfg(windows)]
pub fn socket_address(name: &InstanceName) -> String {
    // Pipe names are machine-wide, so the user's SID keeps two accounts apart.
    let sid = windows_user::current_sid().unwrap_or_else(|_| "unknown-user".to_owned());
    pipe_name(&sid, &endpoint(name))
}

/// The socket address of an instance, as shown in its registry entry.
#[cfg(unix)]
pub fn socket_address(name: &InstanceName) -> String {
    socket_path_named(&socket_dir(), &endpoint(name))
}

/// `endpoint` is [`endpoint`]'s name for the instance.
#[cfg(windows)]
fn pipe_name(sid: &str, endpoint: &str) -> String {
    format!("{}.{sid}.{endpoint}", crate::instance::APP_ID)
}

/// The folder for this user's socket files. A socket path must fit in
/// `sun_path`, 104 bytes on macOS, which the per-user data folder under a long
/// home folder doesn't leave room for.
#[cfg(unix)]
fn socket_dir() -> std::path::PathBuf {
    socket_dir_for(rustix::process::getuid().as_raw())
}

#[cfg(unix)]
fn socket_dir_for(uid: u32) -> std::path::PathBuf {
    std::path::PathBuf::from(format!("/tmp/polymine-{uid}"))
}

#[cfg(all(unix, test))]
fn socket_path(dir: &std::path::Path, name: &InstanceName) -> String {
    socket_path_named(dir, name.as_str())
}

/// `endpoint` is [`endpoint`]'s name for the instance.
#[cfg(unix)]
fn socket_path_named(dir: &std::path::Path, endpoint: &str) -> String {
    dir.join(format!("{endpoint}.sock"))
        .to_string_lossy()
        .into_owned()
}

fn socket_name(address: &str) -> io::Result<Name<'_>> {
    if cfg!(windows) {
        address.to_ns_name::<interprocess::local_socket::GenericNamespaced>()
    } else {
        address.to_fs_name::<interprocess::local_socket::GenericFilePath>()
    }
}

/// Sends one request to the named instance and waits up to `timeout` for the
/// reply.
pub fn call(name: &InstanceName, request: &Request, timeout: Duration) -> Response {
    call_at(&socket_address(name), request, timeout)
}

/// Like [`call`], to an explicit socket address.
pub fn call_at(address: &str, request: &Request, timeout: Duration) -> Response {
    #[cfg(unix)]
    {
        call_in(&socket_dir(), address, request, timeout)
    }
    #[cfg(windows)]
    {
        send(address, request, timeout)
    }
}

/// Like [`call_at`], with `shared` as the folder for this user's sockets. A
/// socket there is reached only while the folder passes the check the app
/// makes before it listens, so a folder another account made in `/tmp` can't
/// stand in for a running instance.
#[cfg(unix)]
fn call_in(
    shared: &std::path::Path,
    address: &str,
    request: &Request,
    timeout: Duration,
) -> Response {
    if std::path::Path::new(address).parent() == Some(shared) {
        match check_private_dir(shared) {
            // With no folder, the connection fails as for any instance that
            // isn't running.
            Err(e) if e.kind() != io::ErrorKind::NotFound => {
                return Response::Error(
                    ErrorBody::new(
                        ErrorCode::NotRunning,
                        format!("no instance can be trusted at {address}: {e}"),
                    )
                    .with_hint(
                        "Polymine makes that folder when it starts; if another account made it, have it removed, then start Polymine",
                    ),
                );
            }
            _ => {}
        }
    }
    send(address, request, timeout)
}

fn send(address: &str, request: &Request, timeout: Duration) -> Response {
    let line = serde_json::to_string(&Envelope {
        version: VERSION,
        request: request.clone(),
    })
    .expect("requests always serialize");
    let address = address.to_owned();
    let (send, receive) = mpsc::channel();
    // The exchange runs on its own thread so a stuck app can't hang the CLI
    // past its timeout.
    thread::spawn(move || {
        let _ = send.send(exchange(&address, &line));
    });
    match receive.recv_timeout(timeout) {
        Ok(Ok(response)) => response,
        Ok(Err(error)) => Response::Error(error),
        Err(_) => Response::Error(
            ErrorBody::new(ErrorCode::Timeout, "the instance didn't reply in time")
                .with_hint(
                "the app may be busy with a long move; run `status` before retrying, and `log` if it keeps timing out",
            ),
        ),
    }
}

fn exchange(address: &str, line: &str) -> Result<Response, ErrorBody> {
    let not_running = |e: io::Error| {
        ErrorBody::new(
            ErrorCode::NotRunning,
            format!("no instance answers at {address}: {e}"),
        )
        .with_hint(
            "start Polymine, pick another instance with --instance, or play headless with --local",
        )
    };
    let mut reader = BufReader::new(connect(address).map_err(not_running)?);
    let internal =
        |e: io::Error| ErrorBody::new(ErrorCode::Internal, format!("connection failed: {e}"));
    let written = reader.get_mut().write_all(format!("{line}\n").as_bytes());
    // An app that turns the request away may reply and hang up before the
    // whole request is written, so its reply is read even then.
    let mut reply = String::new();
    let read = reader.read_line(&mut reply);
    if written.is_err()
        && let Ok(response) = serde_json::from_str(&reply)
    {
        return Ok(response);
    }
    written.map_err(internal)?;
    read.map_err(internal)?;
    serde_json::from_str(&reply)
        .map_err(|e| ErrorBody::new(ErrorCode::Internal, format!("unreadable reply: {e}")))
}

/// Opens the instance's socket for one exchange.
#[cfg(unix)]
fn connect(address: &str) -> io::Result<Stream> {
    Stream::connect(socket_name(address)?)
}

/// Opens the instance's pipe for one exchange. The pipe's name is predictable,
/// so another account could create it first. The client therefore lets the
/// server identify it but never act as it, and talks only to a server running
/// as the same user.
#[cfg(windows)]
fn connect(address: &str) -> io::Result<std::fs::File> {
    use std::os::windows::fs::OpenOptionsExt;
    use std::os::windows::io::AsRawHandle;

    /// `SecurityIdentification` in the flags' impersonation level bits.
    const SECURITY_IDENTIFICATION: u32 = 1 << 16;
    /// Win32's `ERROR_PIPE_BUSY`: every server instance is taken for now.
    const PIPE_BUSY: i32 = 231;
    let path = format!(r"\\.\pipe\{address}");
    let mut waited = Duration::ZERO;
    let pipe = loop {
        let opened = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .security_qos_flags(SECURITY_IDENTIFICATION)
            .open(&path);
        match opened {
            Err(e) if e.raw_os_error() == Some(PIPE_BUSY) && waited < Duration::from_secs(10) => {
                thread::sleep(Duration::from_millis(20));
                waited += Duration::from_millis(20);
            }
            opened => break opened?,
        }
    };
    if !windows_user::serves_current_user(pipe.as_raw_handle())? {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "another account's process holds this pipe",
        ));
    }
    Ok(pipe)
}

/// Parses a request line, checking its version before anything else, so a
/// request from a newer CLI gets a version mismatch even when its shape changed.
pub fn parse_request(line: &str) -> Result<Request, ErrorBody> {
    #[derive(serde::Deserialize)]
    struct Versioned {
        version: u32,
    }
    let malformed =
        |e: serde_json::Error| ErrorBody::new(ErrorCode::Usage, format!("malformed request: {e}"));
    let Versioned { version } = serde_json::from_str(line).map_err(malformed)?;
    if version != VERSION {
        return Err(ErrorBody::new(
            ErrorCode::VersionMismatch,
            format!("the app speaks protocol {VERSION}, the request {version}"),
        )
        .with_hint("use the polymine-cli that came with this Polymine"));
    }
    let envelope: Envelope = serde_json::from_str(line).map_err(malformed)?;
    Ok(envelope.request)
}

/// The longest request line the app reads. Real requests are far shorter.
const MAX_REQUEST: usize = 64 * 1024;
/// How long a client may take to send its request or read the reply.
const IO_TIMEOUT: Duration = Duration::from_secs(5);
/// Requests answered at once. Connections beyond it get a busy error.
const MAX_HANDLERS: usize = 16;

#[derive(Clone, Copy, Debug)]
struct Limits {
    max_request: usize,
    io_timeout: Duration,
    max_handlers: usize,
}

const LIMITS: Limits = Limits {
    max_request: MAX_REQUEST,
    io_timeout: IO_TIMEOUT,
    max_handlers: MAX_HANDLERS,
};

/// Listens for requests until the process exits, answering each on its own
/// thread with `handler`.
pub fn serve(
    address: &str,
    handler: impl Fn(Request) -> Response + Send + Sync + 'static,
) -> io::Result<()> {
    serve_with(address, LIMITS, handler)
}

fn serve_with(
    address: &str,
    limits: Limits,
    handler: impl Fn(Request) -> Response + Send + Sync + 'static,
) -> io::Result<()> {
    #[cfg(unix)]
    prepare_socket_file(address)?;
    let options = ListenerOptions::new().name(socket_name(address)?);
    #[cfg(windows)]
    let options = {
        use interprocess::os::windows::local_socket::ListenerOptionsExt;
        options.security_descriptor(windows_user::owner_only()?)
    };
    let listener = options.create_sync()?;
    let handler = Arc::new(handler);
    let active = Arc::new(AtomicUsize::new(0));
    thread::Builder::new()
        .name("polymine-ipc".into())
        .spawn(move || {
            for connection in listener.incoming() {
                let Ok(stream) = connection else {
                    // Out of file descriptors, say. Retrying at once would spin.
                    thread::sleep(Duration::from_millis(50));
                    continue;
                };
                let Some(slot) = Slot::take(&active, limits.max_handlers) else {
                    let busy = ErrorBody::new(ErrorCode::Busy, "the instance is busy")
                        .with_hint("too many requests at once; retry in a moment");
                    let deadline = Deadline::new(&stream, limits.io_timeout);
                    let _watch = deadline.start();
                    reply(&stream, &Response::Error(busy));
                    continue;
                };
                let handler = Arc::clone(&handler);
                // If the thread can't start, the closure drops, closing the
                // connection and freeing the slot.
                let _ = thread::Builder::new()
                    .name("polymine-ipc-request".into())
                    .spawn(move || {
                        let _slot = slot;
                        let deadline = Deadline::new(&stream, limits.io_timeout);
                        answer(&stream, &deadline, limits.max_request, handler.as_ref());
                    });
            }
        })?;
    Ok(())
}

/// One of the handler threads [`serve`] allows at once, given back on drop.
struct Slot(Arc<AtomicUsize>);

impl Slot {
    fn take(active: &Arc<AtomicUsize>, max: usize) -> Option<Self> {
        // Counted first; over the cap, dropping the slot uncounts it.
        let slot = Self(Arc::clone(active));
        (active.fetch_add(1, Ordering::AcqRel) < max).then_some(slot)
    }
}

impl Drop for Slot {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}

fn answer(
    stream: &Stream,
    deadline: &Deadline,
    max_request: usize,
    handler: &(impl Fn(Request) -> Response + ?Sized),
) {
    let mut reader = BufReader::new(stream);
    let read = {
        let _watch = deadline.start();
        read_request(&mut reader, max_request)
    };
    // The handler itself may take as long as it needs; only the client's
    // reads and writes have a deadline.
    let response = match read {
        Ok(Some(line)) => match parse_request(&line) {
            Ok(request) => handler(request),
            Err(error) => Response::Error(error),
        },
        Ok(None) => return,
        Err(error) => Response::Error(error),
    };
    let _watch = deadline.start();
    reply(stream, &response);
}

/// Bounds each read and write on a server connection, so a client that
/// connects and then goes quiet can't hold a handler. Unix sockets take a
/// timeout. Windows named pipes take none, so there a watchdog cancels the
/// pending I/O once the time is up.
struct Deadline {
    #[cfg(windows)]
    timeout: Duration,
    #[cfg(windows)]
    pipe: usize,
}

impl Deadline {
    fn new(stream: &Stream, timeout: Duration) -> Self {
        #[cfg(unix)]
        {
            let _ = stream.set_recv_timeout(Some(timeout));
            let _ = stream.set_send_timeout(Some(timeout));
            Self {}
        }
        #[cfg(windows)]
        {
            use std::os::windows::io::{AsHandle, AsRawHandle};
            let Stream::NamedPipe(pipe) = stream;
            Self {
                timeout,
                pipe: pipe.as_handle().as_raw_handle() as usize,
            }
        }
    }

    /// Starts the clock for one read or write. The socket's own timeout does
    /// the work, so the guard is empty.
    #[cfg(unix)]
    #[allow(clippy::unused_self, reason = "the Windows version needs it")]
    fn start(&self) -> UnixWatch {
        UnixWatch
    }

    /// Starts the clock for one read or write; the guard stops it when dropped.
    /// The stream must outlive the guard.
    #[cfg(windows)]
    fn start(&self) -> pipe_watchdog::Watch {
        pipe_watchdog::Watch::start(self.pipe, self.timeout)
    }
}

/// Reads one request line of at most `max` bytes. `None` when the connection
/// failed or timed out, leaving nobody to answer.
fn read_request(reader: &mut impl BufRead, max: usize) -> Result<Option<String>, ErrorBody> {
    let mut bytes = Vec::new();
    // One byte more than `max` leaves room for the line break.
    if reader
        .take(max as u64 + 1)
        .read_until(b'\n', &mut bytes)
        .is_err()
    {
        return Ok(None);
    }
    if bytes.len() > max && bytes.last() != Some(&b'\n') {
        return Err(ErrorBody::new(
            ErrorCode::Usage,
            format!("the request is longer than {max} bytes"),
        ));
    }
    String::from_utf8(bytes)
        .map(Some)
        .map_err(|_| ErrorBody::new(ErrorCode::Usage, "the request isn't UTF-8"))
}

fn reply(mut stream: &Stream, response: &Response) {
    let reply = serde_json::to_string(response).expect("responses always serialize");
    let _ = stream.write_all(format!("{reply}\n").as_bytes());
}

/// The guard [`Deadline::start`] returns on Unix, where it has nothing to do.
#[cfg(unix)]
struct UnixWatch;

/// Cancels a named pipe's blocked read or write after a timeout.
#[cfg(windows)]
#[allow(unsafe_code, reason = "cancelling blocked pipe I/O needs a Win32 call")]
mod pipe_watchdog {
    use std::sync::mpsc::{self, RecvTimeoutError};
    use std::thread::{self, JoinHandle};
    use std::time::Duration;

    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::IO::CancelIoEx;

    /// Cancels the I/O pending on a pipe unless dropped within its timeout.
    pub(super) struct Watch {
        stop: Option<mpsc::Sender<()>>,
        thread: Option<JoinHandle<()>>,
    }

    impl Watch {
        /// `pipe` is a raw pipe handle that must stay open until this drops.
        pub(super) fn start(pipe: usize, timeout: Duration) -> Self {
            let (stop, stopped) = mpsc::channel::<()>();
            let thread = thread::Builder::new()
                .name("polymine-ipc-watchdog".into())
                .spawn(move || {
                    if stopped.recv_timeout(timeout) == Err(RecvTimeoutError::Timeout) {
                        // SAFETY: the handle is still open, because the
                        // `Watch` joins this thread before the stream that
                        // owns the handle can drop. With nothing pending the
                        // call fails harmlessly.
                        let _ = unsafe { CancelIoEx(HANDLE(pipe as *mut _), None) };
                    }
                })
                .ok();
            Self {
                stop: Some(stop),
                thread,
            }
        }
    }

    impl Drop for Watch {
        fn drop(&mut self) {
            drop(self.stop.take());
            if let Some(thread) = self.thread.take() {
                let _ = thread.join();
            }
        }
    }
}

/// Makes room for a Unix socket file. A file nobody answers on is left over
/// from a crash and goes; one that answers belongs to a running instance.
#[cfg(unix)]
fn prepare_socket_file(address: &str) -> io::Result<()> {
    let path = std::path::Path::new(address);
    if let Some(dir) = path.parent() {
        if dir == socket_dir() {
            private_dir(dir)?;
        } else {
            std::fs::create_dir_all(dir)?;
        }
    }
    if path.exists() {
        if Stream::connect(socket_name(address)?).is_ok() {
            return Err(io::Error::new(
                io::ErrorKind::AddrInUse,
                format!("another instance is listening at {address}"),
            ));
        }
        std::fs::remove_file(path)?;
    }
    Ok(())
}

/// Creates `dir` readable only by this user, or checks that it already is.
/// The socket folder sits in the shared `/tmp`, where another user could make
/// it first.
#[cfg(unix)]
fn private_dir(dir: &std::path::Path) -> io::Result<()> {
    use std::os::unix::fs::DirBuilderExt;
    match std::fs::DirBuilder::new().mode(0o700).create(dir) {
        Err(e) if e.kind() != io::ErrorKind::AlreadyExists => return Err(e),
        _ => {}
    }
    check_private_dir(dir)
}

/// Checks that `dir` is a folder, not a link, that only this user owns and
/// can open.
#[cfg(unix)]
fn check_private_dir(dir: &std::path::Path) -> io::Result<()> {
    use std::os::unix::fs::MetadataExt;
    let meta = std::fs::symlink_metadata(dir)?;
    let own = meta.uid() == rustix::process::getuid().as_raw();
    let group_and_others = meta.mode() & 0o077;
    if meta.is_dir() && own && group_and_others == 0 {
        Ok(())
    } else {
        Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            format!("{} must be a folder only this user can open", dir.display()),
        ))
    }
}

/// The current Windows user, for naming the pipe and locking it to its owner.
#[cfg(windows)]
#[allow(unsafe_code, reason = "reading the process token needs Win32 calls")]
mod windows_user {
    use std::io;

    use interprocess::os::windows::security_descriptor::SecurityDescriptor;
    use widestring::U16CString;
    use windows::Win32::Foundation::{CloseHandle, HANDLE, HLOCAL, LocalFree};
    use windows::Win32::Security::Authorization::ConvertSidToStringSidW;
    use windows::Win32::Security::{GetTokenInformation, TOKEN_QUERY, TOKEN_USER, TokenUser};
    use windows::Win32::System::Pipes::GetNamedPipeServerProcessId;
    use windows::Win32::System::Threading::{
        GetCurrentProcess, OpenProcess, OpenProcessToken, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::core::PWSTR;

    /// The current user's SID as a string, such as `S-1-5-21-…-1001`.
    pub fn current_sid() -> io::Result<String> {
        let mut token = HANDLE::default();
        // SAFETY: the pseudo-handle from GetCurrentProcess needs no closing,
        // and `token` is a valid place for the opened handle.
        unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &raw mut token) }?;
        let sid = user_sid(token);
        // SAFETY: `token` was opened above and is closed once.
        let _ = unsafe { CloseHandle(token) };
        sid
    }

    /// Whether the process serving the client end of a pipe, `pipe`, runs as
    /// the current user. Another account's process usually can't even be
    /// opened, which counts as no.
    pub fn serves_current_user(pipe: std::os::windows::io::RawHandle) -> io::Result<bool> {
        let mut pid = 0u32;
        // SAFETY: `pipe` is the open client end the caller owns, and `pid` is
        // a valid place for the server's process id.
        unsafe { GetNamedPipeServerProcessId(HANDLE(pipe), &raw mut pid) }?;
        // SAFETY: opening a process by id has no preconditions; a failure,
        // such as access denied, is returned.
        let Ok(process) = (unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) })
        else {
            return Ok(false);
        };
        let mut token = HANDLE::default();
        // SAFETY: `process` was opened above, and `token` is a valid place for
        // the opened handle.
        let opened = unsafe { OpenProcessToken(process, TOKEN_QUERY, &raw mut token) };
        // SAFETY: `process` was opened above and is closed once.
        let _ = unsafe { CloseHandle(process) };
        if opened.is_err() {
            return Ok(false);
        }
        let server = user_sid(token);
        // SAFETY: `token` was opened above and is closed once.
        let _ = unsafe { CloseHandle(token) };
        Ok(server? == current_sid()?)
    }

    fn user_sid(token: HANDLE) -> io::Result<String> {
        let mut len = 0u32;
        // SAFETY: with no buffer, the call only reports the size it needs.
        let _ = unsafe { GetTokenInformation(token, TokenUser, None, 0, &raw mut len) };
        // u64 elements keep the buffer aligned for TOKEN_USER.
        let mut buffer = vec![0u64; (len as usize).div_ceil(8)];
        // SAFETY: the buffer holds at least `len` bytes.
        unsafe {
            GetTokenInformation(
                token,
                TokenUser,
                Some(buffer.as_mut_ptr().cast()),
                len,
                &raw mut len,
            )
        }?;
        // SAFETY: the call filled the buffer with a TOKEN_USER whose SID
        // points into the same buffer, which outlives this function's use.
        let user = unsafe { &*buffer.as_ptr().cast::<TOKEN_USER>() };
        let mut text = PWSTR::null();
        // SAFETY: the SID is valid; the string is freed with LocalFree below.
        unsafe { ConvertSidToStringSidW(user.User.Sid, &raw mut text) }?;
        // SAFETY: on success `text` is a NUL-terminated string.
        let sid = unsafe { text.to_string() };
        // SAFETY: `text` came from ConvertSidToStringSidW and is freed once.
        let _ = unsafe { LocalFree(Some(HLOCAL(text.0.cast()))) };
        sid.map_err(io::Error::other)
    }

    /// A security descriptor whose DACL lets only the current user open the
    /// pipe. `P` keeps inherited entries out.
    pub fn owner_only() -> io::Result<SecurityDescriptor> {
        let sddl = U16CString::from_str(super::owner_only_sddl(&current_sid()?))
            .map_err(io::Error::other)?;
        SecurityDescriptor::deserialize(&sddl)
    }
}

#[cfg(any(windows, test))]
fn owner_only_sddl(sid: &str) -> String {
    format!("D:P(A;;GA;;;{sid})")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn unique_address() -> String {
        let id = format!("test-{}-{:?}", std::process::id(), thread::current().id())
            .replace(|c: char| !c.is_ascii_alphanumeric() && c != '-', "");
        if cfg!(windows) {
            format!("dev.uvw.polymine.{id}")
        } else {
            std::env::temp_dir()
                .join(format!("{id}.sock"))
                .to_string_lossy()
                .into_owned()
        }
    }

    #[test]
    fn a_request_gets_the_handler_reply() {
        let address = unique_address();
        serve(&address, |request| match request {
            Request::Status => Response::Result(json!({"ok": true})),
            _ => Response::Error(ErrorBody::new(ErrorCode::Usage, "nope")),
        })
        .unwrap();
        let reply = call_at(&address, &Request::Status, Duration::from_secs(5));
        assert_eq!(reply, Response::Result(json!({"ok": true})));
        let reply = call_at(&address, &Request::Board, Duration::from_secs(5));
        assert!(matches!(reply, Response::Error(e) if e.code == ErrorCode::Usage));
    }

    /// Sends `bytes` as they are and reads the reply line.
    fn send_raw(address: &str, bytes: &[u8]) -> Response {
        let stream = Stream::connect(socket_name(address).unwrap()).unwrap();
        let mut reader = BufReader::new(stream);
        // The app may hang up on a long request before all of it is written.
        let _ = reader.get_mut().write_all(bytes);
        let mut line = String::new();
        reader.read_line(&mut line).unwrap();
        serde_json::from_str(&line).unwrap()
    }

    fn usage_message(response: Response) -> String {
        match response {
            Response::Error(e) if e.code == ErrorCode::Usage => e.message,
            other => panic!("expected a usage error, got {other:?}"),
        }
    }

    fn status_ok() -> impl Fn(Request) -> Response + Send + Sync + 'static {
        |request| match request {
            Request::Status => Response::Result(json!({"ok": true})),
            _ => Response::Error(ErrorBody::new(ErrorCode::Usage, "nope")),
        }
    }

    #[test]
    fn long_and_non_utf8_requests_get_a_usage_error() {
        let address = unique_address();
        let limits = Limits {
            max_request: 64,
            ..LIMITS
        };
        serve_with(&address, limits, status_ok()).unwrap();
        let long = usage_message(send_raw(&address, &[b'x'; 200]));
        assert!(long.contains("longer than 64"), "{long}");
        let binary = usage_message(send_raw(&address, b"{\"version\":1,\xff}\n"));
        assert!(binary.contains("UTF-8"), "{binary}");
        // A request of exactly the limit still gets through.
        let status = r#"{"version":2,"method":"status"}"#;
        let padded = format!("{status:<64}\n");
        assert_eq!(
            send_raw(&address, padded.as_bytes()),
            Response::Result(json!({"ok": true}))
        );
    }

    #[test]
    fn connections_beyond_the_cap_are_turned_away_until_one_ends() {
        let address = unique_address();
        let limits = Limits {
            max_handlers: 1,
            io_timeout: Duration::from_millis(300),
            ..LIMITS
        };
        serve_with(&address, limits, status_ok()).unwrap();
        // A client that never sends holds the only handler until it times out.
        let silent = Stream::connect(socket_name(&address).unwrap()).unwrap();
        thread::sleep(Duration::from_millis(100));
        let busy = call_at(&address, &Request::Status, Duration::from_secs(5));
        assert!(
            matches!(&busy, Response::Error(e) if e.code == ErrorCode::Busy),
            "{busy:?}"
        );
        thread::sleep(Duration::from_millis(500));
        let reply = call_at(&address, &Request::Status, Duration::from_secs(5));
        assert_eq!(reply, Response::Result(json!({"ok": true})));
        drop(silent);
    }

    #[test]
    fn nobody_listening_means_not_running() {
        let reply = call_at(&unique_address(), &Request::Status, Duration::from_secs(5));
        assert!(matches!(reply, Response::Error(e) if e.code == ErrorCode::NotRunning));
    }

    #[test]
    fn other_protocol_versions_are_refused() {
        let error = parse_request(r#"{"version":99,"method":"status"}"#).unwrap_err();
        assert_eq!(error.code, ErrorCode::VersionMismatch);
        assert_eq!(parse_request("junk").unwrap_err().code, ErrorCode::Usage);
        assert_eq!(
            parse_request(r#"{"method":"status"}"#).unwrap_err().code,
            ErrorCode::Usage
        );
    }

    #[test]
    fn a_newer_request_shape_still_reports_the_version() {
        let newer = r#"{"version":3,"method":"teleport","params":{"to":[1,2]}}"#;
        assert_eq!(
            parse_request(newer).unwrap_err().code,
            ErrorCode::VersionMismatch
        );
        let older_shape = r#"{"version":2,"method":"teleport"}"#;
        assert_eq!(
            parse_request(older_shape).unwrap_err().code,
            ErrorCode::Usage
        );
    }

    #[test]
    fn the_pipe_grants_access_to_its_owner_alone() {
        assert_eq!(
            owner_only_sddl("S-1-5-21-1-2-3-1001"),
            "D:P(A;;GA;;;S-1-5-21-1-2-3-1001)"
        );
    }

    #[cfg(windows)]
    #[test]
    fn the_pipe_is_named_by_sid() {
        let sid = windows_user::current_sid().unwrap();
        assert!(sid.starts_with("S-1-"), "{sid}");
        let name = InstanceName::new("lab").unwrap();
        assert_eq!(socket_address(&name), pipe_name(&sid, name.as_str()));
    }

    #[cfg(unix)]
    #[test]
    fn the_longest_socket_path_fits_in_sun_path() {
        // macOS allows 104 bytes in `sun_path`, the trailing NUL included.
        let name = InstanceName::new(&"n".repeat(24)).unwrap();
        // A data folder of its own adds a dot and an 8-character tag.
        let scoped = format!("{name}.ffffffff");
        let worst = socket_path_named(&socket_dir_for(u32::MAX), &scoped);
        assert!(worst.len() < 104, "{} bytes: {worst}", worst.len());
        let current = socket_address(&name);
        assert!(cfg!(windows) || current.len() < 104, "{current}");
    }

    #[cfg(unix)]
    #[test]
    fn the_socket_folder_must_be_private() {
        use std::os::unix::fs::PermissionsExt;
        let root = tempfile::tempdir().unwrap();
        let fresh = root.path().join("fresh");
        private_dir(&fresh).unwrap();
        let mode = std::fs::metadata(&fresh).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o700);
        private_dir(&fresh).unwrap();

        let open = root.path().join("open");
        std::fs::create_dir(&open).unwrap();
        std::fs::set_permissions(&open, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert_eq!(
            private_dir(&open).unwrap_err().kind(),
            io::ErrorKind::PermissionDenied
        );

        let link = root.path().join("link");
        std::os::unix::fs::symlink(&fresh, &link).unwrap();
        assert!(private_dir(&link).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn the_client_never_talks_through_a_folder_others_can_open() {
        use std::os::unix::fs::PermissionsExt;
        let root = tempfile::tempdir().unwrap();
        let shared = root.path().join("shared");
        std::fs::create_dir(&shared).unwrap();
        let address = socket_path(&shared, &InstanceName::new("lab").unwrap());
        let answered = Arc::new(AtomicUsize::new(0));
        let count = Arc::clone(&answered);
        serve(&address, move |_| {
            count.fetch_add(1, Ordering::SeqCst);
            Response::Result(json!({"ok": true}))
        })
        .unwrap();
        let mode = |mode| std::fs::set_permissions(&shared, PermissionsExt::from_mode(mode));
        let call = || call_in(&shared, &address, &Request::Status, Duration::from_secs(5));

        mode(0o700).unwrap();
        assert_eq!(call(), Response::Result(json!({"ok": true})));
        mode(0o755).unwrap();
        let refused = call();
        assert!(
            matches!(&refused, Response::Error(e) if e.code == ErrorCode::NotRunning && e.hint.is_some()),
            "{refused:?}"
        );
        let link = root.path().join("link");
        mode(0o700).unwrap();
        std::os::unix::fs::symlink(&shared, &link).unwrap();
        let linked = socket_path(&link, &InstanceName::new("lab").unwrap());
        let through_link = call_in(&link, &linked, &Request::Status, Duration::from_secs(5));
        assert!(matches!(through_link, Response::Error(e) if e.code == ErrorCode::NotRunning));
        assert_eq!(answered.load(Ordering::SeqCst), 1);

        let missing = root.path().join("missing");
        let gone = socket_path(&missing, &InstanceName::new("lab").unwrap());
        let reply = call_in(&missing, &gone, &Request::Status, Duration::from_secs(5));
        assert!(matches!(reply, Response::Error(e) if e.code == ErrorCode::NotRunning));
    }

    #[test]
    fn socket_addresses_name_the_instance() {
        let address = socket_address(&InstanceName::new("lab").unwrap());
        assert!(address.contains("lab"), "{address}");
    }
}
