import { apply, checkProject, deserializeProject, serializeProject, validateProject, type Project } from '@space-planner/core';
import { describe, expect, it } from 'vitest';
import {
  autoLinkCommands, checkPack, checkPlantLink, ecoTagOf, FA_STATIONS, flowOrder, nileVisionBoards, nileVisionFinalAssembly, nileVisionPlant, nileVisionSample, productionMetrics,
  SAMPLE_COMPANIES, SMT_STATIONS, THT_STATIONS, type PlantNode,
} from '../src/index.js';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let next = 100;
const node = (code: string, type: PlantNode['type'], parent?: PlantNode): PlantNode => ({ id: uuid(next++), code, type, name: { en: code, ar: code }, active: true, ...(parent ? { parent: { id: parent.id, code: parent.code } } : {}) });

/** The plant tree GMES would export for this company: the plant, the areas, the lines and every station. */
function plantTree(): PlantNode[] {
  const plant = node('EG-NV1', 'plant');
  const areas = ['A-OFF', 'A-FA', 'A-RMW', 'A-RCV', 'A-SMT', 'A-QA', 'A-MNT', 'A-FGW'].map((c) => node(c, 'area', plant));
  const lines = ['SMT-1', 'THT-1', 'FA-1', 'FA-2'].map((c) => node(c, 'line', areas[0]!));
  const stations = [
    ...['FA-1', 'FA-2'].flatMap((l) => [...FA_STATIONS.map(([c]) => c), 'RPR'].map((c) => node(`${l}-${c}`, 'station', lines.find((x) => x.code === l)))),
    ...[...SMT_STATIONS.map(([c]) => c), 'RPR'].map((c) => node(`SMT-1-${c}`, 'station', lines[0])),
    ...[...THT_STATIONS.map(([c]) => c), 'RPR'].map((c) => node(`THT-1-${c}`, 'station', lines[1])),
  ];
  return [plant, ...areas, ...lines, ...stations];
}

const applyAll = (project: Project, commands: readonly unknown[]): Project => {
  const r = apply(project, { type: 'batch', commands: commands as never });
  if (!r.ok) throw new Error(r.rejection.message);
  return r.project;
};

