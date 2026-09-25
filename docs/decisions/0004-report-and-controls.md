# 0004: Client report and drawing-app controls

**Date:** 2026-09-25 · **Status:** accepted

## Context

The owner asked for a printable client report and for professional mouse and keyboard control
of items in both the plan and the 3D view, with adjustable precision and speed, "like the
famous graphics apps". We studied how open-source editors handle this (Excalidraw, tldraw,
Blueprint3D and three.js editors): selection sets, drag thresholds, snapping to grid and to
other shapes' edges with visible guides, axis lock with Shift, a rotation handle with angle
snapping, arrow-key nudges with Shift for big steps, and one undo step per gesture.

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Height | Optional `ItemInstance.elevation` (ticks, stored only when above 0) and an `item.elevate` command | "Move in all directions" includes up and down; optional field keeps every old save byte-identical, so no schema bump |
| Checks with height | Items overlap or take clearance only when their heights meet; the ceiling check uses elevation + height; doors, columns and blocked zones stay checked at any height | A lamp over a table is not a clash; the core does not know door heights, so it stays on the safe side |
| One gesture = one step | The session holds one `preview` command (drag, handle turn, held arrow) and commits it on release | Smooth live feedback without flooding the history and the database |
| Transforms | Pure helpers in `apps/editor/src/logic/transform.ts` return one core command (a batch for groups) | Same path as everything else; testable without a browser |
| Snapping | Guides to edges and centres of items, columns and walls within a screen distance; otherwise grid on the leading item; Ctrl or Alt turn snapping off | What drawing apps do; the guide reach is in pixels so it feels the same at any zoom |
| Precision and speed | Per-browser settings (grid, arrow / Shift / Alt steps, angle step, raise step, drag speed, Alt speed, key acceleration, guides) in local storage, validated on load | Personal preference, not part of the project |
| Mouse map | Drag empty floor = box select; middle or right button, or Space + drag = pan; wheel = zoom | Box selection needs the left button; this matches Figma, tldraw and Excalidraw |
| 3D drag | Ray onto the horizontal plane at the item's height; Shift + drag raises using metres per pixel at the item's distance; handlers run before the camera controls | The item stays under the cursor; orbiting still works on empty space |
| Report | `#/p/<id>/report` built from the saved revision: pure `buildReport`, vector plan with numbered items, a still 3D picture from its own renderer, bill of materials, issues, and a note on what the check covers; browser printing with A4 print styles | No PDF library needed; save-as-PDF comes with the browser |
| Tests | `fast-check` added to the editor's dev tools | Property tests for transforms (move / turn and back) |

## Consequences

- Keyboard arrows move along the plan's north and east even in the 3D view.
- The report is rendered in the browser; a server-side report (for official approvals) is later work.
- Items hung above others still count toward floor coverage once (their plan outlines overlap).
