#!/usr/bin/env node
// Portable copy: a folder (and a .zip of it) that runs Space Planner with no internet and no npm.
// Where the npm registry is blocked (company networks), copy the zip over, unpack, double-click
// "Start Space Planner". Holds the bundled server, the built interface, this machine's Node.js
// (Windows) and, with --with-data, a copy of the projects. Uses only Node's standard library.
//
//   node scripts/portable.mjs [--with-data] [--no-node]
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'release', 'SpacePlanner');
const zip = join(root, 'release', 'SpacePlanner-portable.zip');
const withData = process.argv.includes('--with-data');
const withNode = !process.argv.includes('--no-node') && process.platform === 'win32';

const server = join(root, 'apps', 'server', 'dist');
const web = join(root, 'apps', 'editor', 'dist');
for (const [path, what] of [
  [join(server, 'server.mjs'), 'the server'],
  [join(web, 'index.html'), 'the interface'],
]) {
  if (!existsSync(path)) {
    console.error(`✖ ${what} is not built. Run "pnpm build" (or the start file) once, then this again.`);
    process.exit(1);
  }
}

rmSync(out, { recursive: true, force: true });
rmSync(zip, { force: true });
mkdirSync(join(out, 'app'), { recursive: true });
cpSync(join(server, 'server.mjs'), join(out, 'app', 'server.mjs'));
cpSync(join(server, 'mcp.mjs'), join(out, 'app', 'mcp.mjs'));
cpSync(web, join(out, 'app', 'web'), { recursive: true });
if (withNode) cpSync(process.execPath, join(out, 'node', 'node.exe'));
mkdirSync(join(out, 'data'), { recursive: true });
if (withData) {
  // A consistent copy of the database: the running app keeps recent changes in the -wal file.
  for (const name of ['planner.db', 'planner.db-wal', 'planner.db-shm']) {
    const from = join(root, 'data', name);
    if (existsSync(from)) cpSync(from, join(out, 'data', name));
  }
}

const run = '--disable-warning=ExperimentalWarning "%~dp0app\\server.mjs" --static "%~dp0app\\web" --data "%~dp0data" --open %*';
writeFileSync(
  join(out, 'Start Space Planner.bat'),
  [
    '@echo off',
    'chcp 65001 >nul',
    'title Space Planner',
    'cd /d "%~dp0"',
    `if exist "%~dp0node\\node.exe" ("%~dp0node\\node.exe" ${run}) else (`,
    '  where node >nul 2>nul || (echo Node.js 22.13 or newer is needed: https://nodejs.org & pause & exit /b 1)',
    `  node ${run}`,
    ')',
    'if errorlevel 1 pause',
    '',
  ].join('\r\n'),
);
writeFileSync(
  join(out, 'start.sh'),
  '#!/bin/sh\ncd "$(dirname "$0")"\nexec node --disable-warning=ExperimentalWarning app/server.mjs --static app/web --data data --open "$@"\n',
  { mode: 0o755 },
);
writeFileSync(
  join(out, 'README.txt'),
  [
    'Space Planner - portable copy',
    '',
    'Needs no internet and no installation.',
    'Windows: double-click "Start Space Planner.bat". The browser opens on the program.',
    'Mac / Linux: run ./start.sh (Node.js 22.13 or newer must be installed).',
    'Your projects are kept in the "data" folder next to this file; copy that folder to keep them.',
    'Close the black window to stop the program.',
    '',
  ].join('\r\n'),
);

// A zip of the folder, with the archiver that ships with Windows 10+ and macOS (bsdtar).
const tar = spawnSync('tar', ['-a', '-c', '-f', zip, '-C', join(root, 'release'), 'SpacePlanner'], { stdio: 'inherit' });
console.log(`\n✔ Portable folder: ${out}`);
console.log(tar.status === 0 ? `✔ Zip: ${zip}` : '  (No zip made: "tar" is not available here; copy the folder instead.)');
console.log(withData ? '  With a copy of your projects.' : '  Without projects (add --with-data to include a copy).');
