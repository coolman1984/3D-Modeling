# 0017 — Generated docs, work log and checkpoints

## Context

The D2 session stopped halfway (the agent was interrupted). The work survived only because the
files were still on disk; nothing recorded which checklist items were finished, what was
half-written, or how to get back to a known state. `TASKS.md` helped, but it is edited by hand and
was behind the code (three items marked open were in fact written).

## Decision

- **Generated docs** (`scripts/docs.mjs`, `pnpm docs`): `docs/STATUS.md` (current stage, open items
  from `TASKS.md`, uncommitted files, recent checkpoints, how to resume), `docs/CHANGELOG.md` (from
  git), `docs/README.md` (index of all docs and decisions). They are derived, never hand-edited, and
  written only when their content changes. Plain Node, no new dependency.
- **Work log** `docs/log/YYYY-MM.md`: append-only, one line per checkpoint or note (`pnpm log`).
- **Checkpoints** (`scripts/checkpoint.mjs`, `pnpm checkpoint`): the whole working tree, including
  new files, is written as a commit on `refs/checkpoints/<branch>` through a private index, so HEAD,
  the staged files and the working files are never touched. Each checkpoint's parents are the
  previous checkpoint and HEAD, so the chain is a history of unfinished work and any snapshot
  restores with `git checkout <ref> -- .`. Changes to generated files alone make no checkpoint.
  `--push` copies the ref to GitHub for an off-machine copy.
- **Automatic triggers are opt-in per machine**: a Claude Code `Stop`/`PreCompact` hook and a git
  `post-commit` hook (`.githooks/`), documented in `docs/process/interruptions.md`. They change
  local tool settings, so the owner turns them on; an agent does not.

## Consequences

An interrupted session leaves a snapshot and a readable status behind; the next session starts from
`docs/STATUS.md`. Checkpoint refs are not branches: they do not show in `git branch`, are not pushed
unless asked, and can be deleted with `git update-ref -d refs/checkpoints/<branch>`. The generated
files change often and may show as modified after a commit; that is expected.
