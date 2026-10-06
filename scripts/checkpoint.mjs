#!/usr/bin/env node
/**
 * Work checkpoint: snapshots the whole working tree (tracked changes and new, non-ignored files)
 * into a commit on `refs/checkpoints/<branch>`, without touching HEAD, the index or any file.
 *
 * Why: long agent sessions get interrupted (crashes, limits, closed terminals). The work in the
 * working tree survives on this machine, but nothing records *what state it was in* and a bad
 * `git checkout`/`git clean` can still lose it. Each checkpoint is a normal commit chained to the
 * previous one, so `git log refs/checkpoints/<branch>` is a history of unfinished work and any
 * snapshot can be restored with `git checkout <sha> -- .` (see docs/process/interruptions.md).
 *
 * After snapshotting it refreshes the generated docs (scripts/docs.mjs) and appends one line to
 * the work log, so the next session can resume from docs/STATUS.md.
 *
 * Usage: node scripts/checkpoint.mjs [--push] [--quiet] [message…]
 *   --push   also push the checkpoint ref to origin (off-machine copy)
 *   --quiet  print nothing on success (for hooks)
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, copyFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { updateDocs, appendLog, GENERATED } from "./docs.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const push = args.includes("--push");
const quiet = args.includes("--quiet");
const message = args.filter((a) => !a.startsWith("--")).join(" ").trim() || "checkpoint";

/** Runs git in the repository root and returns trimmed stdout. */
function git(gitArgs, env) {
  return execFileSync("git", gitArgs, {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/** Creates a checkpoint commit and returns its summary, or null when nothing changed. */
export function checkpoint(note) {
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const ref = `refs/checkpoints/${branch === "HEAD" ? "detached" : branch}`;
  const head = git(["rev-parse", "HEAD"]);
  let previous = null;
  try {
    previous = git(["rev-parse", "--verify", "--quiet", ref]);
  } catch {
    previous = null;
  }

  // A private index, seeded from the real one, so `git add -A` never disturbs staged work.
  const dir = mkdtempSync(join(tmpdir(), "checkpoint-"));
  const index = join(dir, "index");
  try {
    const realIndex = git(["rev-parse", "--git-path", "index"]);
    const realIndexPath = realIndex.match(/^[a-zA-Z]:|^\//) ? realIndex : join(root, realIndex);
    if (existsSync(realIndexPath)) copyFileSync(realIndexPath, index);
    const env = { GIT_INDEX_FILE: index };
    git(["add", "-A", "--", "."], env);
    const tree = git(["write-tree"], env);

    // Generated status and log files change on every run; they alone never make a checkpoint.
    const against = previous ?? head;
    const meaningful = git(["diff", "--name-only", against, tree])
      .split("\n")
      .filter((path) => path && !GENERATED.some((prefix) => path.startsWith(prefix)));
    if (meaningful.length === 0) return null;

    const changed = git(["diff", "--name-only", head, tree]).split("\n").filter(Boolean);
    const body = `${note}\n\nbranch: ${branch}\nbase: ${head}\nfiles changed vs base: ${changed.length}`;
    const parents = previous ? ["-p", previous, "-p", head] : ["-p", head];
    const commit = git(["commit-tree", tree, ...parents, "-m", body]);
    git(["update-ref", "-m", `checkpoint: ${note}`, ref, commit]);
    return { ref, commit, branch, head, changed };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(fileURLToPath(import.meta.url)).toLowerCase() === resolve(process.argv[1]).toLowerCase();
if (isMain) {
  try {
    const result = checkpoint(message);
    if (result) {
      appendLog(root, `checkpoint \`${result.commit.slice(0, 10)}\` on \`${result.branch}\`: ${message} (${result.changed.length} files differ from HEAD)`);
      if (push) git(["push", "--quiet", "origin", `${result.ref}:${result.ref}`]);
    }
    updateDocs(root);
    if (!quiet) {
      console.log(result
        ? `Checkpoint ${result.commit.slice(0, 10)} -> ${result.ref} (${result.changed.length} files differ from HEAD)`
        : "No change since the last checkpoint; docs refreshed.");
    }
  } catch (error) {
    // Never fail a hook or a session over a checkpoint; report and exit cleanly.
    console.error(`checkpoint failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = quiet ? 0 : 1;
  }
}
