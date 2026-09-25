import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
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
  const [command, args] =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
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
  const app = createApp({ store, dataDir, staticDir, mcpScript: join(here, 'mcp.mjs') });

  let port = Number(argument('--port') ?? process.env.PORT ?? 4600);
  const fixedPort = argument('--port') !== undefined;
  for (let attempt = 0; ; attempt++) {
    try {
      port = await app.listen(port);
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
