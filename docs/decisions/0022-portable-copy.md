# 0022 — Portable copy for networks that block npm

**Date:** 2026-09-29 · **Status:** accepted

## Context

The owner's company network blocks the npm registry. The one-click launcher (decision 0003)
fetches pnpm through `npx` to install and build, so it stopped there, even though the program
itself needs nothing from npm to run: the server is one bundled file, and the interface is static files.

## Decision

- `node scripts/portable.mjs [--with-data]` (`pnpm portable`) builds `release/SpacePlanner/` and
  `release/SpacePlanner-portable.zip`. They hold the bundled server and MCP bridge, the built
  interface, this machine's `node.exe` on Windows, an empty or copied `data` folder, and
  `Start Space Planner.bat` (plus `start.sh`). The start file uses the bundled Node when present.
  It passes `--static` and `--data` so the copy runs from any folder. No internet, no install.
- The launcher falls back to the build that is already there when installing or building fails,
  and names the portable copy when there is no build.
- `release/` is not committed. Only standard-library Node is used; `tar` (Windows 10+, macOS) makes the zip.

## Consequences

- The zip is about 36 MB, mostly Node.js. The copy carries the Node version of the machine that
  made it (22.13 or newer is needed for the built-in SQLite).
- A portable copy does not update itself. A newer version is a new zip, and the `data` folder is
  copied across to keep the projects.
