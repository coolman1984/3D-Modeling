#!/usr/bin/env node
// One-click launcher: checks Node, installs dependencies, builds when sources changed,
// starts the local app server and opens the browser. Uses only Node's standard library.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PNPM = 'pnpm@10.33.0';
const say = (text) => console.log(`\n▶ ${text}`);
const fail = (text) => {
  console.error(`\n✖ ${text}\n`);
  process.exit(1);
};

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  fail(`Atrium needs Node.js 22.13 or newer (you have ${process.versions.node}).\n  Download it from https://nodejs.org (choose LTS), then run the start file again.`);
}

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const builtEditor = join(root, 'apps', 'editor', 'dist', 'index.html');
const builtServer = join(root, 'apps', 'server', 'dist', 'server.mjs');
const built = () => existsSync(builtEditor) && existsSync(builtServer);
function pnpm(args, label) {
  say(label);
  const result = spawnSync(npx, ['--yes', PNPM, ...args], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status === 0) return;
  // Company networks often block the npm registry. A program that is already built still runs.
  if (built()) {
    console.warn(`\n! ${label}: not possible here (no access to the npm registry?). Starting the version that is already built.`);
    return 'skipped';
  }
  fail(`${label}: something went wrong (see the messages above).\n  Where the npm registry is blocked, use the portable copy: on a machine with access run "node scripts/portable.mjs", copy release/SpacePlanner-portable.zip over and start it.`);
}

function newest(dir) {
  let latest = 0;
  if (!existsSync(dir)) return latest;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    latest = Math.max(latest, entry.isDirectory() ? newest(path) : statSync(path).mtimeMs);
  }
  return latest;
}

const mtime = (path) => (existsSync(path) ? statSync(path).mtimeMs : 0);

// 1. Dependencies: install when missing or when the lockfile changed.
const installMarker = join(root, 'node_modules', '.modules.yaml');
let installed = true;
if (!existsSync(installMarker) || mtime(join(root, 'pnpm-lock.yaml')) > mtime(installMarker)) {
  installed = pnpm(['install', '--frozen-lockfile'], 'Installing components (first time only, may take two minutes)') !== 'skipped';
}

// 2. Build: when anything in the sources is newer than the last build (and the components are there).
const sources = Math.max(newest(join(root, 'packages')), newest(join(root, 'apps', 'editor')), newest(join(root, 'apps', 'server')));
if (installed && sources > Math.min(mtime(builtEditor), mtime(builtServer))) {
  if (pnpm(['--filter', '@space-planner/editor', 'build'], 'Building the interface') !== 'skipped') {
    pnpm(['--filter', '@space-planner/server', 'build'], 'Building the server');
  }
}

// 3. Run.
say('Starting Atrium');
const launchArgs = process.argv.slice(2);
const noOpen = launchArgs.includes('--no-open');
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', builtServer, ...(noOpen ? [] : ['--open']), ...launchArgs.filter((arg) => arg !== '--no-open' && !(noOpen && arg === '--open'))], {
  cwd: root,
  stdio: 'inherit',
});
const stop = () => server.kill();
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
server.on('exit', (code) => process.exit(code ?? 0));
