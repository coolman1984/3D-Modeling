# Handoff plan: close out D2 (for Claude Sonnet 5, effort high)

One-shot plan: follow it top to bottom, finish at **THE END**, then stop. Written 2026-09-26 by
the previous agent (Opus 5.5) after an interrupted session. Everything the work needs is in this
file, `CLAUDE.md`, `DESIGN.md`, `TASKS.md` and `docs/STATUS.md`.

**Finish line (done means):** on branch `claude/d1-sample-company`, one clean commit on top of
`b292f17` holds all D2 work below; `pnpm check` (typecheck + all unit suites + all browser
journeys) passes; every screen was looked at in a browser against `DESIGN.md`; `README.md`,
`TASKS.md` and the generated docs are current; the branch is pushed. **Not** in scope: T11,
new features, new dependencies, any change to `packages/core`.

---

## 0. Rules you must keep (from CLAUDE.md, short form)

- `packages/core` is pure and untouched in D2. `git diff b292f17 -- packages/core` must be empty.
- Integers in storage, immutable state, changes only through core commands; the UI never edits a
  project directly. Saves are forever (no save-format change in D2).
- Tests: when one fails, decide which side is wrong and write down why. Never weaken or skip a
  test to get green. A timeout that only happens under full-suite load may get an explicit budget
  only if the test does not assert speed (two already do, with a comment saying so).
- No new runtime dependency. No `git push --force`, no history rewrite, no deleting files you did
  not create. Stop and ask the owner for anything destructive or any product decision.
- Report to the owner in English (the owner's global instruction overrides the project's Arabic
  rule because the terminal cannot show Arabic). End with: Needed from you / What changed /
  What I found.
- After every finished step run `pnpm checkpoint "<step>"` (snapshot, never touches the branch).

## 1. Technology map (where things live)

| Layer | Tech | Key files |
|---|---|---|
| Core model | TypeScript, no deps, vitest + fast-check | `packages/core/src` (commands, checks, geometry) |
| Activity packs | TypeScript | `packages/starter/src` (hall, office, container, warehouse, production, depot, restaurant, **site**, samples) |
| Routing | TypeScript | `packages/industry/src` (floor raster, Dijkstra, Dubins) |
| Server | Node 22, `node:sqlite`, HTTP, MCP | `apps/server/src` (`store.ts`, `http.ts`, `tools.ts`) |
| Editor | React 19, Vite (rolldown), three.js, Phosphor icons | `apps/editor/src` |
| Browser tests | Playwright (Chromium, SwiftShader) | `apps/editor/e2e/*.spec.ts`, config `apps/editor/playwright.config.ts` |
| Docs system | Node scripts | `scripts/docs.mjs`, `scripts/checkpoint.mjs`, `docs/process/interruptions.md` |

Commands: `pnpm install` · `pnpm typecheck` · `pnpm test` (also runs `node --test scripts/docs.test.mjs`)
· `pnpm e2e` · `pnpm check` (all three) · `pnpm docs` · `pnpm checkpoint "msg"` · `pnpm log "msg"`.

## 2. What D2 contains (review this; do not rebuild it)

