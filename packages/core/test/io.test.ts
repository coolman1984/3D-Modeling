import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  SCHEMA_VERSION,
  apply,
  checkProject,
  deserializeProject,
  measureProject,
  serializeProject,
  type Command,
  type Project,
} from '../src/index.js';
import { furnishedHall, m, place, referenceHall } from './fixtures.js';

function open(text: string): Project {
  const result = deserializeProject(text);
  if (!result.ok) throw new Error(result.problems.map((p) => `${p.path}: ${p.message}`).join('; '));
  return result.project;
}

describe('save and open', () => {
  it('preserves named polygon zones, validates their geometry and undoes a zone change', () => {
    const hall = referenceHall();
    const zone = { id: 'zone-1', kind: 'staging', polygon: [{ x: 10000, y: 10000 }, { x: 20000, y: 10000 }, { x: 20000, y: 20000 }, { x: 10000, y: 20000 }] };
    const result = apply(hall, { type: 'space.set', space: { ...hall.space, zones: [zone] } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(open(serializeProject(result.project)).space.zones).toEqual([zone]);
    const undone = apply(result.project, result.inverse);
    expect(undone.ok && undone.project.space.zones).toBeUndefined();
    const malformed = apply(hall, { type: 'space.set', space: { ...hall.space, zones: [{ ...zone, polygon: [...zone.polygon].reverse() }] } });
    expect(malformed.ok).toBe(false);
  });
  it('round-trips the reference halls exactly', () => {
    for (const project of [referenceHall(), furnishedHall()]) {
      const text = serializeProject(project);
      const reopened = open(text);
      expect(reopened).toEqual(project);
      expect(serializeProject(reopened)).toBe(text);
    }
  });

  it('keeps every number, issue and metric identical after reopening', () => {
    const hall = furnishedHall();
    const reopened = open(serializeProject(hall));
    expect(checkProject(reopened)).toEqual(checkProject(hall));
    expect(measureProject(reopened)).toEqual(measureProject(hall));
  });

  it('writes the same text regardless of key order', () => {
    const hall = furnishedHall();
    const reversed = (value: object): object =>
      Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, v && typeof v === 'object' && !Array.isArray(v) ? reversed(v) : v]));
    expect(serializeProject(reversed(hall) as Project)).toBe(serializeProject(hall));
  });

  it('is readable: sorted keys, indented, newline at the end', () => {
    const text = serializeProject(referenceHall());
    expect(text.endsWith('}\n')).toBe(true);
    expect(text.indexOf('"catalog"')).toBeLessThan(text.indexOf('"id"'));
    expect(text).toContain(`\n  "schemaVersion": ${SCHEMA_VERSION}`);
  });

  it('round-trips after any sequence of edits', () => {
    const coord = fc.integer({ min: 0, max: m(10) });
    const edit: fc.Arbitrary<Command> = fc.oneof(
      fc.record({ id: fc.constantFrom('t1', 'c1', 'c2'), x: coord, y: coord }).map(({ id, x, y }) => ({
        type: 'item.move' as const,
        id,
        to: { x, y },
      })),
      fc.record({ n: fc.nat(20), x: coord, y: coord, r: fc.nat(359_999) }).map(({ n, x, y, r }) => ({
        type: 'item.add' as const,
        item: place(`n${n}`, 'def-chair', x, y, r),
      })),
      fc.constantFrom('c3', 'c4').map((id) => ({ type: 'item.remove' as const, id })),
    );
    fc.assert(
      fc.property(fc.array(edit, { maxLength: 30 }), (edits) => {
        let project = furnishedHall();
        for (const e of edits) {
          const outcome = apply(project, e);
          if (outcome.ok) project = outcome.project;
        }
        const text = serializeProject(project);
        expect(open(text)).toEqual(project);
        expect(serializeProject(open(text))).toBe(text);
      }),
      { numRuns: 100 },
    );
  });
});

describe('opening bad files', () => {
  it('reports text that is not JSON', () => {
    const result = deserializeProject('{ not json');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.problems[0]?.message).toMatch(/not valid JSON/);
  });

  it('refuses files from a newer version of the app', () => {
    const newer = serializeProject(referenceHall()).replace(
      `"schemaVersion": ${SCHEMA_VERSION}`,
      `"schemaVersion": ${SCHEMA_VERSION + 1}`,
    );
    const result = deserializeProject(newer);
    expect(!result.ok && result.problems.map((p) => p.code)).toEqual(['unsupported-version']);
  });

  it('refuses old versions it has no migration for', () => {
    const older = serializeProject(referenceHall()).replace(`"schemaVersion": ${SCHEMA_VERSION}`, '"schemaVersion": 0');
    const result = deserializeProject(older);
    expect(!result.ok && result.problems[0]?.message).toMatch(/no migration from schema version 0/);
  });

  it('refuses unknown fields instead of silently keeping them', () => {
    const raw = JSON.parse(serializeProject(furnishedHall()));
    raw.items.t1.colour = 'red';
    raw.owner = 'someone';
    const result = deserializeProject(JSON.stringify(raw));
    expect(!result.ok && result.problems.map((p) => `${p.code} @ ${p.path}`)).toEqual([
      'unknown-field @ project.owner',
      'unknown-field @ items.t1.colour',
    ]);
  });

  it('refuses a corrupted number with its location', () => {
    const raw = JSON.parse(serializeProject(furnishedHall()));
    raw.items.c2.position.y = 1.5;
    const result = deserializeProject(JSON.stringify(raw));
    expect(!result.ok && result.problems.map((p) => p.path)).toEqual(['items.c2.position.y']);
  });
});

describe('saves written by earlier versions', () => {
  it('a hall saved before T5 (schema 1) migrates without losing its data or planning results', async () => {
    const { readFileSync } = await import('node:fs');
    const text = readFileSync(new URL('./saves/v1-hall-2026-09.json', import.meta.url), 'utf8');
    const opened = deserializeProject(text);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.migratedFrom).toBe(1);
    expect(opened.project.schemaVersion).toBe(2);
    const upgraded = serializeProject(opened.project);
    expect(serializeProject(open(upgraded))).toBe(upgraded);
    expect(checkProject(opened.project)).toEqual([]);
    expect(measureProject(opened.project)).toMatchObject({ itemCount: 5, seats: 4, massUnknown: 5 });
  });
});
