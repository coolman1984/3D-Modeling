# CLAUDE.md

Guidance for AI coding agents working in this repository.

## What this is

A spatial planning platform: users lay out a measured space (hall, office, warehouse),
place items with real dimensions, and learn whether things fit and work before spending money.
Read `docs/03-industrial-packs-plan.md` first (current roadmap: T5–T11), `docs/02-core-plan.md`
for the core, and `docs/01-master-plan.md` only for long-term direction. Recorded decisions live in `docs/decisions/`.

Layout:

| Path | What |
|---|---|
| `packages/core` | Pure TypeScript: units, geometry, model, commands, checks, metrics, save format |
| `packages/industry` | Pure TypeScript shared by industrial packs: floor grid, distance transform, reachability, travel distances and routes for a mover of a given width; deterministic line simulation |
| `packages/starter` | Activity packs (hall, office, container, warehouse, factory: catalogs, styles, rules in `PACKS`), shared rules, packer, 3D shape keys, room templates (activity knowledge lives here, not in core) |
| `apps/server` | Local server: SQLite store (projects, revisions, settings, agent runs), HTTP API, live events, agent tools, MCP bridge, agent runner |
| `apps/editor` | React editor: projects page, 2D plan, 3D view, room and item-type editors, history, agent panel, settings |
| `scripts/start.mjs` + `start.*` | One-click launcher |

Agents that design spaces (not code) use the planner tools: see `docs/agents.md`.

## Commands

```bash
pnpm install
pnpm check                         # typecheck + unit tests + browser tests; must pass before every commit
pnpm dev                           # editor with hot reload (needs the server: node apps/server/dist/server.mjs)
pnpm --filter @space-planner/core test -- test/checks.test.ts   # one file
./start.sh                         # what the owner runs (start.bat on Windows)
```

## Core invariants (never break these)

- **Pure.** `packages/core/src` imports nothing outside itself: no runtime dependencies,
  no DOM, no Node APIs, no `Date`, no `Math.random`. `test/architecture.test.ts` enforces it.
- **Integers in storage.** Lengths are integer ticks (1 tick = 0.1 mm); angles are integer
  millidegrees in `[0, 360000)`. Floats exist only in derived geometry and display conversions.
- **Immutable state, changed only by commands.** `apply(project, command)` returns a new project
  plus the inverse command. Never mutate a `Project`.
- **Integrity vs design.** Commands reject broken *data* (bad numbers, duplicate ids, broken
  references). They never reject *design* problems (overlaps, blocked doors); `checkProject`
  reports those as issues with amounts, and the user decides.
- **Missing data is "unknown", never "pass".**
- **No activity knowledge in the core.** The core knows items, footprints and clearances,
  not "wedding chairs" or "pallet racks". Those belong to future activity packs.
- **Saves are forever.** Never merge a change that makes an existing save file fail to open.
  Bump `SCHEMA_VERSION` and add a step to `MIGRATIONS` instead.
- **Deterministic output.** Same input, same result, same order (no locale-aware sorting).
- **Derived data is never stored.** The spatial index is rebuilt from the project and must give the
  same issues as the all-pairs check (`checkProject(p, { spatialIndex: false })`).
- **Pack data lives in `meta`.** The core validates its shape only; packs give it meaning. New
  universal fields are optional and stored only when set, so old saves stay byte-identical
  (`packages/core/test/saves/`).
- **Rules name their source.** Every pack threshold has a `RuleSource`; nothing is presented as a
  verified regulation unless a person verified it.

## When to keep going and when to stop

When a step doesn't need the owner's input, keep going. Put status notes in the same message
as your next action; don't end a turn with "want me to continue?" or a list of options that
don't block the work.

Stop and ask only when you can't continue without the owner (a product decision, missing
information, access you don't have), or before anything destructive: deleting data or files you
didn't create, force-pushing, rewriting history, or changing anything outside this repository.

## Long tasks

- Keep the task list in `TASKS.md`: a checklist with the finish line at the top. Tick items as
  they're done and add anything new you find. It survives context summaries; the chat doesn't.
- Every task starts from a stated finish line ("done means: …"). If the request has none, write
  one at the top of `TASKS.md` from the plan's done criterion before starting.
- Split broad audits or reviews across subagents only when the work is genuinely parallel, and
  check each subagent's evidence before accepting it.

## How to work

1. **Plan the stage before coding.** Each stage in `docs/02-core-plan.md` has a done criterion.
   State which one you are meeting.
2. **Write reference cases with hand-computed numbers**, plus property tests (fast-check)
   for invariants such as symmetry, round-trips and undo restoring the original.
3. **Verify, don't assume.** Run `pnpm check` and read the output. When everything passes on the
   first try, plant a deliberate bug and confirm a test fails, then restore the code.
4. **When a test fails, decide which side is wrong, and say why.** Fix the code if the code is
   wrong. Change an expectation only when you can explain why the new value is correct.
   Never weaken or skip a test to get green.
5. **Keep diffs minimal and in scope.** Add no features, dependencies or abstractions the
   current stage does not need. A new runtime dependency needs a decision record first.
6. **Record decisions.** Any architectural choice or deviation from the plan gets a short entry
   in `docs/decisions/` (context, decision, consequences).
7. **Review before you commit.** Re-read the diff as a reviewer would, listing only problems
   you'd block the merge for. Fix them, then commit.
8. **Close the loop.** Update the status table in `README.md`, commit with a message listing
   what changed and why, and push.

## Code style

- Match the surrounding code: small pure functions, `readonly` data, JSDoc on exported symbols
  that explains *why*, not *what*.
- Error and problem codes are stable string unions; messages are for developers.
- Tests live in `packages/core/test/`; shared scenarios live in `test/fixtures.ts`
  (reference hall 10 × 8 m with door, column, table and four chairs, and no issues).

## User interface

- The approved visual target is the "Atrium" Claude Design export in `design-reference/`
  (`Atrium * v2.dc.html`). It is a visual reference only: never copy its mock logic.
  See `docs/redesign-audit.md` and decision 0007.
- UI text is English, left-to-right; the plan canvas keeps its own math orientation (X east, Y north).
- Visual system: tokens on `:root` in `apps/editor/src/styles.css` (warm-neutral page, Newsreader serif
  headings, Geist controls, thin borders, one blue accent; red, amber and green only for error,
  warning and pass). Icons are Phosphor "light" from `@phosphor-icons/react`; fonts are bundled.
- It is a working tool: the plan is the hero. No gradients or glass except the 3D backdrop, no
  pill buttons, no emoji inside the app, only functional shadows (menus, dialogs, floating tools).
- Every UI change goes through core commands; the UI never edits a project directly.
- Agents and people share one path: server tools → core commands → one revision with the actor's name.
  Never add a way to change a project that skips the store.

## Talking to the project owner

The owner is not a developer. Report in short, warm Egyptian Arabic, with fitting emoji,
no English words, and no jargon: what now works, what it means for the product,
what is next. Put technical detail in commits and docs, not in the chat.

End every run with three short parts, in this order:
1. **Needed from you**: decisions or approvals you are waiting on (say "nothing" if none).
2. **What changed**.
3. **What I found**: surprises, risks, and anything you could not confirm, with where you looked.
