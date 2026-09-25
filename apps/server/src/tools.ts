import {
  checkProject,
  keepPackData,
  fromUnit,
  measureProject,
  normalizeAngle,
  readRoom,
  roomProblems,
  roomSpace,
  serializeProject,
  toSquareMetres,
  toUnit,
  validateSpace,
  type Command,
  type ColumnSpec,
  type DoorSpec,
  type Issue,
  type Project,
  type RoomSpec,
  type Wall,
} from '@space-planner/core';
import { factoryMetrics, isFactory, lineSimulator, newFactory, nextOf, stationOf, stationsOf, withNext } from '@space-planner/starter';
import { baysOf, rackOf, rackRows, rectZone, routeToBay, topBeam, TRUCK_PROFILES, truckOf, warehouseMetrics, isWarehouse, newWarehouse, ZONE_KINDS } from '@space-planner/starter';
import { cargoOf, checkPack, CONTAINER_TYPES, containerMetrics, detectPack, extremePointPacker, isContainer, newContainer, newRoom, packContainer, packOf, PACKS, ROUND_SHAPES, SHAPES, stepOf, stopOf, type PackId, type PackStrategy, type RuleResult } from '@space-planner/starter';
import type { Store } from './store.js';
import { compareFamily, figureText } from './variants.js';

/** A tool offered to agents, over MCP and to API agents alike. */
export interface ToolDef {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  run(ctx: ToolContext, input: Record<string, unknown>): string;
}

export interface ToolContext {
  readonly store: Store;
  readonly actor: string;
}

/** A tool failure the agent should read and correct. */
export class ToolError extends Error {}

export function toolSummaries(): Array<Pick<ToolDef, 'name' | 'description' | 'inputSchema'>> {
  return TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}

