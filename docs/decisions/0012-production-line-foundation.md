# 0012 — Production line spatial foundation (T8)

## Context

T8 is the fourth industrial pack (after container and warehouse). The plan calls for machines
with operating/maintenance clearance, input/output points, stations, buffers, sources, sinks,
flow relations as directed paths, flow length and crossings — spatial feasibility only, with
throughput simulation deferred to a later stage.

## Decision

- **A station needs no new geometry.** It is a plain `category: 'box'` item, exactly like a
  container piece. "Operating clearance" and "maintenance clearance" are the item's own existing
  `clearance.front` and `clearance.back` — the core already checks clearance overlaps for every
  item, so this is a domain meaning for two fields that already exist, not a new rule or shape.
  No change to `packages/core`, and no new 3D geometry in `View3D.tsx`.
- **Flow order is `item.meta.step`**, the same field container pieces already use for loading
  order. `stepOf` is imported from `container.ts` rather than reimplemented.
- **The point material enters and leaves a station is derived from its rotation** (the same
  "+Y is front" convention every item already has): input is behind the item, output in front of
  it, cleared of the station's own footprint by the mover's half-width plus a fixed gap — the
  same margin `warehouseRoute`'s rack access points use. The first version of this left the
  mover's half-width out of the gap entirely; every route in the reference line came back
  `blocked-start`/`blocked-destination` because the point sat only one grid cell from the
  station's own body, short of the ~3-cell clearance a 1 m-wide mover needs. The hand-calculated
  test in `production.test.ts` caught this on the first run (0 of 5 segments reachable) before
  the fix, and confirmed 5 of 5 and an exact 2.8 m gap after it — the kind of test failure
  CLAUDE.md's workflow expects rather than a bug found later at scale.
- **The route between two consecutive stations is one `findRoute` call.** A production line is a
  short sequence (N stations, N−1 pairs), not an all-pairs problem, so decision 0011's lesson
  (one search per source, not one per pair) is applied as a design constraint from the start:
  `checkProduction` and `productionMetrics` each do exactly one search per consecutive pair, never
  a search per station per candidate face. A 20-station line (19 segments) checks in well under a
  second in the test suite.
- **Flow length is a sum, crossings are not a rule.** Flow length is the sum of the reachable
  consecutive-segment distances. Crossings between flow segments are left as a metric to compute
  later if needed, not a pass/fail rule — a planner may accept a crossing a code check cannot
  judge, unlike a rack outside the building or an unreachable station.
- **Rules:** `machine-boundary` (every station fits inside the floor, mirroring `rack-boundary`)
  and `flow-reachability` (a material handler can travel from each station to the next),
  provenance `engineering`, `unknown` for no stations or a single station.
- **No dedicated add-machine tool.** Racks got `add_warehouse_rack` because a rack is parametric
  (bay/level/position counts must stay consistent with its derived capacity). A station is not
  parametric — it is placed with the existing generic `define_item`/`place_items` tools, same as
  any hall or office item. One new tool, `production_metrics`, mirrors `warehouse_metrics` for
  agent visibility; `create_project` gained a `production` activity with a `reference` flag,
  mirroring the warehouse reference layout.

## Evidence and limits

The 30 × 8 m reference line (source → machine A → buffer → machine B → inspection → finished
goods) has an 8.8 m flow length and passes both rules. `production.test.ts` covers: the full
reference line (structure, metrics, rules, save round-trip), one hand-calculated 2.8 m segment on
the 20 cm grid (verified against the actual stored flow points, not just the formula), a
boundary-violation and single-station-unknown case, and a 20-station line for the reachability
performance guard. Browser journey (`production.spec.ts`) covers creating the reference line,
reading the flow length, editing one station's flow order through the Properties panel (with the
same rack-field label-overlap bug from decision 0011 found and fixed here for the new "Order"
field before it shipped), the Review panel, 3D, and the client report. Typecheck, all unit suites,
and all 15 browser journeys pass together.

Spatial feasibility only: no throughput, WIP, blocking or starvation simulation in this stage —
that is `SimulationPort`, later work, only after spatial flow is proven correct. Buffers report a
capacity number but are not a queueing model. Crossings are not yet computed or shown. No vehicle
kinematics (that is T9).
