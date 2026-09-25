import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const srcDir = join(import.meta.dirname, '..', 'src');
const files = readdirSync(srcDir).filter((f) => f.endsWith('.ts'));

/** Shared industrial code is as pure as the core: it may use the core and nothing else. */
describe('industry purity', () => {
  it('imports only the core and its own files', () => {
    const offenders = files.flatMap((f) =>
      [...readFileSync(join(srcDir, f), 'utf8').matchAll(/from\s*['"]([^'"]+)['"]/g)]
        .map((m) => m[1]!)
        .filter((spec) => !spec.startsWith('./') && spec !== '@space-planner/core')
        .map((spec) => `${f} -> ${spec}`),
    );
    expect(offenders).toEqual([]);
  });

  it('does not use clocks or randomness', () => {
    expect(files.filter((f) => /\b(Date\.now|new Date|Math\.random|performance\.now|crypto\.)/.test(readFileSync(join(srcDir, f), 'utf8')))).toEqual([]);
  });
});
