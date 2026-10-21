//! The fonts installed on this computer, for the font boxes in the ribbon, the Design tab and
//! Options (`GET /api/fonts`).
//!
//! The font folders are scanned once per process, reading only what is needed from each file
//! (the table directory, `name`, `post` and `OS/2`), so hundreds of system fonts take a moment,
//! not seconds. Each family is marked as monospaced (fixed pitch), sans serif or serif, so
//! the code font box can offer fixed-width and sans fonts.

use serde::Serialize;
use std::collections::BTreeMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

#[derive(Clone, Debug, Default, Serialize, PartialEq, Eq)]
pub struct FontFamily {
    pub family: String,
    /// Fixed pitch (every glyph the same width): code fonts.
    pub mono: bool,
    /// Sans serif (from the OS/2 class or PANOSE), else serif or unknown.
    pub sans: bool,
    pub serif: bool,
    /// Shipped with mdcraft (always available in the preview).
    pub bundled: bool,
}

/// Fonts that come with mdcraft (`web/fonts`).
const BUNDLED: &[(&str, bool, bool, bool)] =
    &[("Inter", false, true, false), ("Source Sans 3", false, true, false), ("Source Serif 4", false, false, true), ("JetBrains Mono", true, false, false)];

/// All font families, sorted by name (scanned on first use).
pub fn families() -> &'static [FontFamily] {
    static CACHE: OnceLock<Vec<FontFamily>> = OnceLock::new();
    CACHE.get_or_init(|| scan(&font_dirs()))
}

/// Where fonts are installed.
pub fn font_dirs() -> Vec<PathBuf> {
    let home = crate::util::home_dir();
    let mut dirs: Vec<PathBuf> = Vec::new();
    if cfg!(target_os = "macos") {
        dirs.extend(["/System/Library/Fonts", "/Library/Fonts", "/Network/Library/Fonts"].map(PathBuf::from));
        if let Some(h) = &home {
            dirs.push(h.join("Library/Fonts"));
        }
    } else {
        dirs.extend(["/usr/share/fonts", "/usr/local/share/fonts"].map(PathBuf::from));
        if let Some(h) = &home {
            dirs.push(h.join(".local/share/fonts"));
            dirs.push(h.join(".fonts"));
        }
    }
    dirs
}

/// Scans `dirs` (recursively) and merges the faces into families.
pub fn scan(dirs: &[PathBuf]) -> Vec<FontFamily> {
    let mut files = Vec::new();
    for d in dirs {
        collect(d, 0, &mut files);
    }
    let mut map: BTreeMap<String, FontFamily> = BTreeMap::new();
    for (name, mono, sans, serif) in BUNDLED {
        map.insert(name.to_lowercase(), FontFamily { family: name.to_string(), mono: *mono, sans: *sans, serif: *serif, bundled: true });
    }
    for f in files {
        for face in read_faces(&f).unwrap_or_default() {
            // macOS keeps private UI fonts under names starting with a dot
            if face.family.is_empty() || face.family.starts_with('.') || face.family.starts_with("System Font") {
                continue;
            }
            let e = map.entry(face.family.to_lowercase()).or_insert_with(|| FontFamily { family: face.family.clone(), ..Default::default() });
            e.mono |= face.mono;
            e.sans |= face.sans;
            e.serif |= face.serif;
        }
    }
    let mut v: Vec<FontFamily> = map.into_values().map(|mut f| {
        if f.mono {
            f.sans = false;
            f.serif = false;
        } else if f.sans {
            f.serif = false;
        }
        f
    }).collect();
    v.sort_by_key(|a| a.family.to_lowercase());
    v
}

fn collect(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    if depth > 6 {
        return;
    }
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        let Ok(ft) = e.file_type() else { continue };
        if ft.is_dir() {
            collect(&p, depth + 1, out);
        } else if let Some(ext) = p.extension().and_then(|x| x.to_str()) {
            if matches!(ext.to_ascii_lowercase().as_str(), "ttf" | "otf" | "ttc" | "otc") {
                out.push(p);
            }
        }
    }
}

#[derive(Debug, Default, PartialEq)]
struct Face {
    family: String,
    mono: bool,
    sans: bool,
    serif: bool,
}

fn be16(b: &[u8], at: usize) -> Option<u16> {
    b.get(at..at + 2).map(|x| u16::from_be_bytes([x[0], x[1]]))
}
fn be32(b: &[u8], at: usize) -> Option<u32> {
    b.get(at..at + 4).map(|x| u32::from_be_bytes([x[0], x[1], x[2], x[3]]))
}

