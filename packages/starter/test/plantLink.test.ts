import { apply, deserializeProject, serializeProject, type Command, type Project } from '@space-planner/core';
import { describe, expect, it } from 'vitest';
import { checkPlantLink, ecoTagOf, referenceProductionLine, stationsOfLine, tagItemCommand, tagZoneCommand, withPlantTag, type PlantNode, type PlantTree } from '../src/index.js';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const node = (n: number, code: string, type: PlantNode['type'], parent?: PlantNode): PlantNode => ({
  id: uuid(n), code, type, name: { en: code, ar: code }, active: true, ...(parent ? { parent: { id: parent.id, code: parent.code } } : {}),
});
const plant = node(1, 'EG-NV1', 'plant');
const area = node(2, 'FA', 'area', plant);
const line = node(3, 'FA-1', 'line', area);
const stations = [10, 20, 30].map((op, i) => node(10 + i, `FA-1-${op}`, 'station', line));
const other = node(20, 'FA-2', 'line', area);
const tree: PlantTree = [plant, area, line, ...stations, other];

const run = (project: Project, command: Command | undefined): Project => {
  expect(command).toBeDefined();
  const result = apply(project, command!);
  expect(result.ok).toBe(true);
  return result.ok ? result.project : project;
};

/** A production line with two zones (one for the line) so both items and zones can carry a tag. */
function planWithZones(): Project {
  const base = referenceProductionLine();
  const zone = (id: string, x: number) => ({ id, kind: 'line', polygon: [{ x, y: 0 }, { x: x + 100_000, y: 0 }, { x: x + 100_000, y: 100_000 }, { x, y: 100_000 }] });
  return run(base, { type: 'space.set', space: { ...base.space, zones: [zone('Z-FA-1', 0), zone('Z-FA-2', 200_000)] } });
}

describe('tags on items and zones', () => {
  it('tagging an item is one command, keeps the other pack data and undoes to the original', () => {
    const before = referenceProductionLine();
    const command = tagItemCommand(before, 'S01', stations[0]!)!;
    const result = apply(before, command);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.items.S01!.meta).toEqual({ step: 1, 'eco.ref': `plant_node:${uuid(10)}`, 'eco.code': 'FA-1-10', 'eco.type': 'station' });
    expect(ecoTagOf(result.project.items.S01!.meta)).toEqual({ kind: 'plant_node', id: uuid(10), code: 'FA-1-10', type: 'station' });
    const undone = apply(result.project, result.inverse);
    expect(undone.ok && serializeProject({ ...undone.project, revision: 0 })).toBe(serializeProject(before));
  });

  it('removing the tag leaves the item as it was, and a tag-only item returns to having no meta', () => {
    expect(withPlantTag({ step: 2, 'eco.ref': `plant_node:${uuid(10)}`, 'eco.code': 'X', 'eco.type': 'station' }, null)).toEqual({ step: 2 });
    expect(withPlantTag({ 'eco.ref': `plant_node:${uuid(10)}`, 'eco.code': 'X' }, null)).toBeNull();
  });

  it('a zone is tagged through space.set and untagged back to a plain zone', () => {
    const plan = planWithZones();
    const tagged = run(plan, tagZoneCommand(plan, 'Z-FA-1', line));
    expect(ecoTagOf(tagged.space.zones!.find((z) => z.id === 'Z-FA-1')!.meta)).toMatchObject({ code: 'FA-1', type: 'line' });
    expect(tagged.space.zones!.find((z) => z.id === 'Z-FA-2')).toEqual(plan.space.zones!.find((z) => z.id === 'Z-FA-2'));
    const plain = run(tagged, tagZoneCommand(tagged, 'Z-FA-1', null));
    expect(plain.space.zones).toEqual(plan.space.zones);
  });

  it('a tag that is malformed is no tag; a missing item or zone gives no command', () => {
    expect(ecoTagOf({ 'eco.ref': 'plant_node:not-a-uuid', 'eco.code': 'X' })).toBeUndefined();
    expect(ecoTagOf({ 'eco.ref': `machine:${uuid(1)}`, 'eco.code': 'X' })).toBeUndefined();
    expect(ecoTagOf({ 'eco.ref': `plant_node:${uuid(1)}` })).toBeUndefined();
    expect(tagItemCommand(referenceProductionLine(), 'nope', line)).toBeUndefined();
    expect(tagZoneCommand(referenceProductionLine(), 'nope', line)).toBeUndefined();
  });

  it('a tagged plan is saved and opened again byte for byte, and an untagged plan is unchanged', () => {
    const plain = referenceProductionLine();
    const tagged = run(planWithZones(), tagItemCommand(planWithZones(), 'S02', stations[1]!));
    const opened = deserializeProject(serializeProject(tagged));
    expect(opened.ok && serializeProject(opened.project)).toBe(serializeProject(tagged));
    expect(serializeProject(plain)).not.toContain('eco.');
  });
});

