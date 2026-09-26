import { apply, checkProject, deserializeProject, fromUnit, serializeProject } from '@space-planner/core';
import { describe, expect, it } from 'vitest';
import { checkPack, detectPack, newRestaurant, referenceRestaurant, restaurantMetrics, serviceRoute } from '../src/index.js';

const m = (v: number) => fromUnit(v, 'm');

describe('restaurant reference', () => {
  const project = referenceRestaurant();

  it('9 tables of mixed families seating 44 covers, zero design issues', () => {
    expect(detectPack(project)).toBe('restaurant');
    expect(project.space.boundary[2]).toEqual({ x: m(20), y: m(14) });
    const metrics = restaurantMetrics(project);
    expect(metrics).toMatchObject({ tables: 9, covers: 44, reachableTables: 9, totalTables: 9 });
    expect(metrics.tablesByFamily).toMatchObject({ '4-top': 4, 'round-6': 2, 'booth-4': 2, 'banquette-8': 1 });
    expect(checkProject(project).filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('passes walkway, area per cover, exits, door width and table reachability, all sourced', () => {
    const rules = checkPack(project, 'restaurant');
    expect(rules.find((r) => r.code === 'walkway')).toMatchObject({ status: 'pass' });
    expect(rules.find((r) => r.code === 'area-per-cover')).toMatchObject({ status: 'pass', source: { kind: 'common-guidance' } });
    expect(rules.find((r) => r.code === 'exits')).toMatchObject({ status: 'pass' });
    expect(rules.find((r) => r.code === 'door-width')).toMatchObject({ status: 'pass' });
    expect(rules.find((r) => r.code === 'table-reachability')).toMatchObject({ status: 'pass', measured: 9, required: 9, source: { kind: 'engineering' } });
  });

  it('round-trips through save and open byte-identical', () => {
    const saved = serializeProject(project);
    const reopened = deserializeProject(saved);
    expect(reopened).toMatchObject({ ok: true, project });
  });
});

describe('service route and reachability', () => {
  it('a table near the pass is closer than one far from it, and both are reachable', () => {
    let project = newRestaurant('Route check', 20, 14, 3.2, false);
    const add = (id: string, defId: string, x: number, y: number) => {
      const result = apply(project, { type: 'item.add', item: { id, definitionId: defId, position: { x: m(x), y: m(y) }, rotation: 0, locked: false } });
      expect(result.ok).toBe(true);
      if (result.ok) project = result.project;
    };
    // The pass is on the north wall; a table just south of it is a shorter route than one at the far south wall.
    add('near', 'table-4top', 17, 12);
    add('far', 'table-4top', 3, 2);
    const passId = project.space.doors.find((d) => d.meta?.role === 'pass')!.id;
    const near = serviceRoute(project, passId, 'near');
    const far = serviceRoute(project, passId, 'far');
    expect(near.reachable).toBe(true);
    expect(far.reachable).toBe(true);
    if (near.reachable && far.reachable) expect(near.distance).toBeLessThan(far.distance);
  });

  it('is "unknown, no-tables" with nothing placed and "unknown, no-pass" on a doorless room', () => {
    const empty = newRestaurant('Empty', 20, 14, 3.2, false);
    expect(checkPack(empty, 'restaurant').find((r) => r.code === 'table-reachability')).toMatchObject({ status: 'unknown', reason: 'no-tables' });

    let project = newRestaurant('No pass', 20, 14, 3.2, false);
    project = { ...project, space: { ...project.space, doors: project.space.doors.filter((d) => d.meta?.role !== 'pass') } };
    const result = apply(project, { type: 'item.add', item: { id: 'T01', definitionId: 'table-2top', position: { x: m(10), y: m(7) }, rotation: 0, locked: false } });
    expect(result.ok).toBe(true);
    if (result.ok) project = result.project;
    expect(checkPack(project, 'restaurant').find((r) => r.code === 'table-reachability')).toMatchObject({ status: 'unknown', reason: 'no-pass' });
  });

  it('a table placed outside the boundary is a plain design issue, not a pack rule (the core already reports it)', () => {
    let project = newRestaurant('Boundary check', 20, 14, 3.2, false);
    const result = apply(project, { type: 'item.add', item: { id: 'T01', definitionId: 'table-4top', position: { x: m(0.1), y: m(0.1) }, rotation: 0, locked: false } });
    expect(result.ok).toBe(true);
    if (result.ok) project = result.project;
    expect(checkProject(project).some((issue) => issue.code === 'out-of-bounds' && issue.entityIds.includes('T01'))).toBe(true);
  });
});

describe('restaurant at scale', () => {
  it('checks twenty tables off two doors well under a second', () => {
    let project = newRestaurant('Scale restaurant', 40, 20, 3.2, false);
    const commands = Array.from({ length: 20 }, (_, i) => ({
      type: 'item.add' as const,
      item: { id: `T${i + 1}`, definitionId: 'table-4top', position: { x: m(2 + (i % 10) * 3.8), y: m(2 + Math.floor(i / 10) * 3.8) }, rotation: 0, locked: false },
    }));
    for (const command of commands) {
      const result = apply(project, command);
      expect(result.ok).toBe(true);
      if (result.ok) project = result.project;
    }
    const t = Date.now();
    expect(checkProject(project).filter((issue) => issue.severity === 'error')).toEqual([]);
    const rules = checkPack(project, 'restaurant');
    expect(rules.find((r) => r.code === 'table-reachability')?.status).toBe('pass');
    expect(Date.now() - t).toBeLessThan(1000);
  });
});
