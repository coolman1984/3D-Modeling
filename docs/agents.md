# AI agents in Space Planner

Every change to a project, by a person or an agent, goes through the same core commands and
lands in the project history with the author's name. Agents never touch files: they only get
the planner tools.

## Tools

| Tool | What it does |
|---|---|
| `list_projects` | All projects with id, name, revision, item count |
| `create_project` | New hall, office, container or warehouse (`activity`); `warehouse` with `reference: true` creates the 30 × 20 m sample |
| `add_warehouse_rack` | One parametric rack row through one revision; centre in metres, bays, levels and positions |
| `add_warehouse_zone` | Named polygon (3–32 metre-coordinate vertices) through one revision |
| `warehouse_metrics` | Storage positions, usable positions, rack/zone areas and docks |
| `find_warehouse_route` | Dock to rack, mover body width and side clearance, reachability and sampled distance |
| `get_project` | Room, doors, columns, item types, every item, issues, metrics |
| `set_room` | Size, ceiling, doors on walls, columns |
| `define_item` | Create or edit an item type (sizes, clearances, seats, 3D shape) |
| `place_items` / `move_items` / `remove_items` | Edit the layout (each call is one revision); `height_m` raises an item off the floor |
| `apply_commands` | Raw core commands, for anything else |
| `check_project` | Design issues with amounts, metrics, and the activity's rules (`activity`, `style`) |
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

## Container loading

Containers are projects made with `create_project` and `activity: "container"` plus a
`container_type` (`20gp`, `40gp`, `40hc`, `45hc`, `20rf`, `40rh`, `trailer`). The length runs along
x from the front wall to the doors at the east end; the roof is the ceiling.

1. `define_item` with `mass_kg` and `cargo` (`quantity`, `stackable`, `max_load_on_top_kg`,
   `allow_tilt`, `stack_group`, `stop`) plans the load. Stop 1 is unloaded first.
2. `pack_container` compares three deterministic plans (largest, heaviest, widest base first) and
   changes nothing; `pack_container` with `apply: true` (and optionally `strategy`) applies one as a
   single revision. Algorithms calculate; the agent chooses and explains.
3. `place_items` accepts `tilt` (`"x"` / `"y"`: which side stands up), `stop` and `step` for manual
   placement; `move_items` with `height_m` stacks a piece.
4. `get_project` / `check_project` report payload, support (70% of the base), load on top,
   orientation, stacking groups, unloading order (last in, first out), balance and unplaced pieces,
   each with the source of its threshold.

## Warehouse planning (T7 in progress)

Use `create_project` with `activity: "warehouse", reference: true` for a measured example. Use
`get_project` for rack and dock ids; `warehouse_metrics` for structural capacity; and
`find_warehouse_route` to inspect forklift reachability. One rack row is one item, while bay /
level / position addresses such as `R01-B03-L02-P01` are derived. `add_warehouse_zone` can
create an arbitrary simple polygon with a warehouse-owned kind (`receiving`, `staging`, `no-go`,
`pedestrian`, `main-aisle`, etc.). `check_project` reports rule provenance. Distances use a
20 cm grid without vehicle-turning simulation; they are planning estimates, not site approval.
