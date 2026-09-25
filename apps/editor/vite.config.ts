import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  // During development the editor talks to a running app server.
  server: { port: 5173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:4600' } },
  test: { include: ['test/**/*.test.ts'] },
  build: { chunkSizeWarningLimit: 1500 },
});
