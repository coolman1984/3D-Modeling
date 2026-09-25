# TASKS

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

- T3b hall pack: 20–30 hall items in the starter catalog, hall rules (aisle widths, area per guest,
  guests per door), the rules' results in the report; arrows relative to the camera in 3D.

## Later

- T3 hall pack (printable report, rules) · T4 office pack · walls with thickness (C8)
