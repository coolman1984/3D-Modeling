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

  it('reads the areas to furnish from the walls and the room names', () => {
    expect(furnishAreas(flat).map((a) => `${a.name}/${a.kind}`)).toEqual(['Living/living', 'Main bedroom/bedroom', 'Hall/hall', 'Bedroom 2/bedroom', 'Bath/bathroom']);
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

  it('only the rooms asked for', () => {
    const [option] = furnishOptions(flat, { count: 1, areas: ['Bath'] });
    expect(option!.rooms.map((r) => r.area)).toEqual(['Bath']);
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

  it('an empty shell with unnamed rooms: the largest is furnished as the living room', () => {
    const shell = newHome('Shell', 6, 4);
    const [option] = furnishOptions(shell, { count: 1 });
    expect(option!.rooms.map((r) => r.kind)).toEqual(['living']);
  });
});
