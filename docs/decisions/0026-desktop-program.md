# 0026 — Desktop program with a Windows installer

**Date:** 2026-10-06 · **Status:** accepted

## Context

The owner asked for the program to run on its own, without a browser, installed from an `.exe`
like any other program. Until now it ran as a local server shown in the browser (decisions 0003
and 0022).

## Decision

- New package `apps/desktop`: an Electron shell (`main.cjs`). It starts the same bundled server
  with Electron's own Node (`ELECTRON_RUN_AS_NODE=1`; Electron 44 carries Node 24 with the
  built-in SQLite), reads the address from the server's start line and shows it in one window.
  No server code is forked; the server only gains `--stop-with-stdin`, so closing the window
  closes the store cleanly (Windows cannot send a child SIGTERM). Quitting waits up to 3 s for
  that, then ends the server.
- Projects live in the user's profile (`%APPDATA%\Atrium\data` on Windows), so reinstalling or
  updating keeps them. Uninstalling does not delete them. File → Open projects folder shows them.
- The window opens at once on a small waiting page, then shows the program. The server is asked
  for port 4650 when it is free (the window keeps display settings per address, so a steady port
  keeps them); otherwise it finds one from 4600 up.
- Bringing projects over (`projects.cjs`): on the first start with no projects the program asks
  once whether to bring the projects of the browser version, and File → Bring projects from
  another copy does it any time. The chosen `planner.db` is copied with `VACUUM INTO` (consistent
  even while the other copy is running, `-wal` included) and integrity-checked while the program
  keeps running; only then is the server stopped, the projects here moved to
  `backups/before-import-<time>.db`, the copy put in place (rolled back if that fails) and the
  server started again. If the server cannot start on the brought file (say, from a newer
  version), it is set aside as `backups/refused-<time>.db` and the projects that were here return. It replaces rather than merges: ids could clash, and a whole-file swap is
  easy to undo. Other files are refused with a plain message and nothing changes.
- Problems are told in plain words; the technical output goes to `last-problem.log` next to the
  projects folder. Only the program's own pages may ask for permissions.
- One window per computer: a second start brings the open window forward. Links to other sites
  open in the normal browser; only the program's own pages stay in the window.
- `electron-builder` makes an NSIS installer (`Atrium-Setup-<version>.exe`): per user, no admin
  rights, chosen folder, desktop and Start menu shortcuts. `pnpm desktop` builds it on Windows.
- Building the Windows installer needs Windows (on Linux it needs Wine), and the owner's network
  blocks npm, so the workflow `.github/workflows/desktop.yml` builds it on a Windows runner,
  installs it silently, starts the installed program and checks that it answers, then keeps the
  installer as a download on the run. A `v*` tag also attaches it to a release.
- Electron and electron-builder are development dependencies of `apps/desktop` only; their
  install scripts stay off (`allowBuilds`), so `pnpm install` does not download Electron.
  electron-builder downloads it when packaging. Run `node node_modules/electron/install.js`
  inside `apps/desktop` once before `pnpm --filter @space-planner/desktop start`.

## Consequences

- The installer is about 100 MB (Chromium and Node inside). The browser start files and the
  portable copy keep working unchanged.
- The installer is not code-signed: Windows SmartScreen shows "Windows protected your PC" the
  first time (More info → Run anyway). Signing needs a paid certificate; that is the owner's call.
- No automatic updates yet: a newer version is a new installer run over the old one; the projects stay.
- The desktop and browser versions keep separate project folders; bringing projects copies them
  once, after which the two copies go their own ways.
- Verified: a script drives the packaged program (Playwright's Electron driver, dialogs stubbed
  in the main process) through the first start, the welcome import from a running browser
  version, opening a project, a refused file, a second import with backup, closing (no process,
  no `-wal`) and a second start. The Windows workflow installs, starts, checks the answer and that
  nothing stays running after the window is ended abruptly.
