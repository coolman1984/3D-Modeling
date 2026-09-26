# Industrial packs plan

**Version 1, 25 September 2026.** Extends `01-master-plan.md` (long-term direction) and
`02-core-plan.md` (the pure core). Neither is replaced; see "What changed" below.

The product stays **a fast spatial decision platform**. It answers: will it fit, will it work,
can people / materials / vehicles reach it, what capacity do I get, where are the conflicts,
which alternative is better. It does not become CAD, BIM authoring, a WMS, an MES or a POS.

---

## 1. What changed, and why

| | Before | Now |
|---|---|---|
| Next stage | T5: shared server and accounts | T5: shared industrial spatial foundation |
| Pack order | Halls → offices → warehouses (later) | Halls, offices (done) → **container loading → warehouse → production line → vehicle depot → restaurant** |
| Accounts / companies | Next | T11, after the industrial engine is proven |

**Why:** the commercial priority moved to industrial customers, and nothing in the account work is a
technical dependency of the packs (the local app already stores projects, revisions and agent runs).
Proving the spatial engine on the hardest cases first also de-risks the multi-user platform: its data
model will be designed around packs that exist.

**What remains valid:** everything in the core invariants (pure, integer, immutable, commands,
reversible, integrity vs design, unknown ≠ pass, packs outside the core, saves forever,
deterministic), one command path for people and agents, one revision per accepted change,
2D and 3D from the same state. The master plan's multi-tenant, embedding and licensing chapters stay
the destination for T11+.

**Completed history is unchanged:** C0–C7 (core), T1 (2D editor), T2 (local app), T3a (report and
controls), T3b (hall pack), T4 (office pack), R1 (Atrium redesign, English UI).

---

## 2. Research notes and licences

Studied for ideas; no code copied. Clean-room implementations of published algorithms.

| Project / source | Licence | What we take (ideas only) |
|---|---|---|
| That Open Engine (`@thatopen/components`) | MIT | Viewer capabilities as independent components in a registry (`components.get(Tool)`), each disposable; worlds = scene + camera + renderer. → our viewer "tools" plan (§9) |
| OpenPlan3D | MIT | One project model feeding 2D and 3D; import/export as edges of the model. Confirms our direction |
| three-mesh-bvh | MIT | BVH-accelerated raycast for picking in large scenes. Candidate runtime dependency for the editor only (never the core) once scenes exceed what instancing + simple raycast handles |
| RBush / Flatbush | MIT / ISC | R-tree and packed static R-tree ideas. We start with a uniform grid (§5); an R-tree stays an option behind the same interface |
| Google OR-Tools | Apache-2.0 | CP-SAT / routing as a possible *external* solver behind `OptimizationPort` for slotting and assignment. Not bundled (native, large) |
| OMPL | BSD-3 | Sampling planners for later, hard vehicle cases. First version uses analytic Dubins / Reeds-Shepp curves |
| xflp (3D loading) | MIT | Domain model: items with weight, bearing capacity, stacking groups, loading/unloading stops (LIFO), construction by **extreme points**, improvement by GRASP (swap / relocate) |
| Crainic, Perboli, Tadei 2008, *Extreme Point-Based Heuristics for 3D Bin Packing* (INFORMS JoC) | Paper | Extreme-point placement rule; sorting by volume / height / area; handles fixed items and support constraints |
| Dubins 1957; Reeds & Shepp 1990 | Papers | Shortest forward-only / forward-and-reverse paths with a minimum turning radius |
| Polygon clipping libraries (polygon-clipping MIT, Clipper2 BSL-1.0) | MIT / BSL | Candidates behind `GeometryPort` when union/offset/difference are needed (T7+). Never leak their types into project state |
| Discrete-event simulation (SimPy-style process/queue models) | — | Shape of a later `SimulationPort`: stations, buffers, queues, events; a small TypeScript event loop first, no Python in the one-click install |

Licence rule: MIT / ISC / BSD / Apache-2.0 / BSL-1.0 dependencies are acceptable with a decision
record; copyleft (GPL/LGPL) code is not copied or bundled.

---

## 3. One core, shared capabilities, specialised packs

```
packages/core        pure data + geometry + commands + checks + metrics + save format
                     (+ derived spatial index; + a few universal physical fields)
packages/starter     activity packs: hall, office, container, (warehouse, factory, depot, restaurant)
                     each = catalog + styles + rule profile + pack checks + metrics + generators
packages/industry    shared industrial capabilities, created only when a second pack needs them:
                     routing (graph / grid A*, vehicle kinematics), optimisation and simulation ports
apps/server          store, HTTP, agent tools (pack tools registered per pack)
apps/editor          one Atrium shell; packs add inspector sections, library families, 3D families
```

