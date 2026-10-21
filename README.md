<p align="center"><img src="assets/app-icon/mdcraft-256.png" width="96" alt=""></p>

<h1 align="center">mdcraft</h1>

<p align="center">
  <b>A word processor for Markdown.</b> Write plain text, get Word-style documents and
  PowerPoint-style slides — live, offline, in a native desktop app written in Rust.
</p>

<p align="center">
  <img alt="Written in Rust" src="https://img.shields.io/badge/written%20in-Rust-0f7b6c?style=flat-square&logo=rust&logoColor=white">
  <img alt="macOS, Linux" src="https://img.shields.io/badge/runs%20on-macOS%20%C2%B7%20Linux-0b5f54?style=flat-square">
  <img alt="License" src="https://img.shields.io/badge/license-MIT%20%2F%20Apache--2.0-0f7b6c?style=flat-square">
</p>

<p align="center"><img src="docs/images/document.png" alt="mdcraft with the Home tab of the ribbon, the Navigation pane listing the headings of an annual report, the Markdown editor in the middle and the rendered report — KPI cards, a callout and a chart — on a page to the right" width="100%"></p>

mdcraft brings together two projects:

- **[WordCraft](https://github.com/storytold/wordcraft)** is the template for the application: the
  workspace layout, a ribbon with Home / Insert / Design / … tabs, the File view with a template
  gallery and recent documents, design tokens, keyboard conventions and the rule that *everything
  is a command*.
- **MarkDown Live** (the Zed extension) provides the functionality: its renderer turns Markdown into
  HTML with Mermaid, Graphviz, PlantUML, Vega, Chart.js, Plotly, KaTeX/MathJax with chemistry, CSV
  tables, `@import`, code chunks that run, pictures (HEIC too), videos, 3D molecules and slides with
  speaker notes — all bundled, so it works offline.

## A tour

<table>
<tr>
<td width="50%" valign="top"><img src="docs/images/templates.png" alt="The File › New page with live thumbnails of the document templates: blank, welcome tour, business report, project proposal, formal letter, memo, meeting minutes, résumé, technical specification, research paper and newsletter" width="100%"><p align="center"><sub><b>Templates.</b> 11 Word-style documents and 8 PowerPoint-style decks, each with real content and its own theme.</sub></p></td>
<td width="50%" valign="top"><img src="docs/images/slides.png" alt="A pitch deck in the Aurora theme: slide thumbnails on the left, the Markdown with slide separators in the middle, the rendered 16:9 slides on the right, and the Slides tab of the ribbon with layouts and slide themes" width="100%"><p align="center"><sub><b>Slides.</b> Layouts, slide themes, a thumbnail pane, speaker notes — and the Markdown stays readable.</sub></p></td>
</tr>
<tr>
<td width="50%" valign="top"><img src="docs/images/present.png" alt="Full-screen slide show showing a line chart titled Traction on a dark violet slide" width="100%"><p align="center"><sub><b>Present.</b> F5 starts a full-screen slide show with notes (N), black screen (B) and jump-to-slide.</sub></p></td>
<td width="50%" valign="top"><img src="docs/images/dark.png" alt="mdcraft with a dark interface and a dark page, showing a design document with a flowchart and an entity-relationship diagram" width="100%"><p align="center"><sub><b>Dark mode</b> for the interface and, separately, for the page.</sub></p></td>
</tr>
</table>

## What it does

| Area | Highlights |
|---|---|
| **Editor** | CodeMirror 6 with Markdown highlighting, smart lists, search & replace, spell-check, word wrap, line numbers; slide separators and page breaks shown as labelled bands |
| **Ribbon** | Home (clipboard, font — font and size boxes with every installed font, highlight and font colour pickers —, paragraph, live **Styles** gallery), Insert (cover page, page break, contents, tables with a grid picker, pictures, diagrams, charts, media, chemistry, links, footnotes, callouts, code, equations, date, emoji, symbols), Design (document themes, document fonts, paper size, orientation, margins, watermark, numbered headings), Slides (new slide by layout, layouts, duplicate/move/delete, notes, background, slide themes, present, convert a document to slides), Review (spelling, word count, accessibility check), View (write / split / read, navigation pane, zoom, light / dark interface, dark page, focus mode), contextual **Table** tab |
| **Preview** | Live as you type, scroll-synced with the cursor; double-click a block to edit it; pages for documents, 16:9 frames for slides |
| **File view** | Start page with templates and recent / pinned documents, a template gallery with live thumbnails and search, **My templates** (your own document and slide templates: create, edit, rename, delete), Open, Save As in the system's Save window with a File type (Markdown file or Markdown template), document properties and statistics, print settings, export, options |
| **Output** | Print / PDF (pages, slides one per page, notes), a self-contained web page with rendered diagrams, *Copy as formatted text* for Word and e-mail, plain text |
| **Safety** | Unsaved documents are kept for recovery after a crash; closing asks to save; files are written atomically |
| **For scripts** | `mdcraft-cli new / templates / render / export / serve` |
| **For AI agents** | an MCP server (`mdcraft-cli mcp`) for Claude Code, Gemini CLI and other agents: headless documents, or driving the open window with `--connect` — see [docs/mcp.md](docs/mcp.md) |

Every action is a command with an id (`format.bold`, `insert.chart`, `slides.present` …): the ribbon,
the keyboard, and command search (**Alt+Q**) all run the same commands.

## Quick start

```sh
# Linux needs WebKitGTK:  sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev
cargo run --release -p mdcraft                       # the app (start page)
cargo run --release -p mdcraft -- notes.md           # open a document
cargo run --release -p mdcraft -- --template pitch   # a new deck from a template
```

Command line:

```sh
mdcraft-cli templates                       # list the templates
mdcraft-cli new report Q3-report.md         # a document from a template
mdcraft-cli export Q3-report.md             # → Q3-report.html
mdcraft-cli serve Q3-report.md              # the full editor in your browser
```

For AI agents (MCP):

```sh
claude mcp add mdcraft -- mdcraft-cli mcp --root ~/Documents            # headless documents and decks
mdcraft --control &                                                      # or let agents drive the window
claude mcp add mdcraft-app -- mdcraft-cli mcp --connect --root ~/Documents
```

Gemini CLI and other clients: [docs/mcp.md](docs/mcp.md).

## Templates

Your own templates sit apart from these under **File › New › My templates**: `.mdd` files make
documents, `.mds` files make slide decks (both plain Markdown). See [docs/templates.md](docs/templates.md#my-templates).

| Documents (Word-style) | Theme | Presentations (PowerPoint-style) | Theme |
|---|---|---|---|
| Blank document | Office | Blank presentation | Paper |
| Welcome to mdcraft (a tour) | Office | Pitch deck | Aurora |
| Business report | Report | Project status update | Corporate |
| Project proposal | Office | Quarterly business review | Paper |
| Formal letter | Letter | Training workshop | Sunrise |
| Memo | Office | Tech talk | Midnight |
| Meeting minutes | Office | Lecture | Chalkboard |
| Résumé | Modern | Product launch | Ocean |
| Technical specification | Modern | | |
| Research paper | Classic | | |
| Newsletter | Newsletter | | |

Templates are plain Markdown files in [`templates/`](templates); `{{author}}`, `{{date_long}}`,
`{{quarter}}` and friends are filled in when you create a document. How the Word- and
PowerPoint-style building blocks work (cover pages, KPI cards, columns, timelines, slide layouts,
themes) is in **[docs/templates.md](docs/templates.md)**.

## Architecture

```text
 ┌──────── mdcraft (tao window + wry webview) ────────┐  HTTP 127.0.0.1 + token  ┌──────── mdcraft-core ────────┐
 │ ribbon · File view · CodeMirror editor · preview   │ ───── POST /api/doc ───▶ │ comrak renderer (MarkDown    │
 │ slide show · printing                               │ ◀── long-poll /api/state │ Live), files, prefs, recent, │
 │ native dialogs, title, close, drop over IPC         │                          │ templates, recovery, media   │
 └─────────────────────────────────────────────────────┘                          └──────────────────────────────┘
```

| Crate | Job |
|---|---|
| `crates/mdcraft-core` | MarkDown Live's renderer and preview server, plus the editor API, preferences, recent files, document recovery; embeds the web UI (`web/`) |
| `crates/mdcraft-templates` | the document and slide templates (`templates/*.md`) |
| `apps/mdcraft` | the desktop app: tao + wry (WebKitGTK / WKWebView), native dialogs (rfd), menu on macOS (muda) |
| `apps/mdcraft-cli` | the command-line tool and the MCP server (`mcp.rs`, `live.rs`) |

The web UI lives in `crates/mdcraft-core/web/assets` (plain JavaScript and CSS, no build step) and is
compiled into the binaries. The bundled editor is rebuilt with `tools/editor-bundle` (`npm install && npm run build`).

## Packaging

- Linux: `packaging/linux/package.sh` (tarball; `.deb`/`.rpm` with nfpm); desktop entry and AppStream metadata included.
- macOS: `packaging/macos/package.sh` (universal `.app` and `.dmg`).
- CI: `.github/workflows/ci.yml` builds, lints and tests on macOS and Linux.

## Settings and files

Preferences, recent documents and recovery copies live in `~/.config/mdcraft` (Linux)
or `~/Library/Application Support/mdcraft` (macOS); `MDCRAFT_CONFIG_DIR`
overrides it. Renderer settings use MarkDown Live's keys (`math`, `mermaidTheme`, `enableScriptExecution`,
`plantumlJar` …) and are set in **File › Options**.

## License and credits

mdcraft is dual-licensed under [MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE). See [NOTICE](NOTICE)
for the projects it builds on and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) /
[ATTRIBUTION.md](ATTRIBUTION.md) for bundled libraries, fonts and assets.

<sub>mdcraft is independent and not affiliated with Microsoft or with the ArtCraft team. Microsoft Word
and PowerPoint are trademarks of the Microsoft group of companies, named only to describe the kind of
documents the templates resemble. WordCraft's ArtCraft brand assets are not used.</sub>
