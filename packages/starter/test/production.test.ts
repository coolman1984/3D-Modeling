import { apply, checkProject, deserializeProject, fromUnit, serializeProject } from '@space-planner/core';
import { describe, expect, it } from 'vitest';
import { checkPack, detectPack, flowOrder, flowPoints, newProductionLine, productionLineSpec, productionMetrics, productionRoute, referenceProductionLine, simulateProduction } from '../src/index.js';

const m = (v: number) => fromUnit(v, 'm');

describe('production line reference', () => {
  it('simulates an eight-hour shift deterministically from entered cycle times, never from floor distance', () => {
    const project = referenceProductionLine();
    const spec = productionLineSpec(project);
    expect(spec.map((s) => [s.kind, s.cycle, s.capacity])).toEqual([
      ['source', 30_000, undefined],
      ['machine', 60_000, undefined],
      ['buffer', undefined, 20],
      ['machine', 90_000, undefined],
      ['machine', 30_000, undefined],
      ['sink', undefined, undefined],
    ]);
    const result = simulateProduction(project, 8);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // First finished piece: 30 + 60 + 90 + 30 = 210 s; then the 90 s machine sets the pace.
    // 210 + 90k <= 28,800 s gives k = 0..317 => 318 finished pieces.
    expect(result.produced).toBe(318);
    expect(result.perHour).toBeCloseTo(39.75, 10);
    expect(result.bottleneck).toBe('S04');
    expect(simulateProduction(project, 8)).toEqual(result);
  });

  it('source, two machines, a buffer, inspection and finished goods, in flow order', () => {
    const project = referenceProductionLine();
    expect(detectPack(project)).toBe('production');
    expect(project.space.boundary[2]).toEqual({ x: m(30), y: m(8) });
    const order = flowOrder(project);
    expect(order.map((i) => i.definitionId)).toEqual(['source', 'machine-a', 'buffer', 'machine-b', 'inspection', 'sink']);
    const metrics = productionMetrics(project);
    expect(metrics).toMatchObject({ stations: 6, machines: 2, buffers: 1, bufferCapacity: 20, totalSegments: 5, reachableSegments: 5 });
    expect(metrics.flowLength).toBeGreaterThan(0);
    expect(checkProject(project).filter((issue) => issue.severity === 'error')).toEqual([]);
    const rules = checkPack(project, 'production');
    expect(rules.find((r) => r.code === 'machine-boundary')).toMatchObject({ status: 'pass', measured: 6, required: 6, source: { kind: 'engineering' } });
    expect(rules.find((r) => r.code === 'flow-reachability')).toMatchObject({ status: 'pass', measured: 5, required: 5 });
    const opened = deserializeProject(serializeProject(project));
    expect(opened.ok).toBe(true);
    if (opened.ok) expect(serializeProject(opened.project)).toBe(serializeProject(project));
  });

  it('a 2.8 m gap between a source and a sink, hand-calculated on the 20 cm planning grid', () => {
    // Both are 1 m deep with no clearance. A flow point reaches out from the station's centre by
    // half its depth (0.5 m) + half the material handler's 1 m width (0.5 m) + a fixed 0.1 m gap
    // = 1.1 m: short of that margin, the point sits too close to the station's own footprint for
    // the handler to occupy it. Source at x=2 m outputs at x=3.1 m; sink at x=7 m takes input at
    // x=5.9 m. Both land exactly on a 20 cm cell centre (…, 2.9, 3.1, …, 5.7, 5.9, …), so the
    // grid-sampled distance matches the geometric one exactly: 5.9 − 3.1 = 2.8 m.
    let project = newProductionLine('Gap check', 20, 8, 4, false);
    const place = (id: string, defId: string, x: number, step: number) => {
      const result = apply(project, { type: 'item.add', item: { id, definitionId: defId, position: { x: m(x), y: m(4) }, rotation: 270_000, locked: false, meta: { step } } });
      expect(result.ok).toBe(true);
      if (result.ok) project = result.project;
    };
    place('S01', 'source', 2, 1);
    place('S02', 'sink', 7, 2);
    const source = project.items.S01!;
    const sink = project.items.S02!;
    expect(flowPoints(source, project.catalog.source!).output).toEqual({ x: m(3.1), y: m(4) });
    expect(flowPoints(sink, project.catalog.sink!).input).toEqual({ x: m(5.9), y: m(4) });
    const route = productionRoute(project, 'S01', 'S02');
    expect(route).toMatchObject({ reachable: true, distance: m(2.8) });
  });

  it('a station straddling the wall fails machine-boundary; one station alone is unknown for reachability', () => {
    let project = newProductionLine('Boundary check', 20, 8, 4, false);
    const add = (id: string, defId: string, x: number, y: number, step: number) => {
      const result = apply(project, { type: 'item.add', item: { id, definitionId: defId, position: { x: m(x), y: m(y) }, rotation: 270_000, locked: false, meta: { step } } });
      expect(result.ok).toBe(true);
      if (result.ok) project = result.project;
    };
    add('S01', 'source', 0.2, 4, 1);
    let rules = checkPack(project, 'production');
    expect(rules.find((r) => r.code === 'machine-boundary')).toMatchObject({ status: 'fail', entityIds: ['S01'] });
    expect(rules.find((r) => r.code === 'flow-reachability')).toMatchObject({ status: 'unknown', reason: 'one-station' });

    add('S02', 'sink', 10, 4, 2);
    rules = checkPack(project, 'production');
    expect(rules.find((r) => r.code === 'flow-reachability')?.status).toBe('pass');
  });

  it('checks a 20-station line well under a second (no fan-out: one search per consecutive pair)', () => {
    let project = newProductionLine('Long line', 120, 8, 4, false);
    const commands = Array.from({ length: 20 }, (_, i) => ({
      type: 'item.add' as const,
      item: { id: `S${i + 1}`, definitionId: i % 2 === 0 ? 'buffer' : 'source', position: { x: m(2 + i * 5.5), y: m(4) }, rotation: 270_000, locked: false, meta: { step: i + 1 } },
    }));
    for (const command of commands) {
      const result = apply(project, command);
      expect(result.ok).toBe(true);
      if (result.ok) project = result.project;
    }
    const t = Date.now();
    expect(checkProject(project).filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(checkPack(project, 'production').find((r) => r.code === 'flow-reachability')).toMatchObject({ status: 'pass', measured: 19, required: 19 });
    expect(Date.now() - t).toBeLessThan(1000);
  });
});
