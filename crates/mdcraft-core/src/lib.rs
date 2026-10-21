//! mdcraft-core: the Markdown renderer and the local server behind mdcraft's window.
//!
//! The renderer and preview server come from MarkDown Live (the author's Zed
//! extension): comrak → HTML with Mermaid, math, charts, CSV tables, diagrams,
//! code chunks, pictures, videos and slides finished in the page. mdcraft adds an
//! editor API ([`api`]), preferences and recent files ([`prefs`]) and templates.
//!
//! ```text
//!  ┌──────── mdcraft window (tao + wry) ────────┐   HTTP 127.0.0.1 + token   ┌──── mdcraft-core ────┐
//!  │ ribbon · CodeMirror editor · live preview  │ ─────────────────────────▶ │ render worker, files │
//!  │ native dialogs over IPC                    │ ◀───── long-poll state ─── │ templates, prefs     │
//!  └────────────────────────────────────────────┘                            └──────────────────────┘
//! ```
#![allow(clippy::ptr_arg, clippy::if_same_then_else, clippy::type_complexity)] // style of the code inherited from MarkDown Live

#[cfg(not(unix))]
compile_error!("mdcraft supports macOS and Linux only (Windows support was removed in 0.2.0)");


pub mod agent;
pub mod api;
pub mod app;
pub mod config;
pub mod csv;
pub mod diagrams;
pub mod fonts;
pub mod http;
mod http_ext;
pub mod jobs;
pub mod markdown;
pub mod media;
pub mod prefs;
pub mod user_templates;
pub mod util;
pub mod web;

pub use app::{App, Mode};
pub use config::Settings;
pub use mdcraft_templates as templates;

use std::path::Path;
use std::sync::Arc;

/// Starts the server and the render worker. Returns the app (its `url()` opens the editor).
pub fn start(mode: Mode) -> Result<Arc<App>, String> {
    start_on(mode, None)
}

/// Like [`start`], on a fixed port (`--control PORT`) instead of the configured one.
pub fn start_on(mode: Mode, port: Option<u16>) -> Result<Arc<App>, String> {
    let mut settings = prefs::render_settings();
    if let Some(p) = port {
        settings.port = p;
    }
    let app = App::new(mode, settings);
    http::start(&app)?;
    // the font boxes need the installed fonts: find them while the window opens
    std::thread::spawn(|| {
        let _ = fonts::families();
    });
    app.start_worker();
    Ok(app)
}

/// Renders a Markdown file to an HTML fragment (slow blocks run right away).
pub fn render_file(file: &Path) -> Result<markdown::Rendered, String> {
    let text = std::fs::read_to_string(file).map_err(|e| format!("{}: {e}", file.display()))?;
    let settings = prefs::render_settings();
    let file = util::norm_path(file);
    let mut ctx = markdown::Ctx::new(&settings, file, vec![]);
    ctx.sourcepos = false;
    Ok(markdown::render(&text, &ctx))
}

/// The CSS a standalone page needs (document styles and themes).
pub fn document_css() -> String {
    format!("{}\n{}", http::embedded_text("assets/markdown.css"), http::embedded_text("assets/themes.css"))
}

/// A standalone HTML page for a rendered document. Diagrams, math and code are finished
/// in the reader's browser by `assets/export-runtime.js` with libraries from jsDelivr.
pub fn standalone_html(r: &markdown::Rendered) -> String {
    let theme = r.meta.iter().find(|(k, _)| k == "theme").map(|(_, v)| v.as_str()).unwrap_or("office");
    let title = r.title.clone().unwrap_or_else(|| "Document".into());
    let fonts = http::embedded_text("assets/fonts-cdn.css");
    let runtime = http::embedded_text("assets/export-runtime.js");
    format!(
        "<!doctype html>\n<html lang=\"en\" data-theme=\"light\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<meta name=\"generator\" content=\"mdcraft {ver}\">\n<title>{title}</title>\n<link rel=\"stylesheet\" href=\"https://cdn.jsdelivr.net/npm/highlight.js@11.11.1/styles/github.min.css\">\n<style>\n{fonts}\n{css}\nbody{{margin:0;background:#fff}}\n.markdown-body{{max-width:900px}}\n</style>\n</head>\n<body>\n<article class=\"markdown-body theme-{theme}{deck}\">\n{html}\n</article>\n<script>\n{runtime}\n</script>\n</body>\n</html>\n",
        ver = env!("CARGO_PKG_VERSION"),
        title = markdown::escape_html(&title),
        css = document_css(),
        theme = markdown::escape_html(theme),
        deck = if r.slides > 0 { " ml-deck" } else { "" },
        html = r.html,
    )
}
