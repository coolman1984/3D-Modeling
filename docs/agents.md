# AI agents in Space Planner

Every change to a project, by a person or an agent, goes through the same core commands and
lands in the project history with the author's name. Agents never touch files: they only get
the planner tools.

## Tools

| Tool | What it does |
|---|---|
| `list_projects` | All projects with id, name, revision, item count |
| `create_project` | New rectangular room with the starter catalog |
| `get_project` | Room, doors, columns, item types, every item, issues, metrics |
| `set_room` | Size, ceiling, doors on walls, columns |
| `define_item` | Create or edit an item type (sizes, clearances, seats, 3D shape) |
| `place_items` / `move_items` / `remove_items` | Edit the layout (each call is one revision); `height_m` raises an item off the floor |
| `apply_commands` | Raw core commands, for anything else |
| `check_project` | Design issues with amounts, plus metrics |
| `get_history` / `restore_revision` | Read the history, bring back a version |

Units: metres for positions, centimetres for sizes. x grows east, y grows north, rotation is
degrees counter-clockwise, 0 means the item faces north.

## From the app

Open a project → **الوكيل الذكي** tab → write what you want → pick the agent → **ابدأ**.
The app starts the agent on this computer in its own folder under `data/runs/`, gives it the
planner tools through MCP, streams its log, and shows each change live.

| Agent | Needs | Default command (editable in Settings) |
|---|---|---|
| Claude Code | `claude` installed and signed in | `claude -p --mcp-config {mcpConfig} --strict-mcp-config --allowedTools mcp__planner --output-format stream-json --verbose` (prompt on stdin) |
| Codex | `codex` installed and signed in | `codex exec --skip-git-repo-check -c mcp_servers.planner.command=… -c mcp_servers.planner.args=[…] -` (prompt on stdin) |
| API | An Anthropic API key, or an OpenAI-compatible endpoint | Runs inside the app; model and key in Settings |

The API key is stored only in the local database (`data/planner.db`) and is never sent back
to the browser.

## From your own Claude Code or Codex session

Start the app first (it writes its address to `data/server.json`). Then:

```bash
# Claude Code: this repository's .mcp.json already declares the server;
# elsewhere:
claude mcp add planner -- node /path/to/3D-Modeling/apps/server/dist/mcp.mjs

# Codex
codex mcp add planner -- node /path/to/3D-Modeling/apps/server/dist/mcp.mjs
```

Then ask, for example: "Use the planner tools to lay out project p-1234abcd as a wedding hall
for 120 guests with round tables of 10, a stage by the north wall and a buffet on the east wall."

## HTTP API

The same tools are available at `POST http://127.0.0.1:4600/api/tools/<name>` with
`{"input": {...}, "actor": "agent:my-script"}`. The app listens on the loopback address only.
