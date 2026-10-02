# 0024 — Shipments: pieces lie flat and stack; height is not the goal

**Date:** 2026-10-01 · **Status:** accepted

## Context

The shipment loader (decision 0021) chose, for each part, the wall that holds the most pieces per metre. For a
cushion that may be turned (TV55B, 1335 × 110 × 400 mm) that meant standing it on its long side: 1 335 mm vertical,
two high, 1 260 per 40′ high cube. The owner rejected it: a crew lays cushions flat and stacks them on each other; a
long piece stood on end falls over and is crushed. Filling the container's height is not the priority. Cushions are
light, so how many lie on each other is not the limit; for heavy or fragile cargo it can be.

## Decision

- **Lie flat.** A piece that may be turned lies on its largest face (smallest side up). Only when that does not fit
  the container or its doors is it set on a side, and on its longest side (on end) only when nothing else fits.
  A piece that must stay "this way up" keeps its listed height.
- **Stack limits only when stated.** `maxLayers` (pieces on each other, bottom one included), `maxLoadOnTop` with
  the piece's mass (1 + load ÷ mass layers), or `stackable: false` (one layer). The strictest stated one wins; the
  roof caps all. Unstated = up to the roof. The limit applies to columns of a wall and to pieces poured into the gaps
  above other walls (the column under them counts).
- **No bridging under a weight.** When a part's mass is known, one piece never rests across two others (mixed
  "rows on rows" walls and gap filling on top of other pieces are skipped), so the per-piece load stays exactly what
  the layer count says and the container's own load-on-top rule passes.
- The planned limit is written into the cargo data (`stackable`, `maxLoadOnTop`), so the container rules check the
  plan against it. Server input and the agent tool accept `max_layers`, `max_load_on_top_kg`, `stackable`; the
  shipment form has a "Layers" column.

- **Complete sets.** Parts that name a model (`model`, the first cell of a pasted row) are loaded as whole sets of that model in the exact ratio of their quantities (2 sides + 1 top + 1 bottom per TV); each container takes as many full sets as fit, the last the rest, and a container holds one model only. The form, the server and the agent tool carry `model`.`n`n## Consequences

- TV55B cushions: 5 across × 24 flat layers × 9 walls = 1 080 per 40′ high cube (was 1 260 standing on end): 3 500
  need 4 containers instead of 3. That is the price of a load that arrives undamaged; the owner chose it.
- Boxes that may not be turned are unchanged (88 per 20′ for 100 × 50 × 50 cm upright).
- Rejected: a default stack limit for unstated cargo (tried first: 3 layers). It made light cargo waste containers
  for no reason; a limit belongs to the cargo data, not to a guess.
