//! mdcraft's editor API (on top of MarkDown Live's preview routes).
//!
//! | Route | What |
//! |---|---|
//! | `GET  /api/app` | version, platform, folders, preferences, recent files |
//! | `POST /api/doc` | `{path, text}`: the editor's text (renders the preview) |
//! | `GET  /api/file?path=` | read a text file |
//! | `POST /api/file/save` | `{path, text}`: write a text file (atomic) |
//! | `GET  /api/dir?path=&filter=` | list a folder (`md`, `image`, `all`) |
//! | `GET/POST /api/recent…` | recent documents (`/api/recent/remove`, `/api/recent/pin`) |
//! | `GET/POST /api/prefs` | preferences (`{"ui": …, "render": …}`) |
//! | `GET  /api/templates`, `/api/template?id=`, `/api/template/preview?id=` | templates |
//! | `POST /api/picture` | `{doc, src}`: the path to write for a picture in `doc` |
//! | `POST /api/autosave`, `GET /api/autosave/list`, `POST /api/autosave/discard` | document recovery |

use crate::app::App;
use crate::http::{json_resp, read_json};
use crate::markdown::{self, Ctx};
use crate::prefs;
use crate::util::{self, norm_path};
use crate::web::Request;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

/// Text files larger than this are refused (the editor would choke on them anyway).
const MAX_TEXT: u64 = 32 * 1024 * 1024;

fn q<'a>(qs: &'a [(String, String)], k: &str) -> Option<&'a str> {
    qs.iter().find(|(a, _)| a == k).map(|(_, b)| b.as_str())
}

fn err(code: u16, msg: impl Into<String>) -> crate::web::Response {
    json_resp(code, &json!({"error": msg.into()}))
}

/// Identifies one version of a file on disk (size and modification time), so the editor can
/// tell when another application changed the document it has open.
pub fn file_stamp(p: &Path) -> Option<String> {
    let m = std::fs::metadata(p).ok().filter(|m| m.is_file())?;
    let t = m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_nanos()).unwrap_or(0);
    Some(format!("{}:{t}", m.len()))
}

/// A three-way merge of the editor's text (`ours`) and the file on disk (`theirs`), both
/// changed from `base` (the text last loaded or saved). Returns the merged text and the
/// number of conflicts, which are marked in the text like git does.
pub fn merge_texts(base: &str, ours: &str, theirs: &str) -> (String, usize) {
    let mut opts = diffy::MergeOptions::new();
    opts.set_conflict_style(diffy::ConflictStyle::Merge);
    match opts.merge(base, ours, theirs) {
        Ok(text) => (text, 0),
        Err(text) => {
            let mut n = 0;
            let out: Vec<String> = text
                .split_inclusive('\n')
                .map(|l| {
                    let (body, nl) = l.strip_suffix('\n').map(|b| (b, "\n")).unwrap_or((l, ""));
                    match body {
                        "<<<<<<< ours" => {
                            n += 1;
                            format!("<<<<<<< Your changes{nl}")
                        }
                        ">>>>>>> theirs" => format!(">>>>>>> Changed on disk{nl}"),
                        _ => l.to_string(),
                    }
                })
                .collect();
            (out.concat(), n)
        }
    }
}

fn expand(p: &str) -> PathBuf {
    let p = p.trim();
    if let Some(rest) = p.strip_prefix("~/") {
        if let Some(h) = util::home_dir() {
            return h.join(rest);
        }
    }
    if p == "~" {
        if let Some(h) = util::home_dir() {
            return h;
        }
    }
    PathBuf::from(p)
}