describe('Nile Vision sample company', () => {
  const sample = nileVisionSample();
  const fa = nileVisionFinalAssembly();

  it('is listed among the sample companies', () => {
    expect(SAMPLE_COMPANIES.map((c) => c.id)).toContain('nile-vision');
    expect(SAMPLE_COMPANIES.find((c) => c.id === 'nile-vision')!.build().map((s) => s.project.name)).toEqual(sample.map((s) => s.project.name));
  });

  it('is deterministic: two builds save to the same text', () => {
    expect(nileVisionSample().map((s) => serializeProject(s.project))).toEqual(sample.map((s) => serializeProject(s.project)));
  });

  it.each(sample.map((s) => [s.project.name, s.project] as const))('%s is valid, saves and opens, and has no design errors', (_name, project) => {
    expect(validateProject(project)).toEqual([]);
    const opened = deserializeProject(serializeProject(project));
    expect(opened.ok).toBe(true);
    expect(checkProject(project).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('every final assembly station of the book is placed exactly once, with its GMES code', () => {
    const expected = ['FA-1', 'FA-2'].flatMap((l) => [...FA_STATIONS.map(([c]) => c), 'RPR'].map((c) => `${l}-${c}`)).sort();
    expect(Object.keys(fa.items).sort()).toEqual(expected);
    expect(expected).toHaveLength(2 * 19);
    for (const item of Object.values(fa.items)) expect(item.meta?.['eco.code']).toBe(item.id);
    // the flow of a line follows the routing: 18 operations in order
    const line1 = flowOrder(fa).filter((i) => i.id.startsWith('FA-1-')).map((i) => i.id.slice(5));
    expect(line1).toEqual(FA_STATIONS.map(([c]) => c));
  });

  it('the boards area holds the SMT and THT stations, and the plant holds the areas and storage by code', () => {
    const boards = nileVisionBoards();
    expect(Object.keys(boards.items).sort()).toEqual([...SMT_STATIONS.map(([c]) => `SMT-1-${c}`), 'SMT-1-RPR', ...THT_STATIONS.map(([c]) => `THT-1-${c}`), 'THT-1-RPR'].sort());
    const plant = nileVisionPlant();
    expect((plant.space.zones ?? []).map((z) => z.meta?.['eco.code']).sort()).toEqual(['A-FA', 'A-FGW', 'A-MNT', 'A-OFF', 'A-QA', 'A-RCV', 'A-RMW', 'A-SMT']);
    expect(Object.keys(plant.items)).toContain('WH-RM');
  });

  it('the production rules pass where they can be measured (stations inside the floor, the handler reaches the next station)', () => {
    for (const p of [fa, nileVisionBoards()]) {
      const rules = checkPack(p, 'production');
      expect(rules.find((r) => r.code === 'machine-boundary'), p.name).toMatchObject({ status: 'pass' });
      expect(rules.find((r) => r.code === 'flow-reachability'), p.name).toMatchObject({ status: 'pass' });
    }
    expect(productionMetrics(fa).stations).toBe(36);
  });

  it('nothing is linked before the plant tree is imported: tags are codes only', () => {
    for (const { project } of sample) {
      for (const item of Object.values(project.items)) expect(ecoTagOf(item.meta)).toBeUndefined();
    }
    const checks = checkPlantLink(fa, []);
    expect(checks.every((c) => c.status === 'unknown')).toBe(true);
  });
});

describe('Link by code', () => {
  const tree = plantTree();
  const fa = nileVisionFinalAssembly();

  it('tags every station and line of the plan with the node of its code, in one batch, and the link checks then pass', () => {
    const link = autoLinkCommands(fa, tree);
    expect(link.ambiguous).toEqual([]);
    expect(link.missing).toEqual([]);
    expect(link.linked).toHaveLength(2 * 19 + 2); // stations and the two line zones
    const linkedPlan = applyAll(fa, link.commands);
    const tag = ecoTagOf(linkedPlan.items['FA-1-OCM']!.meta)!;
    expect(tag).toMatchObject({ kind: 'plant_node', code: 'FA-1-OCM', type: 'station', id: tree.find((n) => n.code === 'FA-1-OCM')!.id });
    expect(ecoTagOf(linkedPlan.items['FA-1-OCM']!.meta)).toBeDefined();
    expect(linkedPlan.items['FA-1-OCM']!.meta).toMatchObject({ step: 5 }); // the other pack data stays
    const checks = Object.fromEntries(checkPlantLink(linkedPlan, tree).map((c) => [c.code, c.status]));
    expect(checks).toEqual({ 'node-exists': 'pass', 'station-unique': 'pass', 'station-placed': 'pass' });
    // and it is idempotent: nothing is left to link
    expect(autoLinkCommands(linkedPlan, tree)).toMatchObject({ commands: [], linked: [], missing: [], ambiguous: [] });
  });

  it('links the plant areas and leaves storage blocks that are not plant nodes as "missing", not guessed', () => {
    const plant = nileVisionPlant();
    const link = autoLinkCommands(plant, tree);
    expect(link.linked.sort()).toEqual(['A-FA', 'A-FGW', 'A-MNT', 'A-OFF', 'A-QA', 'A-RCV', 'A-RMW', 'A-SMT']);
    expect(link.missing).toContain('WH-RM');
    expect(link.missing).toHaveLength(11);
  });

  it('a code that two nodes share, or a node that is inactive, is reported and never linked', () => {
    const twin = { ...tree.find((n) => n.code === 'FA-1-OCM')!, id: uuid(9000) };
    const inactive = tree.map((n) => (n.code === 'FA-2-OCM' ? { ...n, active: false } : n));
    const a = autoLinkCommands(fa, [...tree, twin]);
    expect(a.ambiguous).toEqual(['FA-1-OCM']);
    expect(a.linked).not.toContain('FA-1-OCM');
    const b = autoLinkCommands(fa, inactive);
    expect(b.missing).toEqual(['FA-2-OCM']);
  });

  it('a thing that names a node type the node does not have is not linked to it, and what is already linked is left alone', () => {
    const asEquipment = tree.map((n) => (n.code === 'FA-1-FT' ? { ...n, type: 'equipment' as const } : n));
    expect(autoLinkCommands(fa, asEquipment).missing).toEqual(['FA-1-FT']);
    const first = applyAll(fa, autoLinkCommands(fa, tree).commands);
    const other = tree.map((n) => (n.code === 'FA-1-CHS' ? { ...n, id: uuid(9100) } : n));
    expect(autoLinkCommands(first, other).commands).toEqual([]); // a valid tag is never replaced behind the person's back
  });

  it('is undoable: the inverse of the batch restores the plan as it was', () => {
    const link = autoLinkCommands(fa, tree);
    const r = apply(fa, { type: 'batch', commands: link.commands });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const back = apply(r.project, r.inverse);
    expect(back.ok && serializeProject({ ...back.project, revision: 0 })).toBe(serializeProject({ ...fa, revision: 0 }));
  });
});
