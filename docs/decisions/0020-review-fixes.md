# 0020 — Fixes from the 27 September source review (`bugs.md`)

## Context

A source review listed six defects (two high, three medium, one low). Each was checked against
the code before any change; all six were real. This records the behaviour changes, since two of
them change what callers must send.

## Decision

1. **Ids that are built-in object names** (`constructor`, `toString`, `__proto__` …). Core
   `apply` looks up items and catalog entries with an own-property check (`Object.hasOwn`), so
   such an id is found only when the project holds it. Existing saves are unaffected (no schema
   change; those ids stay allowed). As a second guard, `Store.applyCommands` validates the whole
   resulting project and refuses (422) anything that `getProject` could not open again.
2. **Restore needs the revision the caller last saw.** `POST /api/projects/:id/restore` now
   requires `baseRevision` (400 without it) and answers 409 with the latest project when it is
   stale, as the command endpoint already did. The agent tool `restore_revision` takes an optional
   `base_revision`. The editor sends it from all three restore buttons, shows the conflict, loads
   the newer plan, and disables restore while its own edits are unsaved.
3. **Unsaved edits retry by themselves**: when the live connection reopens, and on a timer while
   offline (2 s doubling to 30 s, `logic/retry.ts`). The browser asks before a tab with unsaved
   edits is closed or reloaded; the banner says the edits are not saved yet. Keeping edits across a
   reload (a local outbox) was not added: the warning covers the loss, and a stored outbox needs its
   own conflict rules.
4. **Settings are validated** at `PUT /api/settings` (`settingsProblems`): agents need a label, a
   non-empty command of text arguments and a true/false stdin choice; the API fields and timeout
   are type-checked; invalid input is refused with 400 and nothing is saved. Broken agents already
   stored by an older version are skipped on load. `AgentRunner.start` finishes the run record on
   any startup error (and clears its timeout), so no run is left "running" with nothing behind it.
5. **Deleting a project stops all its agents.** The runner remembers each active run's project
   (`stopProject`), instead of reading the newest 20 runs from the database.
6. **History `limit`** must be a whole number ≥ 1 (400 otherwise) and is capped at 500, in the
   route and again in `Store.history`.

Also: after `Store.close()`, late run-log and run-finish calls from stopped agents are ignored
instead of throwing on the closed database (seen during shutdown and in tests).

## Consequences

Tests: `packages/core/test/reserved-ids.test.ts` (25, including a property test that any accepted
command reopens; all 25 failed before the fix), `apps/server/test/review.test.ts` (10), browser
journey `apps/editor/e2e/review.spec.ts` (2), `apps/editor/test/retry.test.ts` (2). Planted bugs
(old stop-by-listing, no stale-restore check, no retry timer) each failed their test. One existing
server test now sends `baseRevision` with its restore, because the endpoint requires it.
