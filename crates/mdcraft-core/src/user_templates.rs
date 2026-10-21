//! The user's own templates, kept apart from the ones shipped with mdcraft.
//!
//! A custom template is a Markdown file in the templates folder (`templates/` in the settings
//! folder, e.g. `~/Library/Application Support/mdcraft/templates`). The extension says what it
//! makes: `.mdd` a document, `.mds` a slide deck. Inside it is ordinary Markdown with the
//! same placeholders as the built-in templates (`{{author}}`, `{{date_long}}`…).
//!
//! File › New lists them under "My templates"; File › Save As saves one (File type: Markdown
//! template); editing one is opening the file; deleting moves it to the Trash.

use crate::util;
use serde::Serialize;
use std::path::{Path, PathBuf};

/// Document templates.
pub const DOC_EXT: &str = "mdd";
/// Slide-deck templates.
pub const DECK_EXT: &str = "mds";

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct UserTemplate {
    pub path: String,
    /// The file name without the extension.
    pub name: String,
    /// "document" or "presentation" (as for the built-in templates).
    pub kind: &'static str,
    pub description: String,
    pub theme: String,
    /// Seconds since 1970.
    pub modified: u64,
}

/// The templates folder (created on first use).
pub fn dir() -> PathBuf {
    let d = util::config_dir().join("templates");
    let _ = std::fs::create_dir_all(&d);
    d
}

/// "document" / "presentation" for a template file, None for other files.
pub fn kind_of(p: &Path) -> Option<&'static str> {
    match p.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        DOC_EXT => Some("document"),
        DECK_EXT => Some("presentation"),
        _ => None,
    }
}

/// The custom templates in `dir`, sorted by name.
pub fn list_in(dir: &Path) -> Vec<UserTemplate> {
    let mut v: Vec<UserTemplate> = std::fs::read_dir(dir)
        .map(|rd| rd.flatten().map(|e| e.path()).filter_map(|p| describe(&p)).collect())
        .unwrap_or_default();
    v.sort_by_key(|t| t.name.to_lowercase());
    v
}

pub fn list() -> Vec<UserTemplate> {
    list_in(&dir())
}

/// A template file's entry: name, kind, theme and description (from the front matter or the
/// first heading).
pub fn describe(p: &Path) -> Option<UserTemplate> {
    let kind = kind_of(p)?;
    let meta = std::fs::metadata(p).ok().filter(|m| m.is_file())?;
    let text = std::fs::read_to_string(p).unwrap_or_default();
    let fm = text.strip_prefix("---\n").and_then(|rest| rest.split_once("\n---").map(|(f, _)| f)).unwrap_or("");
    let pairs = crate::markdown::front_matter_pairs(fm);
    let get = |k: &str| pairs.iter().find(|(key, _)| key == k).map(|(_, v)| v.clone()).unwrap_or_default();
    let mut description = get("description");
    if description.is_empty() {
        description = text.lines().find(|l| l.starts_with("# ")).map(|l| l[2..].trim().to_string()).unwrap_or_default();
    }
    if description.is_empty() {
        description = get("title");
    }
    Some(UserTemplate {
        path: p.to_string_lossy().to_string(),
        name: p.file_stem()?.to_string_lossy().to_string(),
        kind,
        description,
        theme: get("theme"),
        modified: meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0),
    })
}

/// A new document's text from a template file: the placeholders filled in.
pub fn instantiate(p: &Path, vars: &mdcraft_templates::Vars) -> Result<String, String> {
    if kind_of(p).is_none() {
        return Err(format!("{} is not a template (.{DOC_EXT} or .{DECK_EXT})", p.display()));
    }
    let text = std::fs::read_to_string(p).map_err(|e| format!("cannot read {}: {e}", p.display()))?;
    Ok(mdcraft_templates::fill(&text, vars))
}

/// Only files in the templates folder may be renamed or deleted from the New page.
fn inside(p: &Path, dir: &Path) -> bool {
    let (Ok(p), Ok(d)) = (p.canonicalize(), dir.canonicalize()) else { return false };
    p.parent() == Some(d.as_path())
}

/// A file name for a template: the characters a file name can't have are replaced.
fn safe_name(name: &str) -> Option<String> {
    let n: String = name.trim().chars().map(|c| if matches!(c, '/' | '\\' | ':' | '\0') { '-' } else { c }).collect();
    let n = n.trim_matches('.').trim().to_string();
    (!n.is_empty() && n.len() <= 120).then_some(n)
}

/// Renames a template in `dir` (keeping its extension). Returns the new path.
pub fn rename_in(dir: &Path, p: &Path, name: &str) -> Result<PathBuf, String> {
    if !inside(p, dir) || kind_of(p).is_none() {
        return Err("only templates in the templates folder can be renamed".into());
    }
    let name = safe_name(name).ok_or("enter a name")?;
    let ext = p.extension().and_then(|e| e.to_str()).unwrap_or(DOC_EXT);
    let to = p.with_file_name(format!("{name}.{ext}"));
    if to == p {
        return Ok(to);
    }
    if to.exists() {
        return Err(format!("there is already a template called “{name}”"));
    }
    std::fs::rename(p, &to).map_err(|e| format!("cannot rename: {e}"))?;
    Ok(to)
}

