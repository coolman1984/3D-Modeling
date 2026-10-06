import type { Command, Id, Meta, Project, Zone } from '@space-planner/core';
import type { RuleSource } from './rules.js';

/**
 * The link between a plan and the plant tree of manufacturing (GMES): an item or a zone carries the node it stands for in its
 * own pack data (`meta`), so the core learns nothing new and old saves stay byte-identical (plan 40-SPACE-PLANNER WP-S1).
 *
 *   meta["eco.ref"]  = "plant_node:<uuid>"      (also "warehouse:<uuid>" / "storage_location:<uuid>" for the snapshot)
 *   meta["eco.code"] = the node's code          (what a person recognises; survives a node that no longer exists)
 *   meta["eco.type"] = plant | area | line | station | equipment
 *
 * Tagging is an ordinary command (`item.meta`, or `space.set` for a zone), so it is undoable like every other change.
 */

export type PlantNodeType = 'plant' | 'area' | 'line' | 'station' | 'equipment';
export const PLANT_NODE_TYPES: readonly PlantNodeType[] = ['plant', 'area', 'line', 'station', 'equipment'];

/** What the plan needs of a node of `eco.plant_node.v1`. */
export interface PlantNode {
  readonly id: string;
  readonly code: string;
  readonly type: PlantNodeType;
  readonly name: { readonly en: string; readonly ar: string };
  readonly parent?: { readonly id: string; readonly code: string };
  readonly active: boolean;
}

export type PlantTree = readonly PlantNode[];

export type RefKind = 'plant_node' | 'warehouse' | 'storage_location';
const REF_KINDS: readonly RefKind[] = ['plant_node', 'warehouse', 'storage_location'];

export const ECO_REF = 'eco.ref';
export const ECO_CODE = 'eco.code';
export const ECO_TYPE = 'eco.type';

