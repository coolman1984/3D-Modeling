// Copies the bundled server and the built interface into stage/, which the installer carries as
// resources/app (see "extraResources" in package.json). Build both first: pnpm desktop:build does.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const server = join(here, '..', 'server', 'dist');
const web = join(here, '..', 'editor', 'dist');
const stage = join(here, 'stage');

for (const [path, what] of [
  [join(server, 'server.mjs'), 'the server'],
  [join(web, 'index.html'), 'the interface'],
]) {
  if (!existsSync(path)) {
    console.error(`✖ ${what} is not built (${path}).`);
    process.exit(1);
  }
}

rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
cpSync(join(server, 'server.mjs'), join(stage, 'server.mjs'));
cpSync(join(server, 'mcp.mjs'), join(stage, 'mcp.mjs'));
if (existsSync(join(server, 'packs'))) cpSync(join(server, 'packs'), join(stage, 'packs'), { recursive: true });
cpSync(web, join(stage, 'web'), { recursive: true });
console.log(`✔ Staged the server and the interface in ${stage}`);
