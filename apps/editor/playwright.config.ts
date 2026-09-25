import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

// Cloud sessions ship a pinned Chromium; CI installs Playwright's own.
const localChromium = '/opt/pw-browsers/chromium';
// Every browser-test run starts with an empty database.
const dataDir = process.env.PLANNER_TEST_DATA ?? mkdtempSync(join(tmpdir(), 'planner-e2e-'));
process.env.PLANNER_TEST_DATA = dataDir;

export default defineConfig({
  testDir: 'e2e',
  timeout: 45_000,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1440, height: 900 },
    launchOptions: {
      ...(existsSync(localChromium) && !process.env.CI ? { executablePath: localChromium } : {}),
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
      // Arabic file names need a UTF-8 locale; minimal containers default to plain C.
      env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' },
    },
  },
  webServer: {
    command: `pnpm build && pnpm --filter @space-planner/server build && node --disable-warning=ExperimentalWarning ../server/dist/server.mjs --port 4173 --data "${dataDir}"`,
    url: 'http://127.0.0.1:4173/api/health',
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
