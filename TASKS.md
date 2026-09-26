# TASKS

## Now: D1 — client demo: "Nile Gate Logistics" sample company + material slotting + visual polish

**Finish line (1–2 day deadline):** from the projects page, one click adds a realistic fictional
Egyptian logistics company (Nile Gate Logistics): an electronics distribution centre in 10th of
Ramadan stocked with Samsung-style TVs and appliances, a port warehouse, loaded inbound containers
(TV cartons upright, palletised appliances), a multi-stop outbound trailer, an empty container to
pack live, and a truck yard. In a warehouse a person can see which material sits in which rack
location (3D pallets coloured by material), assign / move / clear material per location, find a
material, and run a deterministic slotting optimiser that cuts forklift travel (before/after shown).
The 3D view looks like a real site (industrial racking colours, pallets, printed TV cartons,
corrugated container shell, better lighting) while staying fast at 100+ racks. Everything goes
through core commands and the store; `pnpm check` passes; browser-checked with screenshots.

- [x] Starter: stock slotting module (encoding in rack `meta`, locations, metrics, optimiser) + tests
- [x] Starter: Nile Gate sample company (warehouses, containers, trailer, yard) + tests
- [x] Server: `POST /api/samples/nile-gate` creates the sample projects through the store; test
- [x] Editor: "Add sample company" on the projects page
- [x] Editor: stock panel (occupancy, materials, find, optimise) + rack location grid in the inspector
- [x] Editor 3D: stock pallets per location (instanced), racking colours, lighting, TV carton print, container shell, forklifts, dock plates, floor lines
- [x] Agent tools: `warehouse_stock`, `assign_stock`, `optimize_slotting`
- [x] Decision record 0015, README, agents.md; planted bug caught; browser review with screenshots; `sample.spec.ts`
- [x] Full `pnpm check` (typecheck, 314 unit tests, 18 browser journeys); commit on a branch and push

Found along the way (D1):
- The 20′ phone sample was 12.4% front-heavy on the first build (balance limit 10%); fixed the sample load.
- Stock in a blocked location is allowed and not yet reported by any rule.
- Playwright's own Chromium was not installed on this machine; installed it for the browser suite.

## Done: T5 — shared industrial foundation (plan: `docs/03-industrial-packs-plan.md`)

**Done means:**
1. Derived grid spatial index in the core; checks use it; results identical to all-pairs (property
   test); benchmark at 1k / 5k / 20k items with before/after numbers recorded in decision 0009.
2. Optional `ItemDefinition.mass` (g), `ItemInstance.tilt`, `meta` on types and items; validation,
   `item.tilt` / `item.meta` commands, checks and metrics (total mass, centre of mass) aware of them;
   old saves open byte-identical (fixture test).
3. Rule sources with provenance on every starter rule; shown in the review and report.
4. 3D view renders repeated items with instancing; picking, selection and issue tint still work.
5. `OptimizationPort` type in the starter; server and editor unchanged in behaviour otherwise.
6. `pnpm check` passes; planted bug caught; docs and README updated.

- [x] Plan: `docs/03-industrial-packs-plan.md`, master plan note, core plan note, decision 0008
- [x] Core: spatial index + checks + property test + benchmark
- [x] Core: mass, tilt, meta (types, validate, commands, derive, checks, metrics, io fixture)
- [x] Starter: rule provenance; OptimizationPort
- [x] Editor: instanced 3D; review/report show rule sources
- [x] Check, planted bug, docs, commit

## Done: T6 — container loading MVP (done definition in the plan §7, decision 0010)

- [x] Core: `Space.meta` (container type, payload, doors), `createSpace` keeps it
- [x] Pack: container types, sample cargo, `newContainer`, cargo data in `meta`, 8 loading rules with sources, container metrics
- [x] Packer: extreme points, three strategies as `OptimizationPort` candidates, never proposes a failing load (property test)
- [x] Server: create containers (HTTP + tool), `define_item` mass + cargo, `place_items` tilt/stop/step, `pack_container`, container facts for agents, `set_room` keeps pack data
- [x] Editor: container in the create dialog, Load panel, cargo inspector, settle onto stack, payload field, colour by, cut-away, playback, numbered steps, report sequence
- [x] Live updates: re-check the project whenever the live connection (re)opens (race found by the browser tests)
- [x] Tests: reference cases, property test, server tools, browser journey, planted bug; `pnpm check`

