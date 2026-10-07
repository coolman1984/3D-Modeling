import { describe, expect, it } from 'vitest';
import { checkProject, deserializeProject, serializeProject, validateProject, type ItemDefinition, type Project } from '../src/index.js';
import { cm, furnishedHall, m, place } from './fixtures.js';

// A 2.4 × 1.7 m rug, 1 cm thick, laid under table t1 and its chairs in the reference hall.
const rug = (surface?: true): ItemDefinition => ({
  id: 'def-rug',
  name: 'Rug',
  category: 'rug',
  size: { w: cm(240), d: cm(170), h: cm(1) },
  clearance: { front: cm(20), back: cm(20), left: cm(20), right: cm(20) },
  ...(surface ? { surface } : {}),
});

function withRug(definition: ItemDefinition): Project {
  const hall = furnishedHall();
  const t1 = hall.items.t1!;
  return { ...hall, catalog: { ...hall.catalog, [definition.id]: definition }, items: { ...hall.items, r1: place('r1', definition.id, t1.position.x, t1.position.y) } };
}

const codes = (p: Project) => checkProject(p).map((i) => `${i.code} ${i.entityIds.join('+')}`);

describe('floor coverings', () => {
  it('an ordinary 1 cm item under a table overlaps it; a floor covering does not', () => {
    expect(codes(withRug(rug())).some((c) => c.startsWith('overlap') && c.includes('r1'))).toBe(true);
    const covered = withRug(rug(true));
    expect(validateProject(covered)).toEqual([]);
    expect(codes(covered).filter((c) => c.includes('r1'))).toEqual([]);
  });

  it('a floor covering still has to lie inside the room', () => {
    const p = withRug(rug(true));
    const outside = { ...p, items: { ...p.items, r1: place('r1', 'def-rug', m(0), m(0)) } };
    expect(codes(outside)).toContain('out-of-bounds r1');
  });

  it('stores only true and survives a save', () => {
    const p = withRug(rug(true));
    const text = serializeProject(p);
    expect(text).toContain('"surface": true');
    const opened = deserializeProject(text);
    expect(opened.ok && opened.project.catalog['def-rug']?.surface).toBe(true);
    const wrong = { ...p, catalog: { ...p.catalog, 'def-rug': { ...rug(), surface: false as unknown as true } } };
    expect(validateProject(wrong).map((e) => e.path)).toContain('catalog.def-rug.surface');
  });
});
