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
  fail(`محتاج Node.js إصدار 22.13 أو أحدث (عندك ${process.versions.node}).\n  نزّله من https://nodejs.org (اختار LTS) وبعدين شغّل ملف البداية تاني.`);
}

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
function pnpm(args, label) {
  say(label);
  const result = spawnSync(npx, ['--yes', PNPM, ...args], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) fail(`${label}: حصلت مشكلة (شوف الرسائل اللي فوق).`);
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
if (!existsSync(installMarker) || mtime(join(root, 'pnpm-lock.yaml')) > mtime(installMarker)) {
  pnpm(['install', '--frozen-lockfile'], 'بيثبّت المكونات (أول مرة بس، ممكن تاخد دقيقتين)');
}

// 2. Build: when anything in the sources is newer than the last build.
const builtEditor = join(root, 'apps', 'editor', 'dist', 'index.html');
const builtServer = join(root, 'apps', 'server', 'dist', 'server.mjs');
const sources = Math.max(newest(join(root, 'packages')), newest(join(root, 'apps', 'editor')), newest(join(root, 'apps', 'server')));
if (sources > Math.min(mtime(builtEditor), mtime(builtServer))) {
  pnpm(['--filter', '@space-planner/editor', 'build'], 'بيجهّز الواجهة');
  pnpm(['--filter', '@space-planner/server', 'build'], 'بيجهّز الخادم');
}

// 3. Run.
say('بيشغّل البرنامج');
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', builtServer, '--open', ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
});
const stop = () => server.kill();
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
server.on('exit', (code) => process.exit(code ?? 0));