## Done: T7 — warehouse MVP (plan §7)

**Finish line:** A person can create, edit, check, route, inspect in 2D/3D and report a realistic warehouse in Atrium; agents share the command path; browser journeys and full `pnpm check` pass before calling T7 done. T8 begins only afterward.

- [x] 30 × 20 × 8 m reference warehouse with two dock roles, five 6-bay/4-level/2-position rack rows (240 positions), a column and operational zones.
- [x] Shared derived floor raster and Euclidean distance transform moved out of the hall; deterministic eight-direction shortest paths without diagonal corner cutting, mover width and reconstructed path.
- [x] Parametric rack definitions, unique addressable locations and blocked/usable capacity; rack inspector can edit a row through one revision.
- [x] Geometry-only named polygon zones in schema 2, migration from schema 1; zone edits preserve history, render in 2D/3D/report and can be made by an agent.
- [x] Warehouse selection and reference/empty templates, storage panel, visible dock-to-rack route in 2D and 3D, rack/zone controls, capacity and report data.
- [x] Checks for aisle gap, rack reachability, dock route, dock approach, restricted-zone conflict and rack boundary, with rule provenance; unknown for missing data.
- [x] Agent tools to create, add rack/zone, read metrics and find a route; project check uses the warehouse pack.
- [x] Hand-calculated 240-position reference, blocked location and route tests; 110-rack/5,280-position scale case; diagonal-corner planted bug caught and restored.
- [x] Browser journey and full `pnpm check`: Chromium is available in this workspace now; `warehouse.spec.ts` and all 14 journeys pass. Found and fixed a corrupted `styles.css` (binary garbage committed in the T7 foundation commit) that had silently broken the editor build.
- [x] Usability and visual review in a real browser: plan, split, 3D, rack inspector, report and a 100-rack/4,800-position scale project all reviewed with screenshots. Found and fixed a real layout bug (rack-capacity fields overlapping their labels) and a severe performance bug (see below). Decision 0011 has the details.
- [x] Audited 100-rack interactions and performance: found `checkWarehouse` running up to `docks × racks × 4` full-grid Dijkstra searches (24–39 s at 100 racks); fixed with a one-flood-per-dock reachability search in `packages/industry` (now ~380 ms). Regression test added that fails without the fix. 3D renders 100 rack rows (600 bays) smoothly; 2D interaction and one rack edit are both well under 100 ms.
- [x] Recheck all prior hall/office/container browser journeys and save compatibility end to end: all pass, no regressions.
- [x] Pallet occupancy visualization is structural only (rack levels/positions shown as dividers, not per-pallet placement) — acceptable for spatial planning per the plan; revisit only if the owner asks for live occupancy.
- [x] T7 decision evidence finished (decision 0011). All gates pass: `pnpm check` green (typecheck, all unit suites, all 14 browser journeys), save compatibility confirmed, planted-bug verification done for the routing fix (reverted it, confirmed the new test fails at ~24 s, restored it, confirmed it passes at ~380 ms).

## Done: T8 — production line MVP (plan §8 in `docs/03-industrial-packs-plan.md`, decision 0012)

**Finish line:** A person can create, edit, check, inspect in 2D/3D and report a realistic
production line (source → machine → buffer → machine → inspection → finished goods) in Atrium;
spatial feasibility only (machine footprint, operating and maintenance clearance, flow
reachability and length) — no throughput simulation in this stage. Agents share the command
path; browser journey and full `pnpm check` pass before calling T8 done.

What T7 already gives this for free: `packages/industry` routing (reused as-is for flow
reachability), the derived-zone/rule-provenance pattern, instanced 3D rendering, the
report/agent-tool patterns, and the lesson from decision 0011 (bulk reachability must be one
search per source, not one per pair — apply that from the start here, not after measuring a
regression).

