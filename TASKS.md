# TASKS

## Current: T1 — browser plan editor

**Done means:** a browser app where the owner opens the reference hall, adds tables and chairs
from a catalog, drags and rotates them, sees problems and numbers update live, undoes and redoes,
and saves/reopens a file with identical results. All edits go through core commands.
`pnpm check` (typecheck, unit tests, browser test) passes locally and in CI.

- [x] Add the article's working rules to CLAUDE.md (stops, TASKS.md, review pass, report format, UI anti-patterns)
- [ ] Decision record 0002: editor stack
- [ ] Scaffold `apps/editor` (Vite + React + TypeScript), wire into `pnpm check`
- [ ] Pure editor logic with tests: viewport transform, snapping, id generation, formatting
- [ ] Plan canvas: room, column, door swing, items, clearance zones, selection
- [ ] Editing: add from catalog, drag to move (live preview), rotate, delete, lock, undo/redo, keyboard shortcuts
- [ ] Side panels: selected-item inspector, problems list (click to select), numbers and bill of materials
- [ ] Save/open file, autosave in the browser, new rectangular hall
- [ ] Browser test: journey through the real UI + screenshot
- [ ] CI installs the browser and runs the browser test
- [ ] Review diff, update README/TASKS, commit, push

## Later

- T2 light 3D view · T3 hall pack (catalog, rules, report) · T4 office pack · T5 server
- C8 walls with thickness and openings (needs the polygon engine)