fn read_at(f: &mut File, offset: u64, len: usize) -> Option<Vec<u8>> {
    if len > 4 * 1024 * 1024 {
        return None;
    }
    f.seek(SeekFrom::Start(offset)).ok()?;
    let mut buf = vec![0; len];
    f.read_exact(&mut buf).ok()?;
    Some(buf)
}

/// The faces in a .ttf/.otf, or every face of a .ttc collection.
fn read_faces(path: &Path) -> Option<Vec<Face>> {
    let mut f = File::open(path).ok()?;
    let head = read_at(&mut f, 0, 12)?;
    if &head[0..4] == b"ttcf" {
        let n = be32(&head, 8)?.min(64) as usize;
        let offs = read_at(&mut f, 12, n * 4)?;
        Some((0..n).filter_map(|i| be32(&offs, i * 4)).filter_map(|o| read_face(&mut f, o as u64)).collect())
    } else {
        Some(read_face(&mut f, 0).into_iter().collect())
    }
}

fn read_face(f: &mut File, offset: u64) -> Option<Face> {
    let hdr = read_at(f, offset, 12)?;
    let tag = &hdr[0..4];
    if tag != [0, 1, 0, 0] && tag != b"OTTO" && tag != b"true" {
        return None;
    }
    let n = be16(&hdr, 4)? as usize;
    let dir = read_at(f, offset + 12, n * 16)?;
    let mut tables: BTreeMap<[u8; 4], (u32, u32)> = BTreeMap::new();
    for i in 0..n {
        let r = &dir[i * 16..i * 16 + 16];
        tables.insert([r[0], r[1], r[2], r[3]], (be32(r, 8)?, be32(r, 12)?));
    }
    let mut get = |t: &[u8; 4]| tables.get(t).and_then(|(o, l)| read_at(f, *o as u64, *l as usize));
    let name = get(b"name")?;
    let family = family_name(&name)?;
    let post = get(b"post");
    let os2 = get(b"OS/2");
    let fixed_pitch = post.as_deref().and_then(|p| be32(p, 12)).map(|v| v != 0).unwrap_or(false);
    // OS/2: sFamilyClass at 30 (high byte 8 = sans serif, 1-7 = serif kinds), PANOSE at 32
    let class = os2.as_deref().and_then(|o| o.get(30).copied()).unwrap_or(0);
    let panose = os2.as_deref().and_then(|o| o.get(32..42)).map(|p| p.to_vec()).unwrap_or_default();
    let latin_text = panose.first() == Some(&2);
    let pan_mono = latin_text && panose.get(3) == Some(&9);
    let pan_sans = latin_text && matches!(panose.get(1), Some(11..=13));
    let pan_serif = latin_text && matches!(panose.get(1), Some(2..=10));
    let lower = family.to_lowercase();
    let name_mono = ["mono", "code", "courier", "consol", "menlo", "monaco", "typewriter", "fixed"].iter().any(|w| lower.contains(w));
    let name_sans = ["sans", "grotesk", "grotesque", "helvetica", "arial", "gothic", "inter", "verdana", "tahoma", "futura", "avenir"].iter().any(|w| lower.contains(w));
    // emoji and symbol fonts set the fixed-pitch flag but are no code fonts
    let symbols = ["emoji", "symbol", "dingbat", "wingding", "webding"].iter().any(|w| lower.contains(w));
    let mono = !symbols && (fixed_pitch || pan_mono || name_mono);
    let sans = !mono && (class == 8 || pan_sans || name_sans);
    let serif = !mono && !sans && ((1..=7).contains(&class) || class == 10 || pan_serif || lower.contains("serif"));
    Some(Face { family, mono, sans, serif })
}

