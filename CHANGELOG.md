# Changelog

## 0.2.3 — 2026-10-21

- **New and Open use a new window** while the window has a document or slide deck open; an
  empty window is used for it. This covers File › New (standard templates, My templates, New
  document / slide template), Home, File › Open (recent, pinned, browse, Browse…), ⌘O, the
  New blank document / presentation commands and the Markdown guide. Opening the document the
  window already shows does nothing. A browser tab (`mdcraft-cli serve`) keeps one document.
- Removed **New window** from the ribbon (View › Window); ⇧⌘N and command search still have it.
- `mdcraft --user-template FILE.mdd|.mds` and `mdcraft --new-template document|presentation`
  start a window with a new document from your template, or a new template.

## 0.2.2 — 2026-10-21

### Templates and saving

- **My templates** (File › New, and on Home when there are some): your own document and slide
  templates, apart from the standard ones. *New document template* / *New slide template*,
  *Save this document as a template*, and on each card **Edit** (opens the template file),
  **Rename** and **Delete** (moves it to the Trash). Search and the Documents / Presentations
  filter cover them too. Clicking one makes a new document with the placeholders filled in.
- Template files: `.mdd` (document) and `.mds` (slide deck), plain Markdown, kept in
  `templates/` in the settings folder. Finder knows them as MdCraft document / slide
  templates (double-click to edit one); the Open window lists them.
- **Save As** opens the system's Save window with a **File type** menu: *Markdown file (.md)*
  or *Markdown document template (.mdd)* / *Markdown slide template (.mds)*, whichever the
  document is. Templates are always saved in the templates folder
  (`~/Library/Application Support/mdcraft/templates`), whatever folder the window shows: only
  the name is used, the panel says so, and you are asked before an existing template with
  that name is replaced. On macOS this is the native Save panel with an accessory menu; on Linux the GTK
  dialog lists the types and the extension of the name decides. The Save As page inside the
  File view is gone; a browser tab (`mdcraft-cli serve`) gets an in-app window with the same
  File type choice.
- **Export**: removed *Markdown copy* (use Save As) and *Plain text*.
- Fixed: the Highlight button could wrap `==marked==` text in a span when clicked right after
  moving the cursor.

### Fixed

- **After an update the window kept showing the previous version's interface** (for example
  the old Save As page and Export page) when MdCraft runs on a fixed port (`--control PORT`,
  `MDCRAFT_CONTROL_PORT`): the interface files were cached for a day under the same address.
  They are now revalidated on every launch (`Cache-Control: no-cache` with an ETag; unchanged
  files answer 304), and the page loads them with this build's fingerprint
  (`/assets/app.js?v=…`), so a new build never runs with cached files, also right after
  upgrading from 0.2.1.

## 0.2.1 — 2026-10-21

### Fonts and colours

- **Font group** (Home tab), as in Word: a font box listing every font installed on the
  computer (each shown in its own typeface, recently used first, type to filter), a size box
  (8–72 pt, or type any size), grow and shrink, and **Highlight** and **Font color** as
  drop-down buttons. Formatting is written as `<span style="…">` around words and as
  `<div style="…">` (with blank lines) around whole paragraphs; changing it again updates the
  same tag instead of nesting a new one, and removing the last property removes the tag.
- **Colour picker** for highlight and font colour: Word's highlighter colours (plus soft ones)
  or theme colours with lighter and darker shades, standard colours, **custom colours**
  (type a #hex code or use More colors…; kept in your preferences, right-click one to remove
  it), and No color / Automatic. The button applies the last colour picked; clicking it
  inside a highlight removes it. `==marked==` text still works.
- **Document fonts** (Design tab): body font, code font and size for the whole document,
  written to the front matter as `mainfont`, `monofont` and `fontsize` (pandoc's names). The
  code font list has fixed-width fonts first, then sans-serif fonts.
- The front matter keys change the rendered document: preview, HTML export, printing and
  `mdcraft-cli export`/MCP renders. They win over the theme's fonts; slides keep their own
  text sizes. Unsafe values are ignored.
- **File › Options › Document fonts**: default `mainfont`, `monofont` and `fontsize` that
  new documents get in their front matter (presentations get the fonts, not the size), and a
  button to use them for the open document.
- `GET /api/fonts`: the installed fonts (macOS: /System/Library/Fonts, /Library/Fonts,
  ~/Library/Fonts; Linux: /usr/share/fonts, ~/.local/share/fonts…), read from the font files
  themselves (family name, fixed pitch, sans or serif), once per window, in a few hundred ms.

### Files, agent control and packaging

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
- The macOS `.dmg` opens as a laid-out window: a background (`packaging/macos/dmg-background.png`
  and `@2x` for Retina), the app on the left, an Applications shortcut on the right.
  `packaging/macos/package.sh` builds it with `diskutil image` on macOS 26+ (hdiutil is
  deprecated; older systems still use it), mounts the image visibly so Finder can save the
  window layout, retries ejecting while the volume is busy, and prints where the files are.
  `DMG_BACKGROUND=file.png` uses another background; `DMG_LAYOUT=0` skips the layout. The
  layout step drives Finder, so Terminal needs permission to control Finder (macOS asks once).
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