### Concept placement

| Concept | Where | Why |
|---|---|---|
| Mass of an item type | **core** (`ItemDefinition.mass`, grams) | Universal physics; container weight limits, rack capacity, floor load, vehicle loads all need it |
| Orientation (which side is up) | **core** (`ItemInstance.tilt`) | Universal 3D fact: a box can lie on its side. Changes the occupied box, so the core's checks must know it |
| Pack data on types / items (stackable, max load on top, destination, loading step, priority, fragility, cycle time…) | **core stores, packs interpret** (`meta`: string / number / boolean map) | The core validates only the shape; meaning stays in packs (no activity knowledge in the core) |
| Spatial index | **core**, derived, never saved | Needed by every check on large projects; pure and deterministic |
| Zone (named polygon) | core `Space.zones` **at T7**, kind is a free tag | Warehouse is the first pack that needs it; not added before |
| Route / path / flow / connection | `packages/industry` at T7 | Shared by warehouse, factory, depot, restaurant with different movement profiles |
| Vehicle profile, swept envelope | `packages/industry` at T9 | Kinematics shared by forklift (later) and road vehicles |
| Rack, bay, level, slot | warehouse pack | Parametric generator of items; only its meaning is warehouse-specific |
| Container, cargo, stacking group, load order | container pack | Pack rules over core items |
| Machine, station, buffer, conveyor | factory pack | |
| Table families, covers | restaurant pack | |
| Scenario / variant | **server + store** at T6/T7 (projects linked as variants of one base) | Comparison is a product feature, not core geometry |
| Rule profile with provenance | starter (shared rule module) | Thresholds are pack knowledge; provenance is how we avoid presenting guidance as law |

---

## 4. Rule provenance

Every pack threshold carries:

```ts
interface RuleSource {
  readonly kind: 'engineering' | 'company-policy' | 'common-guidance' | 'verified-regulation';
  readonly title: string;          // "Common hall planning guidance"
  readonly jurisdiction?: string;  // "EG", "EU", …
  readonly version?: string;
  readonly effective?: string;     // ISO date
  readonly ruleSet: string;        // stable id, e.g. "starter.hall.v1"
}
```

Nothing ships as `verified-regulation` until a person verifies it. Missing or unverified data is
reported as **unknown**, never pass. Profiles are data, so a company can supply its own values later.

---

## 5. Spatial index (T5)

- `SpatialIndex` interface in the core: `query(box) → candidate indices` in ascending order.
- First implementation: **uniform grid** over item bounding boxes, cell size from the median item
  size (clamped), so tables and pallets land in few cells. Deterministic, no floating state.
- Checks use it for item↔item overlap and clearance; exact geometry decides as before. The results
  must be **identical** to the all-pairs version (property test compares both).
- Benchmarks (`pnpm --filter @space-planner/core bench`): 1 000, 5 000 and 20 000 repeated items,
  before and after. An R-tree is added only if the grid measures poorly on real layouts.

## 6. 3D performance (T5)

- One shared geometry + material per (shape, size, colour state); items of one type render as a
  `THREE.InstancedMesh`. Selection / issue tint via per-instance colour, not cloned materials.
- Picking maps `instanceId` back to the item id. three-mesh-bvh is evaluated when imported models
  arrive (T8+); procedural boxes do not need it.
- The planning footprint/volume (core) is authoritative; the pretty model never decides feasibility.

---

## 7. Stages

Each stage has a done definition; shared abstractions are extracted only when a second pack needs them.

### T5 — Shared industrial foundation
Done means:
1. Derived grid spatial index in the core; checks use it; identical results to all-pairs
   (property test); benchmark at 1k / 5k / 20k items with before/after numbers recorded.
2. Universal optional fields: `ItemDefinition.mass` (grams), `ItemInstance.tilt` (which local axis
   is up), `meta` on types and items; validation, commands (`item.tilt`, `item.meta`), checks
   and metrics (total mass, centre of mass) aware of them; old saves open byte-identical.
3. Rule sources with provenance on every starter rule; reports show the source kind.
4. 3D view renders repeated items with instancing; picking still works; selection and issue tint.
5. `OptimizationPort` type: an optimiser proposes commands / a candidate project, never mutates.

