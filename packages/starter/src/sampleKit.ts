import { apply, createProject, fromUnit, roomSpace, type DoorSpec, type ItemDefinition, type ItemInstance, type Meta, type Project, type Zone } from '@space-planner/core';
import { newContainer } from './container.js';
import { packContainer, type PackStrategy } from './packer.js';
import { stockCommands, type Slot } from './stock.js';
import { rackDefinition, WAREHOUSE_CATALOG, type RackSpec } from './warehouse.js';

/**
 * Building blocks shared by the sample companies: a stocked warehouse, a loaded container, floor
 * pallets. Deterministic (a fixed-seed sequence, no clock), so every copy of a sample is identical.
 * Not exported from the package: samples are data, these are how the data is made.
 */

export const m = (v: number) => fromUnit(v, 'm');
export const cm = (v: number) => fromUnit(v, 'cm');
export const kg = (v: number) => Math.round(v * 1000);
export const none = { front: 0, back: 0, left: 0, right: 0 };

/** A small fixed-seed generator (LCG), so "random-looking" stock is the same on every machine. */
export function sequence(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export interface MaterialSpec {
  readonly id: string;
  readonly name: string;
  readonly line: string;
  readonly units: number;
  readonly massKg: number;
  readonly heightCm: number;
  readonly velocity: 'A' | 'B' | 'C';
  readonly moves: number;
  readonly color: number;
  /** Pallets on hand, used to weight how often the product shows up in the racks. */
  readonly stock: number;
}

/** One loaded euro pallet of a product, as a warehouse material. */
export function materialDefinition(s: MaterialSpec): ItemDefinition {
  return {
    id: s.id,
    name: s.name,
    category: 'box',
    size: { w: cm(120), d: cm(80), h: cm(s.heightCm) },
    clearance: none,
    mass: kg(s.massKg),
    meta: { sku: s.id, line: s.line, unitsPerPallet: s.units, velocity: s.velocity, movesPerWeek: s.moves, color: s.color },
  };
}

export const region = (id: string, kind: string, x0: number, y0: number, x1: number, y1: number, meta?: Meta): Zone => ({
  id,
  kind,
  polygon: [{ x: m(x0), y: m(y0) }, { x: m(x1), y: m(y0) }, { x: m(x1), y: m(y1) }, { x: m(x0), y: m(y1) }],
  ...(meta ? { meta } : {}),
});

export interface WarehouseSite {
  readonly name: string;
  readonly width: number;
  readonly depth: number;
  readonly height: number;
  readonly docks: ReadonlyArray<DoorSpec & { readonly role: 'receiving' | 'shipping'; readonly zone: string }>;
  readonly zones: readonly Zone[];
  readonly rack: RackSpec;
  /** Rack row id and centre in metres; all rows face north (rotation 0). */
  readonly rows: ReadonlyArray<{ readonly id: string; readonly x: number; readonly y: number; readonly blocked?: string }>;
  readonly floor: readonly ItemInstance[];
  /** Extra item types the floor items use (forklifts, workbenches…). */
  readonly extraCatalog?: readonly ItemDefinition[];
  /** Share of positions holding a pallet. */
  readonly fill: number;
  readonly seed: number;
  readonly materials: readonly MaterialSpec[];
}

/** Build a stocked warehouse: rows, zones, docks, floor pallets, then stock by bands of one product. */
export function warehouseSite(site: WarehouseSite): Project {
  const space = roomSpace({ width: m(site.width), depth: m(site.depth), ceilingHeight: m(site.height), doors: site.docks.map(({ id, wall, offset, width }) => ({ id, wall, offset, width })), columns: [] });
  const doors = space.doors.map((door) => {
    const spec = site.docks.find((d) => d.id === door.id)!;
    return { ...door, meta: { role: spec.role, approachZone: spec.zone } };
  });
  const rack = rackDefinition('ngl-rack', site.rack);
  const catalog = Object.fromEntries([...WAREHOUSE_CATALOG, rack, ...site.materials.map(materialDefinition), ...(site.extraCatalog ?? [])].map((d) => [d.id, d]));
  const items: Record<string, ItemInstance> = {};
  for (const row of site.rows) {
    items[row.id] = { id: row.id, definitionId: rack.id, position: { x: m(row.x), y: m(row.y) }, rotation: 0, locked: false, ...(row.blocked ? { meta: { blockedPositions: row.blocked } } : {}) };
  }
  for (const item of site.floor) items[item.id] = item;
  let project: Project = { ...createProject('new', site.name, { ...space, doors, zones: [...site.zones], meta: { pack: 'warehouse' } }), catalog, items };

  // Stock arrives in runs of one product, as real put-away does, with no thought for travel.
  const random = sequence(site.seed);
  const total = site.materials.reduce((s, x) => s + x.stock, 0);
  const pick = () => {
    let r = random() * total;
    for (const s of site.materials) if ((r -= s.stock) < 0) return s.id;
    return site.materials[site.materials.length - 1]!.id;
  };
  const changes: Array<Slot & { material: string }> = [];
  let current = pick();
  let run = 0;
  for (const row of site.rows) {
    const blocked = new Set((row.blocked ?? '').split(',').filter(Boolean));
    for (let bay = 1; bay <= site.rack.bays; bay++) for (let level = 1; level <= site.rack.levels; level++) for (let position = 1; position <= site.rack.positionsPerLevel; position++) {
      const suffix = `B${String(bay).padStart(2, '0')}-L${String(level).padStart(2, '0')}-P${String(position).padStart(2, '0')}`;
      if (blocked.has(suffix) || random() > site.fill) continue;
      if (run <= 0) {
        current = pick();
        run = 2 + Math.floor(random() * 7);
      }
      run--;
      changes.push({ rackId: row.id, bay, level, position, material: current });
    }
  }
  const stocked = stockCommands(project, changes);
  if (!stocked.ok) throw new Error(`sample stock does not fit: ${stocked.problem}`);
  const result = apply(project, { type: 'batch', commands: stocked.commands });
  if (!result.ok) throw new Error(`sample stock rejected: ${result.rejection.message}`);
  project = result.project;
  return project;
}

export function pallet(id: string, definitionId: string, x: number, y: number, rotation = 0): ItemInstance {
  return { id, definitionId, position: { x: m(x), y: m(y) }, rotation, locked: false };
}

/** Floor pallets on a grid, cycling through products, starting at the south-west pallet centre. */
export function palletBlock(prefix: string, products: readonly string[], x0: number, y0: number, columns: number, rows: number, dx: number, dy: number, rotation = 0): ItemInstance[] {
  const out: ItemInstance[] = [];
  let n = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) {
    n++;
    out.push(pallet(`${prefix}${String(n).padStart(2, '0')}`, products[(r * 7 + c * 3) % products.length]!, x0 + c * dx, y0 + r * dy, rotation));
  }
  return out;
}

