import { PLANT_NODE_TYPES, type PlantNode, type PlantTree } from '@space-planner/starter';
import { validate } from './contract.js';
import { SCHEMAS } from './schemas.js';

/**
 * The plant tree of manufacturing as Space Planner keeps it: `eco.plant_node.v1` records from GMES (`GET /api/plant/export`,
 * `{ company_id, nodes: [...] }`) or a file with the same content (a bare array is accepted too). Each node is checked against
 * the vendored contract; one bad record refuses the whole import with a message that names it, so a half tree is never stored.
 */

export class PlantImportError extends Error {}

export interface PlantImport {
  readonly nodes: PlantTree;
  /** The company the export says it belongs to, when it says one. */
  readonly companyId?: string;
}

const ordinal = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function parsePlantExport(input: unknown): PlantImport {
  let value = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input);
    } catch {
      throw new PlantImportError('This is not a plant export: the file is not valid JSON.');
    }
  }
  const list = Array.isArray(value) ? value : typeof value === 'object' && value !== null && Array.isArray((value as { nodes?: unknown }).nodes) ? (value as { nodes: unknown[] }).nodes : undefined;
  if (!list) throw new PlantImportError('This is not a plant export: expected a list of plant nodes (eco.plant_node.v1), or an object with a "nodes" list.');
  if (list.length === 0) throw new PlantImportError('The plant export has no nodes.');
  if (list.length > 20000) throw new PlantImportError('The plant export has more than 20 000 nodes.');

  const problems: string[] = [];
  list.forEach((raw, index) => {
    const label = `node ${index + 1}${typeof raw === 'object' && raw !== null && typeof (raw as { code?: unknown }).code === 'string' ? ` (${(raw as { code: string }).code})` : ''}`;
    for (const p of validate(SCHEMAS['eco.plant_node.v1'], raw)) problems.push(`${label}: ${p.replace(/^\$\.?/, '') || 'invalid'}`);
  });
  if (problems.length) throw new PlantImportError(`This is not a valid plant export. ${problems.slice(0, 5).join('; ')}${problems.length > 5 ? `; and ${problems.length - 5} more problems` : ''}.`);

  const nodes = list as PlantNode[];
  const ids = new Set<string>();
  for (const n of nodes) {
    if (ids.has(n.id)) throw new PlantImportError(`This is not a valid plant export: the id of ${n.code} appears twice.`);
    ids.add(n.id);
  }
  for (const n of nodes) {
    if (n.parent && !ids.has(n.parent.id)) throw new PlantImportError(`This is not a valid plant export: ${n.code} names a parent (${n.parent.code}) that is not in the file.`);
  }
  const rank = (t: PlantNode['type']) => PLANT_NODE_TYPES.indexOf(t);
  const clean = nodes.map((n): PlantNode => ({
    id: n.id, code: n.code, type: n.type, name: { en: n.name.en, ar: n.name.ar }, active: n.active,
    ...(n.parent ? { parent: { id: n.parent.id, code: n.parent.code } } : {}),
  }));
  const companyId = typeof value === 'object' && value !== null && !Array.isArray(value) && typeof (value as { company_id?: unknown }).company_id === 'string' ? (value as { company_id: string }).company_id : undefined;
  return { nodes: clean.sort((a, b) => rank(a.type) - rank(b.type) || ordinal(a.code, b.code)), ...(companyId ? { companyId } : {}) };
}
