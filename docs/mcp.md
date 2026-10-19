# mdcraft for AI agents (MCP)

`mdcraft-cli mcp` is a [Model Context Protocol](https://modelcontextprotocol.io) server on
stdin/stdout. Any MCP client can use it: Claude Code, Claude Desktop, Gemini CLI, Codex, Cursor and others.
It works in two ways:

- **In the background (headless):** the agent creates, reads, edits, inspects and exports `.md`
  documents and decks on disk. No window is needed.
- **Live:** the agent drives a running mdcraft window. It can change the editor's text, the
  cursor and the selection, and it can run any ribbon command by its id (`format.bold`,
  `insert.chart`, `design.theme`, `slides.present`, …). You watch the changes as they happen,
  and Ctrl+Z undoes them.

## Set up

```sh
cargo build --release -p mdcraft-cli          # → target/release/mdcraft-cli (put it on your PATH)
```

### Claude Code

```sh
claude mcp add mdcraft -- mdcraft-cli mcp --root ~/Documents         # headless, limited to Documents
mdcraft --control &                                                   # or drive the running app…
claude mcp add mdcraft-app -- mdcraft-cli mcp --connect --root ~/Documents
```

Check the connection with `/mcp` in Claude Code.

### Gemini CLI (`~/.gemini/settings.json`), Claude Desktop, Cursor (`mcpServers`)

```json
{
  "mcpServers": {
    "mdcraft":     { "command": "mdcraft-cli", "args": ["mcp", "--root", "/Users/you/Documents"] },
    "mdcraft-app": { "command": "mdcraft-cli", "args": ["mcp", "--connect", "--root", "/Users/you/Documents"] }
  }
}
```

Use the full path to `mdcraft-cli` if it is not on the `PATH` the client sees.

## Options

| Option | Meaning |
|---|---|
| `--root DIR` | The agent may read and write only below `DIR`. Repeatable. |
| `--automation-read-root DIR` | The agent may read below `DIR`. Repeatable. |
| `--automation-write-root DIR` | The agent may write (and read) below `DIR`. Repeatable. |
| `--connect [PORT]` | Also drive a window started with `mdcraft --control [PORT]`. Without a port, it connects to the window on `MDCRAFT_CONTROL_PORT` when that is set, otherwise to the most recently started window. |

Without any root option, the agent can reach every file your user account can. Relative paths
are resolved against the first root.

The live tools follow the same roots. `app_open_document` and `app_save` refuse paths
outside the allowed folders.

## Letting a window be driven

```sh
mdcraft --control            # any free port
mdcraft --control 7985       # a fixed port
mdcraft-cli serve --control  # the editor in a browser tab, for scripts and tests
```

- Without `--control` (or `MDCRAFT_CONTROL_PORT`, below), a window can't be driven: the
  `/api/agent/…` routes answer 403.
- With it, the window writes its port and a random session token to `control/<port>.json` in
  the settings folder. Only your user account can read that file, and the window removes it
  when it closes.
- The server listens on 127.0.0.1 only and checks the token on every request.

### Always on: `MDCRAFT_CONTROL_PORT`

Set `MDCRAFT_CONTROL_PORT=PORT` to turn control on without `--control`, for example for windows
opened by double-clicking a document, which never get a command line. `0` means any free port.
`--control` on the command line wins over the variable.

On macOS, apps opened from Finder, the Dock or Spotlight don't see variables from your shell
profile. Set it for your login session instead; when MdCraft doesn't find the variable in its
environment, it asks launchd (`launchctl getenv MDCRAFT_CONTROL_PORT`):

```sh
launchctl setenv MDCRAFT_CONTROL_PORT 7985   # until you log out; quit and reopen MdCraft
lsof -iTCP:7985 -sTCP:LISTEN                 # check: mdcraft is listening
mdcraft-cli doctor                           # shows the port MdCraft picks up, and from where
```

To keep it after logging out, put that `launchctl setenv` in a LaunchAgent in
`~/Library/LaunchAgents/` that runs at login.

Every window is its own process. The first one takes the port; a window opened while it is
taken uses a free port instead (with an explicit `--control PORT` it stops with an error). A
plain `mdcraft-cli mcp --connect` drives the window on `MDCRAFT_CONTROL_PORT` when there is
one, otherwise the newest window. `mdcraft-cli serve` reads the variable too.

## Tools

| Tool | What it does |
|---|---|
| `guide` | The authoring guide: front matter, themes, cover pages, KPI cards, columns, callouts, charts, diagrams, slides and layouts. |
| `list_templates` | The document and presentation templates. |
| `create_document` | Creates a new file from a template. It never overwrites an existing file. |
| `read_document` | Reads a whole file, or a range of lines. |
| `write_document` | Writes a whole file (atomic). Replacing an existing file needs `overwrite: true`. |
| `edit_document` | Find and replace in a file (the first occurrence, or all of them). |
| `inspect_document` | Title, document or deck, slide count, front matter, outline with line numbers, word count. Use this to check work without screenshots. |
| `render_html` / `export_html` | The rendered HTML fragment, or a standalone web page. |
| `list_files` | Lists Markdown files and folders. |
| `app_state` | The open document (path, saved, unsaved changes), view, ribbon tab, cursor, selection, theme and statistics. |
| `app_get_text` / `app_set_text` | Reads the editor's text, or replaces it as one undoable edit. |
| `app_insert` / `app_replace` / `app_select` | Types at the cursor (or as a block, or at the end), finds and replaces, moves the cursor or selects. |
| `app_list_commands` / `app_run_command` | Lists every command, or runs one by id, exactly as the ribbon does. |
| `app_new_document` / `app_open_document` / `app_save` | Document lifecycle in the window. |
| `app_set_view` / `app_inspect` | Switches between write, split and read; returns the rendered outline, slides and front matter. |

## Safety

- **Unsaved work is never discarded.** `app_new_document`, `app_open_document` and
  `file.new`/`file.open`/`file.close` are refused while the window has unsaved changes. The agent
  must call `app_save` first.
- **Agent edits can be undone.** Every edit is an ordinary edit in the editor, so Ctrl+Z
  undoes it.
- **Documents never run code for the agent.** Rendering for the agent never runs code chunks,
  even if code chunks are enabled in File › Options.
- **Dialogs wait for you.** Some commands open a dialog for the user, such as Insert › Picture….
  The tool call then returns after its timeout, and the dialog stays open for you.

## How it works

```text
 agent ──stdio/MCP──▶ mdcraft-cli mcp ──HTTP 127.0.0.1 + token──▶ mdcraft-core ──long poll──▶ agent.js in the window
                       (headless tools                             /api/agent/call            runs MD.run(id) and
                        work on files)                             /api/agent/view            editor operations
```

The code is in `apps/mdcraft-cli/src/mcp.rs` (protocol and tools),
`apps/mdcraft-cli/src/live.rs` (client), `crates/mdcraft-core/src/agent.rs` (bridge and routes)
and `crates/mdcraft-core/web/assets/agent.js` (the page side).
