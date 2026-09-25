import { apply, checkProject, fromUnit, type Command, type ItemInstance, type Project } from '@space-planner/core';
import { describe, expect, it } from 'vitest';
import { checkFactory, crossings, detectPack, factoryMetrics, flowsOf, lineSimulator, newFactory, nextOf, packOf, portOf, stationOf, stationsOf, withNext } from '../src/index.js';

const m = (v: number) => fromUnit(v, 'm');
const cm = (v: number) => fromUnit(v, 'cm');
const EAST = 270_000; // front (local +y) turned to face +x

function run(project: Project, commands: readonly Command[]): Project {
  const r = apply(project, { type: 'batch', commands });
  if (!r.ok) throw new Error(JSON.stringify(r.rejection));
  return r.project;
}
const put = (id: string, definitionId: string, x: number, y: number, next: string[] = [], rotation = EAST): Command => ({
  type: 'item.add',
  item: { id, definitionId, position: { x: m(x), y: m(y) }, rotation, locked: false, ...(next.length ? { meta: { next: next.join(' ') } } : {}) },
});

/**
 * 30 × 15 m, 6 m high. A line along y = 7 m, every station facing east:
 *   goods-in-1 at x 3    (1.2 m deep → out port 3 + 0.6 + 0.4 = 4.0)
 *   cnc-1      at x 8    (1.8 m deep → in 8 − 0.9 − 0.4 = 6.7, out 8 + 0.9 + 0.4 = 9.3)
 *   assembly-1 at x 14   (0.9 m deep → in 13.15, out 14.85)
 *   goods-out-1 at x 20  (in 20 − 0.6 − 0.4 = 19.0)
 * Straight flows: 2.7 + 3.85 + 4.15 = 10.7 m.
 */
function line(): Project {
  const base = newFactory('F', { width: m(30), depth: m(15), height: m(6) });
  return run(base, [
    put('goods-in-1', 'goods-in', 3, 7, ['cnc-1']),
    put('cnc-1', 'cnc', 8, 7, ['assembly-1']),
    put('assembly-1', 'assembly', 14, 7, ['goods-out-1']),
    put('goods-out-1', 'goods-out', 20, 7),
  ]);
}

