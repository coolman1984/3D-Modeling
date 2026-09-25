# 0003: Local app with database, history and AI agents

**Date:** 2026-09-25 · **Status:** accepted

## Context

The owner wants a full local app: several projects, a database, a history of every change,
a 3D view for clients, and AI agents (Claude Code, Codex, or an API) that can design on their
own from a written specification. It must start from one file.

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Server | `apps/server`: Node's own `http`, bundled with esbuild into `dist/server.mjs` and `dist/mcp.mjs` | No framework needed for a local API; one file to run |
| Database | SQLite through Node's built-in `node:sqlite` (Node ≥ 22.13) | No native module to compile on the owner's machine; one file `data/planner.db` |
| History | Every accepted change is a revision row: actor, summary, commands, full snapshot | Simple, robust restore; any version can be brought back as a new revision |
| Concurrency | Editor sends each command with its base revision; the server answers 409 on a stale base and the editor reloads | Person and agent can work on the same project without overwriting each other |
| Live updates | Server-sent events (`/api/events`) | One-way push is all the editor needs |
| Agent tools | One tool set in the server (`tools.ts`), shared by MCP and the API agent | One path, one history; tools speak metres and cm, raw commands stay available |
| Coding agents | Launched as local programs from editable command templates, prompt on stdin, MCP bridge over stdio | Works with Claude Code and Codex without an API key; templates can follow CLI changes |
| API agent | Anthropic SDK manual tool loop (`claude-opus-5` by default, adaptive thinking, server-side refusal fallback) or any OpenAI-compatible endpoint | Optional path for people who prefer an API key |
| Starter catalog | `packages/starter` (catalog, 3D shape keys, room templates) | Keeps activity knowledge out of the core |
| 3D | three.js, simple procedural models per shape, walls with door gaps, picture export | Good-looking enough for clients; no model files to ship |
| Security | Loopback only; Host must be loopback, a browser Origin must be the app, changes must be JSON | The API can start programs (agents); other websites and DNS rebinding must not reach it |
| Round items | Optional `footprint: 'round'` on item types (ellipse polygon that contains the true curve) | Chairs around round tables must not raise false overlaps; optional field keeps old files valid |
| Launch | `start.bat` / `start.command` / `start.sh` → `scripts/start.mjs` (installs, builds when sources changed, runs, opens the browser) | One click, standard library only |

## Consequences

- The API key is stored in plain form in the local database; fine for a single-user local app,
  not for a shared server.
- The default Claude Code / Codex command lines follow their current CLIs; if a CLI changes its
  flags, the owner edits the command in Settings instead of waiting for a release.
- Snapshots per revision grow the database for very large projects; pruning can come later.