/// The family name from a `name` table: the typographic family (ID 16) when there is one,
/// else the family (ID 1); English first.
fn family_name(t: &[u8]) -> Option<String> {
    let count = be16(t, 2)? as usize;
    let strings = be16(t, 4)? as usize;
    let mut best: Option<(u8, String)> = None;
    for i in 0..count {
        let r = 6 + i * 12;
        let (platform, encoding, lang, id, len, off) = (be16(t, r)?, be16(t, r + 2)?, be16(t, r + 4)?, be16(t, r + 6)?, be16(t, r + 8)? as usize, be16(t, r + 10)? as usize);
        if id != 1 && id != 16 {
            continue;
        }
        let Some(raw) = t.get(strings + off..strings + off + len) else { continue };
        let text = match platform {
            0 | 3 if encoding <= 10 => {
                let units: Vec<u16> = raw.chunks_exact(2).map(|c| u16::from_be_bytes([c[0], c[1]])).collect();
                String::from_utf16_lossy(&units)
            }
            1 if encoding == 0 => raw.iter().map(|&b| if b < 128 { b as char } else { '?' }).collect(),
            _ => continue,
        };
        let text = text.trim().to_string();
        if text.is_empty() {
            continue;
        }
        let english = (platform == 3 && lang == 0x409) || (platform == 1 && lang == 0) || platform == 0;
        // rank: typographic family beats family, English beats other languages
        let rank = (if id == 16 { 2 } else { 0 }) + u8::from(english);
        if best.as_ref().map(|(r, _)| rank > *r).unwrap_or(true) {
            best = Some((rank, text));
        }
    }
    best.map(|(_, s)| s)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A minimal sfnt with `name`, `post` and `OS/2` tables.
    fn font(family: &str, fixed: bool, class: u8, serif_style: u8) -> Vec<u8> {
        let utf16: Vec<u8> = family.encode_utf16().flat_map(|u| u.to_be_bytes()).collect();
        let mut name = Vec::new();
        name.extend([0, 0, 0, 1, 0, 18]); // format, count 1, strings at 6 + 12
        name.extend([0, 3, 0, 1, 0x04, 0x09, 0, 1]); // Windows, Unicode BMP, en-US, family
        name.extend((utf16.len() as u16).to_be_bytes());
        name.extend([0, 0]);
        name.extend(&utf16);
        let mut post = vec![0u8; 32];
        post[12..16].copy_from_slice(&(fixed as u32).to_be_bytes());
        let mut os2 = vec![0u8; 96];
        os2[30] = class;
        os2[32] = 2;
        os2[33] = serif_style;
        let tables: [(&[u8; 4], Vec<u8>); 3] = [(b"OS/2", os2), (b"name", name), (b"post", post)];
        let mut out = vec![0, 1, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0];
        let mut data_off = 12 + 16 * tables.len();
        let mut data: Vec<u8> = Vec::new();
        for (tag, t) in &tables {
            out.extend(*tag);
            out.extend([0, 0, 0, 0]);
            out.extend((data_off as u32).to_be_bytes());
            out.extend((t.len() as u32).to_be_bytes());
            data.extend(t);
            data_off += t.len();
        }
        out.extend(data);
        out
    }

    #[test]
    fn reads_families_and_kinds() {
        let dir = std::env::temp_dir().join(format!("mdcraft-fonts-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        std::fs::write(dir.join("Mono.ttf"), font("Test Mono Font", true, 0, 0)).unwrap();
        std::fs::write(dir.join("sub/Grot.otf"), font("Test Grot", false, 8, 0)).unwrap();
        std::fs::write(dir.join("Old.ttf"), font("Test Old Style", false, 1, 3)).unwrap();
        std::fs::write(dir.join("Hidden.ttf"), font(".Hidden UI", false, 8, 0)).unwrap();
        std::fs::write(dir.join("notes.txt"), "not a font").unwrap();
        std::fs::write(dir.join("broken.ttf"), "nope").unwrap();
        let v = scan(std::slice::from_ref(&dir));
        let get = |n: &str| v.iter().find(|f| f.family == n).cloned();
        assert_eq!(get("Test Mono Font").map(|f| (f.mono, f.sans)), Some((true, false)));
        assert_eq!(get("Test Grot").map(|f| (f.mono, f.sans, f.serif)), Some((false, true, false)));
        assert_eq!(get("Test Old Style").map(|f| (f.mono, f.sans, f.serif)), Some((false, false, true)));
        assert!(get(".Hidden UI").is_none());
        assert!(get("JetBrains Mono").map(|f| f.mono && f.bundled).unwrap_or(false));
        let names: Vec<&str> = v.iter().map(|f| f.family.as_str()).collect();
        let mut sorted = names.clone();
        sorted.sort_by_key(|s| s.to_lowercase());
        assert_eq!(names, sorted);
        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
mod system_scan {
    /// `cargo test -p mdcraft-core print_system_fonts -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn print_system_fonts() {
        let t = std::time::Instant::now();
        let v = super::scan(&super::font_dirs());
        eprintln!("{} families in {:?}", v.len(), t.elapsed());
        for f in &v {
            eprintln!("{:<5} {}", if f.mono { "mono" } else if f.sans { "sans" } else if f.serif { "serif" } else { "?" }, f.family);
        }
    }
}