describe('factory pack', () => {
  it('starts with sample stations and is detected as a factory', () => {
    const p = newFactory('F');
    expect(detectPack(p)).toBe('factory');
    expect(stationOf(p.catalog.cnc)).toEqual({ kind: 'machine', cycle: 90_000, maintenance: { front: 0, back: cm(80), left: cm(60), right: cm(60) }, inSide: 'back', outSide: 'front' });
    expect(stationOf(p.catalog.conveyor)).toMatchObject({ kind: 'conveyor', inSide: 'left', outSide: 'right', capacity: 8 });
  });

  it('reads flows from item meta and writes them back', () => {
    const item: ItemInstance = { id: 'a', definitionId: 'cnc', position: { x: 0, y: 0 }, rotation: 0, locked: false, meta: { next: 'b  c', note: 'x' } };
    expect(nextOf(item)).toEqual(['b', 'c']);
    expect(withNext(item, ['c', 'c', 'd'])).toEqual({ note: 'x', next: 'c d' });
    expect(withNext({ ...item, meta: { next: 'b' } }, [])).toBeNull();
  });

  it('places ports and measures straight flows by hand: 10.7 m, no crossings', () => {
    const p = line();
    const byId = new Map(stationsOf(p).map((s) => [s.item.id, s]));
    expect(portOf(byId.get('cnc-1')!, 'in')).toMatchObject({ x: expect.closeTo(m(6.7), 6), y: expect.closeTo(m(7), 6) });
    expect(portOf(byId.get('cnc-1')!, 'out')).toMatchObject({ x: expect.closeTo(m(9.3), 6), y: expect.closeTo(m(7), 6) });
    const f = factoryMetrics(p, 'cart');
    expect(f.flows).toBe(3);
    expect(f.straightLength).toBeCloseTo(m(10.7), 3);
    expect(f.crossings).toBe(0);
    expect(f.stations).toEqual({ source: 1, machine: 2, buffer: 0, conveyor: 0, sink: 1 });
    // On a clear floor the cart drives the straight line (within the 10 cm grid).
    expect(f.routedLength).toBeGreaterThanOrEqual(m(10.7) - cm(30));
    expect(f.routedLength).toBeLessThanOrEqual(m(10.7) + cm(30));
    expect(checkProject(p)).toEqual([]);
    expect(checkFactory(p, 'cart').map((r) => `${r.code}:${r.status}:${r.measured}/${r.required}`)).toEqual(['maintenance-access:pass:1/1', 'flow-links:pass:4/4', 'flow-path:pass:3/3', 'flow-crossings:pass:0/0']);
  });

  it('a column in the CNC maintenance space fails maintenance access, not the flow', () => {
    const p = line();
    // CNC maintenance zone: x 6.3–9.9 (80 cm behind it), y 5.15–8.85. Column at x 6.3–6.7, y 5.3–5.7.
    const col = { id: 'col', kind: 'column' as const, polygon: [{ x: m(6.3), y: m(5.3) }, { x: m(6.7), y: m(5.3) }, { x: m(6.7), y: m(5.7) }, { x: m(6.3), y: m(5.7) }] };
    const q = run(p, [{ type: 'space.set', space: { ...p.space, obstacles: [col] } }]);
    const [maint, , path] = checkFactory(q, 'cart');
    expect(maint).toMatchObject({ status: 'fail', entityIds: ['cnc-1'] });
    expect(path).toMatchObject({ status: 'pass' });
  });

  it('a wall of blocked floor across the hall cuts the CNC → assembly flow', () => {
    const p = line();
    const wall = { id: 'wall', kind: 'blocked-zone' as const, polygon: [{ x: m(11.5), y: 0 }, { x: m(12.5), y: 0 }, { x: m(12.5), y: m(15) }, { x: m(11.5), y: m(15) }] };
    const q = run(p, [{ type: 'space.set', space: { ...p.space, obstacles: [wall] } }]);
    expect(checkFactory(q, 'cart')[2]).toMatchObject({ code: 'flow-path', status: 'fail', measured: 2, required: 3, entityIds: ['cnc-1'] });
    expect(factoryMetrics(q, 'cart').routedLength).toBeUndefined();
  });

  it('a second line crossing the first is counted once', () => {
    // goods-in-2 at (12, 2) facing north: out port y = 3.0; goods-out-2 at (12, 12): in port y = 11.0.
    // x = 12 crosses the CNC → assembly flow (x 9.3–13.15 at y = 7).
    const p = run(line(), [put('goods-in-2', 'goods-in', 12, 2, ['goods-out-2'], 0), put('goods-out-2', 'goods-out', 12, 12, [], 0)]);
    const flows = flowsOf(p);
    expect(crossings(flows).map(([a, b]) => `${a.from.item.id}×${b.from.item.id}`)).toEqual(['cnc-1×goods-in-2']);
    expect(checkFactory(p, 'cart')[3]).toMatchObject({ status: 'fail', measured: 1, entityIds: ['cnc-1', 'goods-in-2'] });
  });

  it('flags broken flows: a dangling id, a dead end, a stranded machine', () => {
    const p = run(line(), [
      { type: 'item.meta', id: 'assembly-1', meta: { next: 'nowhere' } },
      put('inspection-1', 'inspection', 25, 3),
    ]);
    const links = checkFactory(p, 'cart')[1]!;
    expect(links.status).toBe('fail');
    // assembly-1 names a missing station and no longer reaches the sink; cnc-1 and goods-in-1
    // no longer reach a sink either; inspection-1 is on no flow; goods-out-1 is fed by nobody.
    expect(links.entityIds).toEqual(['assembly-1', 'cnc-1', 'goods-in-1', 'goods-out-1', 'inspection-1']);
  });

  it('simulates a shift from the cycle times: the 90 s CNC sets the pace, 318 parts in 8 h', () => {
    // Source releases at 60 s; CNC 60–150; assembly 150–210 → sink at 210 + 90k ≤ 28 800 → 318 parts.
    const r = lineSimulator.run(line(), { hours: 8 });
    expect(r.ok && r.produced).toBe(318);
    expect(r.ok && r.bottleneck).toBe('cnc-1');
    expect(r.ok && r.perHour).toBeCloseTo(318 / 8, 9);
    // Without a cycle time there is no answer, never a guess.
    const p = line();
    const { cycle: _c, ...meta } = p.catalog.cnc!.meta!;
    const q = run(p, [{ type: 'catalog.define', definition: { ...p.catalog.cnc!, meta } }]);
    expect(lineSimulator.run(q, { hours: 8 })).toEqual({ ok: false, problem: 'missing-cycle', ids: ['cnc-1'] });
    expect(packOf('factory').figures(q).find((f) => f.id === 'per-hour')!.value).toBeUndefined();
    expect(packOf('factory').figures(p).find((f) => f.id === 'per-hour')!.value).toBe(39.8);
  });

  it('reports unknown without stations or maintenance data', () => {
    expect(checkFactory(newFactory('F'), 'cart').map((r) => `${r.code}:${r.status}:${r.reason}`)).toEqual([
      'maintenance-access:unknown:no-stations',
      'flow-links:unknown:no-stations',
      'flow-path:unknown:no-flows',
      'flow-crossings:unknown:no-flows',
    ]);
    const bare = run(newFactory('F', { width: m(20), depth: m(10) }), [put('a', 'assembly', 5, 5)]);
    expect(checkFactory(bare, 'cart')[0]).toMatchObject({ status: 'unknown', reason: 'no-maintenance-data' });
  });
});