- [x] Reference production line: Source → Machine A → Buffer → Machine B → Inspection → Finished
      goods, 30 × 8 m, 8.8 m hand-calculated flow length.
- [x] Machines reuse the core's existing per-item clearance (front = operating clearance, back =
      maintenance clearance) rather than inventing new geometry; no core change.
- [x] Flow order from `item.meta.step` (the same field container pieces already use for loading
      order, via the existing `stepOf`); flow route between consecutive stations derived via
      `packages/industry` `findRoute`, one search per consecutive pair — no per-pair fan-out.
- [x] Rules: `machine-boundary` (station fits inside the floor), `flow-reachability` (a material
      handler can travel from each station to the next). Unknown for no/one station; rule
      provenance `engineering` on both.
- [x] Production metrics: station/machine/buffer counts, buffer capacity, flow length, floor area,
      reachable/total segments.
- [x] Editor: production activity card + reference/empty templates in the create dialog, a
      production panel (flow length, counts, flow order list), a "Production flow" group in the
      inspector to set a station's order, the flow route always visible in 2D and 3D.
- [x] Agent tools: `create_project` activity `production` with a `reference` flag,
      `production_metrics` mirroring `warehouse_metrics`; project check uses the production pack.
      Stations are placed with the existing generic `define_item`/`place_items` tools — no
      dedicated add-machine tool, since a station is not parametric like a rack.
- [x] Report: production-specific cover copy and stats, a "Production flow" section alongside the
      existing plan/3D/quantities/rules sections.
- [x] Hand-calculated reference test (exact 2.8 m segment on the 20 cm grid, verified against the
      real stored flow points), a 20-station scale/performance case, a boundary/unknown-reason
      case. A real bug (the mover's own half-width missing from the flow-point gap, so every
      route came back blocked) was caught by the first test run, not planted afterward — see
      decision 0012.
- [x] Browser journey (`production.spec.ts`); full `pnpm check` green (typecheck, all unit suites,
      all 15 browser journeys); recheck of all prior packs' journeys and save compatibility;
      decision record 0012; TASKS/README/plan doc updated.

## Done: T9 — vehicle depot / garage MVP (plan §7 in `docs/03-industrial-packs-plan.md`, decision 0013)

**Finish line:** A person can create, edit, check, inspect in 2D/3D and report a realistic vehicle
depot (parking bays, a travel lane, parked vehicles) in Atrium; spatial feasibility only — a
minimum-turning-radius (Dubins) path checked from the nearest lane into each empty bay, swept
body checked against walls, columns, other vehicles and no-go zones. No throughput/dwell-time
simulation, no reverse maneuvers, no articulated (trailer) kinematics. Agents share the command
path; browser journey and full `pnpm check` pass before calling T9 done.

What earlier stages already give this for free: the derived-zone/rule-provenance pattern from T7
(a bay ended up being a zone, exactly like a warehouse aisle), the report/agent-tool patterns from
T7/T8, and `packages/industry` as the right home for a new shared vehicle-kinematics primitive
(the plan's own concept-placement table already named "vehicle profile, swept envelope" for
`packages/industry` at T9).

- [x] New `packages/industry/src/dubins.ts`: a clean-room Dubins path planner (LSL/RSR/LSR/RSL),
      pose sampling and vehicle-corner geometry. Verified by forward-simulating the returned path
      back to the goal pose (property test over random poses/radii), plus two hand-derived cases
      (a straight segment, an exact (π/2)·r quarter-circle turn). A floating-point edge case at a
      symmetric tangent configuration was found and fixed (tolerance before the p² square root).
- [x] Reference depot: 30 × 18 m, a two-way lane, six perpendicular bays, two parked vehicles
      (sedan, van), zero design issues, both rules pass.
- [x] A bay is a zone (`Space.zones`, kind `bay`), not an item — the first version as an item
      caused every parked vehicle to be flagged as "overlapping" its own bay, since the core's
      overlap check only looks at vertical extent and a floor marking and a car both start at
      elevation zero. Zones and items are never compared for overlap, so this was the correct
      fix, not a workaround.
