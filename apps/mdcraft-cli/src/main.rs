//! mdcraft on the command line.
//!
//! ```text
//! mdcraft-cli new TEMPLATE [OUT.md]        a document from a template (stdout without OUT)
//! mdcraft-cli templates                     list the templates
//! mdcraft-cli render FILE.md                print the rendered HTML fragment
//! mdcraft-cli export FILE.md [-o OUT.html]  a standalone web page
//! mdcraft-cli serve [FILE.md] [--template ID] [--port N] [--no-open]
//!                                           the editor in your browser
//! mdcraft-cli mcp [--root DIR] [--connect [PORT]]
//!                                           an MCP server for AI agents (stdio)
//! mdcraft-cli doctor                        show the detected setup
//! ```

#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod live;
mod mcp;

use mdcraft_core::{api, prefs, templates, util, Mode};
use std::path::PathBuf;
use std::process::ExitCode;

const USAGE: &str = "mdcraft-cli — Markdown documents and slides from the command line

USAGE:
  mdcraft-cli new TEMPLATE [OUT.md]         a document from a template (stdout without OUT)
  mdcraft-cli templates                     list the templates (documents and presentations)
  mdcraft-cli render FILE.md                print the rendered HTML fragment
  mdcraft-cli export FILE.md [-o OUT.html]  a standalone web page (libraries from jsDelivr)
  mdcraft-cli serve [FILE.md] [--template ID] [--port N] [--no-open] [--control]
                                            the mdcraft editor in your browser
                                            (--control: AI agents may drive it, see mcp --connect)
  mdcraft-cli mcp [--root DIR] [--automation-read-root DIR] [--automation-write-root DIR] [--connect [PORT]]
                                            an MCP server for AI agents on stdin/stdout
                                            (claude mcp add mdcraft -- mdcraft-cli mcp)
  mdcraft-cli doctor                        show the detected setup
  mdcraft-cli --version

ENVIRONMENT:
  MDCRAFT_SETTINGS    JSON renderer settings on top of the saved preferences
  MDCRAFT_CONFIG_DIR  where preferences and recent files live
  MDCRAFT_CONTROL_PORT  serve: like --control on this port; mcp --connect: the window to drive
";

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let cmd = args.first().map(|s| s.as_str()).unwrap_or("");
    let rest = args.get(1..).unwrap_or(&[]);
    let r = match cmd {
        "new" => cmd_new(rest),
        "templates" | "list" => cmd_templates(),
        "render" => cmd_render(rest),
        "export" => cmd_export(rest),
        "serve" | "open" => cmd_serve(rest),
        "mcp" => mcp::run(rest),
        "doctor" => cmd_doctor(),
        "--version" | "-V" | "version" => {
            println!("mdcraft {}", env!("CARGO_PKG_VERSION"));
            Ok(())
        }
        "" | "--help" | "-h" | "help" => {
            print!("{USAGE}");
            Ok(())
        }
        other => Err(format!("unknown command `{other}`\n\n{USAGE}")),
    };
    match r {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("mdcraft-cli: {e}");
            ExitCode::FAILURE
        }
    }
}

fn cmd_new(args: &[String]) -> Result<(), String> {
    let id = args.first().ok_or("which template? (mdcraft-cli templates lists them)")?;
    let t = templates::get(id).ok_or_else(|| format!("no template `{id}` (mdcraft-cli templates lists them)"))?;
    let text = templates::instantiate(t, &api::template_vars());
    match args.get(1) {
        Some(out) => {
            let p = PathBuf::from(out);
            if p.exists() {
                return Err(format!("{} already exists", p.display()));
            }
            prefs::write_atomic(&p, text.as_bytes()).map_err(|e| format!("{}: {e}", p.display()))?;
            eprintln!("Created {} from “{}”", p.display(), t.name);
        }
        None => print!("{text}"),
    }
    Ok(())
}

fn cmd_templates() -> Result<(), String> {
    for kind in [templates::Kind::Document, templates::Kind::Presentation] {
        println!("{}", if kind == templates::Kind::Document { "Documents" } else { "Presentations" });
        for t in templates::all().iter().filter(|t| t.kind == kind) {
            println!("  {:<12} {:<28} {}", t.id, t.name, t.description);
        }
        println!();
    }
    Ok(())
}

