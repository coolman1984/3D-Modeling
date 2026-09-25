# TASKS

## Done: T1 — browser plan editor

**Done means:** a browser app where the owner opens the reference hall, adds tables and chairs
from a catalog, drags and rotates them, sees problems and numbers update live, undoes and redoes,
and saves/reopens a file with identical results. All edits go through core commands.
`pnpm check` (typecheck, unit tests, browser test) passes locally and in CI.

- [x] Add the article's working rules to CLAUDE.md (stops, TASKS.md, review pass, report format, UI anti-patterns)
- [x] Decision record 0002: editor stack
- [x] Scaffold `apps/editor` (Vite + React + TypeScript), wire into `pnpm check`
- [x] Pure editor logic with tests: viewport transform, snapping, id generation, formatting
- [x] Plan canvas: room, column, door swing, items, clearance zones, selection
- [x] Editing: add from catalog, drag to move (live preview), rotate, delete, lock, undo/redo, keyboard shortcuts
- [x] Side panels: selected-item inspector, problems list (click to select), numbers and bill of materials
- [x] Save/open file, autosave in the browser, new rectangular hall
- [x] Browser test: journey through the real UI + screenshot
- [x] CI installs the browser and runs the browser test
- [x] Review diff, update README/TASKS, commit, push

## Found along the way

- New items used to land on the column in the middle of the demo hall; they now go to the
  nearest free spot.
- Not in T1: editing walls, doors and columns, multi-select, copy/paste, touch gestures
  beyond single-finger drag, printing.

## Next

- T2 light 3D view of the same project, or T3 hall pack (catalog, rules, printable report).
  The owner picks the order.

## Later

- T2 light 3D view · T3 hall pack (catalog, rules, report) · T4 office pack · T5 server
- C8 walls with thickness and openings (needs the polygon engine)