### T6 — Container loading MVP
Done means (from the brief): container project with configurable container types (20′, 40′,
40′ HC, 45′ HC, reefer, truck trailer, custom), cargo types with quantity, mass, allowed orientations,
stackability, maximum load on top, fragility, destination / stop, loading priority; manual true-3D
placement with snap to floor / top of box; stacking; collision, bounds, height, weight, support and
load-on-top validation; volume / floor utilisation, weight, centre of mass; load order and
unloading (LIFO) feasibility; unpacked items; deterministic packing heuristic (extreme points,
first-fit decreasing) behind `OptimizationPort` returning candidates; cutaway 3D (roof off, side wall
off), colour by destination / weight / sequence, numbered load order, sequence playback; report;
agent tools to read / check / edit / pack; tests (reference cases, property tests, journey).

### T7 — Warehouse MVP
Parametric racks (bays × levels × positions), rows, aisles, docks, staging / picking / no-go zones
(`Space.zones`), forklift profile, grid A* reachability and route length, capacity metrics
(locations, pallet capacity, floor and cube utilisation), aisle-width rules with provenance,
instanced racks and pallets, report, agent tools. Introduces `packages/industry` (routing).

**Implementation checkpoint (done — see decision 0011):** the warehouse pack, reference warehouse,
parametric rows, named zones, dock roles, 2D/3D route display, source-labelled rules, report and
high-level agent tools are implemented, browser-tested and checked at 100-rack/4,800-position
scale. Movement uses deterministic grid Dijkstra, not A*: for a single pair and these planning
grids it is simple to inspect, while still finding the shortest permitted sampled route. Bulk
reachability (every rack from every dock, for the `rack-access`/`dock-access` rules) uses one
flood-fill search per dock rather than one search per rack — the difference between ~380 ms and
tens of seconds once a warehouse has 100 rows. The grid is derived at 20 cm cells; it does not
model turning radii, swept envelopes or site code compliance. Structural storage capacity is
distinct from actual stock occupancy.

### T8 — Production line MVP
Machines with operating / maintenance clearance, operator side, input / output points, stations,
buffers, conveyors, sources, sinks, flow relations drawn as directed paths, flow length and
crossings; spatial feasibility separate from operation. `SimulationPort` with a small deterministic
TypeScript discrete-event simulator (throughput, WIP, blocking, starvation) as an optional tool —
later work, after spatial flow is correct; this stage stops at spatial feasibility.

**Model (smallest correct one, reusing T5–T7 rather than inventing new geometry):**
A station (source, machine, buffer, inspection or sink) is a plain item whose `category` is
`'box'`, exactly like container cargo — no new 3D geometry required for the MVP. Its "operating
clearance" and "maintenance clearance" are the item's own existing `clearance.front` and
`clearance.back`: the core already checks clearance overlaps for every item, so this needs no new
rule at all, just a domain meaning for two fields that already exist. Flow order is
`item.meta.step` (the same field a container piece's loading order already uses, via the existing
`stepOf`, not a new one). The point material enters and leaves a station is derived from its rotation (same "+Y is front"
convention every item already has): input is behind the item, output in front of it. The route
between two consecutive stations is one `packages/industry` `findRoute` call between those two
points — a production line is a short sequence, not an all-pairs problem, so the decision 0011
lesson (one search per source, not one per pair) is a design constraint from the start here, not a
fix applied after measuring a regression. Flow length is the sum of the consecutive segment
distances; crossings (if any straight I/O segment crosses another) are a metric to report, not a
pass/fail rule, since a planner may accept a crossing a code check cannot judge. Rules: a station
fits inside the room boundary, and each consecutive pair is reachable for a material-handler
movement profile — both with rule provenance, `unknown` when a line has no stations or is a single
station. Buffers are ordinary stations with a `meta.capacity`, reported in metrics, not modelled as
a queueing system in this stage.

**Implementation checkpoint (done — see decision 0012):** the production pack, reference line,
flow order/route/length, both rules, the editor panel and inspector group, agent tools, report
section, hand-calculated and scale tests, and the browser journey are implemented and pass
together with `pnpm check`. The first version of the flow-point gap left the material handler's
own half-width out of the margin, so every route in the reference line came back blocked; the
hand-calculated test caught it on the first run, before it reached the browser.

