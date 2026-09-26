import { fromUnit, rotate, type Command, type Id, type ItemDefinition, type ItemInstance, type Meta, type Project, type Tick, type Vec2 } from '@space-planner/core';
import { distanceAt, floorRaster, reachabilityFrom } from '@space-planner/industry';
import type { Candidate, OptimizationPort } from './optimization.js';
import { DEFAULT_FORKLIFT, dockApproach, rackSpecOf, type RackSpec } from './warehouse.js';

/**
 * Material slotting: which material sits in which rack location. A material is a catalog
 * definition holding one loaded pallet (`meta.sku`); what a location holds is stored on its rack
 * row, one `meta` entry per bay, so a 1,680-position warehouse adds a few hundred short strings to
 * the save instead of thousands of items that the core would report as overlapping their rack.
 *
 * Bay entry `s01` = levels bottom-up joined by `|`, positions west to east joined by `,`, each a
 * material id or empty: `"Q60D55,Q60D55,|CU70043,,|,,"`.
 */

const cm = (v: number) => fromUnit(v, 'cm');
const m = (v: number) => fromUnit(v, 'm');

/** Longest material id a location can hold; keeps a bay entry within the core's meta text limit. */
export const MATERIAL_ID_MAX = 10;
/** Lifting to a higher level costs time; counted as this much extra travel per level above the floor. */
export const LEVEL_PENALTY = m(1.5);

export type Velocity = 'A' | 'B' | 'C';

/** What the slotting tools read from a material definition. */
export interface Material {
  readonly id: Id;
  readonly name: string;
  readonly sku: string;
  /** Product family shown in lists, e.g. "QLED TV". */
  readonly line?: string;
  readonly velocity?: Velocity;
  /** Pallet moves in and out per week, all pallets of this material together. */
  readonly movesPerWeek?: number;
  readonly unitsPerPallet?: number;
  /** Display colour 0xRRGGBB. */
  readonly color?: number;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined);

export function materialOf(definition: ItemDefinition | undefined): Material | undefined {
  const sku = str(definition?.meta?.sku);
  if (!definition || !sku) return undefined;
  const v = definition.meta?.velocity;
  const fields: Record<string, unknown> = {
    line: str(definition.meta?.line),
    velocity: v === 'A' || v === 'B' || v === 'C' ? v : undefined,
    movesPerWeek: num(definition.meta?.movesPerWeek),
    unitsPerPallet: num(definition.meta?.unitsPerPallet),
    color: num(definition.meta?.color),
  };
  return { id: definition.id, name: definition.name, sku, ...Object.fromEntries(Object.entries(fields).filter(([, x]) => x !== undefined)) } as Material;
}

