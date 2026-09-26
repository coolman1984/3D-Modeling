import { apply, fromUnit, validateProject, type Command, type Project } from '@space-planner/core';
import { describe, expect, it } from 'vitest';
import { checkOffice, checkPack, detectPack, missingPackItems, newHall, newRoom, OFFICE_CATALOG, packOf, PACKS, RULE_SOURCES, workstationRule } from '../src/index.js';

const m = (v: number) => fromUnit(v, 'm');

/** An 8 × 6 m office (48 m²) with one 90 cm door centred on the south wall. */
const office = () => newRoom('Office', 8, 6, 3, 'office');

function place(project: Project, id: string, definitionId: string, x: number, y: number, rotation = 0): Project {
  const command: Command = { type: 'item.add', item: { id, definitionId, position: { x: m(x), y: m(y) }, rotation, locked: false } };
  const result = apply(project, command);
  if (!result.ok) throw new Error(result.rejection.message);
  return result.project;
}

/** A 140 × 70 desk at (x, y) facing north (its front edge at y + 0.35 m) and, optionally, a chair `gap` in front of it. */
function desk(project: Project, n: number, x: number, y: number, gap?: number): Project {
  let p = place(project, `desk-${n}`, 'desk-140', x, y);
  if (gap !== undefined) p = place(p, `chair-${n}`, 'office-chair', x, y + 0.35 + gap, 180_000);
  return p;
}

describe('office pack', () => {
  it('a new office has the office catalog and is valid; it is recognised as an office', () => {
    const p = office();
    expect(Object.keys(p.catalog).sort()).toEqual(OFFICE_CATALOG.map((d) => d.id).sort());
    expect(validateProject(p)).toEqual([]);
    expect(detectPack(p)).toBe('office');
    expect(detectPack(newHall('Hall', 10, 8))).toBe('hall');
    // A hall that also brought in the office items is still mostly a hall.
    const both = { ...newHall('Hall', 10, 8), catalog: { ...newHall('Hall', 10, 8).catalog, ...office().catalog } };
    expect(detectPack(both)).toBe('hall');
    expect(missingPackItems(newHall('Hall', 10, 8), 'office').map((d) => d.id)).not.toContain('sofa'); // shared item
  });

  it('every desk has a chair: 30 cm in front counts, 70 cm does not', () => {
    // Chair centres 30 cm from the desk's front edge are within the 60 cm reach.
    const two = desk(desk(office(), 1, 2, 3, 0.3), 2, 5, 3, 0.3);
    expect(workstationRule(two)).toMatchObject({ status: 'pass', measured: 2, required: 2, entityIds: [] });
    const far = desk(desk(office(), 1, 2, 3, 0.3), 2, 5, 3, 0.7);
    expect(workstationRule(far)).toMatchObject({ status: 'fail', measured: 1, required: 2, entityIds: ['desk-2'] });
  });

  it('one chair serves one desk only', () => {
    // Two desks 1.5 m apart (edges 10 cm apart) and one chair between their fronts.
    let p = place(office(), 'desk-1', 'desk-140', 2.25, 3);
    p = place(p, 'desk-2', 'desk-140', 3.75, 3);
    p = place(p, 'chair-1', 'office-chair', 3, 3.65, 180_000);
    expect(workstationRule(p)).toMatchObject({ status: 'fail', measured: 1, entityIds: ['desk-2'] });
  });

  it('floor per person: 48 m² for 10 people is 4.8 m², short of the open-plan 6, fine for a meeting room', () => {
    let p = office();
    for (let n = 0; n < 10; n++) p = place(p, `c${n}`, 'meeting-chair', 1 + (n % 5) * 1.2, 2 + Math.floor(n / 5) * 2);
    expect(checkOffice(p, 'open-plan')[1]).toMatchObject({ code: 'area-per-person', status: 'fail', measured: 4.8, required: 6 });
    expect(checkOffice(p, 'meeting')[1]).toMatchObject({ status: 'pass', required: 2 });
  });

  it('rules come in a fixed order; no desks and no seats are "unknown", never "pass"', () => {
    const rules = checkOffice(office());
    expect(rules.map((r) => `${r.code} ${r.status}`)).toEqual(['walkway unknown', 'area-per-person unknown', 'workstations unknown', 'exits unknown', 'door-width unknown']);
    expect(rules[2]!.reason).toBe('no-desks');
  });

  it('packs are one list; an unknown style falls back to the pack’s first style', () => {
    expect(PACKS.map((p) => p.id)).toEqual(['hall', 'office', 'container', 'warehouse', 'production', 'depot', 'restaurant']);
    expect(packOf('nope').id).toBe('hall');
    const p = desk(office(), 1, 4, 3, 0.3);
    expect(checkPack(p, 'office', 'banquet')).toEqual(checkOffice(p, 'open-plan').map((r) => ({ ...r, source: RULE_SOURCES[r.code] })));
    // Every rule says where its numbers come from, and none claims to be a verified regulation.
    for (const r of [...checkPack(p, 'office', 'meeting'), ...checkPack(p, 'hall', 'banquet')]) {
      expect(r.source?.ruleSet).toMatch(/^starter\./);
      expect(r.source?.kind).not.toBe('verified-regulation');
    }
    expect(checkPack(p, 'office', 'meeting')[1]!.required).toBe(2);
    expect(checkPack(p, 'hall', 'theatre')[1]).toMatchObject({ code: 'area-per-guest', required: 0.7 });
  });

  it('a well laid-out office passes every rule', () => {
    const p = desk(desk(office(), 1, 2, 3, 0.3), 2, 6, 3, 0.3);
    expect(checkOffice(p).map((r) => r.status)).toEqual(['pass', 'pass', 'pass', 'pass', 'pass']);
  });
});
