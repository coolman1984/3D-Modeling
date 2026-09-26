import { checkProject, deserializeProject, serializeProject, validateProject } from '@space-planner/core';
import { describe, expect, it } from 'vitest';
import { checkContainer, checkWarehouse, containerMetrics, isContainer, isWarehouse, nileGateSample, optimizeSlotting, stockMetrics } from '../src/index.js';

describe('Nile Gate sample company', () => {
  const sample = nileGateSample();

  it('is deterministic: two builds save to the same text', () => {
    const again = nileGateSample();
    expect(again.map((s) => serializeProject(s.project))).toEqual(sample.map((s) => serializeProject(s.project)));
  });

  it.each(sample.map((s) => [s.project.name, s.project] as const))('%s is valid, saves and opens, and has no design errors', (_name, project) => {
    expect(validateProject(project)).toEqual([]);
    const opened = deserializeProject(serializeProject(project));
    expect(opened.ok).toBe(true);
    expect(checkProject(project).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('every warehouse passes its rules', () => {
    for (const { project } of sample.filter((s) => isWarehouse(s.project))) {
      const failed = checkWarehouse(project).filter((r) => r.status !== 'pass');
      expect(failed, project.name).toEqual([]);
    }
  });

  it('every loaded container passes its loading rules and loaded everything planned', () => {
    for (const { project } of sample.filter((s) => isContainer(s.project) && Object.keys(s.project.items).length > 0)) {
      const failed = checkContainer(project).filter((r) => r.status === 'fail');
      expect(failed, project.name).toEqual([]);
      expect(containerMetrics(project).unpacked, project.name).toBe(0);
    }
  });

  it('the practice container is planned but empty', () => {
    const practice = sample.find((s) => s.project.name.startsWith('Try it'))!.project;
    expect(Object.keys(practice.items)).toHaveLength(0);
    expect(containerMetrics(practice).unpacked).toBe(204);
  });

  it('the main DC is stocked and the slotting optimiser saves travel', () => {
    const dc = sample[0]!.project;
    const stock = stockMetrics(dc);
    expect(stock.positions).toBe(1680);
    expect(stock.occupancy).toBeGreaterThan(0.75);
    expect(stock.occupancy).toBeLessThan(0.95);
    const candidate = optimizeSlotting(dc);
    expect(candidate.leftOver).toEqual([]);
    expect(candidate.metrics.saving).toBeGreaterThan(15);
  });
});


