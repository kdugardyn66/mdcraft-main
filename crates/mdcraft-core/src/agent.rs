//! The agent bridge: lets `mdcraft-cli mcp --connect` drive a running mdcraft window.
//!
//! The editor lives in the page, so an agent's request is queued here and the page
//! (`web/assets/agent.js`) picks it up with a long poll, runs it — usually a command by
//! id, exactly what the ribbon would run — and posts the answer back.
//!
//! | Route | Who | What |
//! |---|---|---|
//! | `POST /api/agent/call` | the MCP server | `{op, args, timeoutMs}` → waits for the page's answer |
//! | `GET  /api/agent/next` | the page | long poll: the next request `{id, op, args}` (or `null`) |
//! | `POST /api/agent/result` | the page | `{id, ok, value, error}` |
//! | `GET  /api/agent/view` | the MCP server | the rendered view (HTML, headings, slides, front matter) |
//!
//! The bridge is off unless the app was started with `--control`: then the port and
//! the session token are written to `control/<port>.json` in the config folder (only
//! readable by the user), which is how `mdcraft-cli mcp --connect` finds them. All
//! routes sit behind the server's token check and only listen on 127.0.0.1.

use crate::app::App;
use crate::http::{json_resp, read_json};
use crate::util;
use crate::web::Request;
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

/// Requests waiting for the page, and answers waiting for the agent.
#[derive(Default)]
pub struct Bridge {
    /// Set by `--control`: the page starts polling only then.
    pub enabled: AtomicBool,
    next_id: AtomicU64,
    inner: Mutex<Inner>,
    /// Signalled when a request is queued (the page waits) or answered (the agent waits).
    cv: Condvar,
}

#[derive(Default)]
struct Inner {
    queue: VecDeque<Value>,
    results: HashMap<u64, Value>,
    /// Ids whose caller gave up: their late answers are dropped.
    abandoned: Vec<u64>,
    /// When the page last asked for work (is a window listening?).
    page_seen: Option<Instant>,
}

/// Longest an agent call may wait for the page.
const MAX_WAIT: Duration = Duration::from_secs(300);
/// How long the page's long poll is held open.
const POLL: Duration = Duration::from_secs(20);

impl Bridge {
    pub fn page_connected(&self) -> bool {
        self.inner.lock().ok().and_then(|i| i.page_seen).map(|t| t.elapsed() < POLL + Duration::from_secs(5)).unwrap_or(false)
    }

    /// Queues `op` for the page and waits for its answer.
    pub fn call(&self, op: &str, args: Value, wait: Duration) -> Result<Value, String> {
        if !self.page_connected() {
            return Err("no mdcraft window is listening (is the document window still open?)".into());
        }
        let id = self.next_id.fetch_add(1, Ordering::SeqCst) + 1;
        let deadline = Instant::now() + wait.min(MAX_WAIT);
        let mut inner = self.inner.lock().map_err(|_| "bridge poisoned")?;
        inner.queue.push_back(json!({"id": id, "op": op, "args": args}));
        self.cv.notify_all();
        loop {
            if let Some(r) = inner.results.remove(&id) {
                return Ok(r);
            }
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                inner.queue.retain(|q| q["id"].as_u64() != Some(id));
                inner.abandoned.push(id);
                if inner.abandoned.len() > 64 {
                    inner.abandoned.remove(0);
                }
                return Err(format!("the window did not answer `{op}` within {} s (a dialog may be waiting for the user)", wait.as_secs()));
            }
            inner = self.cv.wait_timeout(inner, left).map_err(|_| "bridge poisoned")?.0;
        }
    }

    /// The page's long poll: the next request, or `None` after a while.
    fn next(&self) -> Option<Value> {
        let deadline = Instant::now() + POLL;
        let mut inner = self.inner.lock().ok()?;
        loop {
            inner.page_seen = Some(Instant::now());
            if let Some(q) = inner.queue.pop_front() {
                return Some(q);
            }
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return None;
            }
            inner = self.cv.wait_timeout(inner, left).ok()?.0;
        }
    }

    fn answer(&self, id: u64, v: Value) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.page_seen = Some(Instant::now());
            if let Some(i) = inner.abandoned.iter().position(|a| *a == id) {
                inner.abandoned.remove(i);
                return;
            }
            inner.results.insert(id, v);
            self.cv.notify_all();
        }
    }
}

