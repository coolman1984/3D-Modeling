# 0015: Restaurant pack

**Date:** 2026-09-25 · **Status:** accepted

## Context

T10 (plan §7): table families (2/4/6-top, round, booth, banquette, communal), dining / bar /
terrace / private zones, covers, floor per cover, service routes from the pass to tables (shared
routing), unreachable tables, clearance rules, candidate layouts (max capacity / balanced /
spacious).

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Table families | One item per table with its chairs drawn in (`seats` = covers, category `table-set`, round families use the round footprint); chair pull-out room is the core clearance on the chair sides | Covers and layouts work on whole tables; the core's overlap and clearance checks apply unchanged |
| Pass | An item whose type has `meta.pass`; servers start from its front | No core concept; any counter can be the pass |
| Zones | `dining`, `bar`, `terrace`, `private` (core zones); floor per cover counts these zones, or the whole floor when there are none | Guests sit in those areas; kitchens and stores do not count |
| Styles | Casual (1.3 m² per cover, 90 cm aisles), fine dining (1.8, 120 cm), quick service (1.0, 90 cm): common planning guidance | Shown as guidance with its source |
| Routing | The hall's walkway search generalised: `routesToItems(project, width, ids, startCells, measure)` — flood for reachability (hall, unchanged results) or Dijkstra for distances (service walks); start cells from doors (`doorStarts`) or the pass (`passStarts`) | One routing path for guests and servers |
| Rules | Guest walkway to a door (the hall's rule, 90 cm), service route from the pass to every table (style width), floor per cover, exits and door width (shared egress rules) | A busy layout that passes service still fails exits when 50 or more guests have one door — the rule says so |
| Layouts | `restaurantLayouts` (`OptimizationPort`): rows of one family across a zone with the style's aisle × 1, 1.35 and 1.8, skipping spots that clash with walls, columns, door swings or items (with clearances), then dropping tables no server can reach. Deterministic; proposes commands, never applies them | Same pattern as the container packer: the tool computes, the person chooses |
| UI | Dining panel (covers, floor per cover, walks from the pass, unreachable tables, layout proposals to apply, zones), table-with-chairs 3D model, report cover; the zone editor is shared with the warehouse | Same Atrium shell |

## Consequences

- Hand-checked: a 20 × 14 m room with a 180 m² dining zone takes 23 / 20 / 12 four-tops (92 / 80 /
  48 covers); a table straight in front of the pass is a 2.2 m walk.
- Layouts use one family and a straight grid; mixed families, angled rows and booths along walls
  are for a later optimiser behind the same port.
- Kitchen equipment and back-of-house flows are not modelled (the production line pack could
  describe a kitchen line later).