export function runTool(ctx: ToolContext, name: string, input: unknown): { text: string; isError: boolean } {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { text: `Unknown tool "${name}".`, isError: true };
  try {
    const args = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
    return { text: tool.run(ctx, args), isError: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { text: `Error: ${message}`, isError: true };
  }
}

// ---------- input helpers ----------

function str(input: Record<string, unknown>, key: string, optional = false): string {
  const v = input[key];
  if (v === undefined && optional) return '';
  if (typeof v !== 'string' || v.trim() === '') throw new ToolError(`"${key}" must be a non-empty string`);
  return v;
}

function num(input: Record<string, unknown>, key: string): number;
function num(input: Record<string, unknown>, key: string, optional: true): number | undefined;
function num(input: Record<string, unknown>, key: string, optional = false): number | undefined {
  const v = input[key];
  if (v === undefined && optional) return undefined;
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new ToolError(`"${key}" must be a number`);
  return v;
}

function list(input: Record<string, unknown>, key: string, optional = false): Array<Record<string, unknown>> {
  const v = input[key];
  if (v === undefined && optional) return [];
  if (!Array.isArray(v)) throw new ToolError(`"${key}" must be an array`);
  return v.map((x, i) => {
    if (typeof x !== 'object' || x === null) throw new ToolError(`"${key}[${i}]" must be an object`);
    return x as Record<string, unknown>;
  });
}

const metres = (v: number) => fromUnit(v, 'm');
const centimetres = (v: number) => fromUnit(v, 'cm');
const degrees = (v: number) => normalizeAngle(Math.round(v * 1000));
const fmtM = (ticks: number) => `${toUnit(ticks, 'm').toFixed(2)} m`;
const fmtCm = (ticks: number) => `${+toUnit(ticks, 'cm').toFixed(1)} cm`;

function load(ctx: ToolContext, input: Record<string, unknown>): Project {
  const id = str(input, 'project_id');
  const project = ctx.store.getProject(id);
  if (!project) throw new ToolError(`No project "${id}". Call list_projects to see the ids.`);
  return project;
}

function commit(ctx: ToolContext, project: Project, commands: Command[], summary: string): Project {
  const result = ctx.store.applyCommands(project.id, commands, { actor: ctx.actor, summary });
  if (result.ok) return result.project;
  if (result.status === 422) {
    const detail = result.rejection.problems?.map((p) => `${p.path}: ${p.message}`).join('; ');
    const at = result.rejection.at ? ` (command #${result.rejection.at.join('.')})` : '';
    throw new ToolError(`Rejected${at}: ${result.rejection.code}: ${result.rejection.message}${detail ? ` — ${detail}` : ''}`);
  }
  throw new ToolError('The project could not be changed.');
}

function takenIds(project: Project): Set<string> {
  return new Set([
    project.id,
    ...Object.keys(project.items),
    ...Object.keys(project.catalog),
    ...project.space.doors.map((d) => d.id),
    ...project.space.obstacles.map((o) => o.id),
    ...(project.space.zones ?? []).map((z) => z.id),
  ]);
}

function nextId(prefix: string, taken: Set<string>): string {
  for (let n = 1; ; n++) {
    const id = `${prefix}-${n}`;
    if (!taken.has(id)) {
      taken.add(id);
      return id;
    }
  }
}

// ---------- descriptions ----------

export function describeIssue(project: Project, issue: Issue): string {
  const names = issue.entityIds.map((id) => {
    const item = project.items[id];
    return item ? `${id} (${project.catalog[item.definitionId]?.name ?? item.definitionId})` : id;
  });
  const amount = issue.amount === undefined ? '' : `, off by ${fmtCm(issue.amount)}`;
  return `[${issue.severity}] ${issue.code}: ${names.join(' vs ') || 'project'}${amount}`;
}

export function describeProject(project: Project): string {
  const lines: string[] = [];
  lines.push(`Project ${project.id} "${project.name}" — revision ${project.revision}`);
  lines.push('Coordinates: metres from the south-west corner; x grows east, y grows north. Rotation in degrees counter-clockwise; 0 means the item front faces north.');
  const room = readRoom(project.space);
  if (room) {
    lines.push(`Room: ${fmtM(room.width)} wide (x) × ${fmtM(room.depth)} deep (y), ceiling ${room.ceilingHeight === undefined ? 'unknown' : fmtM(room.ceilingHeight)}`);
    for (const d of room.doors) lines.push(`  Door ${d.id}: ${d.wall} wall, hinge ${fmtM(d.offset)} from the wall start, ${fmtCm(d.width)} wide, opens inward`);
    for (const c of room.columns) lines.push(`  Column ${c.id}: centre (${fmtM(c.center.x)}, ${fmtM(c.center.y)}), ${fmtCm(c.width)} × ${fmtCm(c.depth)}`);
  } else {
    lines.push(`Room outline (m): ${project.space.boundary.map((p) => `(${toUnit(p.x, 'm')}, ${toUnit(p.y, 'm')})`).join(' ')}`);
  }
  lines.push('Item types (id | name | category | w×d×h cm | clearance front/back/left/right cm | seats | footprint):');
  for (const d of Object.values(project.catalog)) {
    const c = d.clearance;
    lines.push(`  ${d.id} | ${d.name} | ${d.category} | ${toUnit(d.size.w, 'cm')}×${toUnit(d.size.d, 'cm')}×${toUnit(d.size.h, 'cm')} | ${[c.front, c.back, c.left, c.right].map((v) => toUnit(v, 'cm')).join('/')} | ${d.seats ?? 0} | ${d.footprint ?? 'rect'}`);
  }
  const items = Object.values(project.items);
  lines.push(`Items (${items.length}) (id | type | x m | y m | rotation° | height above floor m${items.some((i) => i.locked) ? ' | locked' : ''}):`);
  for (const i of items) {
    lines.push(`  ${i.id} | ${i.definitionId} | ${toUnit(i.position.x, 'm')} | ${toUnit(i.position.y, 'm')} | ${i.rotation / 1000} | ${toUnit(i.elevation ?? 0, 'm')}${i.locked ? ' | locked' : ''}`);
  }
  const issues = checkProject(project);
  lines.push(`Issues (${issues.length}):`);
  for (const issue of issues) lines.push(`  ${describeIssue(project, issue)}`);
  const metrics = measureProject(project);
  lines.push(`Metrics: ${metrics.seats} seats, ${metrics.itemCount} items, floor ${toSquareMetres(metrics.floorArea).toFixed(2)} m², occupied ${(metrics.occupancy * 100).toFixed(1)}%`);
  if (isContainer(project)) lines.push(...describeLoad(project));
  if (isWarehouse(project)) lines.push(...describeWarehouse(project));
  if (isFactory(project)) lines.push(...describeFactory(project));
  lines.push(...describeRules(project));
  return lines.join('\n');
}

const PACK_NAMES: Record<PackId, string> = { hall: 'Hall', office: 'Office', container: 'Container loading', warehouse: 'Warehouse', factory: 'Production line' };

const secOf = (ms: number | undefined) => (ms === undefined ? 'not set' : `${Math.round(ms / 100) / 10} s`);

/** Production line facts for agents: stations with cycle times and flows. */
function describeFactory(project: Project): string[] {
  const f = factoryMetrics(project, 'cart');
  const lines = [
    'Stations take parts in at their input side (default: back; conveyors: left end) and send them out at their output side (default: front; conveyors: right end). Flows are the "next" station ids (connect_flow).',
    `Flows: ${f.flows}, straight length ${mOf(f.straightLength)}, ${f.crossings} crossing(s). Throughput comes only from simulate_line with the cycle times people entered.`,
    'Station types (id | kind | cycle | capacity | maintenance back/left/right/front cm):',
  ];
  for (const d of Object.values(project.catalog)) {
    const st = stationOf(d);
    if (st) lines.push(`  ${d.id} | ${st.kind} | ${secOf(st.cycle)} | ${st.capacity ?? '-'} | ${st.maintenance ? [st.maintenance.back, st.maintenance.left, st.maintenance.right, st.maintenance.front].map((v) => toUnit(v, 'cm')).join('/') : 'not stated'}`);
  }
  const stations = stationsOf(project);
  if (stations.length) {
    lines.push('Placed stations (id | kind | sends parts to):');
    for (const st of stations) lines.push(`  ${st.item.id} | ${st.data.kind} | ${nextOf(st.item).join(', ') || '-'}`);
  }
  return lines;
}

const mOf = (ticks: number | undefined) => (ticks === undefined ? 'unknown' : `${Math.round(toUnit(ticks, 'm') * 100) / 100} m`);

/** Warehouse facts for agents: truck, zones, rack types and capacity. */
function describeWarehouse(project: Project): string[] {
  const truck = truckOf(project);
  const w = warehouseMetrics(project);
  const lines = [
    `Truck: ${truck.id} (${truck.label}): needs a ${mOf(truck.aisle)} working aisle and a ${mOf(truck.width)} lane, lifts to ${mOf(truck.maxLift)}. Other trucks: ${TRUCK_PROFILES.filter((t) => t.id !== truck.id).map((t) => t.id).join(', ')} (set_truck).`,
    'Rack bays: one item per bay; the front (where pallets go in) faces the item\'s front. Rows run along x.',
    `Capacity: ${w.bays} bays, ${w.locations} pallet locations (${w.rackLocations} in racks, ${w.floorPallets} on the floor)${w.rackCapacity === undefined ? '' : `, racks carry up to ${kgOf(w.rackCapacity)}`}; storage covers ${(w.storageFloorShare * 100).toFixed(1)}% of the floor${w.cubeShare === undefined ? '' : ` and ${(w.cubeShare * 100).toFixed(1)}% of the volume`}.`,
    `Travel from the docks to rack faces: ${w.travelAverage === undefined ? 'no bay reachable' : `average ${mOf(w.travelAverage)}, farthest ${mOf(w.travelMax)}`}.`,
    `Zones (id | kind | name | x..x, y..y m) — kinds: ${ZONE_KINDS.join(', ')}; trucks never drive through no-go zones:`,
  ];
  for (const z of project.space.zones ?? []) {
    const xs = z.polygon.map((p) => p.x);
    const ys = z.polygon.map((p) => p.y);
    lines.push(`  ${z.id} | ${z.kind} | ${z.name ?? ''} | ${toUnit(Math.min(...xs), 'm')}..${toUnit(Math.max(...xs), 'm')}, ${toUnit(Math.min(...ys), 'm')}..${toUnit(Math.max(...ys), 'm')}`);
  }
  lines.push('Rack types (id | levels | pallets per level | level height | top beam | load per pallet):');
  for (const d of Object.values(project.catalog)) {
    const r = rackOf(d);
    if (r) lines.push(`  ${d.id} | ${r.levels} | ${r.positions} | ${mOf(r.levelHeight)} | ${mOf(topBeam(r))} | ${kgOf(r.positionLoad)}`);
  }
  return lines;
}

const kgOf = (grams: number | undefined) => (grams === undefined ? 'unknown' : `${Math.round(grams / 100) / 10} kg`);

/** Container facts for agents: the container, cargo rules per type, and the load with stops and steps. */
function describeLoad(project: Project): string[] {
  const m = containerMetrics(project);
  const meta = project.space.meta ?? {};
  const lines = [
    `Container: type ${String(meta.containerType)}, doors at the east end (x = length); payload limit ${kgOf(typeof meta.maxPayload === 'number' ? meta.maxPayload : undefined)}.`,
    `Load: ${m.pieces} pieces, ${(m.volumeUse * 100).toFixed(1)}% of the volume, ${(m.floorUse * 100).toFixed(1)}% of the floor, mass ${kgOf(m.mass)}${m.payloadUse === undefined ? '' : ` (${(m.payloadUse * 100).toFixed(1)}% of payload)`}${m.balance ? `, centre of mass ${m.balance.along.toFixed(1)}% off the middle along, ${m.balance.across.toFixed(1)}% across` : ''}; ${m.unpacked} planned pieces not placed.`,
    'Cargo types (id | mass | quantity planned | stackable | max load on top | may lie on side | stacking group | stop):',
  ];
  for (const d of Object.values(project.catalog)) {
    const c = cargoOf(d);
    lines.push(`  ${d.id} | ${kgOf(d.mass)} | ${c.quantity ?? '-'} | ${c.stackable ?? '?'} | ${c.maxLoadOnTop === undefined ? '?' : kgOf(c.maxLoadOnTop)} | ${c.allowTilt ?? '?'} | ${c.stackGroup ?? '-'} | ${c.stop ?? '-'}`);
  }
  const pieces = Object.values(project.items).filter((i) => i.tilt || stepOf(i) !== undefined || stopOf(i, project.catalog[i.definitionId]!) !== undefined);
  if (pieces.length > 0) {
    lines.push('Pieces with orientation, stop or loading step (id | tilt | stop | step):');
    for (const i of pieces) lines.push(`  ${i.id} | ${i.tilt ?? 'upright'} | ${stopOf(i, project.catalog[i.definitionId]!) ?? '-'} | ${stepOf(i) ?? '-'}`);
  }
  return lines;
}

/** The activity pack's rules (guidance) as short English lines for agents. */
function describeRules(project: Project, packId: PackId = detectPack(project), style?: string): string[] {
  const pack = packOf(packId);
  const styleId = pack.styles.some((s) => s.id === style) ? style! : pack.styles[0]!.id;
  const line = (r: RuleResult): string => {
    if (r.status === 'unknown') return `  ${r.code}: unknown (${(r.reason ?? 'missing data').replace(/-/g, ' ')})`;
    const cmOf = (v: number | undefined) => `${toUnit(v ?? 0, 'cm')} cm`;
    switch (r.code) {
      case 'walkway':
        return `  walkway ${cmOf(r.required)} from every seat to a door: ${r.status}${r.entityIds.length ? ` — no way out for ${r.entityIds.join(', ')}` : ''}`;
      case 'area-per-guest':
      case 'area-per-person':
        return `  floor per ${r.code === 'area-per-guest' ? 'guest' : 'person'}: ${r.measured} m² (needs ${r.required}): ${r.status}`;
      case 'workstations':
        return `  desks with a chair: ${r.measured} of ${r.required}: ${r.status}${r.entityIds.length ? ` — no chair at ${r.entityIds.join(', ')}` : ''}`;
      case 'exits':
        return `  exits: ${r.measured} door(s) (needs ${r.required}): ${r.status}`;
      case 'door-width':
        return `  total door width: ${cmOf(r.measured)} (needs ${cmOf(r.required)}): ${r.status}`;
      case 'payload':
        return `  payload: ${kgOf(r.measured)} of ${kgOf(r.required)}: ${r.status}`;
      case 'support':
        return `  support: weakest raised piece rests ${r.measured}% on pieces below (needs ${r.required}%): ${r.status}${r.entityIds.length ? ` — ${r.entityIds.join(', ')}` : ''}`;
      case 'load-on-top':
        return `  load on top: heaviest load ${kgOf(r.measured)}: ${r.status}${r.entityIds.length ? ` — overloaded ${r.entityIds.join(', ')}` : ''}`;
      case 'balance':
        return `  balance: centre of mass ${r.measured}% off the middle (limit ${r.required}%): ${r.status}`;
      case 'aisle-width':
        return `  aisle width: narrowest ${cmOf(r.measured)} in front of a rack face (truck needs ${cmOf(r.required)}): ${r.status}${r.entityIds.length ? ` — too narrow at ${r.entityIds.join(', ')}` : ''}`;
      case 'lift-height':
        return `  lift height: highest beam ${cmOf(r.measured)} (truck lifts ${cmOf(r.required)}): ${r.status}${r.entityIds.length ? ` — out of reach: ${r.entityIds.join(', ')}` : ''}`;
      case 'ceiling-clearance':
        return `  ceiling clearance: ${cmOf(r.measured)} above the highest load (needs ${cmOf(r.required)}): ${r.status}${r.entityIds.length ? ` — ${r.entityIds.join(', ')}` : ''}`;
      case 'rack-access':
        return `  rack access from the docks: ${r.measured} of ${r.required} bays: ${r.status}${r.entityIds.length ? ` — cut off: ${r.entityIds.join(', ')}` : ''}`;
      case 'docks':
        return `  docks: ${r.measured} (needs ${r.required}): ${r.status}`;
      case 'maintenance-access':
        return `  maintenance space free: ${r.measured} of ${r.required} stations: ${r.status}${r.entityIds.length ? ` — blocked at ${r.entityIds.join(', ')}` : ''}`;
      case 'flow-links':
        return `  flows from a source to a sink through every station: ${r.status}${r.entityIds.length ? ` — check ${r.entityIds.join(', ')}` : ''}`;
      case 'flow-path':
        return `  material can be moved along ${r.measured} of ${r.required} flows: ${r.status}${r.entityIds.length ? ` — blocked after ${r.entityIds.join(', ')}` : ''}`;
      case 'flow-crossings':
        return `  flow crossings: ${r.measured}: ${r.status}${r.entityIds.length ? ` — ${r.entityIds.join(', ')}` : ''}`;
      case 'unpacked':
        return `  planned pieces placed: ${r.measured} of ${r.required}: ${r.status}${r.entityIds.length ? ` — short: ${r.entityIds.join(', ')}` : ''}`;
      default:
        return `  ${r.code}: ${r.status}${r.entityIds.length ? ` — ${r.entityIds.join(', ')}` : ''}`;
    }
  };
  return [`${PACK_NAMES[pack.id]} rules (${styleId}):`, ...checkPack(project, pack.id, styleId).map(line)];
}

function afterChange(project: Project, what: string): string {
  const issues = checkProject(project);
  const errors = issues.filter((i) => i.severity === 'error').length;
  return `${what} Now at revision ${project.revision}. ${issues.length === 0 ? 'No issues.' : `${issues.length} issue(s), ${errors} error(s):\n${issues.slice(0, 30).map((i) => `  ${describeIssue(project, i)}`).join('\n')}`}`;
}

/** Cargo fields of define_item → the type's meta, merged over what it had. */
function cargoMeta(value: unknown, previous: Record<string, string | number | boolean> | undefined): { meta?: Record<string, string | number | boolean> } {
  const meta: Record<string, string | number | boolean> = { ...(previous ?? {}) };
  if (typeof value === 'object' && value !== null) {
    const c = value as Record<string, unknown>;
    if (typeof c.quantity === 'number') meta.quantity = Math.max(0, Math.round(c.quantity));
    if (typeof c.stackable === 'boolean') meta.stackable = c.stackable;
    if (typeof c.max_load_on_top_kg === 'number') meta.maxLoadOnTop = Math.round(c.max_load_on_top_kg * 1000);
    if (typeof c.allow_tilt === 'boolean') meta.allowTilt = c.allow_tilt;
    if (typeof c.stack_group === 'string' && c.stack_group) meta.stackGroup = c.stack_group;
    if (typeof c.stop === 'number') meta.stop = Math.round(c.stop);
  }
  return Object.keys(meta).length > 0 ? { meta } : {};
}

/** Rack fields of define_item → the type's meta, over the rest of its meta. */
function rackMeta(value: unknown, rest: Record<string, string | number | boolean> | undefined): { meta?: Record<string, string | number | boolean> } {
  const meta: Record<string, string | number | boolean> = { ...(rest ?? {}) };
  if (typeof value === 'object' && value !== null) {
    const r = value as Record<string, unknown>;
    const levels = num(r, 'levels');
    const positions = num(r, 'positions');
    if (levels < 1 || positions < 1 || levels > 30 || positions > 20) throw new ToolError('rack levels must be 1 to 30 and positions 1 to 20');
    Object.assign(meta, { rack: 'pallet', levels: Math.round(levels), positions: Math.round(positions), levelHeight: centimetres(num(r, 'level_height_cm')) });
    const load = num(r, 'position_load_kg', true);
    if (load !== undefined) meta.positionLoad = Math.round(load * 1000);
  }
  return Object.keys(meta).length > 0 ? { meta } : {};
}

/** Station fields of define_item → the type's meta, over the rest of its meta. */
function stationMeta(value: unknown, rest: Record<string, string | number | boolean> | undefined): { meta?: Record<string, string | number | boolean> } {
  const meta: Record<string, string | number | boolean> = { ...(rest ?? {}) };
  if (typeof value === 'object' && value !== null) {
    const st = value as Record<string, unknown>;
    const kind = str(st, 'kind');
    if (!['source', 'machine', 'buffer', 'conveyor', 'sink'].includes(kind)) throw new ToolError('station kind must be source, machine, buffer, conveyor or sink');
    meta.station = kind;
    const cycle = num(st, 'cycle_s', true);
    if (cycle !== undefined) {
      if (cycle <= 0 || cycle > 86_400) throw new ToolError('cycle_s must be between 0 and 86400');
      meta.cycle = Math.round(cycle * 1000);
    }
    const capacity = num(st, 'capacity', true);
    if (capacity !== undefined) meta.capacity = Math.max(1, Math.round(capacity));
    const mc = typeof st.maintenance_cm === 'object' && st.maintenance_cm !== null ? (st.maintenance_cm as Record<string, unknown>) : undefined;
    if (mc) {
      for (const [k, key] of [['front', 'maintFront'], ['back', 'maintBack'], ['left', 'maintLeft'], ['right', 'maintRight']] as const) {
        const v = num(mc, k, true);
        if (v !== undefined) meta[key] = centimetres(v);
      }
    }
    if (typeof st.in_side === 'string') meta.inSide = st.in_side;
    if (typeof st.out_side === 'string') meta.outSide = st.out_side;
  }
  return Object.keys(meta).length > 0 ? { meta } : {};
}

function rackHeight(value: unknown): number | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const r = value as Record<string, unknown>;
  return Math.round(num(r, 'levels')) * centimetres(num(r, 'level_height_cm'));
}

