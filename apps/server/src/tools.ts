import {
  checkProject,
  containsPolygon,
  fromUnit,
  measureProject,
  normalizeAngle,
  readRoom,
  roomProblems,
  roomSpace,
  serializeProject,
  toSquareMetres,
  toCounterClockwise,
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
import { cargoOf, checkPack, CONTAINER_TYPES, containerMetrics, DEFAULT_FORKLIFT, detectPack, extremePointPacker, isContainer, newContainer, newProductionLine, newRoom, newWarehouse, packContainer, packOf, PACKS, productionMetrics, rackDefinition, referenceProductionLine, referenceWarehouse, ROUND_SHAPES, SHAPES, stepOf, stopOf, WAREHOUSE_ZONE_KINDS, warehouseMetrics, warehouseRoute, type PackId, type PackStrategy, type RuleResult } from '@space-planner/starter';
import type { Store } from './store.js';

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
  if (detectPack(project) === 'warehouse') {
    const w = warehouseMetrics(project);
    lines.push(`Warehouse: ${w.rackRows} rack rows, ${w.bays} bays, ${w.positions} pallet positions (${w.usablePositions} usable), ${w.docks} docks, ${w.floorArea.toFixed(1)} m² gross floor.`);
  }
  lines.push(...describeRules(project));
  return lines.join('\n');
}

