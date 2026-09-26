# DESIGN.md — the "Paradigm" visual system

The approved look for every screen of Space Planner, chosen by the owner on 2026-09-26 (decision
0019). The reference is the Paradigm website capture (godly.design, Sept 2026). It replaces the warm "Atrium" palette of decision 0007.
The layout, functions and words of the app stay; only the look changes. All values live as tokens
on `:root` in `apps/editor/src/styles.css`; components use tokens, never raw colours.

## 1. Feeling

Quiet, exact, expensive. A cool white page, near-black ink, one electric blue, hairline grey rules,
and large light serif headings. Nothing decorative: no shadows except on floating things, no
gradients except one pale blue wash on feature panels and the 3D backdrop. The work (plan, 3D,
tables) is the picture; the frame around it is calm and square.

## 2. Colour

| Token | Value | Use |
|---|---|---|
| `--page` | `#f5f6f8` | Page and workspace background (cool grey-white) |
| `--surface` | `#fafbfc` | Side panels, rails |
| `--white` | `#ffffff` | Cards, tables, inputs on focus, dialogs |
| `--fill` | `#eff1f4` | Inputs at rest, segmented tracks, code |
| `--hover` | `#eceef2` | Hover on quiet controls |
| `--line-soft` | `#eef0f3` | Row dividers inside tables |
| `--line` | `#e4e7ec` | Hairline borders, frame lines |
| `--line-mid` | `#dadee5` | Section rules, card borders |
| `--line-strong` | `#c9ced7` | Button borders, strong rules |
| `--ink` | `#0b0d12` | Text, primary buttons, dark bands |
| `--ink-2` | `#4b505b` | Body text, secondary |
| `--ink-3` | `#7d838f` | Labels, hints, eyebrows |
| `--ink-5` | `#b6bcc6` | Disabled, placeholders |
| `--dark` | `#0b0d12` | Dark bands (top bar, hero, footer) |
| `--dark-2` | `#161a22` | Raised surface on dark (tabs, cards) |
| `--dark-line` | `#242a35` | Rules on dark |
| `--on-dark` | `#f4f5f7` / `--on-dark-2` `#9aa1ad` | Text on dark |
| `--accent` | `#1f3bf5` | The one blue: active step, focus, links, selection |
| `--accent-soft` | `#eef1fe` | Selected cell, active tab tint |
| `--accent-line` | `#cfd7fd` | Selected borders |
| `--wash` | `linear-gradient(160deg, #eef1fb 0%, #c9d3f5 100%)` | Feature panels only |

Status colours are pastel chips with dark text of the same hue, never loud fills:

| Meaning | Chip background | Text |
|---|---|---|
| Pass / highest | `#e4f4e8` | `#1f7a3d` |
| Warning / high | `#fdf2d9` | `#8a5a00` |
| Error / low | `#fde8e6` | `#b3261e` |
| Info / category | `#eef1fe` | `#2336c9` |
| Neutral / category 2 | `#f0e9fb` | `#6a3fb6` |

## 3. Type

- **Display serif** (`--serif`, Newsreader, weight 400): page titles 56–64 px, section titles
  32–40 px, panel titles 26–30 px; line-height 1.02–1.08, letter-spacing −0.02 em. Never bold.
- **Sans** (`--sans`, Geist): UI 13 px, body 14–15 px at line-height 1.5, tables 12.5–13 px.
  Weights 400 and 500 only.
- **Eyebrow** (`.kicker`): 11 px, uppercase, letter-spacing 0.12 em, `--ink-3`, weight 400.
  Sits 12–16 px above a serif heading ("THE OLD WAY", "WORKFLOWS").
- **Big numbers**: light sans (weight 300), tabular, `--ink-5` on light pages for hero statistics;
  `--ink` in panels where the number is the answer.

## 4. Shape and space

| Token | Value | Use |
|---|---|---|
| `--r-0` | `0` | Buttons, inputs' outer frame on dark, tabs, step markers |
| `--r-1` | `3px` | Inputs, chips, segmented items, table cells |
| `--r-2` | `6px` | Small cards, menus, floating tool bars |
| `--r-3` | `14px` | Feature panels (the grey panels around screenshots), dialogs |

- **Buttons are square** (radius 0). Primary: `--ink` fill, white text, arrow "→" when it leads
  somewhere. On dark: white fill, `--ink` text. Secondary: white, 1 px `--line-strong` border.
  Heights 32 / 38 / 44 px. Never pill-shaped.
- **Step and tab markers**: an active step is a solid `--accent` square with white text; inactive
  ones are white with a thin grey border. Small square dots (8 px) mark positions on a rail.
- Spacing on an 8 px rhythm; sections breathe (48–96 px between blocks on pages; 16–24 px in panels).
- **Frame lines**: pages sit in a thin-ruled frame (vertical rules at the content edges,
  horizontal rules between sections, `--line`). Use them on pages (projects, report, settings), not
  inside the editor workspace, where the plan grid already carries the structure.

## 5. Components

- **Top bar**: a dark band (`--dark`), 52 px, white wordmark with a square logo mark, links in
  `--on-dark-2`, active link `--on-dark`, the one call to action as a white square button.
- **Hero / feature band**: `--dark` block with a large serif headline in `--on-dark`, a short
  paragraph in `--on-dark-2`, a white square button, and a product picture framed by `--dark-line`.
- **Tabs over dark**: a row of equal cells separated by `--dark-line`; the active cell is `--dark-2`
  with `--on-dark` text.
- **Tables**: white, hairline grid (`--line-soft` rows, `--line` columns), 36 px rows, a small
  icon before each header, tabular numbers, the selected cell tinted `--accent-soft`.
- **Chips**: 20–22 px high, radius `--r-1`, pastel background, 12 px text (section 2).
- **Lists with marks**: "×" for problems and "✓" for what works, thin, in `--ink-3`, 14 px text.
- **Panels**: `--surface` with a 1 px `--line` edge; titles in serif; groups separated by rules
  and eyebrows, not boxes.
- **Inputs**: `--fill` at rest, white with a 1 px `--accent` border on focus; radius `--r-1`.
- **Floating tools** (3D toolbar, zoom): white, `--r-2`, 1 px `--line`, one functional shadow.
- **FAQ-style rows**: full-width rows with a hairline under each and a "+" / chevron at the right.

## 6. Plan, 3D and report

- The 2D plan keeps its drawing conventions (walls black, clearances dashed); its paper becomes
  `--white` on the `--page` workspace, grid lines `--line-soft`, selection `--accent`.
- The 3D backdrop follows `--page` (cool), with the blue wash allowed behind outdoor sites.
- The report is a white A4 page with the same serif titles, eyebrows, chips and tables.

## 7. Rules for new work

1. Only tokens. A new colour needs a token and a line in this file.
2. One blue. Red, amber and green only for error, warning and pass.
3. Square buttons; round corners only by the scale in section 4.
4. Serif for headings only; never for controls, numbers in tables or labels.
5. No emoji in the app, no glass, no decorative shadows, no gradients except `--wash`.
