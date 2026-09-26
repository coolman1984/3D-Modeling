# AI agents in Space Planner

Every change to a project, by a person or an agent, goes through the same core commands and
lands in the project history with the author's name. Agents never touch files: they only get
the planner tools.

## Tools

| Tool | What it does |
|---|---|
| `list_projects` | All projects with id, name, revision, item count |
| `create_project` | New hall, office, container, warehouse, production line, vehicle depot or restaurant (`activity`); `warehouse`, `production`, `depot` or `restaurant` with `reference: true` creates the measured sample |
| `add_warehouse_rack` | One parametric rack row through one revision; centre in metres, bays, levels and positions |
| `add_warehouse_zone` | Named polygon (3–32 metre-coordinate vertices) through one revision |
| `warehouse_metrics` | Storage positions, usable positions, rack/zone areas and docks |
| `warehouse_stock` / `assign_stock` / `optimize_slotting` | What each rack location holds; fill or empty locations; re-slot stock to cut forklift travel |
| `find_warehouse_route` | Dock to rack, mover body width and side clearance, reachability and sampled distance |
| `production_metrics` | Station/machine/buffer counts, buffer capacity, flow length and segment reachability |
| `add_depot_bay` | One parking bay zone through one revision; centre in metres, bay type and facing direction |
| `add_depot_zone` | Named lane or no-go polygon (3–32 metre-coordinate vertices), a lane carries a travel direction |
| `depot_metrics` | Bay counts by type, occupied and usable bay counts, vehicle count |
| `bay_entry_check` | Whether a named vehicle type can turn from the nearest lane into a named bay, swept-body checked |
| `restaurant_metrics` | Cover count, table counts by family, floor area per cover, zone areas, table reachability |
| `table_route` | Waitstaff route from the kitchen pass door to a table, reachability and sampled distance |
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

## Warehouse planning

Use `create_project` with `activity: "warehouse", reference: true` for a measured example. Use
`get_project` for rack and dock ids; `warehouse_metrics` for structural capacity; and
`find_warehouse_route` to inspect forklift reachability. One rack row is one item, while bay /
level / position addresses such as `R01-B03-L02-P01` are derived. `add_warehouse_zone` can
create an arbitrary simple polygon with a warehouse-owned kind (`receiving`, `staging`, `no-go`,
`pedestrian`, `main-aisle`, etc.). `check_project` reports rule provenance. Distances use a
20 cm grid without vehicle-turning simulation; they are planning estimates, not site approval.

Stock: a material is an item type holding one loaded pallet (`meta.sku`). `warehouse_stock` reads
occupancy and pallets per material (give `material_id` for its locations); `assign_stock` fills or
empties locations such as `W01-B02-L03-P01` (level 1 is the floor) in one revision;
`optimize_slotting` proposes moving the busiest pallets nearest the shipping dock and reports
weekly forklift travel before and after (`apply: true` makes it one revision). The sample
companies (projects page, "Add sample company": Nile Gate Logistics or Samsung Electronics Egypt)
have fully stocked warehouses to try this on.

## Site plans (whole campuses)

A site plan (pack `site`, from the Samsung sample) is a plot seen from above. A building is one
item (`category: "building"`, `meta.use`, `meta.storeys`) with its outer size; what happens inside
is its own project. Roads, lawns, plazas and yards are zones; staff parking uses the depot's bays
and lanes, so `add_depot_bay`, `add_depot_zone` and `bay_entry_check` work here too (a bus bay
defaults to a 12 m coach, other bays to a sedan). `get_project` reports plot area, built area and
coverage, green area and bays; `check_project` adds `building-boundary` (every building inside the
plot and off the roads) to the depot's bay rules.

## Production line planning

Use `create_project` with `activity: "production", reference: true` for the measured example
(source → machine A → buffer → machine B → inspection → finished goods). A station is placed with
the ordinary `define_item` / `place_items` tools — it is not parametric like a rack, so there is
no dedicated add-station tool. Give it a `category: "box"` definition; `clearance.front` is its
operating clearance and `clearance.back` its maintenance clearance (the core checks these like any
item's clearance, nothing warehouse- or production-specific). Give the placed item a `step`
(1 = first) to put it in the flow; `production_metrics` reports station/machine/buffer counts,
buffer capacity and flow length, and `check_project` reports whether every consecutive pair is
reachable for the default material handler. This stage is spatial feasibility only — no
throughput, WIP or blocking simulation.

## Vehicle depot planning

Use `create_project` with `activity: "depot", reference: true` for the measured example (a
two-way lane and six parking bays, two already occupied). A vehicle is placed with the ordinary
`define_item` / `place_items` tools, `category: "car"`; a bay is not an item — it is a floor
marking, so it is added with `add_depot_bay` (parametric: centre, bay type, facing direction) and
lives in `Space.zones` with `kind: "bay"`, the same way a warehouse aisle is a zone rather than an
item. A lane is added with `add_depot_zone` and a travel `direction_deg`; `bay_entry_check` and
`check_project`'s `bay-entry` rule drive a minimum-turning-radius (Dubins) path from the nearest
lane into a bay and sample its swept body every 20 cm against the walls, columns, other parked
vehicles and no-go zones — a planning estimate, not a site's turning-circle approval. No reverse
maneuvers, no articulated (trailer) kinematics, no throughput or dwell-time simulation.

## Restaurant planning

Use `create_project` with `activity: "restaurant", reference: true` for the measured example (a
kitchen pass and 9 tables of mixed families seating 44). A table is placed with the ordinary
`define_item` / `place_items` tools, `category: "table"` or `"round-table"` — a family (2/4/6-top,
round, booth, banquette, communal) is just a size and a `seats` count, the same universal field a
hall chair already uses, so covers, the walkway-to-a-door rule, floor area per cover and exit
rules all come from the shared rule module with no restaurant-specific geometry. A door with
`meta.role: "pass"` is the kitchen service point; `table_route` and the `table-reachability` rule
drive a waitstaff route from it to each table on the derived floor grid — a planning estimate.
Dining / bar / terrace / private zones are named polygons, the same mechanism a warehouse aisle
uses. No throughput, no reservation or seating-turn simulation, and no automatic candidate-layout
generation (max-capacity / balanced / spacious) in this stage — tables are placed by a person or
an agent, the way a hall or office is furnished.
