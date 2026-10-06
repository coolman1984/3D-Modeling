'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, mkdtempSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { countProjects, prepareCopy, putBack, swapIn, ImportError } = require('../projects.cjs');

function projectsFile(path, names) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT)');
  const add = db.prepare('INSERT INTO projects VALUES (?, ?)');
  names.forEach((name, i) => add.run(`p${i}`, name));
  return db; // left open, like a running browser version
}

test('projects still only in the other copy\'s -wal file come across', () => {
  const dir = mkdtempSync(join(tmpdir(), 'atrium-'));
  const source = join(dir, 'old.db');
  const running = projectsFile(source, ['Hall', 'Office', 'Warehouse']);
  assert.ok(existsSync(`${source}-wal`));
  const data = mkdtempSync(join(tmpdir(), 'atrium-data-'));
  const { temp, projects } = prepareCopy(source, data, 's1');
  assert.equal(projects, 3);
  assert.equal(countProjects(temp), 3);
  running.close();
});

test('the projects already here are kept in backups/ and the copy takes their place', () => {
  const dir = mkdtempSync(join(tmpdir(), 'atrium-'));
  const source = join(dir, 'old.db');
  projectsFile(source, ['A', 'B']).close();
  const data = mkdtempSync(join(tmpdir(), 'atrium-data-'));
  projectsFile(join(data, 'planner.db'), ['Mine']).close();
  const { temp } = prepareCopy(source, data, 's2');
  const kept = swapIn(data, temp, 's2');
  assert.equal(kept, join(data, 'backups', 'before-import-s2.db'));
  assert.equal(countProjects(kept), 1);
  assert.equal(countProjects(join(data, 'planner.db')), 2);
  assert.equal(existsSync(temp), false);
});

test('a first import has nothing to keep', () => {
  const dir = mkdtempSync(join(tmpdir(), 'atrium-'));
  projectsFile(join(dir, 'old.db'), ['A']).close();
  const data = mkdtempSync(join(tmpdir(), 'atrium-data-'));
  const { temp } = prepareCopy(join(dir, 'old.db'), data, 's3');
  assert.equal(swapIn(data, temp, 's3'), undefined);
  assert.equal(countProjects(join(data, 'planner.db')), 1);
});

test('other files are refused with a plain message and nothing is left behind', () => {
  const dir = mkdtempSync(join(tmpdir(), 'atrium-'));
  const text = join(dir, 'notes.db');
  writeFileSync(text, 'not a database');
  const other = join(dir, 'other.db');
  new DatabaseSync(other).exec('CREATE TABLE things (x)');
  const data = mkdtempSync(join(tmpdir(), 'atrium-data-'));
  assert.throws(() => prepareCopy(text, data, 's4'), (e) => e instanceof ImportError && /not an Atrium projects file/.test(e.message));
  assert.throws(() => prepareCopy(other, data, 's4'), /not an Atrium projects file/);
  assert.throws(() => prepareCopy(join(dir, 'missing.db'), data, 's4'), /was not found/);
  assert.equal(existsSync(join(data, 'incoming-s4.db')), false);
  assert.equal(countProjects(join(data, 'planner.db')), undefined);
});

test('when the copy cannot be put in place, the projects here come back', () => {
  const data = mkdtempSync(join(tmpdir(), 'atrium-data-'));
  projectsFile(join(data, 'planner.db'), ['Mine']).close();
  assert.throws(() => swapIn(data, join(data, 'incoming-gone.db'), 's5'), (e) => e instanceof ImportError);
  assert.equal(countProjects(join(data, 'planner.db')), 1);
  assert.equal(existsSync(join(data, 'backups', 'before-import-s5.db')), false);
});

test('brought projects the program cannot open are set aside and the ones here return', () => {
  const dir = mkdtempSync(join(tmpdir(), 'atrium-'));
  projectsFile(join(dir, 'old.db'), ['New1', 'New2']).close();
  const data = mkdtempSync(join(tmpdir(), 'atrium-data-'));
  projectsFile(join(data, 'planner.db'), ['Mine']).close();
  const { temp } = prepareCopy(join(dir, 'old.db'), data, 's6');
  const kept = swapIn(data, temp, 's6');
  const refused = putBack(data, kept, 's6');
  assert.equal(countProjects(join(data, 'planner.db')), 1);
  assert.equal(countProjects(refused), 2);
  assert.equal(existsSync(kept), false);
});
