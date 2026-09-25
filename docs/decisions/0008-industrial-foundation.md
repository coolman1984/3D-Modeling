# 0008: Industrial roadmap and the shared foundation

**Date:** 2026-09-25 · **Status:** accepted

## Context

The commercial priority moved to industrial activities: container loading, warehouses, production
lines, vehicle depots, then restaurants. Accounts and collaboration (the old T5) are not a technical
dependency of any of them. The core must stay pure and small while these packs need mass, 3D
orientation, pack-owned data and projects with thousands of items. Full plan:
`docs/03-industrial-packs-plan.md`.

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Roadmap | T5 shared industrial foundation → T6 container → T7 warehouse → T8 production → T9 depot → T10 restaurant → T11 accounts and collaboration | Prove the engine on the hardest cases before the multi-user platform; completed stages keep their names |
| Mass | Optional `ItemDefinition.mass`, integer grams | Universal physics; integer like every stored quantity |
| Orientation | Optional `ItemInstance.tilt`: `'x'` or `'y'` = that local axis points up (the item lies on its side); missing = upright. Effective size is derived by the core | A lying box occupies a different volume, so checks must know; three states cover every box orientation together with the existing Z rotation |
| Pack data | Optional `meta` on definitions and items: map of string → string / finite number / boolean, at most 32 keys, keys up to 64 characters, strings up to 200 | Packs need stackability, load limits, destinations, load steps, cycle times; the core validates the shape and never reads the meaning |
| Commands | `item.tilt` and `item.meta` (whole-map replace, reversible) | Every change is a command with an inverse |
| Schema | No version bump: all fields optional, stored only when set, so every old save stays byte-identical (same rule as `elevation`, decision 0004) | Saves are forever; older apps reject newer files clearly through the strict field list |
| Spatial index | Derived uniform grid in the core, rebuilt from the project, never saved; checks use it and must equal the all-pairs result | Large warehouses; the index is a cache, never truth |
| Zones, routes, vehicles | Not in T5. Zones enter the core at T7; routing and kinematics in a new `packages/industry` at T7/T9 | Add abstractions only when a pack needs them |
| Rule provenance | Every starter rule names its source kind, title and rule-set id; no rule ships as verified regulation | Guidance must not look like law; unknown stays unknown |
| Optimisation | `OptimizationPort`: input project + goals → candidate command lists with metrics and explanation; never mutates state | Algorithms propose, people and agents choose |

## Consequences

- The core gains three optional fields, two commands and an index module; no dependency.
- Metrics report total mass and centre of mass only when every placed type has a mass; otherwise
  "unknown".
- Packs can grow without core changes as long as their data fits `meta`.
