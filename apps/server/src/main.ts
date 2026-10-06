import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './http.js';
import { Store } from './store.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function openBrowser(url: string): void {
  const helper = [
    'D:/WORK/Software Development/GitHub/AI CREW/Mandatory To Use Skills/windows-chrome-launcher/scripts/open_chrome.py',
    join(homedir(), '.codex', 'skills', 'windows-chrome-launcher', 'scripts', 'open_chrome.py'),
  ].find(existsSync);
  if (!helper) {
    console.warn('Chrome launcher helper is unavailable; open the printed address in Google Chrome.');
    return;
  }
  const command = 'python';
  const args = [helper, url];
  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.on('error', () => undefined); // no browser opener installed: the address is printed below
    child.unref();
  } catch {
    // The address is printed below; the person can open it by hand.
  }
}

async function main(): Promise<void> {
  const dataDir = resolve(argument('--data') ?? process.env.PLANNER_DATA ?? join(repoRoot, 'data'));
  mkdirSync(dataDir, { recursive: true });
  const store = new Store(join(dataDir, 'planner.db'));
  const staticDir = resolve(argument('--static') ?? join(repoRoot, 'apps', 'editor', 'dist'));
  // A company server on the office network: --host 0.0.0.0 --allow-host atrium.office.lan
  // (behind the company's own certificate). By default only this computer can reach the app.
  const allowedHosts = (argument('--allow-host') ?? process.env.PLANNER_ALLOWED_HOSTS ?? '').split(',').map((h) => h.trim()).filter(Boolean);
  const listenHost = argument('--host') ?? process.env.PLANNER_HOST ?? '127.0.0.1';
  const app = createApp({ store, dataDir, staticDir, mcpScript: join(here, 'mcp.mjs'), allowedHosts });

  let port = Number(argument('--port') ?? process.env.PLANNER_PORT ?? process.env.PORT ?? 4600);
  const fixedPort = argument('--port') !== undefined || process.env.PLANNER_PORT !== undefined || process.env.PORT !== undefined;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be an integer from 1 to 65535');
  for (let attempt = 0; ; attempt++) {
    try {
      port = await app.listen(port, listenHost);
      break;
    } catch (error) {
      const busy = (error as NodeJS.ErrnoException).code === 'EADDRINUSE';
      if (!busy || fixedPort || attempt > 20) throw error;
      port += 1;
    }
  }
  const url = `http://127.0.0.1:${port}`;
  writeFileSync(join(dataDir, 'server.json'), JSON.stringify({ url, pid: process.pid, startedAt: new Date().toISOString() }, null, 2));
  console.log(`\n  Atrium is running: ${url}\n  Data is kept in: ${dataDir}\n  Close this window to stop the program.\n`);
  if (store.accounts.userCount() === 0) console.log('  First time: open the address above to set up your company and your account.\n');
  if (!existsSync(staticDir)) console.log('  (The interface is not built; run the start file or pnpm build)');
  if (process.argv.includes('--open')) openBrowser(url);

  const shutdown = () => {
    void app.close().then(() => {
      store.close();
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
