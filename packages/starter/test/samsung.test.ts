import { checkProject, deserializeProject, serializeProject, validateProject } from '@space-planner/core';
import { describe, expect, it } from 'vitest';
import { checkPack, containerMetrics, depotMetrics, detectPack, isContainer, productionMetrics, restaurantMetrics, samsungSample, siteMetrics, stockMetrics } from '../src/index.js';

describe('Samsung Electronics Egypt sample', () => {
  const sample = samsungSample();
  const named = (start: string) => sample.find((s) => s.project.name.includes(start))!.project;

  it('is deterministic: two builds save to the same text', () => {
    const again = samsungSample();
    expect(again.map((s) => serializeProject(s.project))).toEqual(sample.map((s) => serializeProject(s.project)));
    // A full rebuild of ten projects (~2 s alone) can pass 5 s under suite load. Not a speed test.
  }, 20_000);

  it.each(sample.map((s) => [s.project.name, s.project] as const))('%s is valid, saves and opens, and has no design errors', (_name, project) => {
    expect(validateProject(project)).toEqual([]);
    const opened = deserializeProject(serializeProject(project));
    expect(opened.ok).toBe(true);
    expect(checkProject(project).filter((i) => i.severity !== 'info')).toEqual([]);
  });

  it.each(sample.map((s) => [s.project.name, s.project] as const))('%s passes every rule of its pack (none fail)', (_name, project) => {
    const style = typeof project.space.meta?.style === 'string' ? project.space.meta.style : null;
    const failed = checkPack(project, detectPack(project), style).filter((r) => r.status === 'fail');
    expect(failed.map((r) => `${r.code}: ${r.entityIds.slice(0, 6).join(', ')}`)).toEqual([]);
  });

  it('each project is checked as the activity it shows', () => {
    expect(sample.map((s) => detectPack(s.project))).toEqual(['site', 'production', 'production', 'warehouse', 'depot', 'office', 'office', 'hall', 'restaurant', 'container']);
  });

  it('the campus matches the published site area and holds the buildings, buses and cars', () => {
    const metrics = siteMetrics(named('campus'));
    expect(metrics.siteArea).toBe(336_000);
    expect(metrics.buildings).toBe(17); // 16 buildings and the gate's guard booth
    expect(metrics.busBays).toBe(54);
    expect(metrics.buses).toBe(47);
    expect(metrics.carBays).toBe(480);
    expect(metrics.cars).toBe(329 + 11); // staff cars and the container trucks at the docks and in the yard
    expect(metrics.coverage).toBeGreaterThan(15);
    expect(metrics.coverage).toBeLessThan(30);
    const rules = checkPack(named('campus'), 'site').map((r) => [r.code, r.status]);
    expect(rules).toEqual([['building-boundary', 'pass'], ['bay-boundary', 'pass'], ['bay-entry', 'pass']]);
  });

  it('the phone plant is about 9,000 m², its SMT line runs end to end', () => {
    const plant = named('Plant 2');
    const metrics = productionMetrics(plant);
    expect(metrics.floorArea).toBe(9000);
    expect(metrics.stations).toBe(12);
    expect(metrics.reachableSegments).toBe(11);
  });

  it('the TV line runs from kitting to palletising, with a 120-set ageing buffer', () => {
    const metrics = productionMetrics(named('Plant 1'));
    expect(metrics.stations).toBe(8);
    expect(metrics.reachableSegments).toBe(7);
    expect(metrics.bufferCapacity).toBe(120);
  });

  it('the finished-goods warehouse is stocked with Samsung products', () => {
    const stock = stockMetrics(named('Finished-goods'));
    expect(stock.positions).toBe(2160);
    expect(stock.occupancy).toBeGreaterThan(0.7);
  });

  it('the transport yard has free bus and car bays a coach and a car can drive into', () => {
    const metrics = depotMetrics(named('transport yard'));
    expect(metrics.bayTypes.bus).toBe(42);
    expect(metrics.usableBays).toBe(metrics.bays - metrics.occupiedBays);
    expect(metrics.usableBays).toBeGreaterThan(20);
  });

  it('the canteen seats a shift wave and every table is served from the pass', () => {
    const metrics = restaurantMetrics(named('canteen'));
    expect(metrics.covers).toBe(886);
    expect(metrics.reachableTables).toBe(metrics.totalTables);
  });

  it('the export container is loaded completely', () => {
    const container = sample.find((s) => isContainer(s.project))!.project;
    expect(containerMetrics(container).unpacked).toBe(0);
  });
});
