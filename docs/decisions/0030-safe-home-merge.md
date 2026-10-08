# 0030 — Safe merge of walls and furnishing (8 October 2026)

## Context

PR 15 adds drawn walls and furnishing options. Three inline review findings were confirmed:
whole-wall translation shifted opening offsets twice; furnishing checks replaced customized
catalogue definitions although applying retained them; unavailable home rules were reported as
passing. Existing interrupted-work regression tests were preserved and completed.

## Decision

- Preserve an opening's local offset when both wall ends have the same translation. Continue
  adjusting offsets when only the start moves along the wall's direction.
- Resolve each furnishing placement from the existing catalogue before creating finishes, and
  preserve existing finish variants. Use that exact definition for footprint checks, evaluation,
  and emitted commands; never silently reset the person's dimensions or clearances.
- Return `unknownRules` separately from `failedRules`. UI cards and agent descriptions only
  report every check passed when neither list contains entries. The project inspector and status
  line likewise use a warning for unknown checks; compact proposal labels fit the narrow panel.
- A proposal where nothing fits uses a reversible unchanged `space.set` command instead of an
  invalid empty batch. It still reports why the room is unfurnished.
- Browser tests may use `PLANNER_TEST_BROWSER` to select an installed Chromium in a restricted
  workspace. The default and CI behaviour are unchanged; no dependency or lockfile changed.

## Branch audit

Teachers and Yousef-Transportation: all code changes are already in main; remaining unique
commit IDs are patch-equivalent documentation (confirmed with `git cherry`). No code is
replaced from older branch snapshots. Store has size zero and no open pull requests.

Only the recent home PR 15 is being merged. `claude/bold-wright-kdi8rf` (6 October) is preserved:
it changes server access to require authenticated company sessions, but includes no matching
editor sign-in journey; a trial merge also conflicts in server, store and startup files. The
older draft PRs 9 and 10 (26 September) contain competing variants implementations, remain
conflicted and are not represented as finished. `integration/production-simulation-safe`
includes PR 9's ancestry and is likewise retained for a separate tested integration.

## Verification

Regression coverage: door/window translation and start-end adjustment; oversized customized
washer refusal and matching applied check counts; kitchen-only unknown rules; server tool
wording; browser cards without a false green pass. Core save fixtures and migration tests remain
part of the complete check. Counts and final merge evidence are recorded in TASKS.md and the log.
