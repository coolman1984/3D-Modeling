# 0005: Hall pack — catalog and hall rules

**Date:** 2026-09-25 · **Status:** accepted

## Context

Stage T3 asks for a hall pack: a real catalog, hall rules and the rules in the client report,
without putting activity knowledge into the core.

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Where | `packages/starter` (`index.ts` catalog, `hall.ts` rules), which now has its own tests | The core stays generic; the office pack (T4) will sit beside it |
| Catalog | 29 items with Arabic names, real sizes and clearances; the 8 old ids kept; `missingStarterItems` lets older projects bring in new items (one `catalog.define` batch) | Saved projects keep working; no schema change |
| Styles | Banquet (1.2 m²/guest, 90 cm walkway), theatre (0.7 m², 1 m), classroom (1.6 m², 90 cm) | Common planning guidance; shown as guidance, not approval |
| Walkway rule | Floor sampled on a 5 cm grid (coarser in very large halls), exact Euclidean distance transform, flood from each doorway through cells with room for the walkway, seat reached when a walkway cell is within W/2 + 50 cm of its outline | Handles any layout without a path-finding library; errs on the safe side by at most half a cell |
| Other rules | Floor per guest, exits (1 / 2 over 49 / 3 over 500 / 4 over 1000), door width (5 mm per guest) | Thresholds as in common building codes |
| Unknown | No seats or no doors gives "unknown", never "pass" | Core invariant carried into packs |
| Style choice | Kept per project in the browser, used by the editor and the report; agents pass `hall_style` to `check_project` | No schema change; a project-level setting can come with T5 accounts |
| Results | Rule failures are warnings: they turn the report verdict to "check", never block editing | Same "integrity vs design" split as the core |

## Consequences

- A walkway through a gap narrower than W + 5 cm may be reported as blocked (safe side).
- The style is not shared between browsers yet.
- Rule checks take about 10 ms in a 12 × 9 m hall and up to about 100 ms in a 40 × 30 m hall with 500 chairs.
