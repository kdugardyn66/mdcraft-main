//! mdcraft — the desktop app: a native window (tao) hosting the editor UI in the
//! system webview (wry: WebKitGTK on Linux, WKWebView on macOS).
//!
//! ```text
//! mdcraft [FILE.md]                 open a document (or the start page)
//! mdcraft --template ID             a new document from a template (report, pitch…)
//! mdcraft --copy-of FILE.md         FILE as a new, unsaved document (a version changed elsewhere)
//! mdcraft --control [PORT]          let AI agents drive this window (mdcraft-cli mcp --connect)
//!                                   (or MDCRAFT_CONTROL_PORT=PORT, e.g. `launchctl setenv` on macOS)
//! mdcraft --version
//! ```
//!
//! The UI is served by mdcraft-core on 127.0.0.1 with a random token, so the renderer,
//! diagrams, math and media work exactly as in the browser. The window adds what a web
//! page can't do: native open/save dialogs, the window title, closing with unsaved
//! changes, files dropped on the window, full-screen slide shows and printing.

#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use mdcraft_core::{util, App, Mode};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tao::dpi::LogicalSize;
use tao::event::{Event, StartCause, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoopBuilder, EventLoopProxy};
use tao::window::{Fullscreen, Icon, Theme, Window, WindowBuilder};
use wry::{DragDropEvent, NewWindowResponse, WebView, WebViewBuilder};

/// Events sent to the event loop from the webview's callbacks.
#[derive(Debug)]
enum UserEvent {
    /// A message from the page (`window.ipc.postMessage`).
    Ipc(String),
    /// Files dropped on the window.
    Dropped(Vec<PathBuf>),
    /// A link to open in the system browser.
    External(String),
}

const ICON_PNG: &[u8] = include_bytes!("../../../assets/app-icon/mdcraft-256.png");

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|a| a == "--version" || a == "-V") {
        println!("mdcraft {}", env!("CARGO_PKG_VERSION"));
        return;
    }
    if args.iter().any(|a| a == "--help" || a == "-h") {
        println!(
            "mdcraft {}\n\nUSAGE:\n  mdcraft [FILE.md]\n  mdcraft --copy-of FILE.md (FILE as a new, unsaved document)\n  mdcraft --template ID     (report, letter, pitch, status… see `mdcraft-cli templates`)\n  mdcraft --control [PORT]  let AI agents drive this window: mdcraft-cli mcp --connect [PORT]\n\nENVIRONMENT:\n  MDCRAFT_CONTROL_PORT=PORT  like --control PORT (macOS: `launchctl setenv` reaches Finder/Dock launches)\n",
            env!("CARGO_PKG_VERSION")
        );
        return;
    }
    if let Err(e) = run(&args) {
        eprintln!("mdcraft: {e}");
        show_fatal(&e);
        std::process::exit(1);
    }
}

/// What to show first, from the command line.
fn startup(args: &[String]) -> Value {
    let mut i = 0;
    while i < args.len() {
        match args.get(i).map(|s| s.as_str()) {
            Some("--template") | Some("-t") => {
                if let Some(t) = args.get(i + 1) {
                    return json!({"template": t});
                }
            }
            Some("--copy-of") => {
                let p = args.get(i + 1).map(|a| util::norm_path(Path::new(a)));
                return match p.filter(|p| p.is_file()) {
                    Some(p) => json!({"copyOf": p.to_string_lossy()}),
                    None => Value::Null,
                };
            }
            Some("--control") => {
                if args.get(i + 1).map(|a| a.parse::<u16>().is_ok()).unwrap_or(false) {
                    i += 1;
                }
            }
            Some(a) if !a.starts_with('-') && !a.starts_with("-psn_") => {
                let p = util::norm_path(Path::new(a));
                return if p.is_file() { json!({"open": p.to_string_lossy()}) } else { Value::Null };
            }
            _ => {}
        }
        i += 1;
    }
    Value::Null
}