- [x] Rules: `bay-boundary` (bay fits inside the depot), `bay-entry` (a reference vehicle can turn
      from the lane into every empty bay without its swept body leaving the floor or touching an
      obstacle). Unknown for no bays, no lanes, or every bay already occupied.
- [x] Depot metrics: bay counts by type, occupied/usable bays, vehicle count, floor area.
- [x] Editor: depot activity card + reference/empty templates, a depot panel (metrics, bay-entry
      check with the swept path shown in 2D/3D, an "add bay" form), a vehicle inspector group.
- [x] Agent tools: `create_project` activity `depot`, `add_depot_bay`, `add_depot_zone`,
      `depot_metrics`, `bay_entry_check` (names a vehicle type); project check uses the depot pack.
- [x] Report: depot-specific cover copy and stats, a "Vehicle depot" section.
- [x] Hand-calculated entry-scene test (exact lane-approach start point, goal at the bay centre),
      occupied/blocked/no-lane/unknown-bay cases, a 20-bay scale case under a second. A real
      geometry issue (a tight turning radius with no lead-in room forcing an unrealistic wide
      loop) was found and fixed by setting the approach point back one turning radius along the
      lane before this reached the browser.
- [x] Browser journey (`depot.spec.ts`); full `pnpm check` green (typecheck, all unit suites, all
      16 browser journeys); decision record 0013; TASKS/README/agents.md updated.

## Done: T10 — restaurant MVP (plan §7 in `docs/03-industrial-packs-plan.md`, decision 0014)

**Finish line:** A person can create, edit, check, inspect in 2D/3D and report a realistic
restaurant (table families, dining/bar/terrace/private zones, covers, a kitchen-pass service
route) in Atrium; spatial feasibility only — walkway/area/exit rules and table reachability from
the kitchen pass. No throughput, reservation or seating-turn simulation, and no automatic
candidate-layout generation in this stage. Agents share the command path; browser journey and
full `pnpm check` pass before calling T10 done.

What earlier stages already give this for free: the shared `walkwayRule`/`areaRule`/`exitRules`
module (T3b, used unmodified — a table's `seats` field makes it a "seat" in the core's own terms,
the same as a hall chair), the door-role convention from T7 (`Door.meta.role`, reused verbatim
including its `rotate()`-based approach-point formula), and the one-search-per-source reachability
shape from decision 0011.

- [x] Reference restaurant: 20 × 14 m, an entrance and a kitchen-pass door, a dining zone, 9
      tables across four families (4-top, round-6, booth-4, banquette-8) seating 44 covers, zero
      design issues, every rule passes on the first run.
- [x] Table families reuse the core's existing `seats` field (no new core concept) and the
      existing `table`/`round-table` 3D shapes (no new geometry); clearance is uniform on all four
      sides, since a table has no single "front" the way a machine or rack does.
- [x] Rules: `area-per-cover` (reuses the shared `areaRule` with a restaurant-specific code and
      provenance) plus the shared `walkway`/`exits`/`door-width` rules unmodified, and the new
      `table-reachability` (waitstaff can travel from the kitchen pass to every table, one
      flood-fill search per pass door). No `table-boundary` rule — the core's own out-of-bounds
      design issue already covers it, same as hall and office.
- [x] Restaurant metrics: covers, tables by family, floor per cover, dining/bar/terrace/private
      zone areas, reachable/total tables.
- [x] Editor: restaurant activity card + reference/empty templates, a restaurant panel (covers,
      metrics, a service-route check with the route shown in 2D/3D).
- [x] Agent tools: `create_project` activity `restaurant`, `restaurant_metrics`, `table_route`;
      project check uses the restaurant pack. Tables placed with the existing generic
      `define_item`/`place_items` tools — no dedicated add-table tool, since a table is not
      parametric like a rack or a bay.
