# 0006: Office pack and a list of activity packs

**Date:** 2026-09-25 · **Status:** accepted

## Context

Stage T4 must show the base is general: a second activity (a small office) with its own
catalog and rules, and no change to the core. The exit gate from the master plan: no change to
core algorithms to add a term, a catalog or a capacity rule for the second pack.

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Core | Untouched in this stage (`git diff packages/core` is empty) | The gate itself |
| Shared rules | `packages/starter/src/rules.ts`: walkway to the doors, floor per person, exits, door width, result type | Both packs use them; each pack only adds what is its own |
| Office pack | `office.ts`: 20 items (desks, office and meeting chairs, meeting tables, storage, printer, whiteboard, phone booth, kitchenette, lounge); styles open-plan (6 m² per person) and meeting room (2 m²), both with a 90 cm walkway; a "desk has a chair" rule (a seat within 60 cm of each desk, one seat per desk) | Common office planning guidance |
| Shared items | Sofa, armchair, plant and reception desk keep the same id and definition in both packs | A project can hold both catalogs without id clashes |
| Pack list | `PACKS` (id, name, catalog, styles, check) with `detectPack` (the pack with most of its items in the project), `checkPack`, `missingPackItems`, `newRoom(..., pack)` | Adding a pack is one entry; no schema field needed |
| Choice | New projects: hall or office (projects page, `create_project activity`). In the editor the pack is read from the catalog and can be changed in the rules panel (kept per browser; the old hall-style choice is carried over) | Saves stay unchanged |
| Agents | `get_project` shows the rules of the detected pack; `check_project` takes `activity` and `style` (`hall_style` still accepted) | Same knowledge for people and agents |

## Consequences

- The office rules count every seat as a person, meeting chairs included.
- A desk's chair is matched by distance, not by which side it is on.
- The activity choice is not shared between browsers yet (needs a project field or accounts, T5).
