# 0028 — Walls and openings: drawing the real space

**Date:** 2026-10-07 · **Status:** accepted

## Context

Stage H1 of `docs/04-home-studio-plan.md`: a designer must draw a client's apartment from its
measurements quickly. Until now a space was one outline with doors hinged on it; apartments faked
their interior walls as placed items (`home-wall-*`), with gaps for doorways. That cannot join
corners, carry doors and windows, or tell rooms apart.

## Decision

- **Core, schema unchanged (2):** two optional, universal space fields, stored only when there are
  some, so every existing save is byte-identical:
  - `walls`: straight walls by centre line (`a`, `b`), `thickness`, optional `height` and `meta`.
  - `openings`: doors and windows that sit in a wall by `offset` along it and `width`; optional
    `height`, `sill` (windows), and for a swinging door `hinge` (start or end jamb) with `side`
    (left or right of the wall looking from `a` to `b`). They move with their wall.
- **Integrity:** ids unique across the project; an opening's wall must exist and the opening must
  fit on it; only doors swing; only windows have a sill; a wall needs two different ends.
- **Derived, never stored** (`model/walls.ts`): wall solids with each end reaching half the
  thickness of the wall it meets (corners and T-junctions close without mitre geometry; walls at
  odd angles may leave a small notch, accepted for now); door openings are gaps, windows are not
  (the wall stands below the sill); a door's swing reuses `doorSwingPolygon` with the hinge on
  the wall face; rooms are found on a 1 cm raster with doors closed, exact for walls on whole
  centimetres with even-centimetre thickness.
- **Checks:** wall solids act as obstacles (`on-obstacle`, `clearance`, named once per wall even
  when a door splits it); door swings act as doors (`door-blocked`). The spatial grid and the
  all-pairs check stay identical.
- **The boundary** stays the outline of the whole space; with drawn outer walls it is their
  outside face. Home shells: 20 cm outer walls, 10 cm partitions, the inside starting at 20 cm.
- **Starter:** the walkway raster includes walls; doorways are passed whatever their width (a door
  is narrower than a walkway by nature; door width is its own rule), and walking starts at doors
  with `meta.role: 'entrance'`. The three apartments are rebuilt on real walls with swinging doors;
  the wall pieces left the catalogue (older plans keep theirs, which still take hung pieces).

## Consequences

- Old plans open unchanged; apartments made from templates now carry walls, doors and rooms.
- The editor draws, selects and edits walls and openings through `space.set` (one revision each).
- Room areas come from the walls; room names still come from labelled zones.