fn cmd_render(args: &[String]) -> Result<(), String> {
    let file = args.first().ok_or("which file?")?;
    let r = mdcraft_core::render_file(&PathBuf::from(file))?;
    print!("{}", r.html);
    Ok(())
}

fn cmd_export(args: &[String]) -> Result<(), String> {
    let mut file = None;
    let mut out = None;
    let mut i = 0;
    while i < args.len() {
        match args.get(i).map(|s| s.as_str()) {
            Some("-o") | Some("--output") => {
                i += 1;
                out = args.get(i).cloned();
            }
            Some(a) => file = Some(a.to_string()),
            None => {}
        }
        i += 1;
    }
    let file = PathBuf::from(file.ok_or("which file?")?);
    let r = mdcraft_core::render_file(&file)?;
    let html = mdcraft_core::standalone_html(&r);
    let out = out.map(PathBuf::from).unwrap_or_else(|| file.with_extension("html"));
    prefs::write_atomic(&out, html.as_bytes()).map_err(|e| format!("{}: {e}", out.display()))?;
    eprintln!("Wrote {}", out.display());
    Ok(())
}

fn cmd_serve(args: &[String]) -> Result<(), String> {
    let mut file = None;
    let mut template = None;
    let mut open = true;
    let mut port: Option<u16> = None;
    let mut control = false;
    let mut i = 0;
    while i < args.len() {
        match args.get(i).map(|s| s.as_str()) {
            Some("--template") | Some("-t") => {
                i += 1;
                template = args.get(i).cloned();
            }
            Some("--port") | Some("-p") => {
                i += 1;
                port = args.get(i).and_then(|s| s.parse().ok());
            }
            Some("--no-open") => open = false,
            Some("--control") => control = true,
            Some(a) => file = Some(a.to_string()),
            None => {}
        }
        i += 1;
    }
    // MDCRAFT_CONTROL_PORT: control on, and its port unless --port says otherwise
    if let Some(p) = mdcraft_core::agent::env_control_port() {
        control = true;
        if port.is_none() && p != 0 {
            port = Some(p);
        }
    }
    if let Some(p) = port {
        let mut v = prefs::load()["render"].clone();
        v["port"] = serde_json::json!(p);
        std::env::set_var("MDCRAFT_SETTINGS", v.to_string());
    }
    let app = mdcraft_core::start(Mode::Browser)?;
    if control {
        let file = mdcraft_core::agent::publish(&app)?;
        eprintln!("agent control on: {} (mdcraft-cli mcp --connect {})", file.display(), app.port.load(std::sync::atomic::Ordering::SeqCst));
    }
    let startup = match (file, template) {
        (Some(f), _) => serde_json::json!({"open": util::norm_path(&PathBuf::from(f)).to_string_lossy()}),
        (None, Some(t)) => serde_json::json!({"template": t}),
        _ => serde_json::Value::Null,
    };
    if let Ok(mut s) = app.startup.lock() {
        *s = startup;
    }
    let url = app.url();
    println!("mdcraft is running at {url}\n(Ctrl+C to stop)");
    if open {
        util::open_url(&url, &["default".to_string()]);
    }
    loop {
        std::thread::sleep(std::time::Duration::from_secs(3600));
    }
}

fn cmd_doctor() -> Result<(), String> {
    let s = prefs::render_settings();
    println!("mdcraft {}", env!("CARGO_PKG_VERSION"));
    println!("settings      : {}", util::config_dir().join("prefs.json").display());
    println!("documents     : {}", util::documents_dir().display());
    println!("templates     : {}", templates::all().len());
    println!("math          : {}", s.math);
    println!(
        "control port  : {}",
        match mdcraft_core::agent::control_port_setting() {
            Some((v, from)) => format!("MDCRAFT_CONTROL_PORT={v} (from {from}): windows opened from Finder, the Dock or Spotlight listen on it"),
            None => "MDCRAFT_CONTROL_PORT not set: only windows started with --control can be driven".into(),
        }
    );
    println!(
        "plantuml      : {}",
        mdcraft_core::diagrams::plantuml_backend(&s).unwrap_or_else(|e| format!("not available — {e}"))
    );
    println!("ffmpeg        : {}", mdcraft_core::media::ffmpeg().map(|p| p.display().to_string()).unwrap_or_else(|| "not found (needed to convert MKV/AVI videos)".into()));
    println!("code chunks   : {}", if s.enable_script_execution { "enabled" } else { "off (File › Options)" });
    Ok(())
}
