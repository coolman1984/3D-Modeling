// Bundles the server and the MCP bridge (with the core) into two standalone files.
import { build } from 'esbuild';

await build({
  entryPoints: { server: 'src/main.ts', mcp: 'src/mcp.ts' },
  outdir: 'dist',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'warning',
});
console.log('server built');