| Area | What | Files / functions |
|---|---|---|
| Samsung sample | 10 illustrative projects, campus 336,000 m² | `starter/src/samsung.ts` (`samsungSample`), `sampleKit.ts`, `sampleCompanies.ts` (`SAMPLE_COMPANIES`, `sampleCompany`) |
| Site pack | buildings, trees, buses, bays; rule `building-boundary` | `starter/src/site.ts` (`checkSite`, `siteMetrics`, `SITE_CATALOG`) |
| Depot fixes | bay entry stops with body centred; obstacle prefilter | `starter/src/depot.ts` (`bayEntry`, `referenceVehicleFor`) |
| Server | project `collection` column, `GET /api/samples`, `POST /api/samples/:id` | `server/src/store.ts`, `http.ts`, `tools.ts` |
| Projects page | grouped by company, sample menu, dark hero band | `editor/src/pages/ProjectsPage.tsx` |
| 3D engine v2 | textures, sky/sun, AO still pass, render on demand, static shadows | `editor/src/ui/View3D.tsx`, `environment3d.ts`, `textures.ts`, `models3d.ts` |
| Graphics levels | Fast / Balanced (default) / High, toolbar button, auto step-down | `editor/src/logic/graphics.ts` (`QUALITY_PROFILES`, `FrameWatch`, `lighter`, `loadQuality`), decision 0018 |
| Arrow keys | visible auto step, view moves with nothing selected, tick box fix | `editor/src/logic/controls.ts` (`niceStep`, `arrowSteps`, `ownsKeys`, `autoStep`), `EditorPage.tsx` key handler, `View3D.tsx` `onKey`, `Panels.tsx` switch |
| Container tools | Cargo type / Delivery drop / Weight / Load order + hint | `editor/src/ui/Container.tsx` (`ContainerViewTools`, `COLOR_BY_HINT`, `colorsOf`) |
| Design | Paradigm look | `DESIGN.md`, `editor/src/styles.css` (tokens + "Paradigm layer" at the end), decision 0019 |
| Docs system | STATUS / CHANGELOG / index / work log / checkpoints | `scripts/*.mjs`, decision 0017 |
| Decisions | 0016 (Samsung + 3D v2), 0017, 0018, 0019 | `docs/decisions/` |

## 3. Steps

### Step 1 — Preconditions (gate)

1. `git log -1 --format="%h %an %s"`. If it prints `3b54ab0 t base`, the owner has **not** yet undone
   the accidental commit. **Stop** and ask them to type, in the prompt:
   `! git reset --mixed b292f17`, `! git config --local --unset user.email`,
   `! git config --local --unset user.name`, `! del a.txt`. Do not do it another way yourself;
   an earlier attempt was refused by the permission check on purpose. Continue only when
   `git log -1` shows `b292f17` and `git config --local --get user.name` prints nothing.
2. `git status --short` must list the D2 files from section 2 as modified or new. Nothing may be
   staged. `a.txt` must not exist.
3. `node --version` ≥ 22; `pnpm install` (no lockfile change expected; if the lockfile changes,
   stop and find out why).
4. If a build fails with `EPERM` on `apps/editor/dist`, the old folder belongs to another
   Windows identity: move it aside (`Move-Item apps/editor/dist apps/editor/node_modules/.stale-dist-<date>`)
   and build again. Do the same for `apps/server/dist` if needed.

Checkpoint: `pnpm checkpoint "handoff: preconditions ok"`.

### Step 2 — Static checks

1. `pnpm typecheck`: all five packages clean.
2. `git diff b292f17 -- packages/core` is empty.
3. Warm-colour sweep (design regression guard), with the Grep tool, case-insensitive, in
   `apps/editor/src`: pattern `#(f3f2ee|efede8|1a1917|5e5a52|8b867c|2b54d0|b93a2e)|0x(efede8|2b54d0)`
   must find nothing (it found nothing at handoff). Physical 3D material colours in `models3d.ts` / `textures.ts` are allowed.
4. No `zz-*.spec.ts` file exists in `apps/editor/e2e` (temporary specs were deleted).

### Step 3 — Unit tests

`pnpm test`. Expected at the last run: core 148, industry 16, starter 112, server 30,
editor 47 (plus 2 `node:test` for scripts). If a test fails, open it, decide which side is wrong,
fix the code (or, only with a written reason, the expectation). Checkpoint after green.

### Step 4 — Browser suite

`pnpm e2e` (about 6 minutes, 20 journeys in 10 files, including the new `controls.spec.ts`
arrow-keys journey and the `sample.spec.ts` Samsung journey). Journeys changed in D2 and what they prove:
- `office.spec.ts`: office catalog now 25 types (5 fit-out items added), 50 after adding hall items.
- `container.spec.ts`: "Delivery drop" appears once a piece has a drop, the hint text, "Load order",
  "Loading step 2 of 10"; the "Cut away side wall" tick box keeps focus and arrows still move the
  pallet (a planted bug here was caught).
- `controls.spec.ts`: Shift+Arrow = 10 × the status-bar arrow step (`data-testid="arrow-step"`);
  arrows pan the plan with nothing selected; arrows turn the 3D camera (canvas pixels change).
- `sample.spec.ts`: both sample companies; graphics button cycles and is remembered.

