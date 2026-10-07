import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SAMPLE_COMPANIES } from '@space-planner/starter';
import { writePack, type Pack } from './packs.js';

/**
 * Builds the packs that come with the program (decision 0027): one per sample company. Run at
 * build time (`node dist/make-packs.mjs <folder>`), so the sample data lives in files beside the
 * program, installed when someone wants it, instead of inside the server.
 */
export function samplePacks(): Pack[] {
  return SAMPLE_COMPANIES.map((company) => ({ id: company.id, name: company.name, description: company.description, projects: company.build().map((p) => p.project) }));
}

/** Writes every sample pack into `dir` as `<id>.atrium`; returns the file names. */
export function writeSamplePacks(dir: string): string[] {
  mkdirSync(dir, { recursive: true });
  return samplePacks().map((pack) => {
    const name = `${pack.id}.atrium`;
    writeFileSync(join(dir, name), writePack(pack));
    return name;
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const dir = resolve(process.argv[2] ?? 'packs');
  for (const name of writeSamplePacks(dir)) console.log(`  ${join(dir, name)}`);
}
