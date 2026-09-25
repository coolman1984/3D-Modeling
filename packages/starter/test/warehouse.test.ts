import { apply, checkProject, deserializeProject, fromUnit, serializeProject } from '@space-planner/core';
import { describe, expect, it } from 'vitest';
import { checkPack, detectPack, newWarehouse, rackDefinition, referenceWarehouse, storageLocations, warehouseMetrics, warehouseRoute } from '../src/index.js';

const m = (v: number) => fromUnit(v, 'm');

describe('warehouse reference', () => {
  it('30 × 20 × 8 m, five rows, six bays, four levels, two positions = 240 addressable locations', () => {
    const project = referenceWarehouse();
    expect(detectPack(project)).toBe('warehouse');
    expect(project.space.boundary[2]).toEqual({ x: m(30), y: m(20) });
    expect(project.space.ceilingHeight).toBe(m(8));
    expect(warehouseMetrics(project)).toMatchObject({ rackRows: 5, bays: 30, levels: 20, positions: 240, usablePositions: 240, floorArea: 600, docks: 2 });
    const locations = storageLocations(project);
    expect(locations).toHaveLength(240);
    expect(locations.some((loc) => loc.id === 'R01-B03-L02-P01')).toBe(true);
    expect(checkProject(project).filter((issue) => issue.severity === 'error')).toEqual([]);
    const opened = deserializeProject(serializeProject(project));
    expect(opened.ok).toBe(true);
    if (opened.ok) expect(serializeProject(opened.project)).toBe(serializeProject(project));
  });

  it('a dock reaches the first row and rules name their engineering source', () => {
    const project = referenceWarehouse();
    expect(warehouseRoute(project, 'receiving', 'R01').reachable).toBe(true);
    const rules = checkPack(project, 'warehouse');
    expect(rules[0]).toMatchObject({ code: 'rack-capacity', measured: 240, status: 'pass', source: { kind: 'engineering' } });
    expect(rules[1]).toMatchObject({ code: 'aisle-width', measured: fromUnit(240, 'cm'), required: fromUnit(220, 'cm'), status: 'pass' });
    expect(rules.find((r) => r.code === 'rack-access')).toMatchObject({ measured: 5, required: 5, status: 'pass' });
    expect(rules.find((r) => r.code === 'dock-access')).toMatchObject({ measured: 2, required: 2, status: 'pass' });
    expect(rules.find((r) => r.code === 'restricted-zone')?.status).toBe('pass');
    expect(rules.find((r) => r.code === 'dock-approach')?.status).toBe('pass');
  });

  it('a blocked rack location reduces usable capacity and editing still goes through commands', () => {
    const project = referenceWarehouse();
    const result = apply(project, { type: 'item.meta', id: 'R01', meta: { blockedPositions: 'B03-L02-P01' } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(warehouseMetrics(result.project)).toMatchObject({ positions: 240, usablePositions: 239 });
    expect(storageLocations(result.project).find((loc) => loc.id === 'R01-B03-L02-P01')?.blocked).toBe(true);
  });

  it('a 1.4 m rack aisle fails the 2.2 m planning forklift width check', () => {
    const result = apply(referenceWarehouse(), { type: 'item.move', id: 'R02', to: { x: m(15), y: m(6.5) } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(checkPack(result.project, 'warehouse')[1]).toMatchObject({ code: 'aisle-width', status: 'fail', measured: fromUnit(140, 'cm'), entityIds: ['R01', 'R02'] });
  });

  it('a rack moved into the pedestrian zone is reported by the warehouse pack', () => {
    const result = apply(referenceWarehouse(), { type: 'item.move', id: 'R01', to: { x: m(2), y: m(5) } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(checkPack(result.project, 'warehouse').find((r) => r.code === 'restricted-zone')).toMatchObject({ status: 'fail', entityIds: ['R01'], source: { kind: 'company-policy' } });
  });

  it('rack width follows bay geometry, and invalid counts are rejected', () => {
    expect(rackDefinition('custom', { bays: 6, bayWidth: 27000, depth: 11000, height: 65000, levels: 4, positionsPerLevel: 2, uprightWidth: 1000 }).size.w).toBe(169000);
    expect(() => rackDefinition('invalid', { bays: 0, bayWidth: 27000, depth: 11000, height: 65000, levels: 4, positionsPerLevel: 2, uprightWidth: 1000 })).toThrow();
  });

  it('derives 5,280 locations from 110 rack rows without saving individual positions', () => {
    const base = newWarehouse('Scale reference', 200, 80, 8);
    const items = Object.fromEntries(Array.from({ length: 110 }, (_, i) => {
      const id = `row-${i + 1}`;
      return [id, { id, definitionId: 'warehouse-rack-6', position: { x: m(9.5 + (i % 10) * 18.5), y: m(5 + Math.floor(i / 10) * 3.5) }, rotation: 0, locked: false }];
    }));
    const project = { ...base, items };
    const t = Date.now();
    expect(warehouseMetrics(project)).toMatchObject({ rackRows: 110, bays: 660, positions: 5280, usablePositions: 5280 });
    const metricsMs = Date.now() - t;
    expect(checkProject(project).filter((issue) => issue.severity === 'error')).toEqual([]);
    const checkMs = Date.now() - t - metricsMs;
    const route = warehouseRoute(project, 'receiving', 'row-1');
    expect(route.reachable).toBe(true);
    const routeMs = Date.now() - t - metricsMs - checkMs;
    expect(metricsMs).toBeLessThan(1000);
    expect(checkMs).toBeLessThan(1000);
    expect(routeMs).toBeLessThan(5000);
    expect(metricsMs + checkMs + routeMs).toBeLessThan(5000);
  });

  it('checks 100 rows across a large floor (the pack rules, not just the core checks) in well under a second', () => {
    // checkProject alone never calls into checkWarehouse — the server also calls checkPack
    // for the activity rules, and that is where the expensive part lived: a per-rack,
    // per-dock, per-access-face routing search (400+ full-grid Dijkstra runs on a 200 x 120 m
    // floor) costing tens of seconds before checkWarehouse switched to one flood fill per dock.
    // A test that only calls checkProject would not catch a regression here.
    const base = newWarehouse('Dense scale reference', 200, 120, 8);
    const items = Object.fromEntries(Array.from({ length: 100 }, (_, i) => {
      const col = i % 10;
      const row = Math.floor(i / 10);
      const id = `rack-${i + 1}`;
      return [id, { id, definitionId: 'warehouse-rack-6', position: { x: m(10 + col * 19), y: m(8 + row * 11) }, rotation: 0, locked: false }];
    }));
    const project = { ...base, items };
    const t = Date.now();
    expect(checkProject(project).filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(checkPack(project, 'warehouse').find((r) => r.code === 'rack-access')).toMatchObject({ status: 'pass', measured: 100 });
    expect(Date.now() - t).toBeLessThan(2000);
  });
});
