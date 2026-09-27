# Code review findings

> **Status (27 Sep 2026): all six confirmed and fixed** with regression tests; see decision
> [0020](docs/decisions/0020-review-fixes.md). Kept here as the original report.

Reviewed on 27 September 2026. Scope: the core command and validation path, the local server and store, agent lifecycle, and editor saving/history behavior. Findings below are ordered by impact. This was a source review; I did not run the application or test suite. Each finding includes a concrete trigger and a proposed fix. No application code was changed.

## 1. High — reserved object property names can make a project impossible to reopen

**Where:** `packages/core/src/commands/apply.ts:50-60`, `packages/core/src/commands/apply.ts:130-143`, `packages/core/src/model/validate.ts:154-175`, `apps/server/src/store.ts:183-186`.

**Trigger:** Send `item.add` through `/api/projects/:id/commands` with a structurally valid item whose `definitionId` is `constructor`, while the catalog has no such definition. `project.catalog[item.definitionId]` resolves to the inherited `Object` constructor, so the command accepts a broken reference. The store writes that revision. When `getProject` next deserializes it, validation checks the catalog's own keys, finds no `constructor` definition, and throws `stored project is invalid`. The same inherited-property problem affects lookups for item IDs and catalog IDs such as `__proto__`, `constructor`, and `toString`.

**Impact:** An accepted API/agent command can strand the latest saved revision and make normal project loading fail with HTTP 500.

**Suggested fix:** Use own-property checks for catalog/item lookups (`Object.hasOwn`) or store ID maps in null-prototype objects. Reject reserved IDs at validation if that is the chosen schema policy. Validate the full resulting project before committing any command, and add regression cases for these IDs and reopening the stored revision.

## 2. High — restoring history can silently overwrite changes made elsewhere

**Where:** `apps/server/src/store.ts:191-197`, `apps/server/src/http.ts:206-212`, `apps/editor/src/api.ts:75-76`, `apps/editor/src/pages/EditorPage.tsx:696-709`.

**Trigger:** Window A previews an old revision. Window B or an agent saves a new change. Window A then clicks **Restore revision**. The restore request contains only the target revision; `Store.restore` reads the current revision and commits the old snapshot over it, without checking the revision Window A last saw. The normal command endpoint already has a `baseRevision` conflict check, but restore bypasses it.

**Impact:** A newer plan is replaced unexpectedly. Its revision remains in history, but the live plan and any subsequent edits start from the restored version.

**Suggested fix:** Require `baseRevision` for restore, check it against the latest revision in the same store operation, and return 409 with the latest project on mismatch. Have the editor show that conflict and let the user review the newer version before retrying. Also prevent restore while local edits are still in the outbox.

## 3. Medium — offline edits do not retry when the server reconnects

**Where:** `apps/editor/src/pages/EditorPage.tsx:209-227`, `apps/editor/src/pages/EditorPage.tsx:242-262`, `apps/editor/src/pages/EditorPage.tsx:596-605`.

**Trigger:** A save request fails while the server is down. The command stays in the in-memory outbox and the banner says it "will be saved when the server is back." When the event stream reconnects, its `open` callback only refreshes if there are no pending edits. The save effect does not depend on connection state and has no timer, so the failed command stays unsent until the user presses **Try again** or makes another edit. Refreshing or closing the tab then loses those pending changes.

**Suggested fix:** On reconnect, trigger a save retry for a nonempty outbox; add bounded retry/backoff for cases where the event stream cannot reconnect. Change the banner to describe the actual pending state and explicitly warn before leaving with unsaved edits. Persist the outbox locally if retaining edits across a refresh is required.

## 4. Medium — malformed settings can break agent listing and leave a run stuck

**Where:** `apps/server/src/http.ts:224-226`, `apps/server/src/settings.ts:68-87`, `apps/server/src/agents.ts:61-65`, `apps/server/src/agents.ts:92-101`, `apps/server/src/agents.ts:134-139`.

**Trigger:** `PUT /api/settings` accepts JSON such as `{"agents":{"broken":{}}}`. `saveSettings` stores it without validating each agent's `command`. `GET /api/agents` then throws when it reads `agent.command[0]`. Starting that agent creates a `running` database record first, then throws at `agent.command.length` before reaching the normal failure handling. The timeout eventually fires, but the run can remain marked running because no active process was registered to stop.

**Suggested fix:** Validate the complete settings payload at the HTTP boundary, including agent command arrays, labels, prompt flags, API fields, and finite timeout. Reject invalid input with 400 without saving it. Validate configuration before calling `createRun`, and ensure every failed startup finishes its database record.

## 5. Medium — deleting a project can leave older active agents running

**Where:** `apps/server/src/http.ts:166-169`, `apps/server/src/http.ts:257-259`, `apps/server/src/store.ts:276-280`.

**Trigger:** More than 20 runs are active for a project. Deletion calls `runnerStopForProject`, which uses `store.listRuns(projectId)` with its default limit of 20. Older active runs are omitted, so their child processes/API loops continue after the project and run records are deleted by the database cascade.

**Impact:** Orphaned agents can consume resources and keep calling tools against a project that no longer exists.

**Suggested fix:** Stop active runs by project ID directly from `AgentRunner`, or query all `status = 'running'` rows without the UI listing limit. Wait for shutdown before deleting the project, or explicitly account for late agent callbacks.

## 6. Low — negative history limits bypass the endpoint cap

**Where:** `apps/server/src/http.ts:196-199`, `apps/server/src/store.ts:200-205`.

**Trigger:** `GET /api/projects/:id/history?limit=-1` passes `-1` through `Math.min(500, ...)`. SQLite treats `LIMIT -1` as unlimited, so the endpoint reads and serializes every revision despite the intended 500-entry cap.

**Suggested fix:** Parse an integer and clamp it to `1..500`; return 400 for invalid values. Apply the same bound in `Store.history` so callers outside HTTP cannot bypass it.

## Review limits

This is a focused source review, not a claim that every path in the repository is bug free. The scenarios above were traced through code and existing tests; they were not executed during this review. The existing test files cover ordinary command, restore, settings, and agent flows, but the specific triggers above are not covered.