- [x] Report: restaurant-specific cover copy and stats, a "Restaurant" section.
- [x] Hand-checked route-distance comparison (a table near the pass is closer than one far from
      it), unknown-reason cases (no tables, no pass door), an out-of-bounds-table case confirmed
      as a core design issue rather than a pack rule, a 20-table scale case under a second. A
      planted-bug run (flipping the door swing-direction sign copied from the warehouse's
      `dockApproach`) failed four independent tests immediately, confirming the reused formula is
      exercised, not just present.
- [x] Browser journey (`restaurant.spec.ts`); full `pnpm check` green (typecheck, all unit suites,
      all 17 browser journeys); recheck of all prior packs' journeys and save compatibility;
      decision record 0014; TASKS/README/agents.md/plan doc updated.

## Done: R1 — Atrium redesign of the existing app (English UI)

**Done means:**
1. Every screen (editor shell, library, objects, space, precision, plan, 3D, split, inspector,
   review + rules, history, AI Planner, status bar, projects, new-project flow, report, settings)
   follows `design-reference/Atrium * v2.dc.html` closely: warm-neutral shell, serif headings,
   thin borders, one blue accent, Phosphor light icons.
2. All user-facing text is English (editor, starter packs, server summaries and agent messages).
3. `packages/core` is untouched; commands, undo/redo, store, revisions and agent tools unchanged.
4. Every existing function has a place (see `docs/redesign-audit.md`); nothing removed.
5. `pnpm check` passes; browser journeys cover create, room, add, move/rotate, multi-select,
   snapping, undo/redo, 2D/3D/split, review, rules, history + restore, AI planner, report, settings.
6. Decision record 0007, README status, CLAUDE.md UI section updated.

- [x] Audit + mapping (`docs/redesign-audit.md`)
- [x] Dependencies: bundled fonts + Phosphor icons (decision 0007)
- [x] Design tokens and base styles
- [x] Editor shell: top bar, rail, left panels, workspace, inspector, status bar, toasts
- [x] Plan canvas restyle (walls, doors with swing, columns, items, rulers, zoom control)
- [x] 3D restyle + camera toolbar (orbit, top view, section, image)
- [x] Review, rules, history (preview + restore), AI Planner
- [x] Item type dialog
- [x] Projects page + create dialog
- [x] Report
- [x] Settings
- [x] English: editor messages, starter packs, server, launcher
- [x] Tests updated (unit, server, browser) + new journeys; `pnpm check`
- [x] Screenshots compared with the design; refine
- [x] Docs: decision 0007, README, CLAUDE.md, commit, push

## Done: T4 — office pack, with no change to the core

**Done means:**
1. `packages/core` is untouched (`git diff` of `packages/core` is empty for this stage).
2. An office pack beside the hall pack: an office catalog (desks, office and meeting chairs,
   meeting tables, storage, printer, whiteboard, phone booth, lounge…) and office rules for two
   styles (open-plan office, meeting room):
   - a 90 cm walkway from every seat to a door (the same general rule as halls);
   - floor area per person;
   - every desk has a chair;
   - exits and door width for the number of people.
3. Packs are one list (`PACKS`): each has a name, catalog, styles and a check. A project's pack
   is worked out from its catalog, and the person can change it in the rules panel.
4. New projects are created as a hall or an office (projects page and agent tool).
5. The rules panel, the "bring in missing items" button, the report and the agent all follow
   the project's pack.
6. Reference tests with hand-computed numbers for the office rules; a browser journey for an
   office from creation to report; `pnpm check` passes.

- [x] Starter: shared rules module, office catalog + rules, packs list, detect, new room per pack
- [x] Server: create with activity, rules per pack in get_project / check_project
- [x] Editor: projects page choice, rules panel with activity + style, missing items per pack, report
- [x] Tests, decision 0006, README, TASKS, confirm core untouched, commit, push

## Done: T3b — hall pack: catalog, hall rules, rules in the report; camera-relative arrows

**Done means:**
1. The starter catalog has 20–30 hall items with real sizes and clearances (tables of each common
   size, chairs, sofas, the bride and groom kosha, stages, dance floor, buffet, bar, DJ booth,
   screen, lectern, plants…); existing ids keep working; an existing project can bring in the
   items it is missing in one step.
