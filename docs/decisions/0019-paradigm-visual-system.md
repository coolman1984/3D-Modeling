# 0019 — "Paradigm" visual system replaces the warm Atrium palette

## Context

On 2026-09-26 the owner asked for the look and feel of the Paradigm website (a capture from
godly.design) across the whole product, written down as a design file. The Atrium target
(decision 0007) was warm beige with serif headings. The layout, components and serif/sans pairing
of Atrium already matched the new reference; the palette, button shapes and top bars did not.

## Decision

- `DESIGN.md` at the repository root is the visual contract: colour, type, shape and component
  rules, and rules for new work. The `design-reference/` Atrium export stays in the repository as
  history but is no longer the target.
- Tokens only: `:root` in `apps/editor/src/styles.css` holds the new cool palette, dark-band
  tokens, one electric blue (`#1f3bf5`), pastel status colours and a radius scale (`--r-0`…`--r-3`).
  About 90 warm hard-coded colours in the stylesheet and components were mapped to their cool
  equivalents; physical 3D materials (asphalt, grass, wood, cartons) keep their real colours.
- Top bars (projects, settings, editor) are dark bands. The projects page header and its "continue"
  card share one full-width dark hero band with thin frame lines. Buttons are square; primary is
  black (white on dark).
- Same bundled fonts (Newsreader, Geist) and the same icons. No new dependency.
- Found and fixed while restyling: the new-project dialog's activity cards overlapped their text
  (seven cards in three fixed-height columns); they are now two columns with automatic height.

## Consequences

`CLAUDE.md`'s user-interface section now points to `DESIGN.md`. The CLAUDE.md "no gradients"
rule is relaxed only for `--wash` on feature panels and the 3D backdrop. Screens were checked with
before/after screenshots; the browser suite's selectors are unchanged (only look, not structure,
moved), apart from the projects hero wrapper.
