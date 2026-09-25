# 0007: Atrium redesign and an English interface

**Date:** 2026-09-25 · **Status:** accepted

## Context

The owner approved a Claude Design prototype ("Atrium", in `design-reference/`) as the visual
target for the existing application and asked for the whole interface in English. The previous
rules (Arabic, right-to-left, no warm backgrounds, no serif accents) came from the first UI stage
and are replaced by this record. The prototype is a mock: its geometry, checks, history and agent
steps are fake and must not replace product logic (see `docs/redesign-audit.md`).

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Language | All user-facing text in English, left-to-right: editor, starter packs (item names, activity and style labels), server revision summaries, agent status messages, launcher | Owner's request; one language everywhere, including what agents write into the history |
| Old saves | Project data is not rewritten. Item names already stored inside a project's own catalog keep their text | Saves are forever; names are the owner's data |
| Visual system | CSS tokens on `:root` in `styles.css` taken from the prototype: page `#f3f2ee`, panels `#f8f7f4`, workspace `#eeede8`, lines `#e9e6e0`, ink `#1a1917`, accent `#2b54d0`, error `#b93a2e`, warning `#9a6400`, pass `#2d7446` | One place to tune the look |
| Fonts | Geist (controls) and Newsreader (headings), bundled with `@fontsource-variable/geist` and `@fontsource-variable/newsreader` | The app runs locally and must look the same offline; no Google Fonts request |
| Icons | Phosphor "light" icons from `@phosphor-icons/react`, imported one by one (tree-shaken) | Same icon family as the prototype, no CDN at runtime |
| Plan and 3D | The real SVG plan and three.js view stay; only colours, line weights, door symbols, rulers and floating toolbars change | The prototype's CSS drawings are fixed-room pictures, not editors |
| Not built | Layers, door swing direction, wall thickness, per-tool agent permissions, workspace name, units and language preferences, revision compare | No model or backend behind them; building them is a product decision |
| New, on existing logic | Drag a tile onto the plan, Objects list, read-only revision preview, 3D orbit and top view, "AI Planner is editing" banner, connection-lost banner with retry | Each only uses existing commands, endpoints or events |

## Consequences

- Three new runtime dependencies of the editor (fonts and icons); no change to core or server
  dependencies.
- Browser tests find controls by English text, test ids and field names.
- The Arabic keyboard letters in the shortcut map stay, so shortcuts still work on an Arabic
  keyboard layout.