/// `MDCRAFT_CONTROL_PORT`: turn on agent control without `--control`, on this port (0 = any
/// free port).
pub fn env_control_port() -> Option<u16> {
    control_port_setting().and_then(|(v, _)| parse_control_port(Some(&v)))
}

/// The raw `MDCRAFT_CONTROL_PORT` value and where it came from ("environment" or "launchctl").
///
/// Apps opened from Finder, the Dock or Spotlight never see a command line or the shell's
/// variables, and current macOS versions don't reliably hand them what `launchctl setenv`
/// set either. So when the process environment doesn't have it, ask launchd directly
/// (`launchctl getenv MDCRAFT_CONTROL_PORT`), which always answers with the session's value.
pub fn control_port_setting() -> Option<(String, &'static str)> {
    if let Some(v) = std::env::var("MDCRAFT_CONTROL_PORT").ok().filter(|v| !v.trim().is_empty()) {
        return Some((v, "environment"));
    }
    launchd_value("MDCRAFT_CONTROL_PORT").map(|v| (v, "launchctl"))
}

#[cfg(target_os = "macos")]
fn launchd_value(name: &str) -> Option<String> {
    use std::process::{Command, Stdio};
    let out = Command::new("/bin/launchctl").args(["getenv", name]).stdin(Stdio::null()).stderr(Stdio::null()).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let v = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!v.is_empty()).then_some(v)
}

#[cfg(not(target_os = "macos"))]
fn launchd_value(_name: &str) -> Option<String> {
    None
}

fn parse_control_port(v: Option<&str>) -> Option<u16> {
    let v = v.map(str::trim).filter(|v| !v.is_empty())?;
    match v.parse::<u16>() {
        Ok(p) => Some(p),
        Err(_) => {
            eprintln!("mdcraft: ignoring MDCRAFT_CONTROL_PORT={v}: not a port number (1-65535, or 0 for any free port)");
            None
        }
    }
}

#[cfg(test)]
mod env_tests {
    #[test]
    fn parses_the_port() {
        use super::parse_control_port as p;
        assert_eq!(p(Some("7985")), Some(7985));
        assert_eq!(p(Some(" 7985\n")), Some(7985));
        assert_eq!(p(Some("0")), Some(0));
        assert_eq!(p(Some("")), None);
        assert_eq!(p(Some("abc")), None);
        assert_eq!(p(Some("70000")), None);
        assert_eq!(p(None), None);
    }
}

/// `control/<port>.json`: how `mdcraft-cli mcp --connect` finds a window.
pub fn control_dir() -> PathBuf {
    util::config_dir().join("control")
}

/// Turns the bridge on and publishes the port and token for local agents.
/// Returns the control file (remove it with [`unpublish`] on exit).
pub fn publish(app: &App) -> Result<PathBuf, String> {
    app.agent.enabled.store(true, Ordering::SeqCst);
    let port = app.port.load(Ordering::SeqCst);
    let dir = control_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    remove_stale(&dir, port);
    let file = dir.join(format!("{port}.json"));
    let v = json!({
        "port": port,
        "token": app.token,
        "pid": std::process::id(),
        "mode": if app.mode == crate::app::Mode::Desktop { "desktop" } else { "browser" },
        "version": env!("CARGO_PKG_VERSION"),
    });
    crate::http::write_private(&file, v.to_string().as_bytes()).map_err(|e| format!("cannot write {}: {e}", file.display()))?;
    Ok(file)
}

