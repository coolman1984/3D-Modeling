import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentStage } from './docs.mjs';

const here = dirname(fileURLToPath(import.meta.url));

test('currentStage reads the first Now section: title, finish line, open and done items', () => {
  const tasks = [
    '# TASKS', '', '## Now: D9 — thing', '', '**Finish line:** it works', 'and is tested.', '',
    '- [x] one', '- [ ] two', '- [X] three', '- [ ] four', '', '## Done: D8', '- [ ] not this',
  ].join('\n');
  assert.deepEqual(currentStage(tasks), { title: 'D9 — thing', finish: '**Finish line:** it works and is tested.', open: ['two', 'four'], done: 2 });
  assert.equal(currentStage('# TASKS\n\n## Done: x\n'), null);
});

test('checkpoint snapshots new and changed files without touching HEAD, the index or the files', () => {
  const repo = mkdtempSync(join(tmpdir(), 'cp-test-'));
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  try {
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 'test');
    mkdirSync(join(repo, 'scripts'));
    cpSync(join(here, 'checkpoint.mjs'), join(repo, 'scripts', 'checkpoint.mjs'));
    cpSync(join(here, 'docs.mjs'), join(repo, 'scripts', 'docs.mjs'));
    writeFileSync(join(repo, 'TASKS.md'), '# TASKS\n\n## Now: T\n\n- [ ] a\n');
    writeFileSync(join(repo, 'a.txt'), 'one\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'base');
    const head = git('rev-parse', 'HEAD');

    writeFileSync(join(repo, 'a.txt'), 'two\n');
    writeFileSync(join(repo, 'new.txt'), 'fresh\n');
    git('add', 'a.txt'); // staged work must survive untouched
    const run = () => execFileSync('node', ['scripts/checkpoint.mjs', 'wip'], { cwd: repo, encoding: 'utf8' });
    assert.match(run(), /Checkpoint [0-9a-f]{10}/);

    const ref = 'refs/checkpoints/main';
    assert.equal(git('rev-parse', 'HEAD'), head);
    assert.equal(git('diff', '--cached', '--name-only'), 'a.txt');
    assert.equal(git('show', `${ref}:new.txt`), 'fresh');
    assert.equal(git('show', `${ref}:a.txt`), 'two');
    assert.equal(readFileSync(join(repo, 'new.txt'), 'utf8'), 'fresh\n');

    // Only generated docs changed since: no new checkpoint.
    const first = git('rev-parse', ref);
    assert.match(run(), /No change since the last checkpoint/);
    assert.equal(git('rev-parse', ref), first);

    // A real change chains onto the previous checkpoint.
    writeFileSync(join(repo, 'new.txt'), 'fresher\n');
    run();
    assert.equal(git('rev-parse', `${ref}^1`), first);
    assert.equal(git('rev-parse', `${ref}^2`), head);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
