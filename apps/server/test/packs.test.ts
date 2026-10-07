import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serializeProject } from '@space-planner/core';
import { demoHall, studioApartment } from '@space-planner/starter';
import { describe, expect, it } from 'vitest';
import { packId, readPack, writePack } from '../src/packs.js';
import { Store } from '../src/store.js';

const pack = { id: 'flats', name: 'Flats', description: 'Two rooms', projects: [studioApartment(), demoHall()] };

describe('pack files', () => {
  it('the same projects always give the same bytes, and read back the same', () => {
    const a = writePack(pack);
    expect(writePack(pack).equals(a)).toBe(true);
    const back = readPack(a);
    expect(back).toMatchObject({ id: 'flats', name: 'Flats', description: 'Two rooms' });
    expect(back.projects).toEqual(pack.projects);
    // A plain (uncompressed) pack reads too.
    const plain = { format: 'atrium-pack', version: 1, id: 'plain', name: 'Plain', projects: [serializeProject(demoHall())] };
    expect(readPack(Buffer.from(JSON.stringify(plain))).projects).toEqual([demoHall()]);
  });

  it('turns a name into a file-safe id', () => {
    expect(packId('Client — Villa 12')).toBe('client-villa-12');
    expect(packId('Ünïcode   Café!!')).toBe('unicode-cafe');
    expect(packId('***')).toBe('pack');
    expect(packId('x'.repeat(80))).toHaveLength(63);
  });
});

describe('packs in the store', () => {
  it('sample companies added by an older version show as installed packs, projects untouched', () => {
    const dir = mkdtempSync(join(tmpdir(), 'planner-legacy-'));
    try {
      const first = new Store(join(dir, 'planner.db'));
      const kept = first.createProject(demoHall(), 'Sample data', 'Sample', 'nile-gate');
      first.createProject(demoHall(), 'human');
      first.close();
      const store = new Store(join(dir, 'planner.db'));
      expect(store.listPacks()).toMatchObject([{ id: 'nile-gate', name: 'Nile Gate Logistics', collection: 'nile-gate', projectCount: 1 }]);
      expect(store.listProjects().find((p) => p.id === kept.id)).toMatchObject({ collection: 'nile-gate' });
      expect(store.removePack('nile-gate')).toEqual([kept.id]);
      expect(store.listProjects()).toHaveLength(1);
      store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('installs all or nothing', () => {
    const store = new Store(':memory:');
    // The second project places an item of a type it does not have: it cannot be stored.
    const hall = demoHall();
    const broken = { ...pack, projects: [studioApartment(), { ...hall, items: { x: { id: 'x', definitionId: 'missing', position: { x: 0, y: 0 }, rotation: 0, locked: false } } }] };
    expect(() => store.installPack(broken, 'human')).toThrow();
    expect(store.listProjects()).toEqual([]);
    expect(store.listPacks()).toEqual([]);
    store.close();
  });
});
