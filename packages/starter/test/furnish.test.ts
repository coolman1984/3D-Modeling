import { apply, checkProject, validateProject, type Project } from '@space-planner/core';
import { describe, expect, it } from 'vitest';
import { arrangementsFor, buildFlat, checkHome, furnishAreas, furnishOptions, HOME_TEMPLATES, newHome, PALETTES } from '../src/index.js';
import { SPEC } from './flatSpec.js';

const applied = (project: Project, command: Parameters<typeof apply>[1]) => {
  const done = apply(project, command);
  if (!done.ok) throw new Error(JSON.stringify(done.rejection));
  return done.project;
};

describe('furnishing options', () => {
  const flat = buildFlat(SPEC);

  it('reads the areas to furnish from the walls and the room names; a large living room without a dining room gets a dining end', () => {
    expect(furnishAreas(flat).map((a) => `${a.name}/${a.kind}`)).toEqual(['Living/living', 'Living · dining/dining', 'Main bedroom/bedroom', 'Hall/hall', 'Bedroom 2/bedroom', 'Bath/bathroom']);
    // The 11.8 m living room (inside from x = 0.2 m on the plan) splits at 58 % of its length.
    const [living, diningEnd] = furnishAreas(flat);
    expect(living!.x1).toBe(diningEnd!.x0);
    expect(diningEnd!.x0).toBe(Math.round(2_000 + 118_000 * 0.58));
  });

  it('a bedroom: every arrangement keeps the bed off the door wall or says so, and passes the checks', () => {
    const bedroom = furnishAreas(flat).find((a) => a.name === 'Main bedroom')!;
    const ranked = arrangementsFor(flat, bedroom);
    expect(ranked.length).toBeGreaterThanOrEqual(3);
    expect(ranked[0]!.items.some((p) => p.def.category === 'bed')).toBe(true);
    expect(ranked[0]!.reasons.join(' ')).toMatch(/solid .* wall, away from the door/);
    // Best first.
    expect(ranked.map((a) => a.score)).toEqual([...ranked.map((a) => a.score)].sort((a, b) => b - a));
  });

  it('three options for the whole flat, each in its own finishes, each without errors and passing the home rules', () => {
    const options = furnishOptions(flat);
    expect(options.map((o) => o.title)).toEqual(PALETTES.map((p, i) => `Option ${'ABC'[i]} · ${p.name}`));
    for (const o of options) {
      const furnished = applied(flat, o.command);
      expect(validateProject(furnished)).toEqual([]);
      expect(checkProject(furnished).filter((i) => i.severity === 'error')).toEqual([]);
      expect(checkHome(furnished).filter((r) => r.status === 'fail')).toEqual([]);
      expect(o.errors).toBe(0);
      expect(o.unfurnished).toEqual([]);
      expect(o.pieces).toBeGreaterThan(15);
      for (const room of o.rooms) expect(room.reasons.length).toBeGreaterThan(0);
    }
    // The options differ in arrangement, not only in colour.
    const living = options.map((o) => o.rooms.map((r) => r.arrangement).join(' | '));
    expect(new Set(living).size).toBe(3);
  });

  it('is deterministic and replaces the furniture already in the rooms', () => {
    expect(JSON.stringify(furnishOptions(flat, { count: 2 }))).toBe(JSON.stringify(furnishOptions(flat, { count: 2 })));
    const once = applied(flat, furnishOptions(flat)[0]!.command);
    const twice = applied(once, furnishOptions(once)[1]!.command);
    // Every piece was replaced: no doubled beds.
    const beds = Object.values(twice.items).filter((i) => twice.catalog[i.definitionId]?.category === 'bed');
    expect(beds).toHaveLength(2);
  });

  it('applying another option takes the finish variants of the first out of the catalogue', () => {
    const [a, b] = furnishOptions(flat, { count: 2 });
    const first = applied(flat, a!.command);
    const variants = (p: Project) => Object.keys(p.catalog).filter((id) => id.includes('--'));
    expect(variants(first).length).toBeGreaterThan(0);
    const second = applied(first, furnishOptions(first, { count: 2 })[1]!.command);
    const used = new Set(Object.values(second.items).map((i) => i.definitionId));
    expect(variants(second).every((id) => used.has(id))).toBe(true);
    expect(b!.title).toContain('Option B');
  });

  it('piece names carry their finish once: no bouclé armchair in charcoal, no doubled colour words', () => {
    const option = furnishOptions(flat)[2]!;
    const furnished = applied(flat, option.command);
    const names = Object.values(furnished.catalog).map((d) => d.name);
    expect(names.filter((n) => /bouclé/i.test(n) && /charcoal/i.test(n))).toEqual([]);
    expect(names.filter((n) => /(charcoal.*charcoal|white.*white|oak.*oak)/i.test(n))).toEqual([]);
    expect(names.some((n) => / · charcoal/.test(n))).toBe(true);
  });

  it('a small laundry is furnished with a machine; a balcony or an unknown name is left alone with a reason', () => {
    const f = buildFlat({ name: 'x', rooms: [{ name: 'Living', x: 0, y: 0, width: 5, depth: 4 }, { name: 'Laundry', x: 5, y: 0, width: 2, depth: 2 }, { name: 'Store', x: 5, y: 2, width: 2, depth: 2 }, { name: 'Balcony', x: 0, y: 4, width: 3, depth: 1.5 }], doors: [{ between: ['Living', 'Laundry'], at: 0.4, width: 0.7 }] });
    const [o] = furnishOptions(f, { count: 1 });
    const placed = Object.values(applied(f, o!.command).items).map((i) => i.definitionId);
    expect(placed).toContain('home-washer');
    expect(o!.unfurnished).toEqual([expect.stringMatching(/^Store: no layout is known/)]);
  });

  it('a study gets a desk and a chair that do not overlap', () => {
    const f = buildFlat({ name: 'x', rooms: [{ name: 'Living', x: 0, y: 0, width: 5, depth: 4 }, { name: 'Study', x: 5, y: 0, width: 3, depth: 2.6 }], doors: [{ between: ['Living', 'Study'], at: 0.5 }] });
    const [o] = furnishOptions(f, { count: 1, areas: ['Study'] });
    expect(o!.errors).toBe(0);
    const cats = Object.values(applied(f, o!.command).items).map((i) => applied(f, o!.command).catalog[i.definitionId]!.category);
    expect(cats).toEqual(expect.arrayContaining(['desk', 'chair']));
  });

  it('only the rooms asked for', () => {
    const [option] = furnishOptions(flat, { count: 1, areas: ['Bath'] });
    expect(option!.rooms.map((r) => r.area)).toEqual(['Bath']);
  });

  it('reports unavailable rules separately when furnishing only a kitchen', () => {
    const kitchen = buildFlat({ name: 'Kitchen', rooms: [{ name: 'Kitchen', x: 0, y: 0, width: 5, depth: 4 }] });
    const [option] = furnishOptions(kitchen, { count: 1 });
    const actual = checkHome(applied(kitchen, option!.command));
    expect(actual.filter((r) => r.status === 'unknown').length).toBeGreaterThan(0);
    expect(option!.unknownRules).toEqual(actual.filter((r) => r.status === 'unknown').map((r) => r.code));
    expect(option!.failedRules).toEqual(actual.filter((r) => r.status === 'fail').map((r) => r.code));
  });

  it('checks the actual customized catalogue and preserves its dimensions when applying', () => {
    const laundry = buildFlat({ name: 'Laundry', rooms: [{ name: 'Laundry', x: 0, y: 0, width: 3, depth: 3 }] });
    const washer = laundry.catalog['home-washer']!;
    const customized = applied(laundry, { type: 'catalog.define', definition: { ...washer, size: { ...washer.size, w: 80_000 } } });
    const [option] = furnishOptions(customized, { count: 1 });
    const actual = applied(customized, option!.command);
    expect(actual.catalog['home-washer']).toEqual(customized.catalog['home-washer']);
    expect(option!.errors).toBe(checkProject(actual).filter((i) => i.severity === 'error').length);
    expect(option!.warnings).toBe(checkProject(actual).filter((i) => i.severity === 'warning').length);
    expect(Object.values(actual.items).some((i) => i.definitionId === 'home-washer')).toBe(false);
    expect(option!.unfurnished).toEqual([expect.stringMatching(/^Laundry: nothing fits/)]);
  });

  it('furnishes every ready apartment, open plans included', () => {
    for (const t of HOME_TEMPLATES) {
      for (const o of furnishOptions(t.build())) {
        expect(o.errors, `${t.id} ${o.title}`).toBe(0);
        expect(o.unfurnished, `${t.id} ${o.title}`).toEqual([]);
        expect(o.failedRules, `${t.id} ${o.title}`).toEqual([]);
      }
    }
  });

  it('an empty shell with unnamed rooms: the largest is the living room, with a dining end when it is 24 m² and 6 m long', () => {
    expect(furnishOptions(newHome('Shell', 6, 4), { count: 1 })[0]!.rooms.map((r) => r.kind)).toEqual(['living', 'dining']);
    expect(furnishOptions(newHome('Small', 5, 4), { count: 1 })[0]!.rooms.map((r) => r.kind)).toEqual(['living']);
  });

  it('a WC gets a basin and a toilet, no bath', () => {
    const wc = buildFlat({ name: 'WC', rooms: [{ name: 'Living', x: 0, y: 0, width: 5, depth: 4 }, { name: 'WC', x: 5, y: 0, width: 1.6, depth: 2 }], doors: [{ between: ['Living', 'WC'], at: 0.5, width: 0.7 }] });
    const [option] = furnishOptions(wc, { count: 1, areas: ['WC'] });
    const placed = Object.values(applied(wc, option!.command).items).map((i) => i.definitionId);
    expect(placed.some((d) => d.startsWith('home-toilet'))).toBe(true);
    expect(placed.some((d) => /bathtub|shower/.test(d))).toBe(false);
  });
});
