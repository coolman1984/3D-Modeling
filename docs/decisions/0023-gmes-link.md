# 0023 — Link to plant: tags in meta, the layout snapshot, the live view from the browser

**Date:** 2026-09-30 · **Status:** accepted (ecosystem plan `complete-company/plan/40-SPACE-PLANNER.md`, WP-S1 to S3)

## Context

Space Planner is one product of an ecosystem (Mizan, GMES, HR-System, Space Planner). Manufacturing (GMES) owns the plant tree
(plant → area → line → station → equipment). A plan should say which node each item and zone stands for, tell GMES where its
stations stand, and show what the stations are doing now. The core must stay pure and old saves must stay byte-identical.

## Decision

- **Tags live in `meta`.** An item or zone carries `eco.ref = "plant_node:<uuid>"`, `eco.code`, `eco.type`. The core learns
  nothing; a plan without tags is unchanged (`packages/starter/src/plantLink.ts`, tested against the save round trip).
  Tagging is an ordinary command (`item.meta`, or `space.set` for a zone), so it is one revision and can be undone.
- **The link checks are not pack rules.** They need the imported plant tree, which `checkPack(project, style)` does not have, so
  `checkPlantLink(project, tree)` returns its own results, still naming a source (`company-policy`, "GMES link"). They are
  "unknown", never "pass", without a tree or without tags.
- **The layout snapshot** (`eco.layout.snapshot.v1`, `apps/server/src/eco/snapshot.ts`) is pure: same plan and options, same bytes.
  Lengths are the plan's ticks, nothing converted. The layout id is `UUIDv5(company, "space:layout:<project id>")`; the event id is
  `UUIDv5(company, "space:layout:<project id>:<revision>")`, so sending one revision twice is a duplicate to GMES. `version` is
  the plan revision **+ 1** (the contract needs a version above zero and a new plan is revision 0; `revision` carries the plan's own
  number). The plan said "version = revision"; this keeps it strictly increasing and valid.
- **Contracts are copied, not written.** `eco.envelope.v1`, `eco.layout.snapshot.v1` and `eco.plant_node.v1` are byte-identical
  copies from `GMES/packages/eco-contracts/schemas/`, pinned by SHA-256 in `apps/server/test/eco.test.ts` (and compared with a
  GMES checkout next to this repository when there is one; `.gitattributes` keeps their bytes). They are checked with a **minimal
  validator written here** (`eco/contract.ts`): no dependency was added. It refuses a schema that uses a keyword it does not check,
  so a contract that grows one fails a test instead of being half-checked. GMES's own validator accepts the envelopes this exporter makes.
- **Calls to GMES only on the person's command**, from the server, with the stored key: "Fetch from GMES" (`GET /api/plant/export`)
  and "Send to GMES" (`POST /eco/v1/inbox`). Everything else works offline; a plant file can be picked instead.
- **Keys are sealed.** On Windows the two keys (write, and read-only for the live view) are encrypted for the signed-in user with
  DPAPI (PowerShell `ProtectedData`, secret passed in an environment variable). They are never sent back to the page.
  Elsewhere (development and CI) they are stored with a `plain:` prefix that says so.
- **The live view runs in the browser only.** The page opens `EventSource(<gmes>/eco/v1/live?lines=…&k=<read key>)`; nothing is stored
  by the server. The key travels in the address because an EventSource cannot send headers, so it is a separate read-only key
  (`eco.live.read`); GMES lists this planner's origin in its allow-list. A dropped connection keeps the last picture, greyed, with the
  time of the last update. An unknown state from GMES is ignored, never shown as "running".

## Consequences

- The live picture is drawn on the link page (a plan seen from above with the stations coloured), not inside the 3D view: colouring
  in `View3D.tsx` is a separate piece of work. The states come from GMES as `running`, `stopped` (with the reason) and `starved`;
  `held` is shown when GMES sends it.
- Sealing or opening a key takes over a second (PowerShell starts); the two keys are sealed in one call and an opened key is
  remembered for the life of the server process.
- The stations of a line are ordered by the number after the line code when the codes look like `<line>-<op>`; the routing's real
  operation sequence is GMES's to say and is not in `eco.plant_node.v1`.

## Addendum (WP-S4): the Nile Vision sample and "Link by code"

- `packages/starter/src/nileVision.ts` adds the sample company "Nile Vision Electronics": the plant (areas and storage by code), final assembly lines FA-1 and FA-2 (18 operations and a repair bench each, in the order of the routing, stations 2 m along the line with 3 m for the material handler) and the SMT line and THT cell. It is laid out here, not copied from the scenario book's coordinates: the book's final assembly row is wider than the hall it stands in, and this plan must pass its own checks (validity, stations inside the floor, the handler reaches the next station).
- Every station and area carries `eco.code` only. The tag itself (`eco.ref`) is made when the plant tree is imported: `autoLinkCommands(project, tree)` tags each item or zone with the one active node of that code (and of the kind it names in `eco.type`), one batch, one revision, undoable. A valid tag is never replaced; two nodes with one code, an inactive node, or a code that is not a plant node (storage blocks) are reported and never guessed.