2. Hall rules live in the hall pack (`packages/starter`), not in the core, for three event styles
   (banquet, theatre, classroom):
   - every seat reaches a door by a walkway at least the style's width (seats cut off are named);
   - floor area per guest;
   - number of exits for the number of guests;
   - total door width for the number of guests.
   Each rule says pass / fail / unknown with the measured and required numbers, and never
   "pass" on missing data.
3. The editor shows the rules next to the issues with a style picker; clicking a failed rule
   selects the seats involved. The report shows the rules and the chosen style.
4. Agents see the rule results in `get_project`.
5. In the 3D view the arrow keys move items relative to where the camera looks.
6. Reference tests with hand-computed numbers for every rule, a property test, browser journeys;
   `pnpm check` passes.

- [x] Hall catalog (20–30 items) + dance-floor shape + "bring in hall items" button
- [x] Hall rules module + tests (starter gets its own tests)
- [x] Editor rules panel + style choice + select failing seats
- [x] Report: rules section and style
- [x] Server: rules in get_project
- [x] 3D: arrows relative to camera
- [x] e2e, decision record 0005, README, TASKS, review, commit, push

## Done: T3a — printable client report + professional move controls (2D and 3D)

**Done means:**
1. A report page (`#/p/<id>/report`) shows, ready to print on A4: project name and date, room
   sizes, a drawn plan, a 3D picture, the headline numbers, the bill of materials (sizes, count,
   seats) and every issue in plain words. A "print" button prints it; the editor links to it.
2. Items can be raised off the floor (core: optional `elevation`, `item.elevate` command,
   height and overlap checks aware of it; old saves still open; agents get the same tool).
3. Selection: click, Shift/Ctrl-click to add or remove, box select by dragging empty floor,
   Ctrl+A, Escape. Moving, rotating and deleting work on the whole selection.
4. Mouse in 2D: smooth drag with grid snapping and smart guides (edges and centres of other
   items and walls), Shift locks to one axis, Alt drags slowly for precision, a rotation handle
   with angle snapping (Shift = free), live readout of the move; pan with the middle button,
   right button or Space+drag; wheel zooms.
5. Mouse in 3D: drag items across the floor, Shift+drag raises and lowers, click / Shift-click
   selects; the camera still orbits when dragging empty space.
6. Keyboard (both views): arrows nudge by the step (Shift = big step, Alt = fine step);
   holding an arrow speeds up and is saved as one history step; PageUp/PageDown raise and lower;
   R / Shift+R and [ ] rotate; Ctrl+D duplicates; Ctrl+C / Ctrl+V copy and paste; L locks.
7. A "precision and speed" panel: grid step, nudge / big / fine steps, angle step, raise step,
   drag speed, key repeat speed, guides on/off; remembered in the browser. A selection panel
   with exact X / Y / height / angle, move-by fields, align and distribute.
8. Every change still goes through core commands, one gesture = one revision.
9. `pnpm check` passes; new logic has reference and property tests; browser journeys cover
   the report, box select, keyboard nudge and 3D drag.

- [x] Core: `elevation`, `item.elevate`, checks, validation, tests
- [x] Server: `elevate` in agent tools; docs/agents.md
- [x] Editor logic: multi-selection session with previews, transform helpers, guides, settings
- [x] Editor 2D: selection, marquee, drag/rotate handle, guides, readout, pan buttons
- [x] Editor 3D: drag on floor, raise, multi-select
- [x] Editor: keyboard map, precision panel, selection panel
- [x] Report page + print styles + editor link
- [x] Tests (logic, e2e), decision record 0004, README, review, commit, push

## Found along the way (T4)

- The core needed no change at all: the hall rules moved into a shared rules module in the
  starter package, and the office pack is built from it.
- A planted bug showed the "shared items count for neither pack" step in pack detection could
  never change the answer (shared items count equally for both); removed.
- Not confirmed: office thresholds are common guidance, not Egyptian labour-law figures.

## Found along the way (T3b)

- A change from an agent that arrived while the editor was still saving its own edit was
  dropped until reload. The editor now fetches it once its own edits are saved.