export interface EcoTag {
  readonly kind: RefKind;
  readonly id: string;
  readonly code: string;
  readonly type?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** The tag an item or zone carries, or undefined when it has none (or a malformed one). */
export function ecoTagOf(meta: Meta | undefined): EcoTag | undefined {
  const ref = meta?.[ECO_REF];
  const code = meta?.[ECO_CODE];
  if (typeof ref !== 'string' || typeof code !== 'string' || code === '') return undefined;
  const at = ref.indexOf(':');
  const kind = ref.slice(0, at) as RefKind;
  const id = ref.slice(at + 1);
  if (at < 0 || !REF_KINDS.includes(kind) || !UUID.test(id)) return undefined;
  const type = meta?.[ECO_TYPE];
  return { kind, id, code, ...(typeof type === 'string' ? { type } : {}) };
}

/** The meta map with the tag of `node` set (other pack data is kept); with null the tag is removed and an empty map becomes null. */
export function withPlantTag(meta: Meta | undefined, node: PlantNode | null): Meta | null {
  const rest = Object.fromEntries(Object.entries(meta ?? {}).filter(([k]) => k !== ECO_REF && k !== ECO_CODE && k !== ECO_TYPE));
  const next = node ? { ...rest, [ECO_REF]: `plant_node:${node.id}`, [ECO_CODE]: node.code, [ECO_TYPE]: node.type } : rest;
  return Object.keys(next).length === 0 ? null : next;
}

/** The command that tags an item with a node (null removes the tag), or undefined when the item does not exist. */
export function tagItemCommand(project: Project, itemId: Id, node: PlantNode | null): Command | undefined {
  const item = project.items[itemId];
  return item ? { type: 'item.meta', id: itemId, meta: withPlantTag(item.meta, node) } : undefined;
}

/** The command that tags a zone with a node (null removes the tag), or undefined when the zone does not exist. */
export function tagZoneCommand(project: Project, zoneId: Id, node: PlantNode | null): Command | undefined {
  const zones = project.space.zones ?? [];
  if (!zones.some((z) => z.id === zoneId)) return undefined;
  const retagged = zones.map((z): Zone => {
    if (z.id !== zoneId) return z;
    const meta = withPlantTag(z.meta, node);
    return meta ? { ...z, meta } : { id: z.id, kind: z.kind, polygon: z.polygon };
  });
  return { type: 'space.set', space: { ...project.space, zones: retagged } };
}

export interface AutoLink {
  /** Tag commands for everything that could be linked unambiguously (apply them as one batch: one revision). */
  readonly commands: Command[];
  /** Codes that were linked. */
  readonly linked: string[];
  /** Codes that match more than one active node of the right kind: a person must choose. */
  readonly ambiguous: string[];
  /** Codes that are not in the plant tree (a storage block that is not a plant node, or a station GMES does not have). */
  readonly missing: string[];
}

const ITEM_NODE_TYPES: readonly PlantNodeType[] = ['station', 'equipment'];
const ZONE_NODE_TYPES: readonly PlantNodeType[] = ['plant', 'area', 'line'];

/**
 * "Link by code": every item or zone that carries an `eco.code` but no valid plant tag is tagged with the active node of that code
 * (items: a station or equipment; zones: a plant, area or line). A node type the thing already names (`eco.type`) must match.
 * Things that already have a valid tag are left alone; ambiguous and unknown codes are reported, never guessed.
 */
export function autoLinkCommands(project: Project, tree: PlantTree): AutoLink {
  const commands: Command[] = [];
  const linked: string[] = [], ambiguous: string[] = [], missing: string[] = [];
  const find = (code: string, allowed: readonly PlantNodeType[], named: unknown): PlantNode[] =>
    tree.filter((n) => n.active && n.code === code && allowed.includes(n.type) && (typeof named !== 'string' || named === n.type));
  const sorted = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (const item of Object.values(project.items).sort(sorted)) {
    const code = item.meta?.[ECO_CODE];
    if (typeof code !== 'string' || ecoTagOf(item.meta)?.kind === 'plant_node') continue;
    const found = find(code, ITEM_NODE_TYPES, item.meta?.[ECO_TYPE]);
    if (found.length === 1) { commands.push({ type: 'item.meta', id: item.id, meta: withPlantTag(item.meta, found[0]!) }); linked.push(code); }
    else (found.length > 1 ? ambiguous : missing).push(code);
  }
  const zones = project.space.zones ?? [];
  let changed = false;
  const retagged = zones.map((zone): Zone => {
    const code = zone.meta?.[ECO_CODE];
    if (typeof code !== 'string' || ecoTagOf(zone.meta)?.kind === 'plant_node') return zone;
    const found = find(code, ZONE_NODE_TYPES, zone.meta?.[ECO_TYPE]);
    if (found.length !== 1) { (found.length > 1 ? ambiguous : missing).push(code); return zone; }
    changed = true;
    linked.push(code);
    return { ...zone, meta: withPlantTag(zone.meta, found[0]!)! };
  });
  if (changed) commands.push({ type: 'space.set', space: { ...project.space, zones: retagged } });
  return { commands, linked, ambiguous, missing };
}

/** Stations of a line in the order of the operations, when their codes follow `<line>-<op>` with a number; otherwise by code. */
export function stationsOfLine(tree: PlantTree, line: PlantNode): PlantNode[] {
  const op = (n: PlantNode): number | undefined => {
    const rest = n.code.startsWith(line.code + '-') ? n.code.slice(line.code.length + 1) : '';
    return /^\d+$/.test(rest) ? Number(rest) : undefined;
  };
  return tree
    .filter((n) => n.type === 'station' && n.parent?.id === line.id && n.active)
    .sort((a, b) => (op(a) ?? Infinity) - (op(b) ?? Infinity) || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}

/** The GMES link rules name their source like every other rule (nothing here is a regulation). */
export const PLANT_LINK_SOURCE: RuleSource = { kind: 'company-policy', title: 'GMES link: the plan matches the plant tree of manufacturing', ruleSet: 'starter.gmes-link.v1' };

export interface LinkCheck {
  readonly code: 'node-exists' | 'station-unique' | 'station-placed';
  readonly status: 'pass' | 'fail' | 'unknown';
  readonly title: string;
  readonly message: string;
  /** Item / zone ids of the plan; for `station-placed` the codes of the stations that are not on the plan yet. */
  readonly entityIds: readonly string[];
  readonly source: RuleSource;
}

interface Tagged {
  readonly what: 'item' | 'zone';
  readonly id: Id;
  readonly tag: EcoTag;
}

function taggedEntities(project: Project): Tagged[] {
  const out: Tagged[] = [];
  for (const item of Object.values(project.items)) {
    const tag = ecoTagOf(item.meta);
    if (tag?.kind === 'plant_node') out.push({ what: 'item', id: item.id, tag });
  }
  for (const zone of project.space.zones ?? []) {
    const tag = ecoTagOf(zone.meta);
    if (tag?.kind === 'plant_node') out.push({ what: 'zone', id: zone.id, tag });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * The three checks of the link (WP-S1): a tagged thing whose node is not in the last imported tree; two items on the same station;
 * a station of a linked line that has not been placed. Without a tree or without tags they are "unknown", never "pass".
 */
export function checkPlantLink(project: Project, tree: PlantTree): LinkCheck[] {
  const tagged = taggedEntities(project);
  const byId = new Map(tree.map((n) => [n.id, n]));
  const unknown = (code: LinkCheck['code'], title: string, message: string): LinkCheck => ({ code, status: 'unknown', title, message, entityIds: [], source: PLANT_LINK_SOURCE });

  const T1 = 'Tagged nodes exist in the plant tree';
  const T2 = 'One item per station';
  const T3 = 'Every station of a linked line is placed';
  const noTree = 'Import the plant tree from GMES first (a file or “Fetch from GMES”).';
  const noTags = 'Tag items or zones with plant nodes to run this check.';

  const checks: LinkCheck[] = [];

  if (tree.length === 0) checks.push(unknown('node-exists', T1, noTree));
  else if (tagged.length === 0) checks.push(unknown('node-exists', T1, noTags));
  else {
    const missing = tagged.filter((t) => !byId.has(t.tag.id));
    checks.push({ code: 'node-exists', status: missing.length ? 'fail' : 'pass', title: T1, entityIds: missing.map((t) => t.id), source: PLANT_LINK_SOURCE,
      message: missing.length ? `${missing.length} tagged ${missing.length === 1 ? 'thing points' : 'things point'} at a node that is not in the last imported tree: ${missing.map((t) => `${t.id} (${t.tag.code})`).join(', ')}.`
        : `All ${tagged.length} tagged things point at nodes of the plant tree.` });
  }

  const onStations = tagged.filter((t) => t.what === 'item' && (byId.get(t.tag.id)?.type ?? t.tag.type) === 'station');
  if (onStations.length === 0) checks.push(unknown('station-unique', T2, tree.length === 0 ? noTree : noTags));
  else {
    const groups = new Map<string, Tagged[]>();
    for (const t of onStations) groups.set(t.tag.id, [...(groups.get(t.tag.id) ?? []), t]);
    const twice = [...groups.values()].filter((g) => g.length > 1);
    checks.push({ code: 'station-unique', status: twice.length ? 'fail' : 'pass', title: T2, source: PLANT_LINK_SOURCE, entityIds: twice.flat().map((t) => t.id),
      message: twice.length ? `Two items stand for the same station: ${twice.map((g) => `${g[0]!.tag.code} → ${g.map((t) => t.id).join(' and ')}`).join('; ')}.` : 'Every station is represented by one item.' });
  }

  if (tree.length === 0) checks.push(unknown('station-placed', T3, noTree));
  else {
    const linkedLines = [...new Set(tagged.map((t) => byId.get(t.tag.id)).filter((n): n is PlantNode => n?.type === 'line'))];
    if (linkedLines.length === 0) checks.push(unknown('station-placed', T3, 'Tag a zone or an item with a line of the plant tree to check that its stations are placed.'));
    else {
      const placed = new Set(onStations.map((t) => t.tag.id));
      const stations = linkedLines.flatMap((line) => stationsOfLine(tree, line));
      const notPlaced = stations.filter((s) => !placed.has(s.id));
      checks.push({ code: 'station-placed', status: notPlaced.length ? 'fail' : 'pass', title: T3, source: PLANT_LINK_SOURCE, entityIds: notPlaced.map((s) => s.code),
        message: notPlaced.length ? `${notPlaced.length} of ${stations.length} stations are not on the plan yet: ${notPlaced.map((s) => s.code).join(', ')}.` : `All ${stations.length} stations of the linked ${linkedLines.length === 1 ? 'line are' : 'lines are'} placed.` });
    }
  }
  return checks;
}
