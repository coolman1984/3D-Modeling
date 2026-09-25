# 0009: Derived spatial index and instanced 3D

**Date:** 2026-09-25 · **Status:** accepted

## Context

Checks compared every item with every other item, and the 3D view built one group of meshes with
its own geometry and materials per item. Warehouses and factories hold thousands of repeated items.

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Index | `gridIndex(boxes)` in `packages/core/src/geometry/grid.ts`: a uniform grid over bounding boxes, cell = median box size; boxes covering more than 64 cells go to a short "large" list; queries return ascending indices | Pure, deterministic, no dependency, fits items of similar size (pallets, chairs, desks). An R-tree (RBush-style) stays possible behind the same `SpatialIndex` interface |
| Authority | The index is built inside `checkProject` / `measureProject` from the project and thrown away; never saved | A cache must never become truth |
| Verification | `checkProject(p, { spatialIndex: false })` keeps the all-pairs path; a property test asserts both give identical issues, another that grid queries equal a full scan | The fast path is proven against the simple one |
| Benchmark | `pnpm --filter @space-planner/core bench` (pallet floor, rows of 50, every 37th pallet nudged into its neighbour) | Measured, not guessed |
| 3D | Items of the same type, orientation and state share one model; each of its meshes becomes an `InstancedMesh`; `userData.itemIds[instanceId]` maps picks back to items | Draw calls and memory grow with the number of types, not items |
| three-mesh-bvh | Not added yet | Procedural boxes pick fast enough; revisit with imported models (T8+) |

## Measurements (this container, Node 22, median of runs)

| Pallets | All pairs | Grid | Speed-up |
|---|---|---|---|
| 1 000 | 70 ms | 34 ms | 2× |
| 5 000 | 1 153 ms | 108 ms | 11× |
| 20 000 | 14 574 ms | 544 ms | 27× |

Issues found are identical in every case (27, 133 and 530).

Editor, 5 000 items (2 500 chairs, 2 500 drawer units), software WebGL: switching to 3D took
10.7 s before T5 and 4.9 s after (index + instancing together).

## Consequences

- Remaining cost at 20 000 items is building polygons for every item; incremental checks (only
  what changed) are the next step if large warehouses need faster feedback while dragging.
- Placing 5 000 items through the agent tool takes about 8 s on the server; the tool path
  (`nextId` over all ids per item, pack rules on each commit) is the next hotspot to measure.
