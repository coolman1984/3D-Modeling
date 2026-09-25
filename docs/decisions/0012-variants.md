# 0012: Variants — alternatives of a plan, compared and adopted

**Date:** 2026-09-25 · **Status:** accepted

## Context

The industrial plan (§7, cross-cutting) asks for variants from T6/T7: a project can have candidate
alternatives, compared on metrics and issues; AI proposals arrive as variants and never replace the
approved plan. T6 compared packing candidates inside the Load panel only; nothing was stored.

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Where | Server store, not the save format: `projects.variant_of` (nullable), added to existing databases on open (`ALTER TABLE` when the column is missing) | Comparison is a product feature; project files stay unchanged and every variant is a normal project with its own history |
| Family | A variant of a variant links to the same base; the base is the approved plan. Deleting a base turns its variants into ordinary projects | One flat family is easy to compare and to explain |
| Adopt | `diffCommands(base, variant)` in the core (pure: unlock and remove leaving items, set the space, remove unused types, define new or changed types, add new or changed items) applied to the base as one revision, "Adopted variant “…”", under the actor's name | Same path as every change: validated by the core, undoable, in the history; the base keeps its id and name |
| Compare | `Pack.figures(project)`: the few numbers that decide between alternatives of each kind of space (hall/office: seats, floor per seat; container: pieces, not placed, volume, payload, off centre; warehouse: pallet locations, rack capacity, floor use, drive from dock), plus errors, warnings, rules failed and unknown. The best value is marked only when the pack says which way is better and there is one winner | Packs know what "better" means; the core does not |
| Agents | `create_variant`, `compare_variants`, `adopt_variant` (only when the person asks) | Agents propose alternatives without touching the approved plan |
| UI | "Variants" in the editor top bar: comparison table, open, adopt, new variant from this plan; projects list says "Variant of …" | Same Atrium shell |

## Consequences

- Adopting removes and re-adds changed items rather than moving them: the history shows one
  revision per adoption, and undo restores the previous layout exactly.
- Variants are compared with each pack's first style (a hall's banquet rules, for example); a style
  picker for the comparison can come later.
- No merge of two variants and no per-item diff view yet.
