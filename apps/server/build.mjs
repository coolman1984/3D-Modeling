// Bundles the server, the MCP bridge and the pack builder (with the core) into standalone files.
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';

await build({
  entryPoints: { server: 'src/main.ts', mcp: 'src/mcp.ts', 'make-packs': 'src/makePacks.ts' },
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
// The packs that come with the program: sample companies as files, beside the server.
const made = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'dist/make-packs.mjs', 'dist/packs'], { stdio: 'pipe' });
if (made.status !== 0) {
  console.error(made.stderr.toString());
  process.exit(1);
}
console.log('server built (with packs)');
