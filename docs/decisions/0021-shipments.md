# 0021 — Shipments: how many containers, side by side

**Date:** 2026-09-29 · **Status:** accepted

## Context

A customer request (TV cushions, production plan for 04/Oct and 05/Oct): "how many
containers do we need", shown in the program with the containers side by side, every container
detail, and the stuffing playback. Until now a container project held one container, and the
extreme-point packer (decision 0010) placed a few hundred mixed pieces. It took about 12 s for 1 260
identical cushions (pieces × corner points), and a 40′ HC holds about 5 000 of the small ones.
Decision 0010 left multi-container shipments open.

## Decision

| Topic | Decision | Why |
|---|---|---|
| Shipment | No new core concept. A shipment is N ordinary container projects. Each project's `space.meta` has `shipment`, `shipmentName`, `shipmentIndex` and `shipmentCount`, and the store groups them by the collection `shipment:<id>` | Every existing container feature (rules, cargo plan, colours, cut-away, playback, report, history) works on each container unchanged. Old saves are untouched. Pack data lives in `meta` |
| Loader | `planShipment` (starter) loads in walls: a wall is one slice across the container, one piece deep, filled from the floor up. Walls run from the front wall to the doors. Per part it uses the wall with the most pieces per metre, or two orientations sharing the depth when the part may lie on its side. Upper rows are kept within the width below, so every piece rests fully on another. A shallower wall fills the gap at the end of a container, and the last pieces go in the shallowest wall that holds them all | This is how crews stuff loose parts. It is deterministic, explainable, and linear in the piece count (4 containers, 5 100 pieces: about 0.3 s including storage) |
| Same-size parts | Parts with identical size and handling (a cushion top and bottom) form one stream and share walls, handed out in the order given | Otherwise a half-empty wall sits in the middle of a container |
| Steps | One loading step is one layer of one wall | Playback shows the crew's order at a watchable pace |
| Checks | Every generated container must pass the core checks (inside, no clashes, under the roof), support and planned-pieces rules. A property test runs this on 60 random shipments | A plan the loader proposes must pass the same rules as a hand-made one |
| UI | "Plan shipment" on the projects page: parts typed or pasted from the production plan, with a live answer. Shipment page `#/s/<id>` shows the containers side by side in one 3D scene (read-only), with colour by part (the same colour in every container), cut-away and one play button (all together, or one after another). It also shows figures and checks per container and links to each container's editor and report. The container editor links back to its shipment | The owner sees the answer, then the containers, then any detail |
| Playback speed | Playback hides pieces by giving their instances an empty matrix instead of rebuilding the scene; a whole playback lasts about 25 s. The container editor gets the same change, plus cached container figures | Rebuilding 2 000–5 000 pieces per step blocked the page for about 1 s per step (measured over CDP: 7–10 s blocked out of every 8 s, afterwards 0.2–0.4 s) |
| Agents | Tool `plan_shipment`, the same code path (`createShipment`), one revision per container with the agent's name | People and agents share one path |

## Consequences

- One container type per shipment. Mixing types ("three 40′ HC and a 20′ for the rest") is not
  offered yet; the answer shows how full the last container is, so a person can decide.
- Loose parts only. Cartons or pallets are entered as parts with their own size and quantity.
- The wall loader does not look at mass. With masses given, payload, load on top and balance are
  checked per container as usual; without them they are unknown.
- A pasted production plan keeps its empty cells in place (tabs, or runs of four spaces where tabs
  became spaces), so each quantity stays under its own day; the form picks the day to ship.
- Parts shipped in bags are entered as loose parts at their listed size; the bag is not added.
- Gap filling (added 29 Sep, after the owner pointed at the empty space above a half-full wall):
  when a container's walls are done and pieces are still waiting, the flat top of every wall is an
  empty box on which the remaining pieces are stacked in columns. They get their loading steps right
  after that wall, before the next wall closes it off. 09/Oct went from 3 containers to 2. Gaps
  narrower than a piece stay empty, so a day can still end with a nearly empty container (07/Oct:
  36 long cushions). Combining days is left to the planner.
- Container projects with thousands of pieces make the project list's thumbnail and check pass
  slower. The shipment page runs its checks one container at a time after it appears.