/// Control files of windows that are gone (crashed, or a Ctrl+C'd `serve`): nothing listens on their port.
fn remove_stale(dir: &std::path::Path, own: u16) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        let Some(port) = p.file_stem().and_then(|s| s.to_str()).and_then(|s| s.parse::<u16>().ok()) else { continue };
        if port == own {
            continue;
        }
        let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
        if std::net::TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_err() {
            let _ = std::fs::remove_file(&p);
        }
    }
}

pub fn unpublish(app: &App) {
    let port = app.port.load(Ordering::SeqCst);
    let _ = std::fs::remove_file(control_dir().join(format!("{port}.json")));
}

/// Handles `/api/agent/…`. Returns the request back when the route isn't ours.
pub fn handle(app: &Arc<App>, req: Request, path: &str) -> Result<std::io::Result<()>, Request> {
    if !path.starts_with("/api/agent/") {
        return Err(req);
    }
    if !app.agent.enabled.load(Ordering::SeqCst) {
        return Ok(req.respond(json_resp(403, &json!({"error": "agent control is off: start mdcraft with --control"}))));
    }
    let r = match (req.method.as_str(), path) {
        ("POST", "/api/agent/call") => {
            let body = read_json(&req);
            let Some(op) = body.get("op").and_then(|v| v.as_str()).map(|s| s.to_string()) else {
                return Ok(req.respond(json_resp(400, &json!({"error": "op required"}))));
            };
            let args = body.get("args").cloned().unwrap_or(Value::Null);
            let wait = Duration::from_millis(body.get("timeoutMs").and_then(|v| v.as_u64()).unwrap_or(30_000));
            match app.agent.call(&op, args, wait) {
                Ok(v) => req.respond(json_resp(200, &v)),
                Err(e) => req.respond(json_resp(503, &json!({"error": e}))),
            }
        }
        ("GET", "/api/agent/next") => {
            let v = app.agent.next().unwrap_or(Value::Null);
            req.respond(json_resp(200, &v))
        }
        ("POST", "/api/agent/result") => {
            let body = read_json(&req);
            match body.get("id").and_then(|v| v.as_u64()) {
                Some(id) => {
                    app.agent.answer(id, body);
                    req.respond(json_resp(200, &json!({"ok": true})))
                }
                None => req.respond(json_resp(400, &json!({"error": "id required"}))),
            }
        }
        ("GET", "/api/agent/view") => {
            let v = match app.state.lock() {
                Ok(st) => {
                    let mut v = app.view_json(&st, true);
                    v["windowConnected"] = json!(app.agent.page_connected());
                    v
                }
                Err(_) => json!({"error": "state unavailable"}),
            };
            req.respond(json_resp(200, &v))
        }
        _ => req.respond(json_resp(404, &json!({"error": "no such agent route"}))),
    };
    Ok(r)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn call_without_page_fails_fast() {
        let b = Bridge::default();
        let t = Instant::now();
        assert!(b.call("state", Value::Null, Duration::from_secs(5)).is_err());
        assert!(t.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn round_trip() {
        let b = Arc::new(Bridge::default());
        b.inner.lock().unwrap().page_seen = Some(Instant::now());
        let page = b.clone();
        let h = std::thread::spawn(move || {
            let q = page.next().unwrap();
            assert_eq!(q["op"], "state");
            page.answer(q["id"].as_u64().unwrap(), json!({"id": q["id"], "ok": true, "value": 42}));
        });
        let r = b.call("state", Value::Null, Duration::from_secs(5)).unwrap();
        assert_eq!(r["value"], 42);
        h.join().unwrap();
    }

    #[test]
    fn late_answers_are_dropped() {
        let b = Bridge::default();
        b.inner.lock().unwrap().page_seen = Some(Instant::now());
        assert!(b.call("slow", Value::Null, Duration::from_millis(50)).is_err());
        b.answer(1, json!({"ok": true}));
        assert!(b.inner.lock().unwrap().results.is_empty());
    }
}
