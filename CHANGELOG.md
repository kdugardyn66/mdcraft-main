# Changelog

## Unreleased

- macOS: opening a `.md` file from Finder (double-click, Open With, or dropping it on the Dock
  icon) now opens it. Finder sends documents as an Apple Event, which the app ignored; it only
  read the command line. With a document already open, the file opens in a new window.
- macOS: selecting several Markdown files in Finder and choosing Open (or Open With → MdCraft)
  opens each one in its own window, also when Finder sends the selection as several events.
- A document changed by another application while it is open: MdCraft notices (within 1.5 s,
  when the window gets focus, and before saving, so it never silently overwrites the other
  version) and asks what to do: **Reload** the new version (Undo brings yours back), **Merge**
  it with your unsaved changes (a three-way merge; where both changed the same lines, both
  versions are kept between `<<<<<<< Your changes` and `>>>>>>> Changed on disk`), **Open in New
  Window** as a new unsaved document, or **Keep Mine**. Merge is offered when you have unsaved
  changes. A file moved or deleted elsewhere is reported once and kept open as unsaved.
- `mdcraft --copy-of FILE.md`: FILE as a new, unsaved document. New API routes for the page:
  `GET /api/file/stat`, `POST /api/merge`; `/api/file` and `/api/file/save` return a `stamp`.
- `MDCRAFT_CONTROL_PORT=PORT` turns on agent control like `--control PORT`, also for windows
  opened from Finder or the Dock (on macOS: `launchctl setenv MDCRAFT_CONTROL_PORT 7985`).
  A second window finds the port taken and uses a free one instead of failing to start.
  `mdcraft-cli serve` reads it too, and a plain `mdcraft-cli mcp --connect` prefers that port.
  On macOS, when the app's environment doesn't have it (apps opened from Spotlight, Finder or
  the Dock often don't get `launchctl setenv` values), MdCraft asks `launchctl getenv`.
  `mdcraft-cli doctor` shows the port and where it came from.
- `packaging/macos/package.sh` builds the `.dmg` step by step (a hidden image with Spotlight
  off, unmounted with retries, then compressed) instead of `hdiutil create -srcfolder`, which
  failed with "Resource busy" and left only the `.app`. The `.dmg` now has an Applications
  shortcut to drag the app onto, and the script prints where both files are.
- New dependency: `diffy` (MIT OR Apache-2.0) for the three-way merge.
- macOS: `Info.plist` declares the Markdown type (`net.daringfireball.markdown`) so Finder
  matches `.md`/`.markdown` files on systems that don't define it.

## 0.2.0 — 2026-10-16

- MCP server for AI agents: `mdcraft-cli mcp` (stdio). Headless tools create, read, edit, inspect
  and export documents; `--connect [PORT]` adds `app_*` tools that drive a running window: editor
  text, cursor, and every command by id. `--root`, `--automation-read-root` and
  `--automation-write-root` keep the agent inside the folders you choose. See `docs/mcp.md`.
- The app is called MdCraft: `MdCraft.app` and `MdCraft-<version>-macos-universal.dmg` on macOS,
  “MdCraft” in the Linux applications menu, the window title, the macOS menu bar and About. Commands and packages stay lowercase
  (`mdcraft`, `mdcraft-cli`).
- Windows is no longer supported: macOS and Linux only. Removed the Windows packaging script,
  the Windows CI runner, the `.ico` icon and the Windows-only code paths; building for Windows
  now stops with a clear error.
- `mdcraft --control [PORT]` and `mdcraft-cli serve --control` let agents drive the window
  (loopback only, a token in a private control file; off by default).

## 0.1.0 — 2026-10-14

First version.

- Desktop app (tao + wry) and `mdcraft-cli`.
- WordCraft-style interface: ribbon (Home, Insert, Design, Slides, Review, View, contextual Table),
  File view (start page, templates, open, save as, info, print, export, options, about),
  command search, status bar with views and zoom, navigation pane with headings and slide thumbnails.
- MarkDown Live 0.7.1 renderer: GFM, Mermaid, Graphviz, PlantUML, Vega, Chart.js, Plotly, WaveDrom,
  KaTeX/MathJax + mhchem, CSV, `@import`, code chunks, media, 3D molecules, slides with notes.
- Additions to the renderer: `<!-- pagebreak -->`, front matter exposed for themes.
- 7 document themes and 7 slide themes; 10 slide layouts; page setup, watermark, numbered headings.
- 11 Word-style document templates and 8 PowerPoint-style deck templates.
- Slide show (F5), printing to paper/PDF, HTML export, copy as formatted text.
- Document recovery, recent and pinned documents, preferences.
