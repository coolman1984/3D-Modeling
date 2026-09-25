# Atrium redesign: audit and mapping

The approved visual target lives in `design-reference/` (Claude Design export: `Atrium * v2.dc.html`
are the final screens, the files without `v2` are an earlier round). It is a **visual and UX
reference only**. Its logic (`atrium-data-v2.js`, the `<script>` blocks) is a mock: fake checks,
fake history, fake agent steps. None of it replaces product code.

## 1. What the prototype is made of

| Prototype part | Status in the real app |
|---|---|
| Warm-neutral shell, Newsreader serif headings, Geist sans controls, thin borders, one blue accent | Adopted as the new visual system (`apps/editor/src/styles.css`) |
| Phosphor "light" icons (via iconify CDN) | Adopted, bundled from `@phosphor-icons/react` (no CDN at runtime) |
| Google Fonts link | Replaced by bundled `@fontsource-variable/*` fonts (the app must work offline) |
| HTML/CSS-div plan drawn in percentages of a fixed 24 × 16 m room | **Prototype-only.** The real SVG `PlanCanvas` (pan, zoom, snapping, guides, marquee, rotate handle) stays; only its look changes |
| CSS-3D "scene" of boxes and discs | **Prototype-only.** The real three.js `View3D` stays; its toolbar and colours change |
| `check()` in `atrium-data-v2.js` (hard-coded findings such as "T-06 overlaps C-03") | **Prototype-only.** Findings come from `checkProject` (core) and `checkPack` (starter) |
| Hard-coded history, agent steps and agent log | **Prototype-only.** History comes from the store; agent progress from the real run log |
| Layers panel (show / hide / lock layers) | **Prototype-only, not built.** The model has no layers; adding them is a product decision |
| Door swing direction select, wall thickness field, "More structure · coming later" | **Prototype-only, not built.** The room model has no such fields |
| "Compare" revision button (disabled in the mockup) | Not built |
| Settings: workspace name, prepared-by, units, language, per-tool permissions, default planner | **Prototype-only, not built.** No backend for them; faking them would mislead |
| "Continue where you left off", project list/grid, templates | Built from real data (most recent project, real thumbnails, real check counts) |

## 2. Every existing function and its new place

| Existing function (before) | New location |
|---|---|
| Project list, open | Projects page: "Continue" card + list/grid rows |
| Create project (name, width, depth, ceiling, activity) | Projects page → "Create project" dialog (activity cards, size fields, live room preview, templates) |
| Try the demo hall | Create dialog → template "Demo hall 10 × 8 m" |
| Import a project file | Projects page → "Open file" button |
| Duplicate / delete project | Row "…" menu; editor "…" menu |
| Settings link | Top navigation (projects, settings) and the gear at the bottom of the editor tool rail |
| Rename project (double-click) | Editor top bar, project name (double-click) |
| Save state | Top bar dot: "Saved · Revision N" / "Saving…"; connection-lost banner with "Try again" |
| Undo / redo | Top bar icons (Ctrl Z / Ctrl Y unchanged) |
| Plan / 3D / Split | Top bar segmented control |
| Fit the whole room | Plan zoom control, 3D camera toolbar, status bar, key F |
| Snap step (none / 1 / 5 / 10 cm) | Precision panel grid control; status bar "Snap on/off" toggle |
| Export project file | Editor "…" menu (and the projects row menu) |
| Client report link | Top bar "Client report" |
| Item types list, search, add to plan | Left rail "Library": search, category tabs, tile grid; click or drag onto the plan |
| Bring in the pack's missing item types | Library footer button |
| New / edit / delete item type | "New item type" button and "Edit item type" link → item type dialog |
| Room size, ceiling, doors, columns | Left rail "Space" panel with Reset / Apply changes bar |
| Precision and speed settings, shortcuts | Left rail "Precision" panel |
| Selected item: exact position, height, angle, turn, lock, duplicate, delete | Right inspector "Properties" (one item) |
| Several items: move by, align, distribute, turn | Right inspector "Properties" (multiple selection) |
| Metrics (seats, items, floor, occupied) and bill of materials | Right inspector "Properties" with nothing selected: facts + Quantities |
| Issues list (click selects) | Right inspector "Review": counts, grouped findings |
| Activity rules, activity and style choice | Right inspector "Review" → "Planning rules" |
| History and restore | Right inspector "History" (now also "Preview" a revision before restoring) |
| AI agent: prompt, agent choice, start, stop, live log | Top bar "AI Planner" → planner panel in the right column |
| 3D: full / short walls, save picture | 3D camera toolbar (section toggle, save image) plus new orbit and top-view buttons |
| Notices (saved elsewhere, rejected command, copied…) | Toast at the bottom of the workspace (`role="status"`) |
| Printable report | Report page as A4 sheets: cover, plan, 3D + quantities, rules + issues |
| Agent settings (CLI commands, API key, model, address, timeout), MCP hint | Settings → "AI Providers" and "Agent Tools" |

New, small, and built on existing logic only: drag a library tile onto the plan (same placement as a
click), an Objects list (select by type), revision preview (read-only, from the existing revision
endpoint), orbit left/right and top view in 3D, and a live "AI Planner is editing" banner.

## 3. Rules kept

- No change to `packages/core`. Geometry, checks, commands and undo stay as they are.
- Every UI action is still a core command sent through the store (one revision per step).
- Test ids and form field names used by the browser tests are kept; visible text is now English.