/// `--control [PORT]`, or else `MDCRAFT_CONTROL_PORT`: Some(port) (0 = any free port) when
/// agents may drive the window. The bool is true when the port came from the environment.
fn control_port(args: &[String]) -> Option<(u16, bool)> {
    match args.iter().position(|a| a == "--control") {
        Some(i) => Some((args.get(i + 1).and_then(|p| p.parse().ok()).unwrap_or(0), false)),
        None => mdcraft_core::agent::env_control_port().map(|p| (p, true)),
    }
}

fn run(args: &[String]) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    linux_env();

    let control = control_port(args);
    let fixed = control.map(|(p, _)| p).filter(|p| *p != 0);
    let app = match mdcraft_core::start_on(Mode::Desktop, fixed) {
        // Every window is its own process and inherits MDCRAFT_CONTROL_PORT: the second one
        // finds the port taken and uses a free one (agents reach it with --connect PORT, or
        // the newest window with a plain --connect). An explicit --control PORT still fails.
        Err(e) if control.map(|(_, env)| env).unwrap_or(false) => {
            eprintln!("mdcraft: MDCRAFT_CONTROL_PORT {}: {e}; using a free port", fixed.unwrap_or(0));
            mdcraft_core::start_on(Mode::Desktop, None)?
        }
        r => r?,
    };
    if let Ok(mut s) = app.startup.lock() {
        *s = startup(args);
    }
    if control.is_some() {
        let file = mdcraft_core::agent::publish(&app)?;
        let port = app.port.load(std::sync::atomic::Ordering::SeqCst);
        eprintln!("mdcraft: agent control on 127.0.0.1:{port} ({}) — connect with: mdcraft-cli mcp --connect {port}", file.display());
    }

    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();

    #[cfg(target_os = "macos")]
    let _menu = mac_menu();

    let window = WindowBuilder::new()
        .with_title("MdCraft")
        .with_inner_size(LogicalSize::new(1360.0, 880.0))
        .with_min_inner_size(LogicalSize::new(820.0, 540.0))
        .with_window_icon(window_icon())
        .with_visible(false)
        .build(&event_loop)
        .map_err(|e| format!("cannot open a window: {e}"))?;

    let webview = build_webview(&window, &app, proxy.clone())?;

    let mut shown = false;
    let opened = Instant::now();
    let mut ready = false;
    let mut close_asked: Option<Instant> = None;
    // Files Finder asked us to open (double-click, Open With, dropped on the Dock icon)
    // before the page was ready to take them.
    let mut pending: Vec<PathBuf> = Vec::new();

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::WaitUntil(Instant::now() + Duration::from_millis(250));
        match event {
            Event::NewEvents(StartCause::Init) => {}
            Event::NewEvents(StartCause::ResumeTimeReached { .. }) => {
                // Show the window once the page is ready, or after a short while anyway.
                if !shown && opened.elapsed() > Duration::from_millis(2500) {
                    window.set_visible(true);
                    shown = true;
                }
            }
            Event::WindowEvent { event: WindowEvent::CloseRequested, .. } => {
                // The page asks about unsaved changes and answers with `quit`. A page that
                // never loaded, or doesn't answer a second click after 8 s, can't keep the
                // window open.
                let stuck = close_asked.map(|t| t.elapsed() > Duration::from_secs(8)).unwrap_or(false);
                if !ready || stuck {
                    app.shutdown();
                    *control_flow = ControlFlow::Exit;
                    return;
                }
                close_asked = Some(Instant::now());
                let _ = webview.evaluate_script("window.__mdNative && window.__mdNative.requestClose()");
            }
            // macOS hands documents to an app with an Apple Event, not on the command line.
            Event::Opened { urls } => {
                let paths: Vec<PathBuf> = urls.iter().filter_map(|u| u.to_file_path().ok()).filter(|p| p.is_file()).collect();
                if paths.is_empty() {
                    return;
                }
                if ready {
                    deliver_opened(&webview, &paths);
                    window.set_focus();
                } else {
                    // Cold launch: let the page open the first file instead of the start page
                    // (it reads `startup` when it boots); "ready" delivers whatever is left.
                    let mut rest = paths.into_iter();
                    if let (Some(first), Ok(mut s)) = (rest.next(), app.startup.lock()) {
                        let read = app.startup_read.load(std::sync::atomic::Ordering::SeqCst);
                        if !read && s.get("open").is_none() && s.get("template").is_none() && s.get("copyOf").is_none() {
                            *s = json!({"open": first.to_string_lossy()});
                        } else {
                            pending.push(first);
                        }
                    }
                    pending.extend(rest);
                }
            }
            Event::WindowEvent { event: WindowEvent::DroppedFile(path), .. } => {
                let _ = proxy.send_event(UserEvent::Dropped(vec![path]));
            }
            Event::UserEvent(UserEvent::Dropped(paths)) => {
                let list: Vec<String> = paths.iter().map(|p| p.to_string_lossy().to_string()).collect();
                let js = format!("window.__mdNative && window.__mdNative.dropped({})", json!(list));
                let _ = webview.evaluate_script(&js);
            }
            Event::UserEvent(UserEvent::External(url)) => open_external(&url),
            Event::UserEvent(UserEvent::Ipc(body)) => {
                let msg: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
                let cmd = msg["cmd"].as_str().unwrap_or("");
                let id = msg["id"].as_u64().unwrap_or(0);
                let reply = |v: Value, err: Option<String>| {
                    let js = format!("window.__mdReply({id}, {}, {})", v, err.map(|e| json!(e)).unwrap_or(Value::Null));
                    let _ = webview.evaluate_script(&js);
                };
                match cmd {
                    "ready" => {
                        ready = true;
                        if !pending.is_empty() {
                            deliver_opened(&webview, &std::mem::take(&mut pending));
                        }
                        if !shown {
                            window.set_visible(true);
                            shown = true;
                        }
                        window.set_focus();
                    }
                    "set-title" => window.set_title(msg["title"].as_str().unwrap_or("MdCraft")),
                    "quit" => {
                        app.shutdown();
                        *control_flow = ControlFlow::Exit;
                    }
                    "open-dialog" => {
                        let mut d = rfd::FileDialog::new().set_title(msg["title"].as_str().unwrap_or("Open")).set_parent(&window);
                        d = add_filters(d, &msg["filters"]);
                        if let Some(dir) = msg["dir"].as_str().map(PathBuf::from).filter(|d| d.is_dir()) {
                            d = d.set_directory(dir);
                        }
                        let picked = d.pick_file();
                        reply(picked.map(|p| json!(p.to_string_lossy())).unwrap_or(Value::Null), None);
                    }
                    "save-dialog" => {
                        let mut d = rfd::FileDialog::new().set_title("Save As").set_parent(&window);
                        d = add_filters(d, &msg["filters"]);
                        if let Some(dir) = msg["dir"].as_str().map(PathBuf::from).filter(|d| d.is_dir()) {
                            d = d.set_directory(dir);
                        }
                        if let Some(name) = msg["name"].as_str() {
                            d = d.set_file_name(name);
                        }
                        let picked = d.save_file();
                        reply(picked.map(|p| json!(p.to_string_lossy())).unwrap_or(Value::Null), None);
                    }
                    "print" => match webview.print() {
                        Ok(()) => reply(json!(true), None),
                        Err(e) => reply(Value::Null, Some(format!("printing is not available: {e}"))),
                    },
                    "fullscreen" => {
                        let on = msg["on"].as_bool().unwrap_or(false);
                        window.set_fullscreen(if on { Some(Fullscreen::Borderless(None)) } else { None });
                    }
                    "theme" => window.set_theme(Some(if msg["dark"].as_bool().unwrap_or(false) { Theme::Dark } else { Theme::Light })),
                    "open-external" => {
                        if let Some(u) = msg["url"].as_str() {
                            open_external(u);
                        }
                    }
                    "reveal" => {
                        if let Some(p) = msg["path"].as_str() {
                            reveal(Path::new(p));
                        }
                    }
                    "new-window" => new_window(msg["path"].as_str(), msg["copy"].as_bool().unwrap_or(false)),
                    other => reply(Value::Null, Some(format!("unknown command {other}"))),
                }
            }
            _ => {}
        }
    });
}