/** Every material in the catalog, in id order. */
export function materialsOf(project: Project): Material[] {
  return Object.values(project.catalog)
    .map(materialOf)
    .filter((x): x is Material => x !== undefined)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export interface Slot {
  readonly rackId: Id;
  readonly bay: number;
  readonly level: number;
  readonly position: number;
}

export const slotId = (s: Slot) => `${s.rackId}-B${String(s.bay).padStart(2, '0')}-L${String(s.level).padStart(2, '0')}-P${String(s.position).padStart(2, '0')}`;
const bayKey = (bay: number) => `s${String(bay).padStart(2, '0')}`;

/** Read one bay of a rack: [level][position] → material id or ''. */
function readBay(rack: ItemInstance, spec: RackSpec, bay: number): string[][] {
  const raw = typeof rack.meta?.[bayKey(bay)] === 'string' ? (rack.meta[bayKey(bay)] as string) : '';
  const levels = raw.split('|');
  return Array.from({ length: spec.levels }, (_, l) => {
    const cells = (levels[l] ?? '').split(',');
    return Array.from({ length: spec.positionsPerLevel }, (_, p) => cells[p] ?? '');
  });
}

function writeBay(cells: string[][]): string | undefined {
  if (cells.every((level) => level.every((c) => c === ''))) return undefined;
  return cells.map((level) => level.join(',')).join('|');
}

/** Material id per occupied location id, over every rack row. */
export function stockOf(project: Project): Map<string, Id> {
  const stock = new Map<string, Id>();
  for (const rack of racksOf(project)) {
    const spec = rackSpecOf(project.catalog[rack.definitionId])!;
    for (let bay = 1; bay <= spec.bays; bay++) {
      readBay(rack, spec, bay).forEach((level, l) => level.forEach((id, p) => {
        if (id) stock.set(slotId({ rackId: rack.id, bay, level: l + 1, position: p + 1 }), id);
      }));
    }
  }
  return stock;
}

/** What one rack row holds, bay by bay: [bay-1][level-1][position-1]. */
export function rackStock(project: Project, rackId: Id): string[][][] | undefined {
  const rack = project.items[rackId];
  const spec = rack && rackSpecOf(project.catalog[rack.definitionId]);
  if (!rack || !spec) return undefined;
  return Array.from({ length: spec.bays }, (_, b) => readBay(rack, spec, b + 1));
}

function racksOf(project: Project): ItemInstance[] {
  return Object.values(project.items)
    .filter((i) => rackSpecOf(project.catalog[i.definitionId]) !== undefined)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export type StockProblem = 'not-a-rack' | 'outside-rack' | 'unknown-material' | 'too-long';

/**
 * The commands that put materials into locations (null empties a location), one `item.meta` per
 * rack touched, keeping the rack's other data. Returns a problem instead when an edit cannot be
 * stored; applying the result is still the caller's choice, through the normal command path.
 */
export function stockCommands(project: Project, changes: ReadonlyArray<Slot & { readonly material: Id | null }>): { ok: true; commands: Command[] } | { ok: false; problem: StockProblem; slot?: Slot } {
  const edited = new Map<Id, { rack: ItemInstance; spec: RackSpec; bays: Map<number, string[][]> }>();
  for (const change of changes) {
    const rack = project.items[change.rackId];
    const spec = rack && rackSpecOf(project.catalog[rack.definitionId]);
    if (!rack || !spec) return { ok: false, problem: 'not-a-rack', slot: change };
    if (change.bay < 1 || change.bay > spec.bays || change.level < 1 || change.level > spec.levels || change.position < 1 || change.position > spec.positionsPerLevel) return { ok: false, problem: 'outside-rack', slot: change };
    if (change.material !== null && (!materialOf(project.catalog[change.material]) || change.material.length > MATERIAL_ID_MAX || /[,|]/.test(change.material))) return { ok: false, problem: 'unknown-material', slot: change };
    let entry = edited.get(rack.id);
    if (!entry) edited.set(rack.id, (entry = { rack, spec, bays: new Map() }));
    let cells = entry.bays.get(change.bay);
    if (!cells) entry.bays.set(change.bay, (cells = readBay(rack, spec, change.bay)));
    cells[change.level - 1]![change.position - 1] = change.material ?? '';
  }
  const commands: Command[] = [];
  for (const { rack, bays } of [...edited.values()].sort((a, b) => (a.rack.id < b.rack.id ? -1 : 1))) {
    const meta: Record<string, string | number | boolean> = { ...(rack.meta ?? {}) };
    for (const [bay, cells] of bays) {
      const text = writeBay(cells);
      if (text === undefined) delete meta[bayKey(bay)];
      else if (text.length > 200) return { ok: false, problem: 'too-long', slot: { rackId: rack.id, bay, level: 1, position: 1 } };
      else meta[bayKey(bay)] = text;
    }
    const sorted = Object.fromEntries(Object.entries(meta).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) as Meta;
    commands.push({ type: 'item.meta', id: rack.id, meta: Object.keys(sorted).length ? sorted : null });
  }
  return { ok: true, commands };
}

/** Move whatever is in `from` to `to`, swapping with what `to` held. */
export function moveStockCommands(project: Project, from: Slot, to: Slot) {
  const stock = stockOf(project);
  return stockCommands(project, [
    { ...to, material: stock.get(slotId(from)) ?? null },
    { ...from, material: stock.get(slotId(to)) ?? null },
  ]);
}

/**
 * Centre of a location's pallet in the plan and the height its pallet stands at. Level 1 is on the
 * floor; each level above sits on beams at an even share of the rack height.
 */
export function slotPlacement(rack: ItemInstance, spec: RackSpec, slot: Pick<Slot, 'bay' | 'level' | 'position'>): { center: Vec2; elevation: Tick; width: Tick; depth: Tick; height: Tick } {
  const w = spec.bays * spec.bayWidth + (spec.bays + 1) * spec.uprightWidth;
  const slotWidth = spec.bayWidth / spec.positionsPerLevel;
  const localX = -w / 2 + spec.uprightWidth + (slot.bay - 1) * (spec.bayWidth + spec.uprightWidth) + (slot.position - 0.5) * slotWidth;
  const offset = rotate({ x: localX, y: 0 }, rack.rotation);
  const pitch = spec.height / spec.levels;
  return {
    center: { x: rack.position.x + offset.x, y: rack.position.y + offset.y },
    elevation: (rack.elevation ?? 0) + Math.round((slot.level - 1) * pitch),
    width: Math.round(slotWidth),
    depth: spec.depth,
    height: Math.round(pitch),
  };
}

export interface StockMetrics {
  readonly positions: number;
  readonly occupied: number;
  /** occupied / positions, 0..1. */
  readonly occupancy: number;
  readonly units: number;
  /** Grams on racks, when every stored material has a mass. */
  readonly mass?: number;
  readonly byMaterial: ReadonlyArray<{ readonly material: Material; readonly pallets: number; readonly units: number }>;
  readonly byVelocity: Readonly<Record<Velocity | 'unset', number>>;
}

export function stockMetrics(project: Project): StockMetrics {
  const stock = stockOf(project);
  let positions = 0;
  for (const rack of racksOf(project)) {
    const s = rackSpecOf(project.catalog[rack.definitionId])!;
    positions += s.bays * s.levels * s.positionsPerLevel;
  }
  const counts = new Map<Id, number>();
  for (const id of stock.values()) counts.set(id, (counts.get(id) ?? 0) + 1);
  const byMaterial = materialsOf(project).map((material) => {
    const pallets = counts.get(material.id) ?? 0;
    return { material, pallets, units: pallets * (material.unitsPerPallet ?? 0) };
  }).filter((x) => x.pallets > 0);
  const byVelocity = { A: 0, B: 0, C: 0, unset: 0 };
  for (const row of byMaterial) byVelocity[row.material.velocity ?? 'unset'] += row.pallets;
  let mass: number | undefined = 0;
  for (const [id, n] of counts) {
    const grams = project.catalog[id]?.mass;
    mass = grams === undefined || mass === undefined ? undefined : mass + grams * n;
  }
  return {
    positions,
    occupied: stock.size,
    occupancy: positions ? stock.size / positions : 0,
    units: byMaterial.reduce((s, r) => s + r.units, 0),
    ...(mass === undefined ? {} : { mass }),
    byMaterial,
    byVelocity,
  };
}

/**
 * One-way forklift travel from a dock to every location, in ticks, plus the lift penalty for its
 * level; locations no forklift can reach are left out. One flood fill from the dock answers all
 * of them: the forklift stands in the aisle directly in front of the location's bay.
 */
export function slotTravel(project: Project, dockId?: Id): Map<string, number> {
  const dock = project.space.doors.find((d) => d.id === dockId) ?? project.space.doors.find((d) => d.meta?.role === 'shipping') ?? project.space.doors[0];
  const travel = new Map<string, number>();
  if (!dock) return travel;
  const restricted = (project.space.zones ?? []).filter((z) => z.kind === 'no-go' || z.kind === 'pedestrian').map((z) => z.polygon);
  const grid = floorRaster(project, cm(20), restricted);
  const distances = reachabilityFrom(grid, dockApproach(dock, DEFAULT_FORKLIFT), DEFAULT_FORKLIFT);
  if (!distances) return travel;
  const standOff = DEFAULT_FORKLIFT.effectiveWidth / 2 + cm(10);
  for (const rack of racksOf(project)) {
    const spec = rackSpecOf(project.catalog[rack.definitionId])!;
    const face = rotate({ x: 0, y: spec.depth / 2 + standOff }, rack.rotation);
    for (let bay = 1; bay <= spec.bays; bay++) {
      const { center } = slotPlacement(rack, spec, { bay, level: 1, position: (spec.positionsPerLevel + 1) / 2 });
      const reach = [1, -1]
        .map((side) => distanceAt(grid, distances, { x: center.x + side * face.x, y: center.y + side * face.y }))
        .filter((d): d is number => d !== undefined);
      if (!reach.length) continue;
      const floor = Math.min(...reach);
      for (let level = 1; level <= spec.levels; level++) for (let position = 1; position <= spec.positionsPerLevel; position++) {
        travel.set(slotId({ rackId: rack.id, bay, level, position }), floor + (level - 1) * LEVEL_PENALTY);
      }
    }
  }
  return travel;
}

function blockedSlots(project: Project): Set<string> {
  const blocked = new Set<string>();
  for (const rack of racksOf(project)) {
    if (typeof rack.meta?.blockedPositions !== 'string') continue;
    for (const s of rack.meta.blockedPositions.split(',')) if (s.trim()) blocked.add(`${rack.id}-${s.trim()}`);
  }
  return blocked;
}

/** Round-trip metres per week: every pallet move goes dock → location → dock. */
function weeklyTravel(project: Project, placement: ReadonlyMap<string, Id>, travel: ReadonlyMap<string, number>): number | undefined {
  const pallets = new Map<Id, number>();
  for (const id of placement.values()) pallets.set(id, (pallets.get(id) ?? 0) + 1);
  let total = 0;
  for (const [slot, id] of placement) {
    const moves = materialOf(project.catalog[id])?.movesPerWeek;
    const distance = travel.get(slot);
    if (moves === undefined || distance === undefined) return undefined;
    total += (moves / pallets.get(id)!) * 2 * distance;
  }
  return total / 10_000;
}

export interface SlottingGoal {
  /** Dock the pallets move to and from; the shipping dock by default. */
  readonly dockId?: Id;
}

export const parseSlot = (id: string): Slot => {
  const match = /^(.*)-B(\d+)-L(\d+)-P(\d+)$/.exec(id)!;
  return { rackId: match[1]!, bay: Number(match[2]), level: Number(match[3]), position: Number(match[4]) };
};

/**
 * Re-slot the stock on hand so the busiest pallets sit closest to the dock and lowest: pallets
 * ranked by moves per pallet, locations by travel plus lift. Only rearranges what is stored; it
 * never adds or drops a pallet. Deterministic for the same project.
 */
export function optimizeSlotting(project: Project, goal: SlottingGoal = {}): Candidate {
  const stock = stockOf(project);
  const travel = slotTravel(project, goal.dockId);
  const before = weeklyTravel(project, stock, travel);
  const blocked = blockedSlots(project);
  const counts = new Map<Id, number>();
  for (const id of stock.values()) counts.set(id, (counts.get(id) ?? 0) + 1);
  const heat = (id: Id) => (materialOf(project.catalog[id])?.movesPerWeek ?? 0) / counts.get(id)!;
  const pallets = [...stock.values()].sort((a, b) => heat(b) - heat(a) || (a < b ? -1 : a > b ? 1 : 0));
  const slots = [...travel.entries()].filter(([id]) => !blocked.has(id)).sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1)).map(([id]) => id);
  const leftOver: string[] = [];
  const placement = new Map<string, Id>();
  pallets.forEach((id, k) => {
    const slot = slots[k];
    if (slot) placement.set(slot, id);
    else leftOver.push(id);
  });
  // Pallets with no reachable free location stay where they are.
  if (leftOver.length) {
    const kept = [...stock.entries()].filter(([slot]) => !placement.has(slot));
    for (const [slot, id] of kept) {
      const k = leftOver.indexOf(id);
      if (k < 0) continue;
      leftOver.splice(k, 1);
      placement.set(slot, id);
    }
  }
  const changes: Array<Slot & { material: Id | null }> = [];
  for (const slot of new Set([...stock.keys(), ...placement.keys()])) {
    const next = placement.get(slot) ?? null;
    if ((stock.get(slot) ?? null) !== next) changes.push({ ...parseSlot(slot), material: next });
  }
  changes.sort((a, b) => (slotId(a) < slotId(b) ? -1 : 1));
  const result = stockCommands(project, changes);
  const after = weeklyTravel(project, placement, travel);
  const metrics: Record<string, number> = { moved: changes.filter((c) => c.material !== null).length };
  if (before !== undefined) metrics.travelBefore = Math.round(before);
  if (after !== undefined) metrics.travelAfter = Math.round(after);
  if (before !== undefined && after !== undefined && before > 0) metrics.saving = Math.round(((before - after) / before) * 1000) / 10;
  return {
    label: 'Busiest pallets nearest the dock',
    commands: result.ok ? result.commands : [],
    metrics,
    explanation: 'Pallets with the most moves per week go to the locations with the shortest forklift trip from the dock, ground level first; each level up counts as 1.5 m more travel.',
    leftOver: result.ok ? leftOver : [...stock.values()],
  };
}

export const velocitySlotter: OptimizationPort<SlottingGoal> = {
  id: 'velocity-slotting',
  propose: (project, goal) => [optimizeSlotting(project, goal)],
};

/** Occupied locations of one material, in location order. */
export function locationsOf(project: Project, materialId: Id): string[] {
  return [...stockOf(project).entries()].filter(([, id]) => id === materialId).map(([slot]) => slot).sort();
}