If `controls.spec.ts` "in 3D an item slides…" times out on `page.screenshot`, the 3D frame is too
slow in the test browser: confirm `data-quality="fast"` is set on `[data-testid=view3d]` (software
renderer ⇒ Fast); if not, fix the detection in `View3D.tsx`, not the test.

Checkpoint after green.

### Step 5 — Look at every screen (browser review)

Write a temporary spec (e.g. `apps/editor/e2e/zz-shots.spec.ts`) that screenshots, at 1440 × 900:
projects (empty, sample menu open, with both companies), editor plan with a selection, split view,
container 3D with the colour tools, Samsung campus 3D, report, settings, create dialog. Read every
image and check it against `DESIGN.md`:
- [ ] dark top bar; square buttons; primary black (white on dark); one blue accent
- [ ] cool page (`#f5f6f8`), no beige left anywhere; hairline borders
- [ ] serif only for headings; eyebrow labels small uppercase grey
- [ ] projects hero band full width, frame lines, menus open **over** the list (not under it)
- [ ] create dialog: activity cards in two columns, no overlapping text
- [ ] container tools read "Cargo type · Weight · Load order" (+ "Delivery drop" only with drops)
- [ ] status bar shows "Arrow N cm"; 3D toolbar ends with the graphics level button
Fix what fails (CSS tokens first). Delete the temporary spec afterwards.

### Step 6 — Docs

1. `README.md` status table (Arabic, for the owner): add one row after the D2 rows:
   `| د٢ب — شكل جديد لكل الشاشات زي «باراديم»، أسهم الكيبورد بقت واضحة، وألوان الحاوية بقت مفهومة | ✅ |`
2. `TASKS.md`: tick the remaining D2 items that are now true (full `pnpm check`, browser review,
   undo of the accidental commit); add anything new under "Found along the way (D2)".
3. `pnpm docs` (refreshes STATUS, CHANGELOG, index).

### Step 7 — Review, then commit

1. Read the whole diff as a reviewer (`git diff`, `git status`); list only merge-blocking problems;
   fix them; rerun the affected tests.
2. Stage explicitly (never `git add -A`; `.claude/` must stay out):
   `git add TASKS.md README.md CLAUDE.md DESIGN.md .gitignore package.json .githooks scripts docs apps packages`
   then `git status --short` and confirm nothing under `.claude/` is staged.
3. Commit (the attribution lines are required):
   ```
   D2: Samsung Egypt sample, site pack, 3D engine v2, graphics levels, Paradigm design, docs system

   What changed and why:
   - Samsung Electronics Egypt sample company (10 illustrative projects from public figures,
     decision 0016); site pack with building-boundary rule; bay-entry fixes.
   - Server: project collections, GET /api/samples, POST /api/samples/:id.
   - 3D engine v2 (textures, sky/sun, AO still pass, render on demand, static shadows) and graphics
     levels Fast/Balanced/High with automatic step-down (decision 0018); the owner's laptop lagged.
   - Arrow keys: visible auto step that follows the zoom; arrows move the view with nothing
     selected; a clicked tick box no longer switches the arrows off.
   - Container colour tools say what they mean (Cargo type / Delivery drop / Weight / Load order).
   - Paradigm visual system (DESIGN.md, decision 0019) across all screens.
   - Docs system: generated STATUS/CHANGELOG/index, work log, checkpoints (decision 0017).
   - Tests: Samsung, graphics, arrow-step unit tests; browser journeys for both samples, arrow
     keys, tick-box focus; stale counts updated with reasons.

   Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
   ```
4. `git log -2 --format="%h %an %s"`: the new commit's author must be `work_dashboard`, parent `b292f17`.

### Step 8 — Push

`git push origin claude/d1-sample-company` (a normal push; the remote branch is at `b292f17`, so
it fast-forwards). If the push is rejected, **stop** and report; never force. Opening a pull
request is optional and only if the owner asks.

Final checkpoint: `pnpm checkpoint "D2 closed and pushed"`, then `pnpm docs`.

---

## THE END

When Step 8 is done, write the owner's report (English, three parts) and **stop**. Do not start
T11 (accounts, companies, collaboration): it needs product decisions from the owner (who signs
in, where the shared server runs, what companies may see) that are not written down yet.
