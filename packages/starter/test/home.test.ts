import { checkProject, fromUnit, serializeProject, validateProject, type ItemInstance, type Project } from '@space-planner/core';
import { describe, expect, it } from 'vitest';
import {
  bedAccessRule,
  checkPack,
  detectPack,
  HOME_CATALOG,
  HOME_TEMPLATES,
  newHome,
  packOf,
  PACKS,
  RULE_SOURCES,
  SHAPES,
  walkwayRule,
} from '../src/index.js';

const m = (v: number) => fromUnit(v, 'm');
const cm = (v: number) => fromUnit(v, 'cm');
const at = (id: string, definitionId: string, x: number, y: number, rotation = 0): ItemInstance => ({ id, definitionId, position: { x: m(x), y: m(y) }, rotation: rotation * 1000, locked: false });
const withItems = (p: Project, items: ItemInstance[]): Project => ({ ...p, items: Object.fromEntries(items.map((i) => [i.id, i])) });

describe('home catalog', () => {
  it('has unique ids, a known shape for every piece, and wall pieces with a height', () => {
    const ids = HOME_CATALOG.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(HOME_CATALOG.length).toBeGreaterThanOrEqual(40);
    const shapes = new Set<string>(SHAPES.map((s) => s.key));
    expect(HOME_CATALOG.filter((d) => !shapes.has(d.category)).map((d) => d.id)).toEqual([]);
    for (const d of HOME_CATALOG.filter((d) => d.meta?.mount === 'wall')) expect(d.meta?.elevation, d.id).toBeGreaterThan(0);
    // Only rugs are floor coverings.
    expect(HOME_CATALOG.filter((d) => d.surface).every((d) => d.category === 'rug')).toBe(true);
    expect(HOME_CATALOG.filter((d) => d.category === 'rug').every((d) => d.surface)).toBe(true);
  });

  it('is the first activity, and an apartment is recognised as one', () => {
    expect(PACKS[0]!.id).toBe('home');
    expect(detectPack(newHome('Flat'))).toBe('home');
    // Older projects with no pack of their own still default to the hall.
    expect(packOf('nonsense').id).toBe('hall');
    expect(RULE_SOURCES['bed-access'].kind).toBe('common-guidance');
  });

  it('refuses impossible shells', () => {
    expect(() => newHome('x', 1, 5)).toThrow(RangeError);
    expect(newHome('Flat', 9, 7).space.doors).toHaveLength(1);
  });
});

describe('ready apartments', () => {
  for (const template of HOME_TEMPLATES) {
    it(`${template.name}: valid, no design issues, every home rule passes, same every time`, () => {
      const p = template.build();
      expect(validateProject(p)).toEqual([]);
      expect(checkProject(p)).toEqual([]);
      expect(checkPack(p, 'home').map((r) => `${r.code} ${r.status}`)).toEqual(['walkway pass', 'bed-access pass']);
      expect(serializeProject(template.build())).toBe(serializeProject(p));
    });
  }

  it('furnishes every room: a bed, a sofa, a kitchen, a bathroom and wall art in each', () => {
    for (const template of HOME_TEMPLATES) {
      const p = template.build();
      const categories = new Set(Object.values(p.items).map((i) => p.catalog[i.definitionId]!.category));
      for (const c of ['bed', 'kitchen', 'toilet', 'wall-art', 'rug']) expect(categories.has(c), `${template.name} ${c}`).toBe(true);
      expect(categories.has('sofa') || categories.has('sectional')).toBe(true);
      // Wall art hangs at its stated height.
      const art = Object.values(p.items).find((i) => p.catalog[i.definitionId]!.category === 'wall-art')!;
      expect(art.elevation).toBe(p.catalog[art.definitionId]!.meta!.elevation);
    }
  });
});

describe('bed access (hand-computed)', () => {
  // A 4 × 4 m room. A queen bed (170 × 215) with its head on the north wall: centre (2, 2.925),
  // long sides at x = 1.15 and 2.85. Each side needs a 60 cm strip from y = 2.925 + 1.075 − 0.55
  // = 3.45 down to the foot at y = 1.85.
  const room = newHome('Bedroom', 4, 4);
  const bed = at('bed', 'home-bed-queen', 2, 2.925, 180);

  it('passes with both sides free', () => {
    expect(bedAccessRule(withItems(room, [bed])).status).toBe('pass');
  });

  it('passes with one side blocked; fails when a wardrobe and a wall take both', () => {
    // Wardrobe 100 × 60 turned to face west, centre x = 3.2: spans x 2.9–3.5, inside the east strip (2.85–3.45).
    const east = at('w1', 'home-wardrobe-2', 3.2, 2.6, 90);
    expect(bedAccessRule(withItems(room, [bed, east])).status).toBe('pass');
    // Bed centre x = 0.9 puts its west side at x = 0.05, so the west strip lies outside the room.
    const tight = at('bed', 'home-bed-queen', 0.9, 2.925, 180);
    const wardrobe = at('w1', 'home-wardrobe-2', 2.1, 2.6, 90); // spans x 1.8–2.4, east strip is 1.75–2.35
    const result = bedAccessRule(withItems(room, [tight, wardrobe]));
    expect(result.status).toBe('fail');
    expect(result.entityIds).toEqual(['bed']);
  });

  it('nightstands at the head and a rug underneath do not block it', () => {
    const items = [bed, at('n1', 'home-nightstand', 0.85, 3.78, 180), at('n2', 'home-nightstand', 3.15, 3.78, 180), at('r1', 'home-rug-cream', 2, 2.2)];
    expect(bedAccessRule(withItems(room, items)).status).toBe('pass');
  });

  it('is unknown without beds', () => {
    expect(bedAccessRule(room)).toMatchObject({ status: 'unknown', reason: 'no-beds' });
  });
});

describe('floor coverings and walkways', () => {
  it('a rug is walked over; the same rug as an ordinary item would cut the sofa off', () => {
    // 4 × 3 m room, door in the middle of the south wall. A sofa against the north wall and a
    // 3 × 2 m rug covering the whole middle: the only way from the door to the sofa crosses it.
    const room = newHome('Lounge', 4, 3);
    const items = [at('s1', 'home-sofa-linen', 2, 2.5, 180), at('r1', 'home-rug-terracotta', 2, 1.1)];
    expect(walkwayRule(withItems(room, items), cm(80)).status).toBe('pass');
    const { surface: _, ...plainRug } = room.catalog['home-rug-terracotta']!;
    const solid = { ...room, catalog: { ...room.catalog, 'home-rug-terracotta': plainRug } };
    expect(walkwayRule(withItems(solid, items), cm(80)).status).toBe('fail');
  });
});