/// Handles `/api/…` routes added by mdcraft. Returns the request back when the route isn't ours.
pub fn handle(app: &Arc<App>, req: Request, path: &str, qs: &[(String, String)]) -> Result<std::io::Result<()>, Request> {
    let r = match (req.method.as_str(), path) {
        ("GET", "/api/app") => {
            let v = json!({
                "name": "mdcraft",
                "version": env!("CARGO_PKG_VERSION"),
                "mode": if app.mode == crate::app::Mode::Desktop { "desktop" } else { "browser" },
                "platform": std::env::consts::OS,
                "home": util::home_dir().map(|h| h.to_string_lossy().to_string()),
                "documents": util::documents_dir().to_string_lossy(),
                "separator": std::path::MAIN_SEPARATOR.to_string(),
                "author": prefs::author(),
                "prefs": prefs::load(),
                "recent": prefs::recent(),
                "templatesDir": crate::user_templates::dir().to_string_lossy(),
                "startup": app.startup.lock().map(|s| {
                    // under the same lock, so the window knows whether a file it adds later is seen
                    app.startup_read.store(true, std::sync::atomic::Ordering::SeqCst);
                    s.clone()
                }).unwrap_or(Value::Null),
                "agent": app.agent.enabled.load(std::sync::atomic::Ordering::SeqCst),
            });
            req.respond(json_resp(200, &v))
        }
        ("POST", "/api/doc") => {
            let body = read_json(&req);
            let (Some(p), Some(text)) = (body.get("path").and_then(|v| v.as_str()), body.get("text").and_then(|v| v.as_str())) else {
                return Ok(req.respond(err(400, "path and text required")));
            };
            app.set_document(expand(p), text.to_string());
            req.respond(json_resp(200, &json!({"ok": true})))
        }
        ("GET", "/api/file") => {
            let Some(p) = q(qs, "path") else { return Ok(req.respond(err(400, "path required"))) };
            let p = norm_path(&expand(p));
            match std::fs::metadata(&p) {
                Ok(m) if m.is_file() && m.len() > MAX_TEXT => req.respond(err(413, format!("{} is too large to edit ({} MB)", p.display(), m.len() / 1_048_576))),
                Ok(m) if m.is_file() => match std::fs::read(&p) {
                    Ok(bytes) => {
                        let text = String::from_utf8(bytes).unwrap_or_else(|e| String::from_utf8_lossy(e.as_bytes()).into_owned());
                        let text = text.strip_prefix('\u{feff}').map(|s| s.to_string()).unwrap_or(text);
                        // `recent=0`: a check for changes made elsewhere, not the user opening it.
                        if q(qs, "recent") != Some("0") {
                            prefs::add_recent(&p);
                        }
                        req.respond(json_resp(200, &json!({"path": p.to_string_lossy(), "text": text, "name": file_name(&p), "stamp": file_stamp(&p)})))
                    }
                    Err(e) => req.respond(err(500, format!("cannot read {}: {e}", p.display()))),
                },
                Ok(_) => req.respond(err(400, format!("{} is a folder", p.display()))),
                Err(e) => req.respond(err(404, format!("cannot open {}: {e}", p.display()))),
            }
        }
        ("POST", "/api/file/save") => {
            let body = read_json(&req);
            let (Some(p), Some(text)) = (body.get("path").and_then(|v| v.as_str()), body.get("text").and_then(|v| v.as_str())) else {
                return Ok(req.respond(err(400, "path and text required")));
            };
            let p = expand(p);
            if p.is_dir() {
                return Ok(req.respond(err(400, format!("{} is a folder", p.display()))));
            }
            let recent = body.get("recent").and_then(|v| v.as_bool()).unwrap_or(true);
            match prefs::write_atomic(&p, text.as_bytes()) {
                Ok(()) => {
                    let p = norm_path(&p);
                    if recent {
                        prefs::add_recent(&p);
                    }
                    req.respond(json_resp(200, &json!({"ok": true, "path": p.to_string_lossy(), "name": file_name(&p), "stamp": file_stamp(&p)})))
                }
                Err(e) => req.respond(err(500, format!("cannot save {}: {e}", p.display()))),
            }
        }
        ("GET", "/api/fonts") => req.respond(json_resp(200, &json!({"fonts": crate::fonts::families()}))),
        ("GET", "/api/file/stat") => {
            let Some(p) = q(qs, "path") else { return Ok(req.respond(err(400, "path required"))) };
            let p = norm_path(&expand(p));
            let stamp = file_stamp(&p);
            req.respond(json_resp(200, &json!({"exists": stamp.is_some(), "stamp": stamp})))
        }
        ("POST", "/api/merge") => {
            let body = read_json(&req);
            let get = |k: &str| body.get(k).and_then(|v| v.as_str());
            let (Some(base), Some(ours), Some(theirs)) = (get("base"), get("ours"), get("theirs")) else {
                return Ok(req.respond(err(400, "base, ours and theirs required")));
            };
            let (text, conflicts) = merge_texts(base, ours, theirs);
            req.respond(json_resp(200, &json!({"text": text, "conflicts": conflicts})))
        }
        ("GET", "/api/dir") => {
            let dir = q(qs, "path").filter(|s| !s.trim().is_empty()).map(expand).unwrap_or_else(util::documents_dir);
            let filter = q(qs, "filter").unwrap_or("md");
            req.respond(match list_dir(&dir, filter) {
                Ok(v) => json_resp(200, &v),
                Err(e) => err(404, e),
            })
        }
        ("GET", "/api/recent") => req.respond(json_resp(200, &json!(prefs::recent()))),
        ("POST", "/api/recent/remove") => {
            let body = read_json(&req);
            prefs::remove_recent(body.get("path").and_then(|v| v.as_str()));
            req.respond(json_resp(200, &json!(prefs::recent())))
        }
        ("POST", "/api/recent/pin") => {
            let body = read_json(&req);
            if let Some(p) = body.get("path").and_then(|v| v.as_str()) {
                prefs::pin_recent(p, body.get("pinned").and_then(|v| v.as_bool()).unwrap_or(true));
            }
            req.respond(json_resp(200, &json!(prefs::recent())))
        }
        ("GET", "/api/prefs") => req.respond(json_resp(200, &prefs::load())),
        ("POST", "/api/prefs") => {
            let body = read_json(&req);
            match prefs::update(&body) {
                Ok(v) => {
                    if body.get("render").is_some() {
                        app.set_settings(prefs::render_settings());
                    }
                    req.respond(json_resp(200, &v))
                }
                Err(e) => req.respond(err(500, e)),
            }
        }
        ("GET", "/api/templates") => {
            let list: Vec<Value> = match q(qs, "q").filter(|s| !s.trim().is_empty()) {
                Some(query) => mdcraft_templates::search(query).into_iter().map(|t| json!(t)).collect(),
                None => mdcraft_templates::all().iter().map(|t| json!(t)).collect(),
            };
            req.respond(json_resp(200, &json!(list)))
        }
        ("GET", "/api/template") => {
            let Some(t) = q(qs, "id").and_then(mdcraft_templates::get) else { return Ok(req.respond(err(404, "no such template"))) };
            let text = mdcraft_templates::instantiate(t, &template_vars());
            req.respond(json_resp(200, &json!({"id": t.id, "name": t.name, "kind": t.kind, "text": text})))
        }
        ("GET", "/api/template/preview") => {
            let Some(t) = q(qs, "id").and_then(mdcraft_templates::get) else { return Ok(req.respond(err(404, "no such template"))) };
            let v = template_preview(app, t);
            req.respond(json_resp(200, &v).header("Cache-Control", "max-age=60"))
        }
        // ---------------------------------------------------------------- custom templates
        ("GET", "/api/user-templates") => {
            let dir = crate::user_templates::dir();
            req.respond(json_resp(200, &json!({"dir": dir.to_string_lossy(), "templates": crate::user_templates::list_in(&dir)})))
        }
        ("GET", "/api/user-template") => {
            let Some(p) = q(qs, "path").map(|p| norm_path(&expand(p))) else { return Ok(req.respond(err(400, "path required"))) };
            match crate::user_templates::instantiate(&p, &template_vars()) {
                Ok(text) => {
                    let t = crate::user_templates::describe(&p);
                    req.respond(json_resp(200, &json!({"path": p.to_string_lossy(), "name": t.as_ref().map(|t| t.name.clone()), "kind": t.map(|t| t.kind), "text": text})))
                }
                Err(e) => req.respond(err(404, e)),
            }
        }
        ("GET", "/api/user-template/preview") => {
            let Some(p) = q(qs, "path").map(|p| norm_path(&expand(p))) else { return Ok(req.respond(err(400, "path required"))) };
            match crate::user_templates::instantiate(&p, &template_vars()) {
                Ok(text) => {
                    let settings = app.settings();
                    let mut ctx = Ctx::new(&settings, p.clone(), vec![]);
                    ctx.sourcepos = false;
                    ctx.allow_scripts = false;
                    let r = markdown::render(&text, &ctx);
                    let meta: serde_json::Map<String, Value> = r.meta.into_iter().map(|(k, v)| (k, Value::String(v))).collect();
                    req.respond(json_resp(200, &json!({"html": r.html, "slides": r.slides, "meta": meta, "title": r.title})))
                }
                Err(e) => req.respond(err(404, e)),
            }
        }
        ("POST", "/api/user-template/rename") => {
            let body = read_json(&req);
            let (Some(p), Some(name)) = (body.get("path").and_then(|v| v.as_str()), body.get("name").and_then(|v| v.as_str())) else {
                return Ok(req.respond(err(400, "path and name required")));
            };
            match crate::user_templates::rename_in(&crate::user_templates::dir(), &expand(p), name) {
                Ok(to) => req.respond(json_resp(200, &json!({"path": to.to_string_lossy()}))),
                Err(e) => req.respond(err(400, e)),
            }
        }
        ("POST", "/api/user-template/delete") => {
            let body = read_json(&req);
            let Some(p) = body.get("path").and_then(|v| v.as_str()) else { return Ok(req.respond(err(400, "path required"))) };
            let Some(trash) = crate::user_templates::trash_dir() else { return Ok(req.respond(err(500, "no Trash folder"))) };
            match crate::user_templates::delete_in(&crate::user_templates::dir(), &expand(p), &trash) {
                Ok(to) => req.respond(json_resp(200, &json!({"trash": to.to_string_lossy()}))),
                Err(e) => req.respond(err(400, e)),
            }
        }
        ("GET", "/api/emoji-preview") => {
            // :shortcode: → glyph, through the renderer's own shortcode table
            let names = q(qs, "names").unwrap_or("");
            let settings = app.settings();
            let opts = markdown::options(&settings, false);
            let mut map = serde_json::Map::new();
            for n in names.split(',').filter(|n| !n.is_empty() && n.len() < 40).take(400) {
                let html = comrak::markdown_to_html(&format!(":{n}:"), &opts);
                let glyph = html.trim().trim_start_matches("<p>").trim_end_matches("</p>").trim().to_string();
                if !glyph.contains(':') {
                    map.insert(n.to_string(), Value::String(glyph));
                }
            }
            req.respond(json_resp(200, &Value::Object(map)).header("Cache-Control", "max-age=3600"))
        }
        ("POST", "/api/picture") => {
            let body = read_json(&req);
            let (Some(doc), Some(src)) = (body.get("doc").and_then(|v| v.as_str()), body.get("src").and_then(|v| v.as_str())) else {
                return Ok(req.respond(err(400, "doc and src required")));
            };
            let copy = body.get("copy").and_then(|v| v.as_bool()).unwrap_or(true);
            req.respond(match picture_path(app, &expand(doc), &expand(src), copy) {
                Ok(v) => json_resp(200, &v),
                Err(e) => err(400, e),
            })
        }
        ("POST", "/api/autosave") => {
            let body = read_json(&req);
            let Some(key) = body.get("key").and_then(|v| v.as_str()).map(autosave_key).filter(|k| !k.is_empty()) else {
                return Ok(req.respond(err(400, "key required")));
            };
            let file = autosave_dir().join(format!("{key}.json"));
            let res = if body.get("text").map(|t| t.is_null()).unwrap_or(true) {
                let _ = std::fs::remove_file(&file);
                Ok(())
            } else {
                let v = json!({
                    "key": key,
                    "path": body.get("path").cloned().unwrap_or(Value::Null),
                    "name": body.get("name").cloned().unwrap_or(Value::Null),
                    "text": body.get("text").cloned().unwrap_or(Value::Null),
                    "saved": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0),
                    "pid": std::process::id(),
                });
                crate::http::write_private(&file, v.to_string().as_bytes()).or_else(|_| {
                    std::fs::create_dir_all(autosave_dir())?;
                    crate::http::write_private(&file, v.to_string().as_bytes())
                })
            };
            req.respond(match res {
                Ok(()) => json_resp(200, &json!({"ok": true})),
                Err(e) => err(500, format!("autosave failed: {e}")),
            })
        }
        ("GET", "/api/autosave/list") => {
            // Recoverable documents: autosaves left by mdcraft windows that are no longer running.
            let mut out = Vec::new();
            if let Ok(rd) = std::fs::read_dir(autosave_dir()) {
                for e in rd.flatten() {
                    let Some(v) = std::fs::read_to_string(e.path()).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()) else { continue };
                    let pid = v["pid"].as_u64().unwrap_or(0) as u32;
                    if pid == std::process::id() || process_alive(pid) {
                        continue;
                    }
                    let text = v["text"].as_str().unwrap_or("");
                    out.push(json!({"key": v["key"], "path": v["path"], "name": v["name"], "saved": v["saved"], "chars": text.chars().count()}));
                }
            }
            req.respond(json_resp(200, &json!(out)))
        }
        ("GET", "/api/autosave/get") => {
            let key = q(qs, "key").map(autosave_key).unwrap_or_default();
            let file = autosave_dir().join(format!("{key}.json"));
            match std::fs::read_to_string(&file).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()) {
                Some(v) if !key.is_empty() => req.respond(json_resp(200, &v)),
                _ => req.respond(err(404, "no such autosave")),
            }
        }
        ("POST", "/api/autosave/discard") => {
            let body = read_json(&req);
            if let Some(key) = body.get("key").and_then(|v| v.as_str()).map(autosave_key).filter(|k| !k.is_empty()) {
                let _ = std::fs::remove_file(autosave_dir().join(format!("{key}.json")));
            }
            req.respond(json_resp(200, &json!({"ok": true})))
        }
        _ => return Err(req),
    };
    Ok(r)
}