fn build_webview(window: &Window, app: &Arc<App>, proxy: EventLoopProxy<UserEvent>) -> Result<WebView, String> {
    let origin = format!("http://127.0.0.1:{}", app.port.load(std::sync::atomic::Ordering::SeqCst));
    let ipc = proxy.clone();
    let drop_proxy = proxy.clone();
    let nav_proxy = proxy.clone();
    let nav_origin = origin.clone();
    let win_proxy = proxy;
    let builder = WebViewBuilder::new()
        .with_url(app.url())
        .with_devtools(cfg!(debug_assertions) || std::env::var_os("MDCRAFT_DEVTOOLS").is_some())
        .with_clipboard(true)
        .with_accept_first_mouse(true)
        .with_background_color((246, 246, 246, 255))
        .with_ipc_handler(move |req| {
            let _ = ipc.send_event(UserEvent::Ipc(req.body().clone()));
        })
        .with_drag_drop_handler(move |e| {
            if let DragDropEvent::Drop { paths, .. } = e {
                let _ = drop_proxy.send_event(UserEvent::Dropped(paths));
            }
            true
        })
        // The window only shows mdcraft itself; other pages open in the system browser.
        .with_navigation_handler(move |url| {
            if url.starts_with(&nav_origin) || url.starts_with("about:") || url.starts_with("blob:") || url.starts_with("data:") {
                return true;
            }
            let _ = nav_proxy.send_event(UserEvent::External(url));
            false
        })
        .with_new_window_req_handler(move |url, _| {
            if url.starts_with("http://") || url.starts_with("https://") || url.starts_with("mailto:") {
                let _ = win_proxy.send_event(UserEvent::External(url));
            }
            NewWindowResponse::Deny
        });

    #[cfg(target_os = "macos")]
    let webview = builder.build(window).map_err(|e| format!("cannot create the web view: {e}"))?;
    #[cfg(not(target_os = "macos"))]
    let webview = {
        use tao::platform::unix::WindowExtUnix;
        use wry::WebViewBuilderExtUnix;
        let vbox = window.default_vbox().ok_or("no GTK container in the window")?;
        builder.build_gtk(vbox).map_err(|e| format!("cannot create the web view (is WebKitGTK 4.1 installed?): {e}"))?
    };
    Ok(webview)
}

