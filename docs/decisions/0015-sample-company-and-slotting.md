# 0015 — Sample company, material slotting and 3D realism (D1)

## Context

The owner needs to show an important logistics client a whole company working in the product:
stocked warehouses where materials can be found and re-arranged, and containers loaded with TVs
and appliances, in a professional, fast 3D view. The previous demo projects lived only in a local
database that is gone; nothing in the repository could recreate them. Racks were structural only
(decision 0011): capacity was counted, but no location held a material.

## Decision

- **The sample company is code, not a saved database.** `packages/starter/src/samples.ts` builds
  "Nile Gate Logistics" (fictional, Egyptian sites, Samsung-style model lines chosen by the owner)
  deterministically: a fixed-seed generator, no clock. `POST /api/samples/nile-gate` stores the nine
  projects through `store.createProject` (actor "Sample data"), so they are ordinary projects with
  history. A button on the projects page calls it. Loaded containers are packed by the existing
  packer at build time and their planned quantities set to what fitted, so every sample opens with
  every check passing; one container is left planned and empty for a live demo.
- **A material is a catalog definition of one loaded pallet** (`meta.sku`, `line`, `velocity`,
  `movesPerWeek`, `unitsPerPallet`, `color`). It can also stand on the floor as an ordinary item
  (staging areas).
- **What a rack location holds is stored on the rack row**, one `meta` entry per bay
  (`s01` = levels joined by `|`, positions by `,`, each a material id). Items for stored pallets
  were rejected: the core would report every pallet as overlapping its rack (the same reason depot
  bays became zones, decision 0013), and a 10,000-position site would add 10,000 entities to the
  save. The core is untouched; the encoding fits its meta limits (32 keys, 200 characters) for racks
  up to 31 bays with material ids up to 10 characters, and `stockCommands` refuses anything that
  does not fit instead of truncating. Edits are ordinary `item.meta` commands: one revision, undo,
  agents share the path.
- **Level 1 is the floor.** Pallet heights and beam heights share one formula (`slotPlacement`), so
  3D, travel and the inspector grid agree.
- **Slotting optimiser behind `OptimizationPort`** (`velocitySlotter`): ranks pallets by moves per
  pallet and locations by forklift travel from the shipping dock (one flood fill, decision 0011)
  plus 1.5 m per level above the floor, and proposes the re-arrangement. It only rearranges stock on
  hand, skips blocked locations, and reports weekly travel before and after. The 1.5 m lift
  equivalent is an engineering assumption, stated in the explanation.
- **3D realism without new dependencies:** stored pallets are two instanced meshes (bases, loads
  coloured per instance), racks use industrial colours, model parts are merged per material
  (a rack row is a couple of draw calls instead of dozens), cartons, carton stacks, container steel
  and floor planks are canvas textures drawn once, and a studio environment with neutral tone
  mapping gives materials depth without shifting the Atrium palette. `three` examples
  (`RoomEnvironment`, `BufferGeometryUtils`) ship with the existing `three` dependency.

## Evidence and limits

`stock.test.ts`: hand-computed location placement, encoding, swap, refusals, metrics, the exact
1.5 m level step, the optimiser moving the busy material to the best location, and a property test
(no pallet lost or placed in a blocked location, deterministic). A planted bug (busiest pallets
sorted last) failed two independent tests. `samples.test.ts`: every sample valid, saves and opens,
no design errors, every warehouse rule passes, every loaded container passes and is fully loaded,
deterministic across builds, the main DC saves 21.8% travel. A real finding on the first run: the
20′ phone container was 12.4% front-heavy (limit 10%); the sample load was changed, not the rule.
Server tests cover the endpoint and the three new agent tools; `sample.spec.ts` covers the button,
optimise and apply, find, and emptying a location from the rack grid. Checked in a real browser with
screenshots at 1,680 and 10,368 positions.

Not modelled: putting stock into a blocked location is allowed (a design choice the person makes;
no rule reports it yet), stock quantities below a full pallet, and pick faces or order profiles.