/** stop / step of a placed piece → its meta. */
function pieceMeta(s: Record<string, unknown>): { meta?: Record<string, number> } {
  const meta: Record<string, number> = {};
  if (typeof s.stop === 'number') meta.stop = Math.round(s.stop);
  if (typeof s.step === 'number') meta.step = Math.round(s.step);
  return Object.keys(meta).length > 0 ? { meta } : {};
}

// ---------- tools ----------

const projectId = { type: 'string', description: 'Project id, e.g. "p-1a2b3c4d".' };
const summary = { type: 'string', description: 'One short line for the history, in the user’s language.' };
const shapeList = SHAPES.map((s) => s.key).join(', ');

export const TOOLS: readonly ToolDef[] = [
  {
    name: 'list_projects',
    description: 'List all projects with id, name, revision and item count.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: (ctx) => {
      const projects = ctx.store.listProjects();
      if (projects.length === 0) return 'No projects yet. Use create_project.';
      return projects.map((p) => `${p.id} | ${p.name} | revision ${p.revision} | ${p.itemCount} items | updated ${p.updatedAt}`).join('\n');
    },
  },
  {
    name: 'create_project',
    description: 'Create a new project. Rooms: a rectangle with one door centred on the south wall, furnished with the catalog of "hall" (default) or "office". Containers: activity "container" with container_type (width/depth are then ignored). Warehouses: activity "warehouse" (default 48 × 30 m, 10 m clear height) with two docks and a staging zone on the south wall and sample rack types. Production lines: activity "factory" (default 40 × 20 m, 6 m) with sample stations. Returns the new project id.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        width_m: { type: 'number', description: 'West→east size in metres.' },
        depth_m: { type: 'number', description: 'South→north size in metres.' },
        ceiling_m: { type: 'number', description: 'Ceiling height in metres, if known.' },
        activity: { type: 'string', enum: PACKS.map((p) => p.id) },
        container_type: { type: 'string', enum: CONTAINER_TYPES.map((t) => t.id), description: 'For activity "container".' },
      },
      required: ['name'],
      additionalProperties: false,
    },
    run: (ctx, input) => {
      if (str(input, 'activity', true) === 'container') {
        const created = ctx.store.createProject(newContainer(str(input, 'name'), str(input, 'container_type', true) || '20gp'), ctx.actor);
        return `Created ${created.id}.\n\n${describeProject(created)}`;
      }
      if (str(input, 'activity', true) === 'factory') {
        const w = num(input, 'width_m', true) ?? 40;
        const d = num(input, 'depth_m', true) ?? 20;
        const h = num(input, 'ceiling_m', true) ?? 6;
        if (w < 5 || d < 5 || w > 500 || d > 500) throw new ToolError('factory sides must be between 5 and 500 m');
        const created = ctx.store.createProject(newFactory(str(input, 'name'), { width: metres(w), depth: metres(d), height: metres(h) }), ctx.actor);
        return `Created ${created.id}.\n\n${describeProject(created)}`;
      }
      if (str(input, 'activity', true) === 'warehouse') {
        const w = num(input, 'width_m', true) ?? 48;
        const d = num(input, 'depth_m', true) ?? 30;
        const h = num(input, 'ceiling_m', true) ?? 10;
        if (w < 10 || d < 10 || w > 500 || d > 500) throw new ToolError('warehouse sides must be between 10 and 500 m');
        if (h <= 0 || h > 50) throw new ToolError('ceiling_m must be between 0 and 50 m');
        const created = ctx.store.createProject(newWarehouse(str(input, 'name'), { width: metres(w), depth: metres(d), height: metres(h) }), ctx.actor);
        return `Created ${created.id}.\n\n${describeProject(created)}`;
      }
      const width = num(input, 'width_m');
      const depth = num(input, 'depth_m');
      if (width < 1 || depth < 1 || width > 500 || depth > 500) throw new ToolError('room sides must be between 1 and 500 m');
      const project = ctx.store.createProject(newRoom(str(input, 'name'), width, depth, num(input, 'ceiling_m', true), packOf(str(input, 'activity', true)).id), ctx.actor);
      return `Created ${project.id}.\n\n${describeProject(project)}`;
    },
  },
  {
    name: 'get_project',
    description: 'Read a project: room, doors, columns, item types, every item with position, current issues and metrics. Always start here.',
    inputSchema: {
      type: 'object',
      properties: { project_id: projectId, include_json: { type: 'boolean', description: 'Also return the raw project JSON (lengths in ticks, 1 tick = 0.1 mm).' } },
      required: ['project_id'],
      additionalProperties: false,
    },
    run: (ctx, input) => {
      const project = load(ctx, input);
      return input.include_json === true ? `${describeProject(project)}\n\nJSON:\n${serializeProject(project)}` : describeProject(project);
    },
  },
  {
    name: 'set_room',
    description:
      'Set the rectangular room: size, ceiling, doors on walls and columns. Omitted doors/columns keep the current ones; pass [] to remove all. Door offset is measured along the wall from its start (south/north walls: from the west end; west/east walls: from the south end) to the hinge; doors open inward.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: projectId,
        width_m: { type: 'number' },
        depth_m: { type: 'number' },
        ceiling_m: { type: 'number' },
        doors: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              wall: { type: 'string', enum: ['south', 'north', 'west', 'east'] },
              offset_m: { type: 'number' },
              width_cm: { type: 'number' },
            },
            required: ['wall', 'offset_m', 'width_cm'],
          },
        },
        columns: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              x_m: { type: 'number' },
              y_m: { type: 'number' },
              width_cm: { type: 'number' },
              depth_cm: { type: 'number' },
            },
            required: ['x_m', 'y_m', 'width_cm'],
          },
        },
        summary,
      },
      required: ['project_id'],
      additionalProperties: false,
    },
    run: (ctx, input) => {
      const project = load(ctx, input);
      const current = readRoom(project.space);
      const width = input.width_m === undefined ? current?.width : metres(num(input, 'width_m'));
      const depth = input.depth_m === undefined ? current?.depth : metres(num(input, 'depth_m'));
      if (width === undefined || depth === undefined) throw new ToolError('this room is not a simple rectangle; give width_m and depth_m');
      const taken = new Set([...Object.keys(project.items), ...Object.keys(project.catalog), project.id]);
      const doors: DoorSpec[] =
        input.doors === undefined
          ? [...(current?.doors ?? [])]
          : list(input, 'doors').map((d) => {
              const wall = str(d, 'wall') as Wall;
              if (!['south', 'north', 'west', 'east'].includes(wall)) throw new ToolError(`unknown wall "${wall}"`);
              return { id: typeof d.id === 'string' && d.id ? d.id : nextId('door', taken), wall, offset: metres(num(d, 'offset_m')), width: centimetres(num(d, 'width_cm')) };
            });
      const columns: ColumnSpec[] =
        input.columns === undefined
          ? [...(current?.columns ?? [])]
          : list(input, 'columns').map((c) => {
              const w = centimetres(num(c, 'width_cm'));
              return {
                id: typeof c.id === 'string' && c.id ? c.id : nextId('column', taken),
                center: { x: metres(num(c, 'x_m')), y: metres(num(c, 'y_m')) },
                width: w,
                depth: c.depth_cm === undefined ? w : centimetres(num(c, 'depth_cm')),
              };
            });
      const ceiling = input.ceiling_m === undefined ? current?.ceilingHeight : metres(num(input, 'ceiling_m'));
      const spec: RoomSpec = { width, depth, doors, columns, ...(ceiling === undefined ? {} : { ceilingHeight: ceiling }) };
      const problems = roomProblems(spec);
      if (problems.length > 0) throw new ToolError(problems.join('; '));
      // The pack's data about the space (a container's type and payload) stays with the room.
      const space = keepPackData(project.space, roomSpace(spec));
      const structural = validateSpace(space);
      if (structural.length > 0) throw new ToolError(structural.map((p) => `${p.path}: ${p.message}`).join('; '));
      const updated = commit(ctx, project, [{ type: 'space.set', space }], str(input, 'summary', true) || 'Room changed');
      return afterChange(updated, 'Room updated.');
    },
  },
  {
    name: 'define_item',
    description: `Create or update an item type. Sizes in cm: width is the item's left-right size, depth its back-front size. Clearance is free space the item needs on each side to be usable (e.g. chair back 40 cm). Category picks the 3D model: ${shapeList}.`,
    inputSchema: {
      type: 'object',
      properties: {
        project_id: projectId,
        id: { type: 'string', description: 'Stable id such as "table-200".' },
        name: { type: 'string', description: 'Display name in the user’s language.' },
        category: { type: 'string', enum: SHAPES.map((s) => s.key) },
        width_cm: { type: 'number' },
        depth_cm: { type: 'number' },
        height_cm: { type: 'number' },
        clearance_cm: {
          type: 'object',
          properties: { front: { type: 'number' }, back: { type: 'number' }, left: { type: 'number' }, right: { type: 'number' } },
        },
        seats: { type: 'integer', description: 'Seats this item adds to capacity.' },
        footprint: { type: 'string', enum: ['rect', 'round'], description: 'Floor outline; "round" for round tables and pots (an ellipse inside width × depth). Defaults to round for round-table and plant.' },
        mass_kg: { type: 'number', description: 'Mass of one piece.' },
        station: {
          type: 'object',
          description: 'Production line station: kind (source, machine, buffer, conveyor, sink), cycle_s (a source’s release interval, a machine’s cycle, a conveyor’s transit time — as measured, never guessed), capacity (parts a buffer or conveyor holds), maintenance_cm (free space per side), in_side / out_side.',
          properties: {
            kind: { type: 'string', enum: ['source', 'machine', 'buffer', 'conveyor', 'sink'] },
            cycle_s: { type: 'number' },
            capacity: { type: 'integer' },
            maintenance_cm: { type: 'object', properties: { front: { type: 'number' }, back: { type: 'number' }, left: { type: 'number' }, right: { type: 'number' } } },
            in_side: { type: 'string', enum: ['front', 'back', 'left', 'right'] },
            out_side: { type: 'string', enum: ['front', 'back', 'left', 'right'] },
          },
          required: ['kind'],
        },
        rack: {
          type: 'object',
          description: 'Warehouse pallet rack bay (category "rack"): load levels including the floor, pallets per level, level height, load per pallet position. The height is then levels × level height.',
          properties: { levels: { type: 'integer' }, positions: { type: 'integer' }, level_height_cm: { type: 'number' }, position_load_kg: { type: 'number' } },
          required: ['levels', 'positions', 'level_height_cm'],
        },
        cargo: {
          type: 'object',
          description: 'Container cargo data: quantity planned, stackable, max_load_on_top_kg, allow_tilt (may lie on its side), stack_group, stop (1 = unloaded first).',
          properties: { quantity: { type: 'integer' }, stackable: { type: 'boolean' }, max_load_on_top_kg: { type: 'number' }, allow_tilt: { type: 'boolean' }, stack_group: { type: 'string' }, stop: { type: 'integer' } },
        },
        summary,
      },
      required: ['project_id', 'id', 'name', 'category', 'width_cm', 'depth_cm', 'height_cm'],
      additionalProperties: false,
    },
    run: (ctx, input) => {
      const project = load(ctx, input);
      const c = (typeof input.clearance_cm === 'object' && input.clearance_cm !== null ? input.clearance_cm : {}) as Record<string, unknown>;
      const side = (k: string) => (c[k] === undefined ? 0 : centimetres(num(c, k)));
      const seats = num(input, 'seats', true);
      const category = str(input, 'category');
      const footprint = input.footprint === 'round' || input.footprint === 'rect' ? input.footprint : ROUND_SHAPES.includes(category as never) ? 'round' : 'rect';
      const definition = {
        id: str(input, 'id'),
        name: str(input, 'name'),
        category,
        size: { w: centimetres(num(input, 'width_cm')), d: centimetres(num(input, 'depth_cm')), h: rackHeight(input.rack) ?? centimetres(num(input, 'height_cm')) },
        clearance: { front: side('front'), back: side('back'), left: side('left'), right: side('right') },
        ...(seats === undefined ? {} : { seats }),
        ...(footprint === 'round' ? { footprint: 'round' as const } : {}),
        ...(input.mass_kg === undefined ? {} : { mass: Math.round(num(input, 'mass_kg') * 1000) }),
        ...stationMeta(input.station, rackMeta(input.rack, cargoMeta(input.cargo, project.catalog[str(input, 'id')]?.meta).meta).meta),
      };
      const existed = Boolean(project.catalog[definition.id]);
      const updated = commit(ctx, project, [{ type: 'catalog.define', definition }], str(input, 'summary', true) || `${existed ? 'Changed' : 'Added'} item type ${definition.name}`);
      return afterChange(updated, `Item type ${definition.id} ${existed ? 'updated' : 'created'}.`);
    },
  },
  {
    name: 'place_items',
    description: 'Place new items (one revision for the whole list). Positions are the item centre in metres; rotation in degrees counter-clockwise (0 = front faces north, 180 = faces south). height_m raises an item off the floor (a lamp, a wall shelf); items hung above others do not clash with them. Ids are generated when omitted.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: projectId,
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              definition_id: { type: 'string' },
              x_m: { type: 'number' },
              y_m: { type: 'number' },
              rotation_deg: { type: 'number' },
              height_m: { type: 'number' },
              tilt: { type: 'string', enum: ['x', 'y'], description: 'Lay it on its side: "x" stands the width up, "y" the depth.' },
              stop: { type: 'integer', description: 'Unloading stop for this piece (containers).' },
              step: { type: 'integer', description: 'Loading step (containers).' },
              id: { type: 'string' },
            },
            required: ['definition_id', 'x_m', 'y_m'],
          },
        },
        summary,
      },
      required: ['project_id', 'items'],
      additionalProperties: false,
    },
    run: (ctx, input) => {
      const project = load(ctx, input);
      const taken = takenIds(project);
      const specs = list(input, 'items');
      if (specs.length === 0) throw new ToolError('items is empty');
      const commands: Command[] = specs.map((s) => {
        const definitionId = str(s, 'definition_id');
        const id = typeof s.id === 'string' && s.id ? s.id : nextId(definitionId, taken);
        const elevation = metres(num(s, 'height_m', true) ?? 0);
        return {
          type: 'item.add',
          item: {
            id,
            definitionId,
            position: { x: metres(num(s, 'x_m')), y: metres(num(s, 'y_m')) },
            rotation: degrees(num(s, 'rotation_deg', true) ?? 0),
            locked: false,
            ...(elevation === 0 ? {} : { elevation }),
            ...(s.tilt === 'x' || s.tilt === 'y' ? { tilt: s.tilt } : {}),
            ...pieceMeta(s),
          },
        };
      });
      const updated = commit(ctx, project, commands, str(input, 'summary', true) || `Added ${commands.length} ${commands.length === 1 ? 'item' : 'items'}`);
      return afterChange(updated, `Placed ${commands.length} item(s): ${commands.map((c) => (c.type === 'item.add' ? c.item.id : '')).join(', ')}.`);
    },
  },
  {
    name: 'pack_container',
    description:
      'Propose loading plans for the planned cargo (quantities set on the cargo types) with deterministic extreme-point heuristics: largest first, heaviest first, widest base first. Each candidate lists what it places, what does not fit, volume and payload use and balance. Pieces already placed stay. With apply = true the chosen candidate is applied as one revision.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: projectId,
        strategy: { type: 'string', enum: ['largest-first', 'heaviest-first', 'footprint-first'], description: 'Apply this one; omit to compare all.' },
        apply: { type: 'boolean' },
        summary,
      },
      required: ['project_id'],
      additionalProperties: false,
    },
    run: (ctx, input) => {
      const project = load(ctx, input);
      if (!isContainer(project)) throw new ToolError('pack_container works on container projects (create one with activity "container")');
      const strategy = str(input, 'strategy', true) as PackStrategy | undefined;
      const candidates = strategy ? [packContainer(project, { strategy })] : extremePointPacker.propose(project, {});
      const text = candidates
        .map((c, i) => `${i + 1}. ${c.label}: ${c.explanation}${c.leftOver.length ? ` Did not fit: ${[...new Set(c.leftOver)].join(', ')}.` : ''}`)
        .join('\n');
      if (input.apply !== true) return `Candidates (nothing changed):\n${text}`;
      const chosen = candidates[0]!;
      if (chosen.commands.length === 0) return `Nothing to place.\n${text}`;
      const updated = commit(ctx, project, [...chosen.commands], str(input, 'summary', true) || `Packed ${chosen.commands.length} pieces (${chosen.label.toLowerCase()})`);
      return afterChange(updated, `Applied "${chosen.label}".`) + '\n' + describeRules(updated).join('\n');
    },
  },
  {
    name: 'add_rack_rows',
    description:
      'Warehouses: add rows of pallet rack bays running east from (x_m, y_m), the south-west corner of the first bay. Rows alternate: the first faces first_facing, then pairs stand back to back across the flue and face each other across the aisle. One revision.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: projectId,
        definition_id: { type: 'string', description: 'A rack type (default "rack-bay").' },
        x_m: { type: 'number' },
        y_m: { type: 'number' },
        bays: { type: 'integer', description: 'Bays per row.' },
        rows: { type: 'integer' },
        aisle_m: { type: 'number', description: 'Clear aisle between facing rows (default: the truck’s working aisle).' },
        flue_m: { type: 'number', description: 'Gap between back-to-back rows (default 0.2).' },
        first_facing: { type: 'string', enum: ['north', 'south'], description: 'Default south.' },
        summary,
      },
      required: ['project_id', 'x_m', 'y_m', 'bays', 'rows'],
      additionalProperties: false,
    },
    run: (ctx, input) => {
      const project = load(ctx, input);
      const definitionId = str(input, 'definition_id', true) || 'rack-bay';
      const definition = project.catalog[definitionId];
      if (!definition || !rackOf(definition)) throw new ToolError(`"${definitionId}" is not a rack type; define one with define_item and "rack"`);
      const bays = Math.round(num(input, 'bays'));
      const rows = Math.round(num(input, 'rows'));
      if (bays < 1 || rows < 1 || bays * rows > 5000) throw new ToolError('bays and rows must be at least 1, and at most 5000 bays in one call');
      const commands = rackRows(definition, {
        definitionId,
        origin: { x: metres(num(input, 'x_m')), y: metres(num(input, 'y_m')) },
        bays,
        rows,
        aisle: input.aisle_m === undefined ? truckOf(project).aisle : metres(num(input, 'aisle_m')),
        flue: metres(num(input, 'flue_m', true) ?? 0.2),
        firstFacing: input.first_facing === 'north' ? 'north' : 'south',
        taken: takenIds(project),
      });
      const updated = commit(ctx, project, commands, str(input, 'summary', true) || `Added ${rows} ${rows === 1 ? 'rack row' : 'rack rows'} of ${bays} bays`);
      return afterChange(updated, `Added ${commands.length} bays.`) + '\n' + describeRules(updated).join('\n');
    },
  },
  {
    name: 'edit_zones',
    description: `Warehouses and other packs: add rectangular zones and/or remove zones by id (one revision). Kinds: ${ZONE_KINDS.join(', ')} (dock = where trucks start, no-go = trucks never drive through).`,
    inputSchema: {
      type: 'object',
      properties: {
        project_id: projectId,
        add: {
          type: 'array',
          items: {
            type: 'object',
            properties: { id: { type: 'string' }, kind: { type: 'string' }, name: { type: 'string' }, x_m: { type: 'number' }, y_m: { type: 'number' }, width_m: { type: 'number' }, depth_m: { type: 'number' } },
            required: ['kind', 'x_m', 'y_m', 'width_m', 'depth_m'],
          },
        },
        remove: { type: 'array', items: { type: 'string' } },
        summary,
      },
      required: ['project_id'],
      additionalProperties: false,
    },
    run: (ctx, input) => {
      const project = load(ctx, input);
      const remove = new Set(Array.isArray(input.remove) ? input.remove.filter((x): x is string => typeof x === 'string') : []);
      const unknownIds = [...remove].filter((id) => !(project.space.zones ?? []).some((z) => z.id === id));
      if (unknownIds.length) throw new ToolError(`No zone ${unknownIds.join(', ')}`);
      const taken = takenIds(project);
      const added = list(input, 'add', true).map((z) => {
        const kind = str(z, 'kind');
        const id = typeof z.id === 'string' && z.id ? z.id : nextId(kind, taken);
        return rectZone(id, kind, str(z, 'name', true) || kind, metres(num(z, 'x_m')), metres(num(z, 'y_m')), metres(num(z, 'width_m')), metres(num(z, 'depth_m')));
      });
      if (added.length === 0 && remove.size === 0) throw new ToolError('give zones to add or ids to remove');
      const zones = [...(project.space.zones ?? []).filter((z) => !remove.has(z.id)), ...added];
      const { zones: _old, ...rest } = project.space;
      const space = zones.length ? { ...rest, zones } : rest;
      const updated = commit(ctx, project, [{ type: 'space.set', space }], str(input, 'summary', true) || `Zones: ${added.length} added, ${remove.size} removed`);
      return afterChange(updated, `Zones now: ${zones.map((z) => `${z.id} (${z.kind})`).join(', ') || 'none'}.`);
    },
  },
  {
    name: 'set_truck',
    description: `Warehouses: the lift truck the layout is planned for (${TRUCK_PROFILES.map((t) => `${t.id}: ${t.label}, aisle ${mOf(t.aisle)}, lift ${mOf(t.maxLift)}`).join('; ')}). Typical figures; the actual truck's rated aisle decides. One revision.`,
    inputSchema: {
      type: 'object',
      properties: { project_id: projectId, truck: { type: 'string', enum: TRUCK_PROFILES.map((t) => t.id) }, summary },
      required: ['project_id', 'truck'],
      additionalProperties: false,
    },
    run: (ctx, input) => {
      const project = load(ctx, input);
      if (!isWarehouse(project)) throw new ToolError('set_truck works on warehouse projects (create one with activity "warehouse")');
      const truck = str(input, 'truck');
      if (!TRUCK_PROFILES.some((t) => t.id === truck)) throw new ToolError(`unknown truck "${truck}"`);
      const space = { ...project.space, meta: { ...(project.space.meta ?? {}), truck } };
      const updated = commit(ctx, project, [{ type: 'space.set', space }], str(input, 'summary', true) || `Truck: ${truckOf({ ...project, space }).label}`);
      return afterChange(updated, `Truck set to ${truck}.`) + '\n' + describeRules(updated).join('\n');
    },
  },
  {
    name: 'route_to_bay',
    description: 'Warehouses: the driving route of the project’s truck from the nearest dock to the front of a rack bay, with its length. Nothing changes.',
    inputSchema: {
      type: 'object',
      properties: { project_id: projectId, bay_id: { type: 'string' }, truck: { type: 'string', enum: TRUCK_PROFILES.map((t) => t.id), description: 'Compare another truck without changing the project.' } },
      required: ['project_id', 'bay_id'],
      additionalProperties: false,
    },
    run: (ctx, input) => {
      const project = load(ctx, input);
      const bayId = str(input, 'bay_id');
      if (!baysOf(project).some((b) => b.item.id === bayId)) throw new ToolError(`"${bayId}" is not a rack bay`);
      const route = routeToBay(project, bayId, str(input, 'truck', true) || undefined);
      if (route.length === 0) return `A ${truckOf(project, str(input, 'truck', true) || undefined).label.toLowerCase()} cannot reach ${bayId} from a dock.`;
      let length = 0;
      for (let i = 1; i < route.length; i++) length += Math.hypot(route[i]!.x - route[i - 1]!.x, route[i]!.y - route[i - 1]!.y);
      return `Route to ${bayId}: ${mOf(length)} (straight segments between cell centres; the drive is about this long).\nCorners (m): ${route.map((p) => `(${toUnit(p.x, 'm').toFixed(2)}, ${toUnit(p.y, 'm').toFixed(2)})`).join(' → ')}`;
    },
  },
  {
    name: 'connect_flow',
    description: 'Production lines: send parts from one placed station to another (or stop, with remove: true). One revision. A station may send to several (parts go to whichever can take one) and receive from several.',
    inputSchema: {
      type: 'object',
      properties: { project_id: projectId, from: { type: 'string' }, to: { type: 'string' }, remove: { type: 'boolean' }, summary },
      required: ['project_id', 'from', 'to'],
      additionalProperties: false,
    },
    run: (ctx, input) => {
      const project = load(ctx, input);
      const from = project.items[str(input, 'from')];
      const to = project.items[str(input, 'to')];
      if (!from || !stationOf(project.catalog[from.definitionId])) throw new ToolError(`"${str(input, 'from')}" is not a placed station`);
      if (!to || !stationOf(project.catalog[to.definitionId])) throw new ToolError(`"${str(input, 'to')}" is not a placed station`);
      const next = input.remove === true ? nextOf(from).filter((id) => id !== to.id) : [...nextOf(from), to.id];
      const updated = commit(ctx, project, [{ type: 'item.meta', id: from.id, meta: withNext(from, next) }], str(input, 'summary', true) || `${input.remove === true ? 'Removed' : 'Added'} flow ${from.id} → ${to.id}`);
      return afterChange(updated, `Flows from ${from.id}: ${nextOf(updated.items[from.id]!).join(', ') || 'none'}.`) + '\n' + describeRules(updated).join('\n');
    },
  },
  {
    name: 'simulate_line',
    description: 'Production lines: simulate the line for some hours from the stations’ cycle times (deterministic). Gives parts made, parts per hour, work in progress, and for each station the share of time busy, blocked (finished part waiting) and starved (waiting for a part), and the bottleneck. Refuses when a cycle time or capacity is missing. Nothing changes.',
    inputSchema: { type: 'object', properties: { project_id: projectId, hours: { type: 'number', description: 'Default 8 (one shift).' } }, required: ['project_id'], additionalProperties: false },
    run: (ctx, input) => {
      const project = load(ctx, input);
      const hours = num(input, 'hours', true) ?? 8;
      if (hours <= 0 || hours > 24 * 31) throw new ToolError('hours must be between 0 and 744');
      const r = lineSimulator.run(project, { hours });
      if (!r.ok) {
        const why = { 'missing-cycle': 'no cycle time for', 'missing-capacity': 'no capacity for', 'unknown-next': 'flows to a missing station or a source from', 'no-source': 'there is no source', 'no-sink': 'there is no sink' }[r.problem];
        return `Cannot simulate: ${why}${r.ids.length ? ` ${r.ids.join(', ')}` : ''}. Set the data with define_item "station" or fix the flows; the drawing alone never gives a throughput.`;
      }
      const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;
      const rows = [...r.stations].map(([id, st]) => `  ${id}: busy ${pct(st.busy)}, blocked ${pct(st.blocked)}, starved ${pct(st.starved)}, out ${st.out}${st.averageContent ? `, holds ${Math.round(st.averageContent * 10) / 10} on average` : ''}`);
      return [`Simulated ${hours} h: ${r.produced} parts, ${Math.round(r.perHour * 10) / 10} per hour, ${Math.round(r.wipAverage * 10) / 10} parts in progress on average; bottleneck ${r.bottleneck ?? 'none'}.`, ...rows].join('\n');
    },
  },
  {
    name: 'create_variant',
    description:
      'Make an alternative of a project to try an idea without touching the approved plan: a linked copy with its own history. Propose layouts in variants, compare them with compare_variants, and let the person adopt one. Returns the new project id.',
    inputSchema: {
      type: 'object',
      properties: { project_id: projectId, name: { type: 'string', description: 'Short name of the idea, e.g. "Reach truck, 3 m aisles".' } },
      required: ['project_id', 'name'],
      additionalProperties: false,
    },
    run: (ctx, input) => {
      const project = load(ctx, input);
      const created = ctx.store.createVariant(project.id, str(input, 'name').slice(0, 200), ctx.actor);
      if (!created) throw new ToolError('could not create the variant');
      return `Created variant ${created.id} "${created.name}" of ${ctx.store.summary(created.id)?.variantOf}. Change it with the usual tools (project_id ${created.id}).`;
    },
  },
  {
    name: 'compare_variants',
    description: 'Compare a project and all its variants side by side: errors, warnings, failed and unknown rules, and the figures that matter for its kind of space (seats, pallet locations, volume used…). Nothing changes.',
    inputSchema: { type: 'object', properties: { project_id: projectId }, required: ['project_id'], additionalProperties: false },
    run: (ctx, input) => {
      const project = load(ctx, input);
      const rows = compareFamily(ctx.store, project.id);
      if (rows.length < 2) return `${project.id} has no variants yet. Use create_variant.`;
      return rows
        .map((r) => `${r.base ? 'BASE ' : ''}${r.project.id} "${r.project.name}" rev ${r.project.revision}: ${r.errors} errors, ${r.warnings} warnings, ${r.rulesFailed} rules failed, ${r.rulesUnknown} unknown; ${r.figures.map((f) => `${f.label} ${figureText(f)}`).join(', ')}`)
        .join('\n');
    },
  },
  {
    name: 'adopt_variant',
    description: 'Make the base project look like this variant, as one new revision of the base (undoable, in its history). Only when the person asked for it: adopting replaces the approved layout.',
    inputSchema: { type: 'object', properties: { variant_id: { type: 'string' }, summary }, required: ['variant_id'], additionalProperties: false },
    run: (ctx, input) => {
      const id = str(input, 'variant_id');
      const result = ctx.store.adoptVariant(id, ctx.actor);
      if (!result.ok) throw new ToolError(result.status === 400 ? `${id} is not a variant` : result.status === 404 ? `No project "${id}"` : result.status === 422 ? `Rejected: ${result.rejection.message}` : 'the base changed meanwhile; try again');
      return afterChange(result.project, `Adopted ${id} into ${result.project.id}.`);
    },
  },
  {
    name: 'move_items',
    description: 'Move, rotate and/or raise existing items (one revision). Give only the fields to change; height_m is the underside above the floor (0 = on the floor).',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: projectId,
        moves: {
          type: 'array',
          items: {
            type: 'object',
            properties: { id: { type: 'string' }, x_m: { type: 'number' }, y_m: { type: 'number' }, rotation_deg: { type: 'number' }, height_m: { type: 'number' } },
            required: ['id'],
          },
        },
        summary,
      },
      required: ['project_id', 'moves'],
      additionalProperties: false,
    },
    run: (ctx, input) => {
      const project = load(ctx, input);
      const commands: Command[] = [];
      for (const mv of list(input, 'moves')) {
        const id = str(mv, 'id');
        const item = project.items[id];
        if (!item) throw new ToolError(`no item "${id}"`);
        if (mv.x_m !== undefined || mv.y_m !== undefined) {
          const x = mv.x_m === undefined ? item.position.x : metres(num(mv, 'x_m'));
          const y = mv.y_m === undefined ? item.position.y : metres(num(mv, 'y_m'));
          commands.push({ type: 'item.move', id, to: { x, y } });
        }
        if (mv.rotation_deg !== undefined) commands.push({ type: 'item.rotate', id, to: degrees(num(mv, 'rotation_deg')) });
        if (mv.height_m !== undefined) commands.push({ type: 'item.elevate', id, to: metres(num(mv, 'height_m')) });
      }
      if (commands.length === 0) throw new ToolError('nothing to change');
      const updated = commit(ctx, project, commands, str(input, 'summary', true) || 'Moved items');
      return afterChange(updated, `Applied ${commands.length} change(s).`);
    },
  },
  {
    name: 'remove_items',
    description: 'Remove items by id (one revision).',
    inputSchema: {
      type: 'object',
      properties: { project_id: projectId, ids: { type: 'array', items: { type: 'string' } }, summary },
      required: ['project_id', 'ids'],
      additionalProperties: false,
    },
    run: (ctx, input) => {
      const project = load(ctx, input);
      const ids = input.ids;
      if (!Array.isArray(ids) || ids.length === 0 || !ids.every((x) => typeof x === 'string')) throw new ToolError('"ids" must be a non-empty list of strings');
      const updated = commit(ctx, project, ids.map((id) => ({ type: 'item.remove', id })), str(input, 'summary', true) || `Removed ${ids.length} ${ids.length === 1 ? 'item' : 'items'}`);
      return afterChange(updated, `Removed ${ids.length} item(s).`);
    },
  },
  {
    name: 'apply_commands',
    description:
      'Advanced: apply raw core commands atomically (lengths in ticks: 1 tick = 0.1 mm, so metres × 10000; angles in millidegrees). Types: item.add {item}, item.move {id,to}, item.rotate {id,to}, item.elevate {id,to}, item.remove {id}, item.lock {id,locked}, catalog.define {definition}, catalog.remove {id}, space.set {space}, project.rename {name}, batch {commands}.',
    inputSchema: {
      type: 'object',
      properties: { project_id: projectId, commands: { type: 'array', items: { type: 'object' } }, summary },
      required: ['project_id', 'commands'],
      additionalProperties: false,
    },
    run: (ctx, input) => {
      const project = load(ctx, input);
      const commands = input.commands;
      if (!Array.isArray(commands) || commands.length === 0) throw new ToolError('"commands" must be a non-empty array');
      const updated = commit(ctx, project, commands as Command[], str(input, 'summary', true) || '');
      return afterChange(updated, `Applied ${commands.length} command(s).`);
    },
  },
  {
    name: 'check_project',
    description: `List design issues (overlaps, blocked doors, items outside the room, missing clearance, too tall) with how far off each is, key metrics, and the activity's rules (walkway from every seat to a door, floor per person, desks with chairs for offices, exits, door width). activity: ${PACKS.map((p) => p.id).join(' or ')} (default: read from the catalog); style: ${PACKS.map((p) => `${p.id}: ${p.styles.map((s) => s.id).join(', ')}`).join('; ')}.`,
    inputSchema: {
      type: 'object',
      properties: {
        project_id: projectId,
        activity: { type: 'string', enum: PACKS.map((p) => p.id) },
        style: { type: 'string', enum: PACKS.flatMap((p) => p.styles.map((s) => s.id)) },
        hall_style: { type: 'string', description: 'Same as style, for halls (kept for older agents).' },
      },
      required: ['project_id'],
      additionalProperties: false,
    },
    run: (ctx, input) => {
      const project = load(ctx, input);
      const issues = checkProject(project);
      const metrics = measureProject(project);
      const head = `Revision ${project.revision}: ${metrics.seats} seats, ${metrics.itemCount} items, occupied ${(metrics.occupancy * 100).toFixed(1)}%.`;
      const activity = str(input, 'activity', true) ? packOf(str(input, 'activity', true)).id : detectPack(project);
      const rules = describeRules(project, activity, str(input, 'style', true) || str(input, 'hall_style', true)).join('\n');
      return `${head}\n${issues.length === 0 ? 'No issues.' : issues.map((i) => describeIssue(project, i)).join('\n')}\n${rules}`;
    },
  },
  {
    name: 'get_history',
    description: 'Recent revisions: number, who made them (human or which agent), summary and time.',
    inputSchema: {
      type: 'object',
      properties: { project_id: projectId, limit: { type: 'integer' } },
      required: ['project_id'],
      additionalProperties: false,
    },
    run: (ctx, input) => {
      const project = load(ctx, input);
      const limit = Math.min(200, Math.max(1, Math.round(num(input, 'limit', true) ?? 20)));
      return ctx.store.history(project.id, limit).map((h) => `#${h.revision} | ${h.actor} | ${h.summary} | ${h.createdAt}`).join('\n');
    },
  },
  {
    name: 'restore_revision',
    description: 'Bring back an earlier revision as a new revision (nothing is erased).',
    inputSchema: {
      type: 'object',
      properties: { project_id: projectId, revision: { type: 'integer' } },
      required: ['project_id', 'revision'],
      additionalProperties: false,
    },
    run: (ctx, input) => {
      const project = load(ctx, input);
      const result = ctx.store.restore(project.id, Math.round(num(input, 'revision')), ctx.actor);
      if (!result.ok) throw new ToolError('no such revision');
      return afterChange(result.project, `Restored revision ${String(input.revision)}.`);
    },
  },
];
