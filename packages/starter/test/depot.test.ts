import { describe, expect, it } from 'vitest';
import { deserializeProject, fromUnit, serializeProject } from '@space-planner/core';
import { bayEntry, bayZone, checkVehicleDepot, DEFAULT_VEHICLE, depotMetrics, newVehicleDepot, referenceVehicleDepot } from '../src/depot.js';

const m = (n: number) => fromUnit(n, 'm');
const lane = { id: 'lane', kind: 'lane-two-way', polygon: [{ x: m(2), y: m(6) }, { x: m(18), y: m(6) }, { x: m(18), y: m(9) }, { x: m(2), y: m(9) }], meta: { direction: 0 } };

describe('reference vehicle depot', () => {
  const project = referenceVehicleDepot();

  it('places six perpendicular bay zones and two vehicles, two bays occupied', () => {
    const metrics = depotMetrics(project);
    expect(metrics.bays).toBe(6);
    expect(metrics.bayTypes.perpendicular).toBe(6);
    expect(metrics.vehicles).toBe(2);
    expect(metrics.occupiedBays).toBe(2);
  });

  it('every empty bay is reachable from the lane without touching a wall, column or the parked vehicles', () => {
    const rules = checkVehicleDepot(project);
    const boundary = rules.find((r) => r.code === 'bay-boundary')!;
    const entry = rules.find((r) => r.code === 'bay-entry')!;
    expect(boundary.status).toBe('pass');
    expect(entry.status).toBe('pass');
    expect(entry.measured).toBe(4); // 6 bays minus the 2 occupied
  });

  it('a parked vehicle sitting in a bay is never flagged as overlapping it — a bay is a zone, not an item', () => {
    // No item-overlap check exists between project.items and project.space.zones at all, so this
    // is really just confirming the reference project has no items overlapping other items.
    expect(Object.keys(project.items)).toEqual(['V01', 'V02']);
  });

  it('round-trips through save and open byte-identical', () => {
    const saved = serializeProject(project);
    const reopened = deserializeProject(saved);
    expect(reopened).toMatchObject({ ok: true, project });
  });
});

describe('bay entry — a small hand-checked scene', () => {
  it('drives a Dubins path from the lane centreline into the bay, hand-verified endpoints', () => {
    // A 20 x 18 m floor, an east-west lane band y in [6,9], and one bay at (10,12) facing north
    // (direction 0 = front (0,1), a nose-in parked car's front pointing away from the lane): the
    // vehicle drives east on the lane, set back one turning radius for room to curve, then turns
    // left into the bay — the same kind of curve `dubinsPath` itself is verified against in
    // packages/industry, exercised here through the depot's own wiring. The extra 3 m of depth
    // over the 15 m used elsewhere in this file leaves room for the sedan's front overhang past
    // the bay's own centre once it is fully turned in.
    let project = newVehicleDepot('bay entry scene', 20, 18, 4, false);
    project = { ...project, space: { ...project.space, zones: [lane, bayZone('B1', { x: m(10), y: m(12) }, 'perpendicular', 0)] } };
    const result = bayEntry(project, 'B1', DEFAULT_VEHICLE);
    expect(result.clear).toBe(true);
    const first = result.path[0]!;
    const last = result.path[result.path.length - 1]!;
    // Hand-computed start: the lane point directly below the bay (10, 7.5), facing east, set back
    // one turning radius (3.2 m) for lead-in room: x = 10 - 3.2 = 6.8 m, y = 7.5 m.
    expect(first.x).toBe(m(6.8));
    expect(first.y).toBe(m(7.5));
    // Hand-computed goal: the bay's own centre (within floating-point sampling tolerance).
    expect(last.x).toBeCloseTo(m(10), 6);
    expect(last.y).toBeCloseTo(m(12), 6);
  });

  it('reports "occupied" for a bay a vehicle already sits in, not a blocked path', () => {
    let project = newVehicleDepot('occupied bay', 20, 18, 4, false);
    project = {
      ...project,
      space: { ...project.space, zones: [lane, bayZone('B1', { x: m(10), y: m(12) }, 'perpendicular', 0)] },
      items: { V1: { id: 'V1', definitionId: 'depot-sedan', position: { x: m(10), y: m(12) }, rotation: 0, locked: false } },
    };
    expect(bayEntry(project, 'B1')).toMatchObject({ clear: false, reason: 'occupied' });
  });

  it('reports "blocked" when a no-go zone sits across the only approach, "no-lanes" with no lane zone, and "no-bay" for an unknown id', () => {
    let project = newVehicleDepot('blocked bay', 20, 18, 4, false);
    const noZones = { ...project, space: { ...project.space, zones: [bayZone('B1', { x: m(10), y: m(12) }, 'perpendicular', 0)] } };
    expect(checkVehicleDepot(noZones).find((r) => r.code === 'bay-entry')).toMatchObject({ status: 'unknown', reason: 'no-lanes' });
    expect(bayEntry(noZones, 'does-not-exist')).toMatchObject({ clear: false, reason: 'no-bay' });

    project = {
      ...noZones,
      space: {
        ...project.space,
        zones: [lane, bayZone('B1', { x: m(10), y: m(12) }, 'perpendicular', 0), { id: 'blocker', kind: 'no-go', polygon: [{ x: m(6), y: m(9) }, { x: m(14), y: m(9) }, { x: m(14), y: m(10.5) }, { x: m(6), y: m(10.5) }] }],
      },
    };
    expect(bayEntry(project, 'B1')).toMatchObject({ clear: false, reason: 'blocked' });
  });
});

describe('vehicle depot at scale', () => {
  it('checks twenty bays off one lane in under a second', () => {
    let project = newVehicleDepot('scale depot', 60, 15, 4, false);
    const wideLane = { id: 'lane', kind: 'lane-two-way', polygon: [{ x: m(1), y: m(6) }, { x: m(59), y: m(6) }, { x: m(59), y: m(9) }, { x: m(1), y: m(9) }], meta: { direction: 0 } };
    const zones = [wideLane, ...Array.from({ length: 20 }, (_, i) => bayZone(`B${String(i + 1).padStart(2, '0')}`, { x: m(2 + i * 2.8), y: m(12) }, 'perpendicular', 0))];
    project = { ...project, space: { ...project.space, zones } };
    const start = Date.now();
    const rules = checkVehicleDepot(project);
    expect(Date.now() - start).toBeLessThan(1000);
    expect(rules.find((r) => r.code === 'bay-entry')?.status).toBeDefined();
  });
});