const PACK_NAMES: Record<PackId, string> = { hall: 'Hall', office: 'Office', container: 'Container loading', warehouse: 'Warehouse', production: 'Production line' };

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
    description: 'Create a hall, office, container, warehouse or production-line project. Warehouse reference layout: activity warehouse, reference true (30 × 20 × 8 m, five rack rows). Production reference layout: activity production, reference true (30 × 8 m, source → machine A → buffer → machine B → inspection → finished goods). Returns the project id.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        width_m: { type: 'number', description: 'West→east size in metres.' },
        depth_m: { type: 'number', description: 'South→north size in metres.' },
        ceiling_m: { type: 'number', description: 'Ceiling height in metres, if known.' },
        activity: { type: 'string', enum: PACKS.map((p) => p.id) },
        container_type: { type: 'string', enum: CONTAINER_TYPES.map((t) => t.id), description: 'For activity "container".' },
        reference: { type: 'boolean', description: 'For activity warehouse: the reference 30 × 20 m layout. For activity production: the reference 30 × 8 m line.' },
      },
      required: ['name'],
      additionalProperties: false,
    },
    run: (ctx, input) => {
      if (str(input, 'activity', true) === 'container') {
        const created = ctx.store.createProject(newContainer(str(input, 'name'), str(input, 'container_type', true) || '20gp'), ctx.actor);
        return `Created ${created.id}.\n\n${describeProject(created)}`;
      }
      if (str(input, 'activity', true) === 'warehouse') {
        const project = input.reference === true
          ? referenceWarehouse(str(input, 'name'))
          : newWarehouse(str(input, 'name'), num(input, 'width_m'), num(input, 'depth_m'), num(input, 'ceiling_m', true) || 8);
        const created = ctx.store.createProject(project, ctx.actor);
        return `Created ${created.id}.\n\n${describeProject(created)}\nWarehouse capacity: ${warehouseMetrics(created).positions} pallet positions.`;
      }
      if (str(input, 'activity', true) === 'production') {
        const project = input.reference === true
          ? referenceProductionLine(str(input, 'name'))
          : newProductionLine(str(input, 'name'), num(input, 'width_m'), num(input, 'depth_m'), num(input, 'ceiling_m', true) || 4);
        const created = ctx.store.createProject(project, ctx.actor);
        return `Created ${created.id}.\n\n${describeProject(created)}\nProduction line: ${productionMetrics(created).stations} stations, ${(productionMetrics(created).flowLength / 10_000).toFixed(1)} m flow length.`;
      }
      const width = num(input, 'width_m');
      const depth = num(input, 'depth_m');
      if (width < 1 || depth < 1 || width > 500 || depth > 500) throw new ToolError('room sides must be between 1 and 500 m');
      const project = ctx.store.createProject(newRoom(str(input, 'name'), width, depth, num(input, 'ceiling_m', true), packOf(str(input, 'activity', true)).id), ctx.actor);
      return `Created ${project.id}.\n\n${describeProject(project)}`;
    },
  },
  {
    name: 'add_warehouse_rack',
    description: 'Add one parametric rack row to a warehouse. Give its centre X/Y in metres and optionally bays, levels and positions per bay per level. It creates one revision with a compact rack definition.',
    inputSchema: { type: 'object', properties: {
      project_id: projectId, x_m: { type: 'number' }, y_m: { type: 'number' },
      bays: { type: 'integer' }, levels: { type: 'integer' }, positions_per_level: { type: 'integer' },
    }, required: ['project_id', 'x_m', 'y_m'], additionalProperties: false },
    run: (ctx, input) => {
      const project = load(ctx, input);
      if (detectPack(project) !== 'warehouse') throw new ToolError('This project is not a warehouse.');
      const taken = takenIds(project);
      const id = nextId('rack', taken);
      const definition = rackDefinition(nextId('rack-type', taken), {
        bays: num(input, 'bays', true) ?? 6, bayWidth: centimetres(270), depth: centimetres(110),
        height: centimetres(650), levels: num(input, 'levels', true) ?? 4,
        positionsPerLevel: num(input, 'positions_per_level', true) ?? 2, uprightWidth: centimetres(10),
      });
      const updated = commit(ctx, project, [
        { type: 'catalog.define', definition },
        { type: 'item.add', item: { id, definitionId: definition.id, position: { x: metres(num(input, 'x_m')), y: metres(num(input, 'y_m')) }, rotation: 0, locked: false } },
      ], `Added rack row ${id}`);
      return `Added ${id}. Total storage: ${warehouseMetrics(updated).positions} pallet positions. Revision ${updated.revision}.`;
    },
  },
  {
    name: 'add_warehouse_zone',
    description: 'Add a named polygonal operational zone to a warehouse. Vertices are metre coordinates in plan order; a valid polygon must stay within the warehouse. One recorded revision.',
    inputSchema: { type: 'object', properties: {
      project_id: projectId, kind: { type: 'string', enum: WAREHOUSE_ZONE_KINDS },
      vertices: { type: 'array', items: { type: 'object', properties: { x_m: { type: 'number' }, y_m: { type: 'number' } }, required: ['x_m', 'y_m'] } },
    }, required: ['project_id', 'kind', 'vertices'], additionalProperties: false },
    run: (ctx, input) => {
      const project = load(ctx, input);
      if (detectPack(project) !== 'warehouse') throw new ToolError('This project is not a warehouse.');
      const kind = str(input, 'kind');
      if (!WAREHOUSE_ZONE_KINDS.some((k) => k === kind)) throw new ToolError('Unknown warehouse zone kind.');
      const vertices = list(input, 'vertices');
      if (vertices.length < 3 || vertices.length > 32) throw new ToolError('A zone needs 3 to 32 vertices.');
      const polygon = toCounterClockwise(vertices.map((p) => ({ x: metres(num(p, 'x_m')), y: metres(num(p, 'y_m')) })));
      if (!containsPolygon(project.space.boundary, polygon)) throw new ToolError('Zone must fit inside the warehouse boundary.');
      const id = nextId(kind, takenIds(project));
      const updated = commit(ctx, project, [{ type: 'space.set', space: { ...project.space, zones: [...(project.space.zones ?? []), { id, kind, polygon }] } }], `Added ${kind} zone ${id}`);
      return `Added ${kind} zone ${id}, revision ${updated.revision}.`;
    },
  },
  {
    name: 'warehouse_metrics',
    description: 'Read spatial capacity, rack footprint, dock count and usable pallet positions of a warehouse.',
    inputSchema: { type: 'object', properties: { project_id: projectId }, required: ['project_id'], additionalProperties: false },
    run: (ctx, input) => {
      const project = load(ctx, input);
      if (detectPack(project) !== 'warehouse') throw new ToolError('This project is not a warehouse.');
      return JSON.stringify(warehouseMetrics(project));
    },
  },
  {
    name: 'production_metrics',
    description: 'Read station count, machine/buffer counts and buffer capacity, and the flow line length and reachability of a production line.',
    inputSchema: { type: 'object', properties: { project_id: projectId }, required: ['project_id'], additionalProperties: false },
    run: (ctx, input) => {
      const project = load(ctx, input);
      if (detectPack(project) !== 'production') throw new ToolError('This project is not a production line.');
      return JSON.stringify(productionMetrics(project));
    },
  },
  {
    name: 'find_warehouse_route',
    description: 'Find a forklift route from a named dock to a rack row, with reachability and approximate travel distance. Supply optional body width and side clearance in centimetres.',
    inputSchema: { type: 'object', properties: {
      project_id: projectId, dock_id: { type: 'string' }, rack_id: { type: 'string' },
      body_width_cm: { type: 'number' }, side_clearance_cm: { type: 'number' },
    }, required: ['project_id', 'dock_id', 'rack_id'], additionalProperties: false },
    run: (ctx, input) => {
      const project = load(ctx, input);
      if (detectPack(project) !== 'warehouse') throw new ToolError('This project is not a warehouse.');
      const body = num(input, 'body_width_cm', true);
      const side = num(input, 'side_clearance_cm', true) ?? 0;
      if (body !== undefined && (body <= 0 || side < 0)) throw new ToolError('Mover width must be positive and clearance cannot be negative.');
      const profile = body === undefined ? DEFAULT_FORKLIFT : { name: 'Custom mover', effectiveWidth: centimetres(body + 2 * side) };
      const route = warehouseRoute(project, str(input, 'dock_id'), str(input, 'rack_id'), profile);
      return route.reachable ? `${(route.distance / 10_000).toFixed(2)} m, reachable; ${route.points.length} grid waypoints (20 cm resolution).` : `Unreachable: ${route.reason}.`;
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
      const nextRoom = roomSpace(spec);
      const space = { ...nextRoom, doors: nextRoom.doors.map((d) => ({ ...d, ...(project.space.doors.find((old) => old.id === d.id)?.meta ? { meta: project.space.doors.find((old) => old.id === d.id)!.meta } : {}) })), ...(project.space.meta ? { meta: project.space.meta } : {}), ...(project.space.zones ? { zones: project.space.zones } : {}) };
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
        size: { w: centimetres(num(input, 'width_cm')), d: centimetres(num(input, 'depth_cm')), h: centimetres(num(input, 'height_cm')) },
        clearance: { front: side('front'), back: side('back'), left: side('left'), right: side('right') },
        ...(seats === undefined ? {} : { seats }),
        ...(footprint === 'round' ? { footprint: 'round' as const } : {}),
        ...(input.mass_kg === undefined ? {} : { mass: Math.round(num(input, 'mass_kg') * 1000) }),
        ...cargoMeta(input.cargo, project.catalog[str(input, 'id')]?.meta),
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
