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
    expect(r.rules.map((x) => `${x.code} ${x.status}`)).toEqual(['walkway pass', 'area-per-guest pass', 'exits pass', 'door-width pass']);
    expect(r.rules[1]!.text).toBe('Each guest has 19.96 m² of floor; at least 1.2 m² is needed.');
    expect(buildReport(p, { pack: 'hall', style: 'theatre' }).activity.styleLabel).toBe('Theatre · rows of chairs');
        expect(r.keyOf).toEqual({ 'table-1': 2, 'chair-1': 1, 'chair-2': 1, 'chair-3': 1, 'chair-4': 1 });
  });

  it('lists problems in plain words and never calls an unknown ceiling "ready"', () => {
    const blocked = place(demoHall(), 'chair-1', 'chair', 5, 3.7); // on the column
    const r = buildReport(blocked);
    expect(r.verdict).toBe('problems');
    expect(r.issues[0]).toEqual({
      severity: 'error',
      title: 'On a column or blocked zone',
      text: 'Banquet chair (chair-1) sits on Column (column-1) by 12.5 cm. Move it clear.',
      headline: 'Banquet chair sits on column',
      where: 'chair-1, column-1',
      gap: '12.5 cm over it',
      need: 'Clear of columns',
    });
    const noCeiling = place(newHall('No ceiling', 10, 8), 'chair-1', 'chair', 5, 5);
    expect(buildReport(noCeiling).verdict).toBe('check');
    expect(buildReport(noCeiling).counts).toEqual({ error: 0, warning: 0, info: 1 });
    expect(buildReport(noCeiling).totals.areaPerSeat).toBe(80);
  });

  it('a failed hall rule turns a clean design into "check", and names the cut-off seats', () => {
    // A pen of four 180 × 80 tables that touch but do not overlap: two across (x 6.1 → 7.9 m,
    // at y 5.65 and 4.35), two turned upright just outside their ends (x 5.7 and 8.3 m).
    // The chair at (7, 5) fits in the 50 cm slot between them and has no way out.
    let p = place(demoHall(), 'chair-1', 'chair', 7, 5);
    p = place(p, 'table-180-1', 'table-180', 7, 5.65);
    p = place(p, 'table-180-2', 'table-180', 7, 4.35);
    p = place(p, 'table-180-3', 'table-180', 5.7, 5, 90_000);
    p = place(p, 'table-180-4', 'table-180', 8.3, 5, 90_000);
    const r = buildReport(p);
    expect(r.counts.error).toBe(0);
    expect(r.rules[0]).toMatchObject({ code: 'walkway', status: 'fail', severity: 'warning' });
    expect(r.rules[0]!.text).toBe('1 seat has no 90 cm walkway to a door: Banquet chair (chair-1). Widen the walkway or move what blocks it.');
  });
});

describe('activity of a project', () => {
  it('is read from the catalog when none was chosen, and a style must belong to its pack', async () => {
    const { activityOf, loadActivity } = await import('../src/logic/activity.js');
    const { newRoom } = await import('@space-planner/starter');
    expect(loadActivity(newRoom('Office', 8, 6, 3, 'office'))).toEqual({ pack: 'office', style: 'open-plan' });
    expect(loadActivity(demoHall())).toEqual({ pack: 'hall', style: 'banquet' });
    expect(activityOf('office', 'theatre')).toEqual({ pack: 'office', style: 'open-plan' });
    expect(activityOf('mall', 'meeting')).toEqual({ pack: 'hall', style: 'banquet' });
  });

  it('an office report checks desks and names the pack and style', async () => {
    const { newRoom } = await import('@space-planner/starter');
    let p = place(newRoom('Office', 8, 6, 3, 'office'), 'desk-140-1', 'desk-140', 2, 3);
    const r = buildReport(p, { pack: 'office', style: 'meeting' });
    expect(r.activity).toEqual({ pack: 'office', label: 'Office', style: 'meeting', styleLabel: 'Meeting room' });
    expect(r.rules.map((x) => `${x.code} ${x.status}`)).toEqual(['walkway unknown', 'area-per-person unknown', 'workstations fail', 'exits unknown', 'door-width unknown']);
    expect(r.rules[2]!.text).toBe('The desk has no chair nearby: Desk 140 × 70 (desk-140-1).');
    p = place(p, 'office-chair-1', 'office-chair', 2, 3.65, 180_000);
    expect(buildReport(p, { pack: 'office', style: 'meeting' }).rules[2]!.text).toBe('The desk has a chair.');
  });
});
