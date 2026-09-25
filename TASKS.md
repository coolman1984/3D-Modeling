# TASKS

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
- Not confirmed here: the real Claude Code and Codex command lines (not installed in this
  environment; the runner was tested with a stand-in agent) and a real API call (tested against
  a stand-in API server).

## Next

- T3 hall pack: printable client report (plan, 3D picture, bill of materials, issues), hall rules.

## Later

- T3 hall pack (printable report, rules) · T4 office pack · walls with thickness (C8)