### T9 — Vehicle depot / garage MVP
Vehicle profiles (length, width, height, wheelbase, overhangs, minimum turning radius, reverse
allowed), bays (90°, angled, parallel, maintenance, wash, charge), lanes (one / two-way), gates.
Dubins / Reeds-Shepp paths, swept body envelope checked against walls, columns, parked vehicles and
zones. A bay is usable only if the vehicle can enter and leave.

**Implementation checkpoint (done — see decision 0013):** the depot pack, reference depot, a
clean-room Dubins path planner (`packages/industry/dubins.ts`, CSC family only — LSL/RSR/LSR/RSL,
verified by forward-simulating the returned path back to its goal pose), the swept-body entry
check, both rules, the editor panel with a visible entry path in 2D/3D, agent tools, report and
tests are implemented, browser-tested and pass with `pnpm check`. Reeds-Shepp (reverse maneuvers)
and articulated (trailer) kinematics are out of scope for this stage. A bay is a zone
(`Space.zones`), not an item: the first version as an item made every parked vehicle "overlap"
its own bay, since the core's overlap check compares vertical extent and a floor marking and a
car both start at the floor.

### T10 — Restaurant MVP
Table families (2/4/6-top, round, booth, banquette, communal), dining / bar / terrace / private
zones, covers, floor per cover, service routes from pass to tables (shared routing), unreachable
tables, clearance rules; candidate layouts (max capacity / balanced / spacious).

**Model (smallest correct one, reusing the shared rule module rather than inventing new checks):**
A table family is a plain item (`category: 'table'` or `'round-table'`, both already known to the
3D view) whose `seats` is its cover count — the same universal field a hall chair already carries,
so `measureProject`'s seat count, `seatIdsOf`, `walkwayRule`, `areaRule` and `exitRules` (in
`rules.ts`, already shared by the hall and office packs) work for restaurant covers with no new
core or rule-engine code, only a new rule code (`area-per-cover`) for provenance. A diner's pulled-
back chair needs room on every open side, unlike a machine's single operating face, so a table's
clearance is set uniformly on all four sides — the core's existing per-item clearance overlap
check does the rest. Dining/bar/terrace/private zones and a kitchen `Door.meta.role: 'pass'`
mirror the warehouse's zone and dock-role conventions exactly. The one new capability is
`table-reachability`: one flood-fill search per pass door (not one per pass/table pair) answers
every table's reachability for a waitstaff movement profile, the same one-search-per-source shape
as production's flow reachability and the depot's bay entry check.

**Implementation checkpoint (done — see decision 0014):** the restaurant pack, reference
restaurant, table catalog, zones, service routing, both new rules (reusing `walkwayRule`,
`areaRule`, `exitRules` unmodified for the rest), the editor panel with a visible service route in
2D/3D, agent tools, report and tests are implemented, browser-tested and pass with `pnpm check`.
Automatic candidate-layout generation (max capacity / balanced / spacious) is deferred, the same
way T8 deferred throughput simulation and T9 deferred reverse maneuvers: tables are placed by a
person or an agent, like any hall or office item, not auto-arranged by a solver.

### T11 — Shared accounts, companies, collaboration
The master plan's multi-user chapters (§19–§24), now designed around the packs above.

### Cross-cutting, staged
- **Variants** (T6 container options first, then every pack): a project can have candidate
  variants; comparison table of metrics and issues; AI proposals arrive as variants, never replacing
  the approved one.
- **Viewer tools** (§9), one per stage as packs need them.
- **GeometryPort** (union / offset / difference / free space) at T7 when zones and aisles need it.

---

## 8. AI planner evolution

From "move objects until it looks right" to: read goals → create a candidate variant → change it
through the normal tools → check geometry and rules → measure → improve → explain in two lines →
the person approves. For packing, slotting and layouts the agent calls deterministic tools
(`pack_container`, later `slot_pallets`, `route`), so algorithms calculate and the AI orchestrates.

## 9. Viewer tools architecture

Each capability is a small tool with `attach(view) / detach()` and its own UI control, registered in
the 3D view instead of hard-wired: camera presets (top, perspective, isometric, saved views), fit
selection / project, section and clipping (container roof / side wall is the first use), hide /
isolate, colour-by, measure distance / area, object search, layers and zone navigation. Delivered
with the pack that first needs each one: T6 cutaway + colour-by + sequence playback, T7 measure +
isolate, T8 section planes, T9 swept-path overlay.

## 10. Testing

Every pack: hand-computed reference scenarios, unit and property tests, browser journey, save/open
compatibility fixtures, agent-tool tests, and performance tests where relevant; planted-bug
verification before each commit.
