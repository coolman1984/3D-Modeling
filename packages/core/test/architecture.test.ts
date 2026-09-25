import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const srcDir = join(import.meta.dirname, '..', 'src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

function importsOf(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const pattern = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  return [...text.matchAll(pattern)].map((m) => m[1] ?? m[2] ?? '');
}

describe('core purity', () => {
  it('imports nothing outside its own source tree', () => {
    const offenders = sourceFiles(srcDir).flatMap((file) =>
      importsOf(file)
        .filter((spec) => !spec.startsWith('./') && !spec.startsWith('../'))
        .map((spec) => `${relative(srcDir, file)} -> ${spec}`),
    );
    expect(offenders).toEqual([]);
  });

  it('does not use clocks or randomness', () => {
    const offenders = sourceFiles(srcDir).filter((file) =>
      /\b(Date\.now|new Date|Math\.random|performance\.now|crypto\.)/.test(readFileSync(file, 'utf8')),
    );
    expect(offenders.map((file) => relative(srcDir, file))).toEqual([]);
  });
});