/// Files opened from Finder while the window is up: Markdown files open here when no
/// document is open, otherwise in new windows; pictures and tables go into the document.
fn deliver_opened(webview: &WebView, paths: &[PathBuf]) {
    let list: Vec<String> = paths.iter().map(|p| p.to_string_lossy().to_string()).collect();
    let js = format!("window.__mdNative && window.__mdNative.opened({})", json!(list));
    let _ = webview.evaluate_script(&js);
}

fn add_filters(mut d: rfd::FileDialog, filters: &Value) -> rfd::FileDialog {
    for f in filters.as_array().map(|a| a.as_slice()).unwrap_or(&[]) {
        let name = f.get(0).and_then(|n| n.as_str()).unwrap_or("Files");
        let exts: Vec<String> = f.get(1).and_then(|e| e.as_array()).map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default();
        if !exts.is_empty() && !exts.iter().any(|e| e == "*") {
            d = d.add_filter(name, &exts);
        }
    }
    d
}

fn window_icon() -> Option<Icon> {
    let decoder = png::Decoder::new(std::io::Cursor::new(ICON_PNG));
    let mut reader = decoder.read_info().ok()?;
    let mut buf = vec![0; reader.output_buffer_size()];
    let info = reader.next_frame(&mut buf).ok()?;
    buf.truncate(info.buffer_size());
    if info.color_type != png::ColorType::Rgba || info.bit_depth != png::BitDepth::Eight {
        return None;
    }
    Icon::from_rgba(buf, info.width, info.height).ok()
}

