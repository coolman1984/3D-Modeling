# 0001: Core foundations

**Date:** 2026-09-25 · **Status:** accepted

## Context

The master plan describes a full platform. We start with a pure core that later UIs, servers
and activity packs can rely on without changes.

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Language and tooling | TypeScript strict, pnpm workspace, Vitest + fast-check | Same code in browser, server and tests; property tests catch geometric edge cases |
| Runtime dependencies | None | Portability, security, stability |
| Length | Integer ticks, 1 tick = 0.1 mm; all supported units are whole ticks | Save and reopen never drift |
| Angle | Integer millidegrees, counter-clockwise; right angles use exact cos/sin | Rotating by 90° never introduces float error |
| Tolerance | 0.2 mm; touching within tolerance is not an overlap | No false alarms from rounding |
| Polygon engine | Deferred. Items are rotated rectangles (convex); the room is a simple polygon | Enough for halls and offices; a clipping library can come later behind the geometry API |
| Door swing | Convex polygon of arc tangents that fully contains the true quarter circle | A blocked door is never reported as clear |
| Ids | Created outside the core, unique across all entity kinds in a project | Purity; one id space for issues and references |
| Unknown fields | Rejected on validation | Stray data never slips into save files silently |

## Deviations from `02-core-plan.md`

- `Issue` carries one `amount` (penetration depth or excess height, rounded up) instead of
  `measured` and `required`. One number answers the user's question ("how far to move it");
  `measured`/`required` fit rule-based checks and can come with the rules engine.
- Added `catalog.remove`, which the inverse of defining a new catalog entry needs.
- Undo is a new revision. `revision` only goes up, which suits sync later.
- Occupied area subtracts pairwise overlaps. This is exact unless three items share one spot,
  which `checkProject` already reports as an error. A true union waits for the polygon engine.
- Obstacles are assumed to lie inside the room when computing floor area.

## Consequences

Walls with thickness, multiple rooms, concave items and exact unions need the deferred polygon
engine, added behind the existing geometry functions.
