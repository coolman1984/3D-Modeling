# 0011 — Warehouse spatial foundation (T7 in progress)

## Context

The first warehouse must work inside Atrium rather than becoming a separate app. Existing hall
walkway rasterisation already proves scanline painting and exact distance to obstacles. Warehouse
routing needs the same floor calculation plus mover-width clearance and a reconstructable path.

## Decision

- Put reusable raster and shortest-path routing in `packages/industry`; hall uses the shared
  raster functions. A route is derived, uses 20 cm cells, eight directions and forbids corner
  cutting. Its returned distance is a cell-centre planning approximation, not a measured vehicle
  path. Dijkstra's algorithm gives deterministic shortest grid paths without an extra heuristic.
- Add optional geometry-only `Space.zones` and door metadata in core schema 2. Warehouse meanings
  (receiving, shipping, pedestrian and no-go) belong to the warehouse pack. Version 1 saves are
  migrated to version 2 without deleting or reinterpreting their layout data.
- Store one rack row as one item of a parametric rack type. Bay, level and position addresses are
  derived, not stored as thousands of pieces. Editing a shared type in the inspector creates a
  separate definition for that row through an atomic command batch.
- Use rack/dock/zone planning rules with source types `engineering`, `company-policy` and
  `common-guidance`; no rule claims regulatory approval. A missing rack, door or zone yields
  `unknown`. Zone footprints, forklift route and 3D parts are visual/derived data; the saved
  geometry and commands remain authoritative.

## Evidence and limits

The 30 × 20 × 8 m reference has five rows × six bays × four levels × two positions = 240
locations. Unit tests cover a hand-calculated six-metre detour, blocked diagonals, narrow
aisles, a restricted-zone conflict, addressability, save migration and agent revisions. A scale
test derives 5,280 positions from 110 rows; on this workspace its combined metrics, core check
and one route case took 89 ms in the verbose test run (not a browser frame-time measurement).
A deliberate corner-cutting bug made two routing
tests fail and was then restored. Typecheck and unit suites pass.

The browser journey was written but could not run: this environment has no Chromium binary and
the attempted Playwright download returned a truncated ZIP. 3D frame rate, browser interaction,
report pagination and the full `pnpm check` remain unverified. T7 stays in progress. Pallet
occupancy is spatial planning only; throughput and turning-radius vehicle geometry are later
work, and no local regulations have been verified.

## Update — browser verification, a corrupted build file, and a routing performance bug

Chromium became available in this workspace. `pnpm check` (typecheck, all unit suites, all 14
browser journeys including `warehouse.spec.ts`) now runs end to end and passes.

Two real defects turned up during that verification, both now fixed:

1. **`apps/editor/src/styles.css` had been overwritten with 60 KB of non-text binary data** in
   the T7 foundation commit, which broke the editor build completely (container pack included,
   not just warehouse). Restored from the last good T6 commit and added the warehouse-panel rules
   that were missing from it (`.warehouse-panel`, `.warehouse-big`, `.warehouse-route`,
   `.warehouse-zone-fields`), plus a rack-capacity inspector fix: its six `CommitField`s used
   inset labels ("Positions", "Bay width", …) too long for the default 28 px label slot, so the
   label text and the typed number overlapped. Fixed by giving each field the existing `wideKey`
   treatment and its own full-width row, matching the `Ceiling` field's precedent in `RoomPanel`.
2. **`checkWarehouse`'s reachability check ran one full-grid Dijkstra search per (dock, rack,
   access-face) triple** — up to `docks × racks × 4` searches, each over the whole derived floor
   raster. At 100 rack rows and 2 docks on a 200 × 20 m floor (200 × 120 m room used for the
   scale check) that is up to 800 searches over a ~600,000-cell grid: 24–39 s measured through the
   real server, confirmed twice against freshly built code before the fix and reverted-and-rebuilt
   afterward for a controlled comparison. The existing 110-row scale test in
   `warehouse.test.ts` did not catch this because it only called `warehouseRoute` for a single
   route, never the bulk `checkWarehouse` path the server's `check_project` tool actually uses.
   Fixed by adding `reachabilityFrom`/`distanceAt` to `packages/industry`: one flood-fill search
   per dock (not per rack or per face) answers every rack's reachability from that dock, cut from
   a shared internal Dijkstra core also used by the unchanged `findRoute`. `checkWarehouse` now
   runs one search per dock (2 instead of up to 800) and looks up each rack's four access points
   in the resulting distance field. Same server, same project, same code path: 380 ms after the
   fix, a wall-clock check confirmed on both a fresh project and one with prior edits.
   `findRoute`'s own algorithm and its existing tests are unchanged; a new exhaustive test checks
   `reachabilityFrom`/`distanceAt` agree with `findRoute` at every cell of an obstructed room, and
   a dense 100-row regression test (which fails at ~24 s against the unfixed code, confirmed by a
   deliberate revert-and-rebuild) guards the server-visible path specifically, not just the core
   checks.

Both fixes are covered by tests that fail without them and pass with them (verified by reverting
each fix, rebuilding, and rerunning). T7's remaining gate is a last visual/usability pass and the
100-rack/5,000-element interaction and 3D scale numbers, tracked in `TASKS.md`.