fn autosave_dir() -> PathBuf {
    util::config_dir().join("autosave")
}

/// Only `[A-Za-z0-9_-]`, so a key can never leave the autosave folder.
fn autosave_key(k: &str) -> String {
    k.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').take(64).collect()
}

/// Whether another mdcraft process with this id still runs (its autosaves aren't orphans).
fn process_alive(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    #[cfg(target_os = "linux")]
    {
        let comm = std::fs::read_to_string(format!("/proc/{pid}/comm")).unwrap_or_default();
        comm.trim().starts_with("mdcraft")
    }
    #[cfg(not(target_os = "linux"))]
    {
        std::process::Command::new("kill").arg("-0").arg(pid.to_string()).stderr(std::process::Stdio::null()).status().map(|s| s.success()).unwrap_or(false)
    }
}

fn file_name(p: &Path) -> String {
    p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()
}

pub fn template_vars() -> mdcraft_templates::Vars {
    let (year, month, day) = prefs::today();
    mdcraft_templates::Vars { author: prefs::author(), year, month, day }
}

/// The template rendered (cached): HTML for the gallery thumbnail and the theme.
fn template_preview(app: &Arc<App>, t: &mdcraft_templates::Template) -> Value {
    static CACHE: OnceLock<Mutex<HashMap<String, Value>>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Some(v) = cache.lock().ok().and_then(|c| c.get(t.id).cloned()) {
        return v;
    }
    let text = mdcraft_templates::instantiate(t, &template_vars());
    let settings = app.settings();
    let file = util::documents_dir().join(format!("{}.md", t.id));
    let mut ctx = Ctx::new(&settings, file, vec![]);
    ctx.sourcepos = false;
    ctx.allow_scripts = false;
    let r = markdown::render(&text, &ctx);
    let meta: serde_json::Map<String, Value> = r.meta.into_iter().map(|(k, v)| (k, Value::String(v))).collect();
    let v = json!({"id": t.id, "html": r.html, "slides": r.slides, "meta": meta, "title": r.title});
    if let Ok(mut c) = cache.lock() {
        c.insert(t.id.to_string(), v.clone());
    }
    v
}