export const FORKLIFT: ItemDefinition = { id: 'ngl-forklift', name: 'Counterbalance forklift 2.5 t', category: 'forklift', size: { w: cm(120), d: cm(250), h: cm(220) }, clearance: none, mass: kg(3900) };

export function forklift(id: string, x: number, y: number): ItemInstance {
  return { id, definitionId: FORKLIFT.id, position: { x: m(x), y: m(y) }, rotation: 0, locked: false };
}

export interface CargoSpec {
  readonly id: string;
  readonly name: string;
  readonly size: readonly [number, number, number];
  readonly massKg: number;
  readonly quantity: number;
  readonly meta: Meta;
}

const cargoDefinition = (c: CargoSpec): ItemDefinition => ({
  id: c.id,
  name: c.name,
  category: 'box',
  size: { w: cm(c.size[0]), d: cm(c.size[1]), h: cm(c.size[2]) },
  clearance: none,
  mass: kg(c.massKg),
  meta: { ...c.meta, quantity: c.quantity },
});

/**
 * A container with this load's cargo only. `pack` loads it with the built-in packer and records
 * what fitted as the plan, so the sample opens complete; without it the plan waits to be packed.
 */
export function loadedContainer(name: string, typeId: string, cargo: readonly CargoSpec[], pack: PackStrategy | null): Project {
  const empty = newContainer(name, typeId);
  let project: Project = { ...empty, catalog: Object.fromEntries(cargo.map((c) => [c.id, cargoDefinition(c)])) };
  if (!pack) return project;
  const candidate = packContainer(project, { strategy: pack });
  const result = apply(project, { type: 'batch', commands: candidate.commands });
  if (!result.ok) throw new Error(`sample load rejected: ${result.rejection.message}`);
  project = result.project;
  const placed = new Map<string, number>();
  for (const item of Object.values(project.items)) placed.set(item.definitionId, (placed.get(item.definitionId) ?? 0) + 1);
  const catalog = Object.fromEntries(Object.values(project.catalog).map((d) => [d.id, { ...d, meta: { ...d.meta, quantity: placed.get(d.id) ?? 0 } }]));
  return { ...project, catalog };
}
