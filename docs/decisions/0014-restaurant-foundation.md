# 0014 — Restaurant spatial foundation (T10)

## Context

T10 is the sixth industrial/hospitality pack. The plan calls for table families, dining/bar/
terrace/private zones, covers, floor per cover, service routes from a kitchen pass to tables,
unreachable-table detection, clearance rules, and candidate layouts (max capacity / balanced /
spacious).

## Decision

- **A table needs no new core concept.** Its `seats` field is its cover count — the exact same
  universal field a hall chair already carries. `packages/starter/rules.ts` already has
  `walkwayRule`, `areaRule` and `exitRules`, generic over any item whose type has `seats`
  (`seatIdsOf` filters by the field, not by category), shared today by the hall and office packs.
  Restaurant covers, the walkway-to-a-door rule, and exits/door-width therefore need no new code
  at all — only a new rule code, `area-per-cover`, so the report and review panel show a
  restaurant-specific title and provenance instead of the hall's "area-per-guest". This is a
  deeper reuse than T8's or T9's (which reused geometry helpers and routing, not a whole rule),
  and it is only available because a table, unlike a machine or a rack, genuinely is "a seat" in
  the core's terms.
- **A table's clearance is uniform on all four sides**, unlike a machine's front/back
  operating/maintenance split (T8) or a rack's face-based access points (T7): a diner's chair,
  pulled back, needs room on whichever side is open, and a table has no single "front" the way a
  station or a rack row does. The core's existing per-item clearance overlap check needs no
  change for this — it was already general enough.
- **The kitchen pass is a door with `meta.role: 'pass'`**, mirroring the warehouse's dock-role
  convention (`meta.role: 'receiving' | 'shipping'`) exactly, down to reusing its `rotate()`-based
  approach-point formula verbatim rather than re-deriving door geometry by hand — a second
  hand-derivation of the same formula in the depot pack (T9) had already shown that door
  hinge/angle/swing math is easy to get subtly wrong; copying the proven formula avoided repeating
  that risk. A planted-bug run confirmed this: flipping the swing-direction sign failed four
  independent tests (a route-distance comparison and a 20-table scale case) immediately.
- **Table reachability is one flood-fill search per pass door**, not one per pass/table pair —
  the same one-search-per-source shape decision 0011 established for the warehouse and every pack
  since has followed as a starting design constraint, not a fix applied after measuring a
  regression.
- **No `table-boundary` rule.** The core's own `out-of-bounds` design-issue check already reports
  a table placed outside the room, the same way it does for a hall's chairs or a warehouse's
  columns; hall and office never duplicated it as a pack rule either, so restaurant does not.
- **Candidate layouts (max capacity / balanced / spacious) are deferred.** Every stage so far has
  named one plan feature explicitly out of scope for its MVP checkpoint (T8: throughput
  simulation; T9: Reeds-Shepp reverse maneuvers and articulated kinematics) rather than trying to
  build the full plan text at once. Automatic layout generation is a genuinely new kind of
  capability — a solver that proposes furniture arrangements, not a checker of one a person placed
  — closer in shape to the container pack's `OptimizationPort` packer than to anything else built
  so far, and it earns its own stage rather than riding along with the reachability/rule
  foundation. Tables are placed with the ordinary `define_item`/`place_items` tools, the same as
  any hall or office item.

## Evidence and limits

The 20 × 14 m reference restaurant (entrance and kitchen-pass doors, a dining zone, 9 tables
across four families seating 44) has zero design issues and passes every rule on the first run —
no bug needed fixing to reach a working reference, unlike T7's routing fan-out, T8's flow-point
gap, or T9's lead-in-distance and floating-point issues, a direct consequence of how much of this
pack is reused rather than new. `restaurant.test.ts` covers the reference structure and metrics,
save round-trip, a route-distance comparison (a table near the pass is closer than one far from
it), unknown-reason cases (no tables, no pass door), an out-of-bounds table confirmed as a core
design issue rather than a pack rule, and a 20-table scale case under a second. Browser journey
(`restaurant.spec.ts`) covers creating the reference restaurant, showing a service route, the
Review panel, 3D, and the client report. Typecheck, all unit suites, and all 17 browser journeys
pass together.
