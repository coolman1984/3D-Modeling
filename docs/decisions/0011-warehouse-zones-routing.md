# 0011: Warehouse pack, zones in the core, shared routing package

**Date:** 2026-09-25 · **Status:** accepted

## Context

T7 (plan §7): a warehouse layout activity. It is the first pack that needs named floor areas
(docks, staging, no-go lanes) and travel over the floor by a mover of a given width. The hall's
walkway rule already had a floor raster and an exact distance transform, private to one rule.

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Zones | Core `Space.zones?: Zone[]` — `{ id, kind, name?, polygon, meta? }`. `kind` is a free tag (1–64 chars) the core never interprets; ids share the project's id space; an empty list is rejected (store none); at most 500. Zones block nothing in `checkProject` | Universal concept (restaurant, factory and depot need it too); meaning stays in packs. Optional and stored only when set, so no schema bump and old saves stay byte-identical |
| Room edits | `keepPackData(previous, next)` in the core: room editors (editor Space panel, `set_room`) keep `meta` and `zones` | Rebuilding walls must not drop a warehouse's docks or a container's payload |
| Routing | New `packages/industry` (pure TS, depends only on core): `floorGrid`, `paintPolygon`, `distanceToBlocked` (Felzenszwalb–Huttenlocher, exact), `reachable` (4-connected flood), `travelField` (Dijkstra, 8 directions, no corner cutting, ties by cell index), `routeTo`. The hall walkway rule now uses it with identical results | One shared layer for warehouse, factory, restaurant; a second real user justified extracting it |
| Rack model | One bay = one item of category `rack`; type `meta`: `rack: 'pallet'`, levels (floor included), positions per level, levelHeight, positionLoad (g). Height = levels × levelHeight. The front (local +y) is where pallets go in | Rows can be shortened, split and moved with ordinary commands; the core needs no rack concept; instancing makes thousands of bays cheap |
| Row generator | `rackRows` returns `item.add` commands only: rows run east, alternating so backs meet at a flue and fronts face across an aisle | Same command path for people and agents; one revision per generation |
| Truck | Project data `space.meta.truck` (counterbalance / reach / VNA profiles: lane width, working aisle, max lift — manufacturers' typical figures, labelled as guidance). The pack has one style | People and agents must check against the same truck; changing it is an undoable revision |
| Rules | aisle width (exact free distance in front of every bay face to the nearest wall, column or item; local frame, edge clipping, spatial index first within 5 m, then out to the wall), lift height (top beam ≤ truck lift), ceiling clearance (45 cm, common fire-code guidance), rack access (truck lane from any dock cell — or door when there is no dock — to a service point half a truck in front of each face; no-go zones blocked), docks ≥ 1. No racks / no ceiling / nowhere to start → unknown | Each names its source; nothing is presented as a regulation |
| Metrics | bays, pallet locations (racks + floor pallets), rack capacity, storage share of floor and volume, zone areas by kind, docks, drive from dock to face (average and farthest) | Capacity first: the number a warehouse owner compares |
| UI | Racks panel (truck, capacity, row generator, zones editor), rack inspector (locations, top beam, aisle in front, drive from a dock), truck route drawn on the plan, zones on plan / 3D / report, procedural rack model (uprights, beams, loaded pallets) instanced per type, report cover with capacity | Same Atrium shell as every pack |

## Consequences

- 2,000 bays: rules ≈ 0.25 s, metrics ≈ 0.65 s (Dijkstra over up to 1.5 M cells). Fine for an
  interactive panel; a 20,000-bay campus would need a coarser travel grid.
- Routes run on a 10 cm grid in eight directions: lengths are a close upper bound of the true
  shortest drive (at most ~8% longer on a diagonal), never shorter.
- Not modelled yet: floor slab load, beam deflection, sprinkler layout, one-way aisles, turning
  of long loads at aisle ends (T9 swept paths will cover vehicles), pick-path optimisation
  (`slot_pallets` belongs to a later optimiser behind `OptimizationPort`).
- Zones are rectangles in the editor and agent tools; the core accepts any simple polygon.
