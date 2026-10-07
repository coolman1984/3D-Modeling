# 0027 — Home studio: apartments, detailed furniture, packs, appearance, faster start

**Date:** 2026-10-07 · **Status:** accepted

## Context

The owner wants the program sellable to interior designers: apartments first, furniture that
looks like furniture (sofas with cushions, made beds, a laid dining table, floor lamps, art on the
walls), an interface that feels light and current, a real appearance settings page, faster start,
and sample content kept in files that are installed and removed rather than built in. Market
reference (Planner 5D, Homestyler, Coohom, Foyr Neo, Rayon): a visual catalogue, drag onto the
plan, ready room layouts, finishes, presentation for clients. Atrium keeps its own edge: exact
measures and checks that say whether things fit and work, offline on the owner's computer.

## Decision

- **Core:** one optional, universal field on item types, `surface: true`, for floor coverings
  (rugs, mats): nothing clashes with them and they take no clearance. Stored only when true, so
  every existing save is byte-identical. No activity knowledge enters the core.
- **Home pack** (`packages/starter/src/home.ts`), first in the list of activities: 54 pieces with
  real sizes and variants by `meta.fabric` / `meta.wood`; wall pieces carry `meta.mount: 'wall'`
  and `meta.elevation`. Clearances follow common residential guidance (40 cm sofa to coffee table,
  60 cm beside a bed, 75 cm behind dining chairs, 90 cm in front of wardrobes and kitchens, 60 cm
  in front of bathroom fittings), labelled `common-guidance`, never as regulation. Rules: walkway
  80 cm from every seat to the door, and `bed-access` (a 60 cm strip along one long side of every
  bed, past the nightstand). Three furnished apartments (49, 70, 108 m²) with interior walls at
  their exact lengths pass every check. The shared walkway rule now lets people walk over rugs.
- **3D models** (`homeModels.ts`): the details people recognise, drawn from code (no model files,
  no new dependency); chevron oak floor; furniture wood grain; generated artwork, rug patterns and
  book spines. Wall art above the cut height is left out of the cut view unless selected.
- **Plan symbols** (`PlanSymbols.tsx`): architectural symbols and a soft fill in each piece's
  colour, in the editor, the client report and the project thumbnails; rugs under furniture;
  rooms named with their area.
- **Library pictures** (`thumbnails.ts`): each item type rendered once from its own 3D model by a
  small offscreen renderer between frames; the line drawing stays as the fallback.
- **Placing wall pieces** hangs them on the nearest wall or partition, facing the room, at their
  height, slid clear of doors.
- **Appearance** (Settings → Appearance, kept per browser): theme light / dark / match computer,
  accent (electric blue, bronze, forest, graphite), text size (every font size scales through
  `--ts`), interface font (Geist, system, editorial serif), heading font. This relaxes DESIGN.md's
  "one blue": the accent is one colour at a time, chosen from four.
- **Packs** (`apps/server/src/packs.ts`): `.atrium` files, gzip JSON holding projects in the save
  format. Sample companies are no longer built into the server: `dist/make-packs.mjs` writes them
  to `dist/packs` at build time, the portable copy and the installer carry them, and the Packs
  window installs (all or nothing), replaces after asking, removes (only that pack's projects) and
  saves any pack or the person's own projects as a file. Samples added by older versions show as
  installed packs. `/api/samples` is gone; `/api/packs` replaces it.
- **Speed:** pages load on demand and the editor is fetched while the browser is idle. The first
  screen needs 493 KB of JavaScript instead of 1,621 KB.

## Consequences

- Variants are catalogue entries, not a material editor; a finishes picker can come later.
- Thumbnails cost a few milliseconds each on a real GPU, more on software rendering; they appear
  progressively.
- The dark theme re-values tokens; a few drawing colours (plan fills of industrial pieces, the
  printed report) stay light on purpose.
- Pack files are forward-checked: a newer pack version is refused with a plain message.
