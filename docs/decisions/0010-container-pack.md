# 0010: Container loading pack

**Date:** 2026-09-25 · **Status:** accepted

## Context

T6 (plan §7): a true 3D loading activity, not a furniture layout. The core already checks
overlaps in 3D (items clash only when their heights meet), walls and the roof (ceiling).

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Container | A rectangular space: x = length from the front wall to the doors (east end), ceiling = inside height. `Space.meta`: pack, container type, payload limit, door opening | No new core concept; the doors are data for the packer and the plan, not a swinging core door |
| Types | 20′, 40′, 40′ HC, 45′ HC, 20′ reefer, 40′ reefer HC, 13.6 m trailer, typical inside sizes and payloads (common guidance) | Always check the actual unit; values are labelled as guidance |
| Cargo data | Type `meta`: quantity, stackable, maxLoadOnTop (g), allowTilt, stackGroup, stop; piece `meta`: stop, step | Pack-owned; the core only stores it |
| Rules | payload, support (70% of the base on pieces within 5 mm), load on top (weight passed down every stack by contact area), orientation, stacking group, unloading order (LIFO: nothing for a later stop on top or between a piece and the doors in its lane), balance (centre of mass within 10% of the middle), unplanned pieces. Missing mass or data → unknown | Each names its source; none is a regulation |
| Packer | Extreme points (Crainic, Perboli, Tadei 2008): pieces sorted by later stop first, then volume / mass / base area; first corner in (depth, height, side) order where an orientation fits the box and the door opening, clashes with nothing, has 70% support on pieces allowed to carry it, overloads nothing down the stack and slides under nothing that may not rest on it. Three strategies are candidates through `OptimizationPort`; identical plans are merged | Deterministic and explainable; not optimal, and says so |
| Contact | The packer measures contact on the same outlines as the checks (round drums are polygons) | A plan the packer proposes must pass the checks (property test, 300 random loads) |
| UI | Load panel (container, cargo plan with quantities, payload limit, plan candidates, unload all); cargo inspector (stop, step, orientation, loads, settle onto the stack); 3D cut-away, colour by type / stop / weight / step, numbered steps on the plan, sequence playback; report with container numbers and loading sequence | Same Atrium shell as every pack |

## Consequences

- The largest-first plan fills from the front wall, so a part load sits off centre; the balance
  rule says so. A balancing strategy is a candidate for later.
- Packing time grows roughly with pieces² × corner points; a few hundred pieces take well under a
  second. Larger loads (thousands of cartons) need layers or a spatial grid in the packer.
- Axle loads, securing (lashing) and multi-container shipments are not modelled yet.
