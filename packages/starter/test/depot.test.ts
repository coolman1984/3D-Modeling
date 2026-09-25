import { apply, checkProject, fromUnit, validateProject, type Command, type Project, type Zone } from '@space-planner/core';
import { bodyFree } from '@space-planner/industry';
import { describe, expect, it } from 'vitest';
import { bayAccess, bayRow, baysOfDepot, checkDepot, depotMetrics, detectPack, gatePose, gatesOf, newDepot, packOf, vehicleOf, yardFor } from '../src/index.js';

const m = (v: number) => fromUnit(v, 'm');
const cm = (v: number) => fromUnit(v, 'cm');

function run(project: Project, commands: readonly Command[]): Project {
  const r = apply(project, { type: 'batch', commands });
  if (!r.ok) throw new Error(JSON.stringify(r.rejection));
  return r.project;
}
const withZones = (p: Project, zones: Zone[]) => run(p, [{ type: 'space.set', space: { ...p.space, zones: [...(p.space.zones ?? []), ...zones] } }]);

/**
 * 30 × 20 m yard, 5 m high, gate on the south wall at x 3–9 m (facing north). Five 2.5 × 5 m car
 * bays square to the aisle from x = 4 m along y = 12 m, opening south: bays x 4–16.5, y 12–17;
 * the aisle in front is 8 m deep.
 */
function yard(): Project {
  const p = newDepot('D', { width: m(30), depth: m(20), height: m(5) });
  const taken = new Set(['gate-1']);
  return withZones(p, bayRow({ vehicleId: 'car', use: 'parking', origin: { x: m(4), y: m(12) }, count: 5, angle: 90, bayWidth: cm(250), bayLength: cm(500), facing: 'north', entry: 'forward', taken }));
}
/** A car item parked nose in, centred in a bay (item rotation 0 = front faces north). */
const parkIn = (p: Project, bayId: string, id: string): Command => {
  const z = p.space.zones!.find((b) => b.id === bayId)!;
  const x = z.polygon.reduce((s, q) => s + q.x, 0) / 4;
  const y = z.polygon.reduce((s, q) => s + q.y, 0) / 4;
  return { type: 'item.add', item: { id, definitionId: 'car', position: { x: Math.round(x), y: Math.round(y) }, rotation: 0, locked: false } };
};

