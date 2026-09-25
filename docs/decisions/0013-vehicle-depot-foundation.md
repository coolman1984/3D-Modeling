# 0013 — Vehicle depot spatial foundation (T9)

## Context

T9 is the fifth industrial pack. The plan calls for vehicle profiles (length, width, wheelbase,
overhangs, minimum turning radius), parking bays (perpendicular, angled, parallel, maintenance,
wash, charge), lanes, gates, Dubins/Reeds-Shepp paths and a swept body envelope checked against
walls, columns, parked vehicles and zones — spatial feasibility, not a site's turning-circle
approval.

## Decision

- **A clean-room Dubins path planner is added to `packages/industry`** (`dubins.ts`): the four
  CSC (curve-straight-curve) primitives — LSL, RSR, LSR, RSL — from the standard closed-form
  equations (Shkel & Lumelsky 2001; also in LaValle, *Planning Algorithms* §15.3.1), the shortest
  of the four returned. The rarer CCC family (e.g. RLR) is not computed: LSL and RSR are always
  feasible, so a path always exists, only occasionally longer than the true optimum. Verified by
  forward-simulating the returned path and checking it actually arrives at the requested goal
  pose — the strongest check available for a curve algorithm — as a property test over random
  poses and radii, plus two hand-derived cases (a straight segment, and a pure quarter-circle
  turn with a hand-computed (π/2)·r length). A near-tangent symmetric configuration produced a
  small negative p² from floating-point noise, dropping an otherwise-valid, often-optimal
  candidate; fixed with a small tolerance before the square root. `vehicleCorners` gives a
  vehicle's four floor corners at a sampled pose, for the swept-body check.
- **A bay is a zone, not an item.** The first version placed a bay as a `category: 'box'` item so
  it could be positioned and rotated like a rack row; a vehicle parked nose-in immediately
  overlapped it, since the core's overlap check compares vertical extents (`bottom < top` for
  both), and a bay's floor marking and a car's body both start at elevation zero — there is no
  positive height that avoids it. A bay is a floor marking, not a 3D object, so it belongs in
  `Space.zones` (kind `'bay'`, `meta.bayType` and `meta.direction`) the same way a warehouse
  aisle or receiving area is a zone rather than an item: zones and items are never compared for
  overlap at all, so a parked vehicle sitting inside its own bay is never flagged, the way a car
  parked on a painted line is not "on" the line in any conflicting sense. This is a smaller
  departure from the T7 warehouse-zone pattern than it looks: only the geometry source changed
  (zone polygon instead of item footprint), not the pack architecture.
- **A vehicle is still an item** (`category: 'car'`), the real 3D object with a turning radius
  and rear overhang stored in `meta`.
- **The lane's travel direction is stored data, not inferred geometry.** A lane zone carries
  `meta.direction` (degrees), the same way a warehouse dock carries `meta.approachZone`: deriving
  a direction from the zone's bounding-box aspect ratio was considered and rejected as fragile
  (a square lane has no dominant axis) and implicit in a way the rest of the pack's data isn't.
- **The approach point is set back one turning radius along the lane, not placed level with the
  bay.** The first version placed the vehicle's start pose at the foot of the perpendicular from
  the bay onto the lane centreline, facing along the lane — geometrically valid but forced a
  wide, unrealistic loop for a tight turning radius, because there is no straight lead-in room
  before the turn has to happen. Real drive-in parking is entered by driving past the stall a
  little before curving in. Setting the start back by one turning radius reproduced that and cut
  a hand-tested path from 23.5 m (a near-full loop) to 6.3 m for the same geometry.
- **Rules:** `bay-boundary` (every bay's zone polygon fits inside the depot, mirroring
  `rack-boundary`) and `bay-entry` (a fixed reference vehicle — a sedan — can drive a
  minimum-turning-radius path from the nearest lane into each *empty* bay without its swept body
  leaving the floor or touching a wall, column, another vehicle or a no-go zone), provenance
  `engineering`, `unknown` for no bays, no lanes, or every bay already occupied. `bay_entry_check`
  (agent tool) checks a named vehicle type instead of the fixed reference one.
- **No throughput or dwell-time simulation, no reverse maneuvers, no articulated (trailer)
  kinematics.** The swept-envelope check samples the Dubins path every 20 cm, the same planning
  resolution the warehouse and production packs use; it is a planning estimate, not a site
  approval, exactly as documented for warehouse routing.

## Evidence and limits

The 30 × 18 m reference depot (a two-way lane, six perpendicular bays, two parked vehicles — a
sedan and a van) has zero design issues and passes both rules. `dubins.test.ts` (in
`packages/industry`) covers the two hand-derived cases, a property test that the returned length
is never shorter than the straight-line distance, the forward-simulation round-trip property
test, and a sampling-density check. `depot.test.ts` covers the reference depot's structure and
metrics, save round-trip, a hand-checked small entry scene (exact start point, close-to goal
point), occupied/blocked/no-lane/unknown-bay outcomes, and a 20-bay scale check under a second.
Browser journey (`depot.spec.ts`) covers creating the reference depot, checking an empty bay's
entry path, adding a bay through the panel, the Review panel, 3D, and the client report.
Typecheck, all unit suites, and all 16 browser journeys pass together.