const IMAGE_EXT: &[&str] = &["png", "jpg", "jpeg", "gif", "svg", "webp", "avif", "bmp", "tif", "tiff", "heic", "heif", "ico"];
const MEDIA_EXT: &[&str] = &["mp4", "webm", "mkv", "mov", "avi", "m4v", "ogv", "mp3", "wav", "ogg", "m4a", "flac", "opus"];
const MD_EXT: &[&str] = &["md", "markdown", "mdown", "mkd", "txt", "mdx", "mdd", "mds"];
const DATA_EXT: &[&str] = &["csv", "tsv", "json", "pdb", "sdf", "mol", "cif", "py", "puml", "mmd", "dot"];

fn list_dir(dir: &Path, filter: &str) -> Result<Value, String> {
    let dir = norm_path(dir);
    let rd = std::fs::read_dir(&dir).map_err(|e| format!("cannot open {}: {e}", dir.display()))?;
    let mut entries: Vec<Value> = Vec::new();
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let Ok(meta) = e.metadata() else { continue };
        let is_dir = meta.is_dir();
        let ext = markdown::ext_of(&name);
        let keep = is_dir
            || match filter {
                "image" => IMAGE_EXT.contains(&ext.as_str()) || MEDIA_EXT.contains(&ext.as_str()),
                "data" => DATA_EXT.contains(&ext.as_str()) || MD_EXT.contains(&ext.as_str()),
                "all" => true,
                _ => MD_EXT.contains(&ext.as_str()),
            };
        if !keep {
            continue;
        }
        let mtime = meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
        entries.push(json!({"name": name, "path": e.path().to_string_lossy(), "dir": is_dir, "size": meta.len(), "mtime": mtime}));
    }
    entries.sort_by(|a, b| {
        let (da, db) = (a["dir"].as_bool().unwrap_or(false), b["dir"].as_bool().unwrap_or(false));
        db.cmp(&da).then_with(|| {
            a["name"].as_str().unwrap_or("").to_lowercase().cmp(&b["name"].as_str().unwrap_or("").to_lowercase())
        })
    });
    entries.truncate(5000);
    let parent = dir.parent().map(|p| p.to_string_lossy().to_string());
    let mut places = vec![];
    if let Some(h) = util::home_dir() {
        places.push(json!({"name": "Home", "path": h.to_string_lossy()}));
        for (label, sub) in [("Documents", "Documents"), ("Desktop", "Desktop"), ("Downloads", "Downloads"), ("Pictures", "Pictures")] {
            let p = h.join(sub);
            if p.is_dir() {
                places.push(json!({"name": label, "path": p.to_string_lossy()}));
            }
        }
    }
    Ok(json!({"path": dir.to_string_lossy(), "parent": parent, "entries": entries, "places": places}))
}