- The walkway rule first measured reach from a seat's centre, so a big seat (the 3 × 2 m kosha)
  could never be reached. It now measures from the seat's outline (test added).
- A planted bug showed a redundant condition in the seat check; removed.
- Not confirmed: the thresholds are common guidance, not Egyptian civil-defence figures; the
  owner may want local numbers. The kosha is drawn in 3D as a plain platform.

## Found along the way (T3a)

- The core measures overlap depth as the overlap length along the best separating axis, not the
  distance to push apart; a new test first assumed the latter (kept the core's meaning).
- A planted bug in the "hung above" clearance rule and one in guide selection were not caught at
  first; tests were added for both.
- Not confirmed here: printing on a real printer (checked with the browser's A4 PDF output),
  and touchpad pinch zoom on a real laptop.

## Done: T2 — full local app (3D, projects, history, database, AI agents)

**Done means:**
1. Double-clicking `start.bat` (Windows) or `start.command` (macOS), or running `./start.sh` (Linux),
   installs what's needed, builds, starts a local server with a database, and opens the browser.
2. A projects page lists, creates, renames, duplicates and deletes projects stored in the database.
3. In a project a person can: set the room (width, depth, ceiling, doors on walls, columns),
   create and edit item types (name, sizes, clearances, seats, shape), place and edit items,
   and see the plan flat (2D), as a 3D model, or both; the 3D view can be saved as a picture.
4. Every change is a saved revision (who, what, when). The history panel shows it and can
   restore any earlier revision.
5. An AI agent can fully control the design through the same commands:
   - local coding agents (Claude Code, Codex) launched from the app with the user's
     specification, using the app's tools through MCP, changes appear live;
   - an optional API agent (Anthropic API, or any OpenAI-compatible endpoint) configured in
     settings;
   - the MCP server can also be added to the user's own Claude Code / Codex sessions.
6. `pnpm check` (typecheck, unit tests, browser tests) passes locally and in CI.

- [x] Core: room spec (rectangle, doors on walls, columns) ↔ space; `project.rename` command
- [x] Server: SQLite store (projects, revisions, settings, agent runs), HTTP API, live events
- [x] Server: agent tools (shared by MCP and API agent) + MCP stdio proxy
- [x] Server: agent runner (Claude Code / Codex templates, detection, logs, stop) + API agent loop
- [x] Editor: projects page, server sync with conflict handling, live updates from agents
- [x] Editor: room editor, item-type editor, history panel, agent panel, settings page
- [x] Editor: 3D view (models per shape, walls with door gaps, columns, selection, picture export)
- [x] One-click launchers + `scripts/start.mjs`; `.mcp.json`; agent docs
- [x] Tests: core, server (store, API, tools, MCP, runner with fake agent, API agent with fake API), browser journeys
- [x] Decision record 0003, README, CLAUDE.md, CI; review diff; commit; push

## Found along the way

- A door exactly at a room corner was read back on the wrong wall (fixed in `readRoom`).
- A saved 3D picture got the name "download" when the name was Arabic and the link was a data URL
  (fixed with a blob link; the test browser also needs a UTF-8 locale).
- The plan did not re-fit when an agent resized the room (fixed).
- Opening the browser could crash the server on machines without an opener (fixed).
- Round tables were checked as squares, so chairs around them showed false overlaps. Items now
  have an optional round footprint (core, starter catalog, agent tools, item-type form).
- Security: any website open in the same browser could have reached the local API and changed
  the agent command. The API now accepts only the app itself (host, origin and JSON checks).
- Not confirmed here: the real Claude Code and Codex command lines (not installed in this
  environment; the runner was tested with a stand-in agent) and a real API call (tested against
  a stand-in API server).

## Next

- T11: shared accounts, companies, collaboration (the master plan's multi-user chapters, designed
  around the packs built in T6–T10) — plan §7 in `docs/03-industrial-packs-plan.md`.

## Later

- Restaurant candidate-layout generation (max capacity / balanced / spacious), deferred from T10.
- A proper 3D model for the kosha (platform + couple sofa + backdrop).
