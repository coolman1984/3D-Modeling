import { apply, fromUnit, type Command, type Project } from '@space-planner/core';
import { demoHall, newHall } from '@space-planner/starter';
import { describe, expect, it } from 'vitest';
import { buildReport } from '../src/logic/report.js';

const m = (v: number) => fromUnit(v, 'm');

function place(project: Project, id: string, definitionId: string, x: number, y: number, rotation = 0): Project {
  const command: Command = { type: 'item.add', item: { id, definitionId, position: { x: m(x), y: m(y) }, rotation, locked: false } };
  const result = apply(project, command);
  if (!result.ok) throw new Error(result.rejection.message);
  return result.project;
}

describe('client report', () => {
  it('adds up a table with four chairs in the 10 × 8 m demo hall', () => {
    let p = place(demoHall(), 'table-1', 'table-180', 3, 6);
    p = place(p, 'chair-1', 'chair', 2.5, 6.7, 180_000);
    p = place(p, 'chair-2', 'chair', 3.5, 6.7, 180_000);
    p = place(p, 'chair-3', 'chair', 2.5, 5.3);
    p = place(p, 'chair-4', 'chair', 3.5, 5.3);
    const r = buildReport(p);
    expect(r.verdict).toBe('ready');
    expect(r.room).toEqual({ width: m(10), depth: m(8), ceiling: m(3), doors: 1, columns: 1, floorArea: 79.84 }); // 80 − 0.4 × 0.4
    // Footprints: 1.8 × 0.8 = 1.44 m² plus four 0.45 × 0.45 = 0.81 m² → 2.25 m².
    expect(r.totals.occupiedArea).toBeCloseTo(2.25, 6);
    expect(r.totals.seats).toBe(4);
    expect(r.totals.areaPerSeat).toBeCloseTo(19.96, 6);
    // Lines follow the bill of materials order (category, then name): chairs, then the table.
    expect(r.lines.map((l) => [l.key, l.definitionId, l.count, l.seats])).toEqual([
      [1, 'chair', 4, 4],
      [2, 'table-180', 1, 0],
    ]);
    expect(r.keyOf).toEqual({ 'table-1': 2, 'chair-1': 1, 'chair-2': 1, 'chair-3': 1, 'chair-4': 1 });
  });

  it('lists problems in plain words and never calls an unknown ceiling "ready"', () => {
    const blocked = place(demoHall(), 'chair-1', 'chair', 5, 3.7); // on the column
    const r = buildReport(blocked);
    expect(r.verdict).toBe('problems');
    expect(r.issues[0]).toEqual({ severity: 'error', title: 'فوق عمود أو منطقة ممنوعة', text: 'كرسي (chair-1) فوق العمود (column-1) بمقدار ١٢٫٥ سم.' });
    const noCeiling = place(newHall('بدون سقف', 10, 8), 'chair-1', 'chair', 5, 5);
    expect(buildReport(noCeiling).verdict).toBe('check');
    expect(buildReport(noCeiling).counts).toEqual({ error: 0, warning: 0, info: 1 });
    expect(buildReport(noCeiling).totals.areaPerSeat).toBe(80);
  });
});
