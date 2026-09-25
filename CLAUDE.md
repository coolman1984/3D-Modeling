# CLAUDE.md

Guidance for AI coding agents working in this repository.

## What this is

A spatial planning platform: users lay out a measured space (hall, office, warehouse),
place items with real dimensions, and learn whether things fit and work before spending money.
Read `docs/02-core-plan.md` first (what we are building now), then `docs/01-master-plan.md`
only for long-term direction. Recorded decisions live in `docs/decisions/`.

Current focus: `packages/core`, a pure TypeScript library. No UI, server or database yet.

## Commands

```bash
pnpm install
pnpm check                         # typecheck + all tests; must pass before every commit
pnpm --filter @space-planner/core test -- test/checks.test.ts   # one file
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
7. **Close the loop.** Update the status table in `README.md`, commit with a message listing
   what changed and why, and push.

## Code style

- Match the surrounding code: small pure functions, `readonly` data, JSDoc on exported symbols
  that explains *why*, not *what*.
- Error and problem codes are stable string unions; messages are for developers.
- Tests live in `packages/core/test/`; shared scenarios live in `test/fixtures.ts`
  (reference hall 10 × 8 m with door, column, table and four chairs, and no issues).

## Talking to the project owner

The owner is not a developer. Report in short, warm Egyptian Arabic, with fitting emoji,
no English words, and no jargon: what now works, what it means for the product,
what is next. Put technical detail in commits and docs, not in the chat.
