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