/// Relative path from `base` (a folder) to `target`, with `/` separators.
pub fn relative_path(base: &Path, target: &Path) -> Option<String> {
    let b: Vec<_> = base.components().collect();
    let t: Vec<_> = target.components().collect();
    let common = b.iter().zip(t.iter()).take_while(|(x, y)| x == y).count();
    if common == 0 {
        return None; // nothing in common
    }
    let ups = b.len() - common;
    if ups > 2 {
        return None; // far away: absolute is clearer
    }
    let mut parts: Vec<String> = std::iter::repeat_n("..".to_string(), ups).collect();
    parts.extend(t[common..].iter().map(|c| c.as_os_str().to_string_lossy().to_string()));
    Some(parts.join("/"))
}

/// What to write in the Markdown for a picture: a path relative to the document when
/// the document is saved (pictures from elsewhere are copied into `images/` next to it,
/// the way Word keeps pictures with the document), else the absolute path.
fn picture_path(app: &Arc<App>, doc: &Path, src: &Path, copy: bool) -> Result<Value, String> {
    let src = norm_path(src);
    if !src.is_file() {
        return Err(format!("{} is not a file", src.display()));
    }
    let doc_saved = doc.is_file();
    let Some(doc_dir) = doc.parent().filter(|_| doc_saved).map(norm_path) else {
        if let Some(d) = src.parent() {
            app.add_root(d.to_path_buf());
        }
        return Ok(json!({"path": src.to_string_lossy().replace('\\', "/"), "copied": false}));
    };
    if src.starts_with(&doc_dir) || !copy {
        if let Some(rel) = relative_path(&doc_dir, &src) {
            return Ok(json!({"path": rel, "copied": false}));
        }
        if let Some(d) = src.parent() {
            app.add_root(d.to_path_buf());
        }
        return Ok(json!({"path": src.to_string_lossy().replace('\\', "/"), "copied": false}));
    }
    let images = doc_dir.join("images");
    std::fs::create_dir_all(&images).map_err(|e| format!("cannot create {}: {e}", images.display()))?;
    let name = src.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "picture".into());
    let mut target = images.join(&name);
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) => (s.to_string(), format!(".{e}")),
        None => (name.clone(), String::new()),
    };
    let mut n = 2;
    while target.exists() && std::fs::read(&target).ok() != std::fs::read(&src).ok() {
        target = images.join(format!("{stem}-{n}{ext}"));
        n += 1;
    }
    if !target.exists() {
        std::fs::copy(&src, &target).map_err(|e| format!("cannot copy the picture: {e}"))?;
    }
    let rel = relative_path(&doc_dir, &target).unwrap_or_else(|| target.to_string_lossy().to_string());
    Ok(json!({"path": rel, "copied": true}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn relative() {
        assert_eq!(relative_path(Path::new("/a/b"), Path::new("/a/b/img/x.png")).as_deref(), Some("img/x.png"));
        assert_eq!(relative_path(Path::new("/a/b"), Path::new("/a/c/x.png")).as_deref(), Some("../c/x.png"));
        assert_eq!(relative_path(Path::new("/a/b/c/d"), Path::new("/x/y.png")), None);
    }

    #[test]
    fn merges_edits_from_both_sides() {
        let base = "# Title\n\nOne\n\nTwo\n\nThree\n";
        let ours = "# Title\n\nOne, edited here\n\nTwo\n\nThree\n";
        let theirs = "# Title\n\nOne\n\nTwo\n\nThree, edited elsewhere\n";
        let (text, conflicts) = merge_texts(base, ours, theirs);
        assert_eq!(conflicts, 0);
        assert_eq!(text, "# Title\n\nOne, edited here\n\nTwo\n\nThree, edited elsewhere\n");
    }

    #[test]
    fn marks_conflicts() {
        let (text, conflicts) = merge_texts("a\nb\nc\n", "a\nmine\nc\n", "a\ntheirs\nc\n");
        assert_eq!(conflicts, 1);
        assert_eq!(text, "a\n<<<<<<< Your changes\nmine\n=======\ntheirs\n>>>>>>> Changed on disk\nc\n");
    }

    #[test]
    fn stamps_change_with_the_file() {
        let dir = std::env::temp_dir().join(format!("mdcraft-stamp-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join("a.md");
        assert_eq!(file_stamp(&f), None);
        std::fs::write(&f, "one").unwrap();
        let a = file_stamp(&f).unwrap();
        std::fs::write(&f, "three").unwrap();
        assert_ne!(file_stamp(&f).unwrap(), a);
        assert_eq!(file_stamp(&dir), None);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
