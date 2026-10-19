//! A tiny client for a running mdcraft window (`mdcraft --control`): finds its port and
//! token in `control/<port>.json` and talks to `/api/agent/…` over loopback HTTP.

use mdcraft_core::agent::control_dir;
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::time::Duration;

/// Which window to drive: a port, or the most recently started one.
#[derive(Clone, Debug)]
pub enum Target {
    Port(u16),
    Newest,
    /// MDCRAFT_CONTROL_PORT: this port when a window is there, otherwise the newest window.
    Preferred(u16),
}

impl Target {
    /// `7985`, `127.0.0.1:7985`, `localhost:7985` or empty: the window on MDCRAFT_CONTROL_PORT
    /// when that is set (and not 0), otherwise the newest window.
    pub fn parse(s: Option<&str>) -> Result<Target, String> {
        let Some(s) = s.map(str::trim).filter(|s| !s.is_empty()) else {
            return Ok(match mdcraft_core::agent::env_control_port() {
                Some(p) if p != 0 => Target::Preferred(p),
                _ => Target::Newest,
            });
        };
        let port = s.rsplit(':').next().unwrap_or(s);
        if let Some(host) = s.rsplit_once(':').map(|(h, _)| h) {
            if !matches!(host, "127.0.0.1" | "localhost" | "[::1]") {
                return Err(format!("--connect only reaches mdcraft on this computer (127.0.0.1), not {host}"));
            }
        }
        port.parse().map(Target::Port).map_err(|_| format!("--connect expects a port such as 7985, got `{s}`"))
    }
}

struct Endpoint {
    port: u16,
    token: String,
}

fn read_control(file: &PathBuf) -> Option<Endpoint> {
    let v: Value = serde_json::from_str(&std::fs::read_to_string(file).ok()?).ok()?;
    Some(Endpoint { port: v["port"].as_u64()? as u16, token: v["token"].as_str()?.to_string() })
}

fn candidates(target: &Target) -> Result<Vec<Endpoint>, String> {
    let dir = control_dir();
    match target {
        Target::Port(p) => {
            let file = dir.join(format!("{p}.json"));
            read_control(&file)
                .map(|e| vec![e])
                .ok_or_else(|| format!("no mdcraft window with agent control on port {p}: start it with `mdcraft --control {p}`"))
        }
        Target::Preferred(p) => {
            let mut list = candidates(&Target::Newest)?;
            if let Some(i) = list.iter().position(|e| e.port == *p) {
                let e = list.remove(i);
                list.insert(0, e);
            }
            Ok(list)
        }
        Target::Newest => {
            let mut files: Vec<(std::time::SystemTime, PathBuf)> = std::fs::read_dir(&dir)
                .map(|rd| {
                    rd.flatten()
                        .map(|e| e.path())
                        .filter(|p| p.extension().map(|x| x == "json").unwrap_or(false))
                        .map(|p| (std::fs::metadata(&p).and_then(|m| m.modified()).unwrap_or(std::time::UNIX_EPOCH), p))
                        .collect()
                })
                .unwrap_or_default();
            files.sort_by_key(|f| std::cmp::Reverse(f.0));
            let list: Vec<Endpoint> = files.iter().filter_map(|(_, p)| read_control(p)).collect();
            if list.is_empty() {
                return Err("no mdcraft window with agent control is running: start one with `mdcraft --control`".into());
            }
            Ok(list)
        }
    }
}

/// One HTTP/1.1 request to 127.0.0.1 (no proxies: this never leaves the computer).
fn http(ep: &Endpoint, method: &str, path: &str, body: Option<&Value>, timeout: Duration) -> Result<(u16, Value), String> {
    let mut s = TcpStream::connect(("127.0.0.1", ep.port)).map_err(|e| format!("cannot reach mdcraft on port {}: {e}", ep.port))?;
    let _ = s.set_read_timeout(Some(timeout + Duration::from_secs(10)));
    let _ = s.set_write_timeout(Some(Duration::from_secs(10)));
    let data = body.map(|b| b.to_string()).unwrap_or_default();
    let sep = if path.contains('?') { '&' } else { '?' };
    let head = format!(
        "{method} {path}{sep}t={token} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: {len}\r\n\r\n",
        token = ep.token,
        port = ep.port,
        len = data.len()
    );
    s.write_all(head.as_bytes()).and_then(|_| s.write_all(data.as_bytes())).map_err(|e| format!("mdcraft: {e}"))?;
    let mut buf = Vec::new();
    s.read_to_end(&mut buf).map_err(|e| format!("no answer from mdcraft: {e}"))?;
    let text = String::from_utf8_lossy(&buf);
    let (headers, body) = text.split_once("\r\n\r\n").ok_or("a garbled answer from mdcraft")?;
    let status: u16 = headers.split_whitespace().nth(1).and_then(|c| c.parse().ok()).unwrap_or(0);
    let v = serde_json::from_str(body).unwrap_or_else(|_| json!({"error": body.trim()}));
    Ok((status, v))
}

pub struct Live {
    pub target: Target,
}

impl Live {
    fn request(&self, method: &str, path: &str, body: Option<&Value>, timeout: Duration) -> Result<Value, String> {
        let mut last = String::new();
        for ep in candidates(&self.target)? {
            match http(&ep, method, path, body, timeout) {
                Ok((200, v)) => return Ok(v),
                Ok((_, v)) => return Err(v["error"].as_str().unwrap_or("mdcraft refused the request").to_string()),
                Err(e) => last = e, // a stale control file (the window was closed): try the next one
            }
        }
        Err(last)
    }

    /// Runs an operation in the window's page (see `web/assets/agent.js`).
    pub fn call(&self, op: &str, args: Value, timeout: Duration) -> Result<Value, String> {
        let body = json!({"op": op, "args": args, "timeoutMs": timeout.as_millis() as u64});
        let v = self.request("POST", "/api/agent/call", Some(&body), timeout)?;
        if v["ok"].as_bool() == Some(true) {
            Ok(v["value"].clone())
        } else {
            Err(v["error"].as_str().unwrap_or("the window could not do that").to_string())
        }
    }

    /// The rendered view of the window's document (title, headings, slides, front matter, HTML).
    pub fn view(&self) -> Result<Value, String> {
        self.request("GET", "/api/agent/view", None, Duration::from_secs(10))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn targets() {
        assert!(matches!(Target::parse(None), Ok(Target::Newest)));
        assert!(matches!(Target::parse(Some("7985")), Ok(Target::Port(7985))));
        assert!(matches!(Target::parse(Some("127.0.0.1:7985")), Ok(Target::Port(7985))));
        assert!(Target::parse(Some("example.com:7985")).is_err());
        assert!(Target::parse(Some("abc")).is_err());
    }
}
