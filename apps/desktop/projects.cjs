// Bringing projects over from another copy (the browser version or a portable copy) into the
// desktop program's projects folder. The other copy may still be open: SQLite's VACUUM INTO makes
// a consistent standalone copy that includes what is still in its -wal file. The projects already
// here are kept in backups/ first, so the step can always be undone by hand. Decision 0026.
'use strict';
const { existsSync, mkdirSync, renameSync, rmSync } = require('node:fs');
const { basename, join } = require('node:path');

const DB = 'planner.db';

/** A message for the person; the developer detail stays in `cause`. */
class ImportError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = 'ImportError';
  }
}

function open(path, readOnly) {
  const { DatabaseSync } = require('node:sqlite');
  return new DatabaseSync(path, { readOnly });
}

/** How many projects a projects file holds, or undefined when there is no file yet. */
function countProjects(path) {
  if (!existsSync(path)) return undefined;
  let db;
  try {
    db = open(path, true);
    const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'projects'").get();
    if (!table) throw new Error('no projects table');
    return Number(db.prepare('SELECT count(*) AS n FROM projects').get().n);
  } catch (error) {
    throw new ImportError(`“${basename(path)}” is not an Atrium projects file.`, error);
  } finally {
    db?.close();
  }
}

/**
 * Copies the chosen file into `dataDir` under a temporary name and checks the copy. The program
 * keeps running meanwhile; nothing here touches the current projects.
 */
function prepareCopy(source, dataDir, stamp) {
  const projects = countProjects(source);
  if (projects === undefined) throw new ImportError(`“${basename(source)}” was not found.`);
  const temp = join(dataDir, `incoming-${stamp}.db`);
  rmSync(temp, { force: true });
  let db;
  try {
    db = open(source, true);
    db.exec(`VACUUM INTO '${temp.replace(/'/g, "''")}'`);
  } catch (error) {
    rmSync(temp, { force: true });
    throw new ImportError('The projects could not be copied. Close the other copy of Atrium and try again.', error);
  } finally {
    db?.close();
  }
  let copy;
  let problem;
  try {
    copy = open(temp, true);
    const check = copy.prepare('PRAGMA integrity_check').all();
    if (check.length !== 1 || Object.values(check[0])[0] !== 'ok') problem = new Error('integrity check failed');
  } catch (error) {
    problem = error;
  } finally {
    copy?.close();
  }
  if (problem) {
    rmSync(temp, { force: true });
    throw new ImportError(`“${basename(source)}” is damaged and was not brought in.`, problem);
  }
  return { temp, projects };
}

/**
 * Puts the checked copy in place. Call only while the server is stopped (it closed the store, so
 * there is no -wal left). The current projects move to backups/; returns that path, if any.
 */
function swapIn(dataDir, temp, stamp) {
  const live = join(dataDir, DB);
  let kept;
  if (existsSync(live)) {
    const backups = join(dataDir, 'backups');
    mkdirSync(backups, { recursive: true });
    kept = join(backups, `before-import-${stamp}.db`);
    renameSync(live, kept);
    for (const side of ['-wal', '-shm']) {
      if (existsSync(live + side)) renameSync(live + side, kept + side);
    }
  }
  try {
    renameSync(temp, live);
  } catch (error) {
    // Never leave the program without its projects: put the old ones back.
    if (kept) {
      renameSync(kept, live);
      for (const side of ['-wal', '-shm']) {
        if (existsSync(kept + side)) renameSync(kept + side, live + side);
      }
    }
    throw new ImportError('The projects could not be put in place.', error);
  }
  return kept;
}

/**
 * Undoes swapIn when the program cannot open the brought projects: they are kept aside as
 * backups/refused-<time>.db and the projects that were here (if any) return.
 */
function putBack(dataDir, kept, stamp) {
  const live = join(dataDir, DB);
  const backups = join(dataDir, 'backups');
  mkdirSync(backups, { recursive: true });
  const refused = join(backups, `refused-${stamp}.db`);
  for (const side of ['', '-wal', '-shm']) {
    if (existsSync(live + side)) renameSync(live + side, refused + side);
    if (kept && existsSync(kept + side)) renameSync(kept + side, live + side);
  }
  return refused;
}

module.exports = { DB, ImportError, countProjects, prepareCopy, putBack, swapIn };