fn open_external(url: &str) {
    if url.starts_with("http://") || url.starts_with("https://") || url.starts_with("mailto:") {
        util::open_url(url, &["default".to_string()]);
    }
}

/// Shows a file in the system's file manager.
fn reveal(p: &Path) {
    let dir = if p.is_dir() { p.to_path_buf() } else { p.parent().map(|d| d.to_path_buf()).unwrap_or_default() };
    let r = if cfg!(target_os = "macos") {
        std::process::Command::new("open").arg("-R").arg(p).spawn()
    } else {
        std::process::Command::new("xdg-open").arg(&dir).spawn()
    };
    if let Err(e) = r {
        eprintln!("mdcraft: cannot show {}: {e}", dir.display());
    }
}

/// Another window: a new mdcraft process (each window has its own document and server).
/// `copy`: show the file as a new, unsaved document instead of opening it.
fn new_window(path: Option<&str>, copy: bool) {
    let Ok(exe) = std::env::current_exe() else { return };
    let mut cmd = std::process::Command::new(exe);
    if let Some(p) = path {
        if copy {
            cmd.arg("--copy-of");
        }
        cmd.arg(p);
    }
    if let Err(e) = cmd.stdin(std::process::Stdio::null()).spawn() {
        eprintln!("mdcraft: cannot open a new window: {e}");
    }
}

#[cfg(target_os = "linux")]
fn linux_env() {
    // WebKitGTK's DMA-BUF renderer shows a blank window with some GPU drivers (NVIDIA,
    // virtual machines); the shared-memory path is reliable and fast enough for documents.
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() && std::env::var_os("MDCRAFT_KEEP_DMABUF").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
}

/// macOS needs an app menu with Edit items, or Cmd-C / Cmd-V don't reach the web view.
#[cfg(target_os = "macos")]
fn mac_menu() -> Option<muda::Menu> {
    use muda::{AboutMetadata, Menu, PredefinedMenuItem, Submenu};
    let menu = Menu::new();
    let about = AboutMetadata { name: Some("MdCraft".into()), version: Some(env!("CARGO_PKG_VERSION").into()), ..Default::default() };
    let app_menu = Submenu::with_items(
        "MdCraft",
        true,
        &[
            &PredefinedMenuItem::about(None, Some(about)),
            &PredefinedMenuItem::separator(),
            &PredefinedMenuItem::hide(None),
            &PredefinedMenuItem::separator(),
            &PredefinedMenuItem::quit(None),
        ],
    )
    .ok()?;
    let edit = Submenu::with_items(
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(None),
            &PredefinedMenuItem::redo(None),
            &PredefinedMenuItem::separator(),
            &PredefinedMenuItem::cut(None),
            &PredefinedMenuItem::copy(None),
            &PredefinedMenuItem::paste(None),
            &PredefinedMenuItem::select_all(None),
        ],
    )
    .ok()?;
    let window = Submenu::with_items("Window", true, &[&PredefinedMenuItem::minimize(None), &PredefinedMenuItem::fullscreen(None)]).ok()?;
    menu.append_items(&[&app_menu, &edit, &window]).ok()?;
    menu.init_for_nsapp();
    Some(menu)
}

/// A last-resort message when the window can't even open.
fn show_fatal(msg: &str) {
    let _ = rfd::MessageDialog::new().set_title("MdCraft").set_description(msg).set_level(rfd::MessageLevel::Error).show();
}
