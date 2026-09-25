import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

// Cloud sessions ship a pinned Chromium; CI installs Playwright's own.
const localChromium = '/opt/pw-browsers/chromium';

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: 1400, height: 860 },
    launchOptions: existsSync(localChromium) && !process.env.CI ? { executablePath: localChromium } : {},
  },
  webServer: {
    command: 'pnpm build && pnpm preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
