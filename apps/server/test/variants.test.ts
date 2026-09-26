import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fromUnit } from '@space-planner/core';
import { demoHall } from '@space-planner/starter';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store } from '../src/store.js';

const m = (v: number) => fromUnit(v, 'm');

describe('variant store safety', () => {
  let dir: string;
  let store: Store;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'planner-variants-'));
    store = new Store(join(dir, 'planner.db'));
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('upgrades a pre-variants projects table additively and leaves old projects ordinary', () => {
    store.close();
    const path = join(dir, 'old.db');
    const old = new DatabaseSync(path);
    old.exec(`CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      revision INTEGER NOT NULL,
      item_count INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO projects VALUES ('p-old', 'Old', 0, 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');`);
    old.close();

    const reopened = new Store(path);
    expect(reopened.listProjects()).toEqual([expect.objectContaining({ id: 'p-old', variantOf: null })]);
    reopened.close();
    new Store(path).close();

    // Recreate the fixture store so afterEach closes an open handle.
    store = new Store(join(dir, 'planner.db'));
  });

  it('keeps variants separate, links nested variants to the same base, and adopts as one undoable revision', () => {
    const base = store.createProject(demoHall(), 'human');
    const variant = store.createVariant(base.id, 'More seats', 'human');
    expect(variant).not.toBeNull();
    expect(store.summary(variant!.id)).toMatchObject({ variantOf: base.id, name: 'More seats' });

    const second = store.createVariant(variant!.id, 'Another idea', 'human');
    expect(second).not.toBeNull();
    expect(store.summary(second!.id)?.variantOf).toBe(base.id);
    expect(store.familyOf(second!.id).map((p) => p.id)).toEqual([base.id, variant!.id, second!.id]);

    const changed = store.applyCommands(
      variant!.id,
      [
        {
          type: 'item.add',
          item: { id: 'variant-chair', definitionId: 'chair', position: { x: m(3), y: m(3) }, rotation: 0, locked: false },
        },
      ],
      { actor: 'human' },
    );
    expect(changed.ok).toBe(true);

    // The approved plan is untouched before adoption.
    expect(store.getProject(base.id)?.items['variant-chair']).toBeUndefined();
    expect(store.getProject(base.id)?.revision).toBe(0);

    const adopted = store.adoptVariant(variant!.id, 'human');
    expect(adopted.ok).toBe(true);
    if (!adopted.ok) return;
    expect(adopted.project.id).toBe(base.id);
    expect(adopted.project.name).toBe(base.name);
    expect(adopted.project.revision).toBe(1);
    expect(adopted.project.items['variant-chair']).toBeDefined();
    expect(store.history(base.id)[0]).toMatchObject({ actor: 'human', summary: 'Adopted variant “More seats”' });

    // The alternative remains intact for audit/comparison.
    expect(store.getProject(variant!.id)?.items['variant-chair']).toBeDefined();

    // Deleting the base does not delete product-level alternatives.
    expect(store.deleteProject(base.id)).toBe(true);
    expect(store.summary(variant!.id)?.variantOf).toBeNull();
    expect(store.summary(second!.id)?.variantOf).toBeNull();
    expect(store.getProject(variant!.id)).not.toBeNull();
    expect(store.getProject(second!.id)).not.toBeNull();
  });

  it('refuses adopting an ordinary base as though it were a variant', () => {
    const base = store.createProject(demoHall(), 'human');
    const result = store.adoptVariant(base.id, 'human');
    expect(result).toEqual({ ok: false, status: 400 });
  });
});