describe('stations of a line', () => {
  it('are ordered by the number after the line code, then by code', () => {
    const shuffled: PlantTree = [node(30, 'FA-1-100', 'station', line), node(31, 'FA-1-20', 'station', line), node(32, 'FA-1-QC', 'station', line), node(33, 'FA-1-3', 'station', line)];
    expect(stationsOfLine(shuffled, line).map((s) => s.code)).toEqual(['FA-1-3', 'FA-1-20', 'FA-1-100', 'FA-1-QC']);
  });

  it('leave out inactive stations and stations of other lines', () => {
    const inactive = { ...node(40, 'FA-1-40', 'station', line), active: false };
    expect(stationsOfLine([...tree, inactive], line).map((s) => s.code)).toEqual(['FA-1-10', 'FA-1-20', 'FA-1-30']);
  });
});

describe('the link checks', () => {
  const codes = (checks: ReturnType<typeof checkPlantLink>) => Object.fromEntries(checks.map((c) => [c.code, c.status]));

  it('are unknown, never pass, without a tree or without tags', () => {
    expect(codes(checkPlantLink(referenceProductionLine(), []))).toEqual({ 'node-exists': 'unknown', 'station-unique': 'unknown', 'station-placed': 'unknown' });
    expect(codes(checkPlantLink(referenceProductionLine(), tree))).toEqual({ 'node-exists': 'unknown', 'station-unique': 'unknown', 'station-placed': 'unknown' });
  });

  it('a station of a linked line that is not placed fails with its code; placing it passes', () => {
    let plan = planWithZones();
    plan = run(plan, tagZoneCommand(plan, 'Z-FA-1', line));
    plan = run(plan, tagItemCommand(plan, 'S01', stations[0]!));
    plan = run(plan, tagItemCommand(plan, 'S02', stations[1]!));
    const partial = checkPlantLink(plan, tree).find((c) => c.code === 'station-placed')!;
    expect(partial).toMatchObject({ status: 'fail', entityIds: ['FA-1-30'], source: { kind: 'company-policy', ruleSet: 'starter.gmes-link.v1' } });
    expect(partial.message).toContain('1 of 3');
    plan = run(plan, tagItemCommand(plan, 'S03', stations[2]!));
    expect(codes(checkPlantLink(plan, tree))).toEqual({ 'node-exists': 'pass', 'station-unique': 'pass', 'station-placed': 'pass' });
  });

  it('stations of a line nobody linked are not required', () => {
    let plan = planWithZones();
    plan = run(plan, tagZoneCommand(plan, 'Z-FA-1', other));
    expect(checkPlantLink(plan, tree).find((c) => c.code === 'station-placed')).toMatchObject({ status: 'pass', entityIds: [] });
  });

  it('two items on the same station fail and name both items', () => {
    let plan = planWithZones();
    plan = run(plan, tagItemCommand(plan, 'S01', stations[0]!));
    plan = run(plan, tagItemCommand(plan, 'S02', stations[0]!));
    expect(checkPlantLink(plan, tree).find((c) => c.code === 'station-unique')).toMatchObject({ status: 'fail', entityIds: ['S01', 'S02'] });
  });

  it('a tag whose node is gone from the last imported tree fails and names the item', () => {
    let plan = planWithZones();
    plan = run(plan, tagItemCommand(plan, 'S01', stations[0]!));
    plan = run(plan, tagItemCommand(plan, 'S02', node(99, 'FA-1-99', 'station', line)));
    expect(checkPlantLink(plan, tree).find((c) => c.code === 'node-exists')).toMatchObject({ status: 'fail', entityIds: ['S02'] });
  });
});