/// Moves a template in `dir` to `trash` (so it can be put back). Returns where it went.
pub fn delete_in(dir: &Path, p: &Path, trash: &Path) -> Result<PathBuf, String> {
    if !inside(p, dir) || kind_of(p).is_none() {
        return Err("only templates in the templates folder can be deleted".into());
    }
    move_to_trash(p, trash)
}

/// The Trash folder: ~/.Trash on macOS, the freedesktop.org trash on Linux.
pub fn trash_dir() -> Option<PathBuf> {
    let home = util::home_dir()?;
    Some(if cfg!(target_os = "macos") {
        home.join(".Trash")
    } else {
        std::env::var_os("XDG_DATA_HOME").map(PathBuf::from).unwrap_or_else(|| home.join(".local/share")).join("Trash")
    })
}

fn move_to_trash(p: &Path, trash: &Path) -> Result<PathBuf, String> {
    let freedesktop = !cfg!(target_os = "macos");
    let files = if freedesktop { trash.join("files") } else { trash.to_path_buf() };
    std::fs::create_dir_all(&files).map_err(|e| format!("cannot use the Trash ({}): {e}", files.display()))?;
    let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "template".into());
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) => (s.to_string(), format!(".{e}")),
        None => (name.clone(), String::new()),
    };
    let mut target = files.join(&name);
    let mut n = 2;
    while target.exists() {
        target = files.join(format!("{stem} {n}{ext}"));
        n += 1;
    }
    std::fs::rename(p, &target).map_err(|e| format!("cannot move {} to the Trash: {e}", p.display()))?;
    if freedesktop {
        let info = trash.join("info");
        let _ = std::fs::create_dir_all(&info);
        let file = target.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let (y, m, d) = crate::prefs::today();
        let body = format!("[Trash Info]\nPath={}\nDeletionDate={y:04}-{m:02}-{d:02}T00:00:00\n", p.to_string_lossy());
        let _ = std::fs::write(info.join(format!("{file}.trashinfo")), body);
    }
    Ok(target)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_rename_delete() {
        let root = std::env::temp_dir().join(format!("mdcraft-utpl-{}", std::process::id()));
        let dir = root.join("templates");
        let trash = root.join("Trash");
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("Weekly report.mdd"), "---\ntitle: Week {{date}}\ntheme: report\n---\n\n# Weekly report\n\nBy {{author}}\n").unwrap();
        std::fs::write(dir.join("Kick-off.mds"), "---\ntheme: aurora\ndescription: Project kick-off deck\n---\n\n# Kick-off\n\n<!-- slide -->\n\n## Goals\n").unwrap();
        std::fs::write(dir.join("notes.md"), "# not a template\n").unwrap();
        let l = list_in(&dir);
        assert_eq!(l.iter().map(|t| (t.name.as_str(), t.kind)).collect::<Vec<_>>(), vec![("Kick-off", "presentation"), ("Weekly report", "document")]);
        assert_eq!(l[0].description, "Project kick-off deck");
        assert_eq!((l[1].description.as_str(), l[1].theme.as_str()), ("Weekly report", "report"));

        let vars = mdcraft_templates::Vars { author: "Ada".into(), year: 2026, month: 10, day: 21 };
        let text = instantiate(&dir.join("Weekly report.mdd"), &vars).unwrap();
        assert!(text.contains("title: Week 2026-10-21") && text.contains("By Ada"), "{text}");
        assert!(instantiate(&dir.join("notes.md"), &vars).is_err());

        let renamed = rename_in(&dir, &dir.join("Weekly report.mdd"), "Week: status").unwrap();
        assert_eq!(renamed.file_name().unwrap(), "Week- status.mdd");
        assert!(rename_in(&dir, &renamed, "Kick-off").is_ok(), "same name, other extension is fine");
        let renamed = dir.join("Kick-off.mdd");
        assert!(rename_in(&dir, &dir.join("Kick-off.mds"), "Kick-off").is_ok());

        // only templates inside the folder
        std::fs::write(root.join("outside.mdd"), "x").unwrap();
        assert!(delete_in(&dir, &root.join("outside.mdd"), &trash).is_err());
        assert!(delete_in(&dir, &dir.join("notes.md"), &trash).is_err());

        let gone = delete_in(&dir, &renamed, &trash).unwrap();
        assert!(gone.exists() && !renamed.exists());
        std::fs::write(&renamed, "again").unwrap();
        let gone2 = delete_in(&dir, &renamed, &trash).unwrap();
        assert_ne!(gone, gone2, "a second file with the same name gets a new name in the Trash");
        let _ = std::fs::remove_dir_all(&root);
    }
}