describe('depot pack', () => {
  it('reads vehicles from spec-sheet data: the car plans on a 3.83 m rear-axle radius', () => {
    const p = newDepot('D');
    expect(detectPack(p)).toBe('depot');
    const car = vehicleOf(p.catalog.car)!;
    expect(car).toMatchObject({ length: cm(470), width: cm(180), wheelbase: cm(280), frontOverhang: cm(95), rearOverhang: cm(95), reverse: true });
    expect(car.minRadius / 10_000).toBeCloseTo(3.8339, 3);
    expect(vehicleOf(p.catalog.bus)!.minRadius / 10_000).toBeCloseTo(Math.sqrt(10.5 ** 2 - 36) - 1.275, 3);
  });

  it('lays out a bay row by hand: bay 1 centred at (5.25, 14.5) m, 2.5 m across and 5 m deep', () => {
    const p = yard();
    const bays = baysOfDepot(p);
    expect(bays.map((b) => b.zone.id)).toEqual(['bay-1', 'bay-2', 'bay-3', 'bay-4', 'bay-5']);
    const xs = bays[0]!.zone.polygon.map((q) => q.x);
    const ys = bays[0]!.zone.polygon.map((q) => q.y);
    expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([m(4), m(6.5), m(12), m(17)]);
    // Parked nose in and centred: body from y = 12.15 to 16.85 m.
    const car = vehicleOf(p.catalog.car)!;
    expect(bays[0]!.parked[0]!.y).toBeCloseTo(m(14.5) - (car.length / 2 - car.rearOverhang), 6);
    // At the gate the car stands inside the yard, rear 30 cm in from the wall.
    const at = gatePose(car, gatesOf(p)[0]!, false);
    expect(at.y - car.rearOverhang).toBeCloseTo(cm(30), 6);
    expect(checkProject(p)).toEqual([]);
    // A new depot is valid data (a rounded −0 in the gate corners was once rejected by the core).
    expect(validateProject({ ...newDepot('D'), id: 'p-1' })).toEqual([]);
  });

  it('every bay can be entered and left; size, headroom and gates pass', () => {
    const p = yard();
    expect(checkDepot(p).map((r) => `${r.code}:${r.status}:${r.measured}/${r.required}`)).toEqual([
      'bay-access:pass:5/5',
      `bay-size:pass:5/5`,
      `vehicle-headroom:pass:${m(5)}/${cm(170)}`,
      'gates:pass:1/1',
    ]);
    // The manoeuvres keep the whole body clear at every sample.
    const bay = baysOfDepot(p)[2]!;
    const a = bayAccess(p, bay);
    expect(a.status).toBe('pass');
    if (a.status !== 'pass') return;
    const { grid, clearance } = yardFor(p, bay.zone);
    expect([...a.enter.poses, ...a.leave.poses].every((q) => bodyFree(bay.vehicle!, q, grid, clearance))).toBe(true);
  });

  it('a car parked either side still leaves the middle bay usable', () => {
    const p = yard();
    const q = run(p, [parkIn(p, 'bay-2', 'car-a'), parkIn(p, 'bay-4', 'car-b')]);
    expect(bayAccess(q, baysOfDepot(q).find((b) => b.zone.id === 'bay-3')!).status).toBe('pass');
  });

  it('a bay walled in on three sides with a parked car on the fourth cannot be reached: proof, not a guess', () => {
    const p = yard();
    const wall = (id: string, x0: number, y0: number, x1: number, y1: number) => ({ id, kind: 'blocked-zone' as const, polygon: [{ x: m(x0), y: m(y0) }, { x: m(x1), y: m(y0) }, { x: m(x1), y: m(y1) }, { x: m(x0), y: m(y1) }] });
    const q = run(p, [
      parkIn(p, 'bay-4', 'car-b'),
      // Closed in front (south), at the east end and along the north: only a 35 cm slot beside car-b.
      { type: 'space.set', space: { ...p.space, obstacles: [wall('front', 14, 11.6, 16.8, 12), wall('end', 16.5, 12, 16.8, 17.3), wall('north', 13.9, 17, 16.8, 17.3)] } },
    ]);
    const access = checkDepot(q)[0]!;
    expect(access).toMatchObject({ code: 'bay-access', status: 'fail', entityIds: ['bay-5'] });
    expect(bayAccess(q, baysOfDepot(q)[4]!)).toEqual({ status: 'fail', why: 'no-way' });
  });

  it('flags small bays and low ceilings; unknown without bays or gates', () => {
    const p = newDepot('D', { width: m(30), depth: m(20), height: m(3) });
    const tight = withZones(p, bayRow({ vehicleId: 'van', use: 'parking', origin: { x: m(4), y: m(12) }, count: 1, angle: 90, bayWidth: cm(230), bayLength: cm(600), facing: 'north', entry: 'forward', taken: new Set(['gate-1']) }));
    const rules = checkDepot(tight);
    // A van is 2.05 m wide: needs 2.65 m; 5.9 m long: needs 6.15 m. 2.5 m high + 20 cm < 3 m: ok.
    expect(rules[1]).toMatchObject({ code: 'bay-size', status: 'fail', entityIds: ['bay-1'] });
    expect(rules[2]).toMatchObject({ code: 'vehicle-headroom', status: 'pass' });
    const busBay = withZones(p, bayRow({ vehicleId: 'bus', use: 'wash', origin: { x: m(4), y: m(6) }, count: 1, angle: 90, bayWidth: cm(350), bayLength: cm(1300), facing: 'north', entry: 'forward', taken: new Set(['gate-1']) }));
    expect(checkDepot(busBay)[2]).toMatchObject({ code: 'vehicle-headroom', status: 'fail', required: cm(340) });
    const empty = checkDepot(newDepot('D'));
    expect(empty.map((r) => `${r.code}:${r.status}`)).toEqual(['bay-access:unknown', 'bay-size:unknown', 'vehicle-headroom:unknown', 'gates:pass']);
    const noGate = run(yard(), [{ type: 'space.set', space: { ...yard().space, zones: yard().space.zones!.filter((z) => z.kind !== 'gate') } }]);
    expect(checkDepot(noGate)[0]).toMatchObject({ status: 'unknown', reason: 'no-gates' });
    expect(checkDepot(noGate)[3]).toMatchObject({ status: 'fail' });
  });

  it('measures the yard for comparing variants', () => {
    const d = depotMetrics(yard());
    expect(d).toMatchObject({ bays: 5, accessible: 5, unknown: 0, gates: 1, byUse: { parking: 5 }, yardArea: 600 });
    expect(d.entryAverage).toBeGreaterThan(m(8));
    expect(packOf('depot').figures(yard())[0]).toMatchObject({ id: 'accessible', value: 5 });
  });

  it('remembers answers for the same yard only: resizing an item type changes the answer', () => {
    // A 1 × 1 m crate in the aisle at (11, 10) m; then the crate type grows to 3 × 19.8 m, a
    // barrier across the whole yard east of the gate (y 0.1–19.9 m at x 9.5–12.5 m).
    const p = yard();
    const crateType = { id: 'crate', name: 'Crate', category: 'box', size: { w: m(1), d: m(1), h: m(1) }, clearance: { front: 0, back: 0, left: 0, right: 0 } };
    const q = run(p, [{ type: 'catalog.define', definition: crateType }, { type: 'item.add', item: { id: 'crate-1', definitionId: 'crate', position: { x: m(11), y: m(10) }, rotation: 0, locked: false } }]);
    const bay5 = () => baysOfDepot(q).find((b) => b.zone.id === 'bay-5')!;
    expect(bayAccess(q, bay5()).status).toBe('pass');
    // Only the type changes: the item and every zone stay as they were.
    const big = run(q, [{ type: 'catalog.define', definition: { ...crateType, size: { w: m(3), d: m(19.8), h: m(1) } } }]);
    expect(bayAccess(big, baysOfDepot(big).find((b) => b.zone.id === 'bay-5')!).status).toBe('fail');
  });
});
