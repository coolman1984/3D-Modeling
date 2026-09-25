import { defineConfig } from 'vitest/config';

/** Performance runs are separate from `pnpm test`: `pnpm --filter @space-planner/core bench`. */
export default defineConfig({ test: { include: ['bench/**/*.perf.ts'], testTimeout: 600_000 } });
