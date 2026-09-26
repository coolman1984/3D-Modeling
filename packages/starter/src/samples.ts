import { apply, createProject, fromUnit, roomSpace, type DoorSpec, type ItemDefinition, type ItemInstance, type Meta, type Project, type Zone } from '@space-planner/core';
import { newContainer } from './container.js';
import { referenceVehicleDepot } from './depot.js';
import { packContainer, type PackStrategy } from './packer.js';
import { stockCommands, type Slot } from './stock.js';
import { rackDefinition, WAREHOUSE_CATALOG, type RackSpec } from './warehouse.js';

/**
 * "Nile Gate Logistics": a fictional Egyptian consumer-electronics distributor, used to show the
 * product with realistic numbers. Product names follow common TV and appliance model lines;
 * carton sizes and weights are typical published values, rounded. Everything is generated
 * deterministically (a fixed-seed sequence, no clock), so every copy of the sample is identical.
 */

const m = (v: number) => fromUnit(v, 'm');
const cm = (v: number) => fromUnit(v, 'cm');
const kg = (v: number) => Math.round(v * 1000);
const none = { front: 0, back: 0, left: 0, right: 0 };

export const SAMPLE_COMPANY = 'Nile Gate Logistics';

/** A small fixed-seed generator (LCG), so "random-looking" stock is the same on every machine. */
function sequence(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

interface MaterialSpec {
  readonly id: string;
  readonly name: string;
  readonly line: string;
  readonly units: number;
  readonly massKg: number;
  readonly heightCm: number;
  readonly velocity: 'A' | 'B' | 'C';
  readonly moves: number;
  readonly color: number;
  /** Pallets on hand in the main distribution centre. */
  readonly stock: number;
}

const MATERIAL_SPECS: readonly MaterialSpec[] = [
  { id: 'CU70043', name: 'Crystal UHD 43″ CU7000 · UA43CU7000', line: 'Crystal UHD TV', units: 20, massKg: 250, heightCm: 150, velocity: 'A', moves: 80, color: 0x3f8f8a, stock: 120 },
  { id: 'CU70055', name: 'Crystal UHD 55″ CU7000 · UA55CU7000', line: 'Crystal UHD TV', units: 14, massKg: 285, heightCm: 165, velocity: 'A', moves: 52, color: 0x5fb3a6, stock: 130 },
  { id: 'Q60D55', name: 'QLED 55″ Q60D · QA55Q60D', line: 'QLED TV', units: 12, massKg: 250, heightCm: 160, velocity: 'A', moves: 44, color: 0x2b54d0, stock: 110 },
  { id: 'Q60D65', name: 'QLED 65″ Q60D · QA65Q60D', line: 'QLED TV', units: 8, massKg: 280, heightCm: 170, velocity: 'B', moves: 20, color: 0x4a74e0, stock: 100 },
  { id: 'Q80D65', name: 'QLED 65″ Q80D · QA65Q80D', line: 'QLED TV', units: 8, massKg: 300, heightCm: 170, velocity: 'B', moves: 16, color: 0x7b9ae8, stock: 70 },
  { id: 'QN90D65', name: 'Neo QLED 65″ QN90D · QA65QN90D', line: 'Neo QLED TV', units: 6, massKg: 260, heightCm: 170, velocity: 'B', moves: 12, color: 0x4b3fb0, stock: 55 },
  { id: 'QN90D75', name: 'Neo QLED 75″ QN90D · QA75QN90D', line: 'Neo QLED TV', units: 5, massKg: 300, heightCm: 185, velocity: 'C', moves: 5, color: 0x6f62cc, stock: 35 },
  { id: 'S90D65', name: 'OLED 65″ S90D · QA65S90D', line: 'OLED TV', units: 6, massKg: 230, heightCm: 170, velocity: 'C', moves: 6, color: 0x8a4fb5, stock: 30 },
  { id: 'LS03D55', name: 'The Frame 55″ LS03D · QA55LS03D', line: 'Lifestyle TV', units: 8, massKg: 220, heightCm: 160, velocity: 'C', moves: 4, color: 0xa7784e, stock: 25 },
  { id: 'HWQ990D', name: 'Soundbar HW-Q990D', line: 'Audio', units: 16, massKg: 240, heightCm: 140, velocity: 'B', moves: 14, color: 0x3a3834, stock: 45 },
  { id: 'RF65DG', name: 'French-door fridge 650 L · RF65DG', line: 'Refrigeration', units: 1, massKg: 135, heightCm: 190, velocity: 'B', moves: 18, color: 0x9aa4ad, stock: 90 },
  { id: 'RT42CG', name: 'Top-mount fridge 420 L · RT42CG', line: 'Refrigeration', units: 2, massKg: 150, heightCm: 185, velocity: 'B', moves: 16, color: 0xb9c2c9, stock: 110 },
  { id: 'WW90T', name: 'Washer 9 kg EcoBubble · WW90T4040', line: 'Laundry', units: 4, massKg: 290, heightCm: 180, velocity: 'B', moves: 18, color: 0xd4d0c6, stock: 115 },
  { id: 'DV90T', name: 'Dryer 9 kg · DV90T5240', line: 'Laundry', units: 4, massKg: 200, heightCm: 180, velocity: 'C', moves: 8, color: 0xc3bdb0, stock: 35 },
  { id: 'AR18WF', name: 'WindFree AC 1.5 HP · AR18TXFCAWK', line: 'Air conditioning', units: 6, massKg: 280, heightCm: 160, velocity: 'A', moves: 90, color: 0x6fb7d6, stock: 150 },
  { id: 'MS23K', name: 'Microwave 23 L · MS23K3513', line: 'Kitchen', units: 24, massKg: 300, heightCm: 170, velocity: 'B', moves: 20, color: 0xc98a3c, stock: 60 },
  { id: 'SMA55', name: 'Galaxy A55 phones · SM-A556 (master cartons)', line: 'Mobile', units: 480, massKg: 150, heightCm: 120, velocity: 'A', moves: 40, color: 0x26303a, stock: 40 },
  { id: 'G527', name: 'Odyssey G5 27″ monitor · LS27CG510', line: 'Monitors', units: 30, massKg: 200, heightCm: 170, velocity: 'C', moves: 7, color: 0x9b3b4a, stock: 30 },
];

/** One loaded euro pallet of each product, as warehouse materials. */
export const NILE_GATE_MATERIALS: readonly ItemDefinition[] = MATERIAL_SPECS.map((s) => ({
  id: s.id,
  name: s.name,
  category: 'box',
  size: { w: cm(120), d: cm(80), h: cm(s.heightCm) },
  clearance: none,
  mass: kg(s.massKg),
  meta: { sku: s.id, line: s.line, unitsPerPallet: s.units, velocity: s.velocity, movesPerWeek: s.moves, color: s.color },
}));

const region = (id: string, kind: string, x0: number, y0: number, x1: number, y1: number): Zone => ({ id, kind, polygon: [{ x: m(x0), y: m(y0) }, { x: m(x1), y: m(y0) }, { x: m(x1), y: m(y1) }, { x: m(x0), y: m(y1) }] });

interface Site {
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
  /** Share of positions holding a pallet. */
  readonly fill: number;
  readonly seed: number;
  readonly materials: readonly MaterialSpec[];
}

/** Build a stocked warehouse: rows, zones, docks, floor pallets, then stock by bands of one product. */
function warehouseSite(site: Site): Project {
  const space = roomSpace({ width: m(site.width), depth: m(site.depth), ceilingHeight: m(site.height), doors: site.docks.map(({ id, wall, offset, width }) => ({ id, wall, offset, width })), columns: [] });
  const doors = space.doors.map((door) => {
    const spec = site.docks.find((d) => d.id === door.id)!;
    return { ...door, meta: { role: spec.role, approachZone: spec.zone } };
  });
  const rack = rackDefinition('ngl-rack', site.rack);
  const catalog = Object.fromEntries([...WAREHOUSE_CATALOG, rack, ...NILE_GATE_MATERIALS.filter((d) => site.materials.some((s) => s.id === d.id))].map((d) => [d.id, d]));
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

function pallet(id: string, definitionId: string, x: number, y: number, rotation = 0): ItemInstance {
  return { id, definitionId, position: { x: m(x), y: m(y) }, rotation, locked: false };
}

/** Floor pallets on a grid, cycling through products, starting at the south-west pallet centre. */
function palletBlock(prefix: string, products: readonly string[], x0: number, y0: number, columns: number, rows: number, dx: number, dy: number, rotation = 0): ItemInstance[] {
  const out: ItemInstance[] = [];
  let n = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) {
    n++;
    out.push(pallet(`${prefix}${String(n).padStart(2, '0')}`, products[(r * 7 + c * 3) % products.length]!, x0 + c * dx, y0 + r * dy, rotation));
  }
  return out;
}

function forklift(id: string, x: number, y: number): ItemInstance {
  return { id, definitionId: 'ngl-forklift', position: { x: m(x), y: m(y) }, rotation: 0, locked: false };
}

const FORKLIFT: ItemDefinition = { id: 'ngl-forklift', name: 'Counterbalance forklift 2.5 t', category: 'forklift', size: { w: cm(120), d: cm(250), h: cm(220) }, clearance: none, mass: kg(3900) };

/** The main site: 60 × 40 m, 14 rows of 8 bays × 5 levels × 3 pallets (1,680 positions). */
export function nileGateRamadanDC(name = 'Nile Gate · 10th of Ramadan DC — consumer electronics'): Project {
  const rack: RackSpec = { bays: 8, bayWidth: cm(270), depth: cm(110), height: cm(1000), levels: 5, positionsPerLevel: 3, uprightWidth: cm(10) };
  const ys = [10, 14.2, 18.4, 22.6, 26.8, 31, 35.2];
  const rows = [
    ...ys.map((y, i) => ({ id: `W${String(i + 1).padStart(2, '0')}`, x: 16.25, y })),
    ...ys.map((y, i) => ({ id: `E${String(i + 1).padStart(2, '0')}`, x: 42, y, ...(i === 3 ? { blocked: 'B02-L03-P01,B02-L03-P02,B02-L03-P03' } : {}) })),
  ];
  const inbound = ['Q60D55', 'CU70055', 'AR18WF', 'WW90T', 'RT42CG'];
  const outbound = ['CU70043', 'Q60D65', 'AR18WF', 'MS23K', 'RF65DG', 'SMA55'];
  const project = warehouseSite({
    name,
    width: 60, depth: 40, height: 12,
    docks: [
      { id: 'R1', wall: 'south', offset: m(6), width: m(3.5), role: 'receiving', zone: 'inbound-docks' },
      { id: 'R2', wall: 'south', offset: m(11), width: m(3.5), role: 'receiving', zone: 'inbound-docks' },
      { id: 'R3', wall: 'south', offset: m(16), width: m(3.5), role: 'receiving', zone: 'inbound-docks' },
      { id: 'S1', wall: 'south', offset: m(37), width: m(3.5), role: 'shipping', zone: 'outbound-docks' },
      { id: 'S2', wall: 'south', offset: m(42), width: m(3.5), role: 'shipping', zone: 'outbound-docks' },
      { id: 'S3', wall: 'south', offset: m(47), width: m(3.5), role: 'shipping', zone: 'outbound-docks' },
    ],
    zones: [
      region('inbound-docks', 'receiving', 5, 0.3, 20.5, 3.6),
      region('outbound-docks', 'shipping', 36, 0.3, 51.5, 3.6),
      region('inbound-staging', 'staging', 1.2, 0.8, 4.8, 7.4),
      region('outbound-staging', 'staging', 52, 0.8, 59.7, 7.4),
      region('dock-apron', 'main-aisle', 5, 3.6, 51.5, 8.4),
      region('west-block', 'storage', 5, 9, 27.5, 36),
      region('east-block', 'storage', 30.75, 9, 53.25, 36),
      region('cross-aisle', 'cross-aisle', 27.5, 9, 30.75, 36),
      region('small-parts-picking', 'picking', 54.5, 9, 59.5, 34),
      region('forklift-charging', 'charging', 54.5, 36, 59.5, 39.5),
      region('walkway', 'pedestrian', 0.3, 9, 1.4, 39.5),
    ],
    rack,
    rows,
    floor: [
      ...palletBlock('IN', inbound, 2.1, 1.6, 3, 5, 1.1, 1.3, 90_000),
      ...palletBlock('OUT', outbound, 53, 1.6, 6, 5, 1.2, 1.3, 90_000),
      forklift('FL1', 55.5, 37.75), forklift('FL2', 57, 37.75), forklift('FL3', 58.5, 37.75),
    ],
    fill: 0.86,
    seed: 20260926,
    materials: MATERIAL_SPECS,
  });
  return { ...project, catalog: { ...project.catalog, [FORKLIFT.id]: FORKLIFT } };
}

/** Port cross-dock at Alexandria: container pallets devanned in the middle, overflow racks to the east. */
export function nileGatePortWarehouse(name = 'Nile Gate · Alexandria port — bonded cross-dock'): Project {
  const rack: RackSpec = { bays: 7, bayWidth: cm(270), depth: cm(110), height: cm(800), levels: 4, positionsPerLevel: 3, uprightWidth: cm(10) };
  const products = ['Q60D65', 'CU70043', 'AR18WF', 'RF65DG', 'WW90T', 'SMA55', 'MS23K'];
  const floor: ItemInstance[] = [];
  for (const [k, x] of [7.2, 8.3, 13.2, 14.3, 19.2, 20.3, 21.4].entries()) {
    for (let r = 0; r < 12; r++) floor.push(pallet(`X${k + 1}-${String(r + 1).padStart(2, '0')}`, products[(k * 5 + r * 3) % products.length]!, x, 6.6 + r * 1.5, 90_000));
  }
  const project = warehouseSite({
    name,
    width: 48, depth: 30, height: 9,
    docks: [
      { id: 'QUAY1', wall: 'south', offset: m(3), width: m(3.5), role: 'receiving', zone: 'quay-side' },
      { id: 'QUAY2', wall: 'south', offset: m(9), width: m(3.5), role: 'receiving', zone: 'quay-side' },
      { id: 'QUAY3', wall: 'south', offset: m(15), width: m(3.5), role: 'receiving', zone: 'quay-side' },
      { id: 'TRUCK1', wall: 'north', offset: m(3), width: m(3.5), role: 'shipping', zone: 'truck-side' },
      { id: 'TRUCK2', wall: 'north', offset: m(9), width: m(3.5), role: 'shipping', zone: 'truck-side' },
      { id: 'TRUCK3', wall: 'north', offset: m(15), width: m(3.5), role: 'shipping', zone: 'truck-side' },
    ],
    zones: [
      region('quay-side', 'receiving', 1, 0.3, 20, 3.6),
      region('truck-side', 'shipping', 1, 26.4, 20, 29.7),
      region('cross-dock', 'staging', 6.5, 5.6, 22, 24.4),
      region('overflow-racks', 'storage', 26, 6.5, 46, 25),
      region('customs-hold', 'no-go', 40, 0.8, 47.2, 4.5),
    ],
    rack,
    rows: [7.5, 11.7, 15.9, 20.1, 24.3].map((y, i) => ({ id: `P${String(i + 1).padStart(2, '0')}`, x: 36, y })),
    floor,
    fill: 0.7,
    seed: 30303,
    materials: MATERIAL_SPECS.filter((s) => products.includes(s.id) || s.velocity === 'C'),
  });
  return project;
}

/** A design study at scale: 120 × 85 m, 48 rows of 12 bays × 6 levels (10,368 positions). */
export function nileGateMegaDC(name = 'Nile Gate · 6th of October mega DC — design study'): Project {
  const rack: RackSpec = { bays: 12, bayWidth: cm(270), depth: cm(110), height: cm(1200), levels: 6, positionsPerLevel: 3, uprightWidth: cm(10) };
  const w = (12 * 270 + 13 * 10) / 100;
  const xs = [4 + w / 2, 4 + w * 1.5 + 4, 4 + w * 2.5 + 8];
  const rows: Array<{ id: string; x: number; y: number }> = [];
  xs.forEach((x, b) => {
    for (let r = 0; r < 16; r++) rows.push({ id: `${'ABC'[b]}${String(r + 1).padStart(2, '0')}`, x: Math.round(x * 100) / 100, y: 16 + r * 4.2 });
  });
  const docks = Array.from({ length: 10 }, (_, i) => ({ id: `D${String(i + 1).padStart(2, '0')}`, wall: 'south' as const, offset: m(8 + i * 10.5), width: m(3.5), role: (i < 5 ? 'receiving' : 'shipping') as 'receiving' | 'shipping', zone: 'docks' }));
  return warehouseSite({
    name,
    width: 120, depth: 85, height: 14,
    docks,
    zones: [
      region('docks', 'receiving', 6, 0.3, 114, 3.6),
      region('staging', 'staging', 6, 3.6, 114, 12),
      region('storage', 'storage', 4, 15, 116, 80),
    ],
    rack,
    rows,
    floor: [],
    fill: 0.78,
    seed: 60606,
    materials: MATERIAL_SPECS,
  });
}

interface CargoSpec {
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
function loadedContainer(name: string, typeId: string, cargo: readonly CargoSpec[], pack: PackStrategy | null): Project {
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

const TV = { stackable: true, allowTilt: false };

export function nileGateTvContainer(): Project {
  return loadedContainer('Inbound MSKU 40′HC — QLED & Crystal UHD TVs (Ho Chi Minh → Sokhna)', '40hc', [
    { id: 'tv-qn75', name: 'Neo QLED 75″ QN90D carton', size: [182, 20, 112], massKg: 42, quantity: 24, meta: { stackable: false, allowTilt: false, print: 'Neo QLED|75″' } },
    { id: 'tv-q65', name: 'QLED 65″ Q60D carton', size: [158, 17, 98], massKg: 27, quantity: 96, meta: { ...TV, maxLoadOnTop: kg(30), print: 'QLED|65″' } },
    { id: 'tv-cu55', name: 'Crystal UHD 55″ CU7000 carton', size: [136, 14, 85], massKg: 17, quantity: 160, meta: { ...TV, maxLoadOnTop: kg(40), print: 'Crystal UHD|55″' } },
    { id: 'soundbar', name: 'Soundbar HW-Q990D carton', size: [124, 42, 30], massKg: 11, quantity: 40, meta: { stackable: true, allowTilt: true, maxLoadOnTop: kg(45), print: 'Soundbar|Q990D' } },
  ], 'largest-first');
}

export function nileGateApplianceContainer(): Project {
  return loadedContainer('Inbound HLCU 40′HC — home appliances (Busan → Alexandria)', '40hc', [
    { id: 'fridge-rf65', name: 'French-door fridge RF65DG carton', size: [95, 80, 185], massKg: 135, quantity: 16, meta: { stackable: false, allowTilt: false, print: 'Refrigerator|650 L' } },
    { id: 'washer-ww90', name: 'Washer WW90T carton', size: [66, 68, 90], massKg: 72, quantity: 60, meta: { stackable: true, allowTilt: false, maxLoadOnTop: kg(80), print: 'EcoBubble|9 kg' } },
    { id: 'ac-outdoor', name: 'WindFree AC outdoor unit carton', size: [92, 38, 66], massKg: 38, quantity: 40, meta: { stackable: true, allowTilt: false, maxLoadOnTop: kg(80), print: 'WindFree|1.5 HP' } },
    { id: 'microwave', name: 'Microwave MS23K carton', size: [58, 46, 36], massKg: 13, quantity: 80, meta: { stackable: true, allowTilt: false, maxLoadOnTop: kg(60), print: 'Microwave|23 L' } },
  ], 'heaviest-first');
}

export function nileGatePhoneContainer(): Project {
  return loadedContainer('Inbound 20′ — Galaxy phones & tablets, high value (Jebel Ali → Sokhna)', '20gp', [
    { id: 'phones-pallet', name: 'Galaxy A55 master cartons · euro pallet', size: [120, 80, 120], massKg: 380, quantity: 11, meta: { stackable: true, allowTilt: false, maxLoadOnTop: kg(400) } },
    { id: 'tablets-pallet', name: 'Galaxy Tab S9 FE cartons · euro pallet', size: [120, 80, 100], massKg: 300, quantity: 11, meta: { stackable: true, allowTilt: false, maxLoadOnTop: kg(300) } },
  ], 'footprint-first');
}

export function nileGateRetailTrailer(): Project {
  return loadedContainer('Outbound trailer 13.6 m — Cairo retail run, 3 stops', 'trailer', [
    { id: 'stop1-tv', name: 'Stop 1 Nasr City showroom · QLED TV pallet', size: [120, 80, 170], massKg: 280, quantity: 8, meta: { stackable: false, allowTilt: false, stop: 1 } },
    { id: 'stop2-appl', name: 'Stop 2 Heliopolis store · appliance pallet', size: [120, 80, 180], massKg: 290, quantity: 10, meta: { stackable: false, allowTilt: false, stop: 2 } },
    { id: 'stop3-mixed', name: 'Stop 3 New Cairo mall · mixed electronics pallet', size: [120, 80, 150], massKg: 240, quantity: 14, meta: { stackable: false, allowTilt: false, stop: 3 } },
  ], 'largest-first');
}

/** Nothing loaded yet: the plan is set, so a visitor can press a loading plan and watch it fill. */
export function nileGatePracticeContainer(): Project {
  return loadedContainer('Try it — plan this 40′HC load (TVs + appliances)', '40hc', [
    { id: 'tv-q65', name: 'QLED 65″ Q60D carton', size: [158, 17, 98], massKg: 27, quantity: 60, meta: { ...TV, maxLoadOnTop: kg(30), print: 'QLED|65″' } },
    { id: 'tv-cu55', name: 'Crystal UHD 55″ CU7000 carton', size: [136, 14, 85], massKg: 17, quantity: 80, meta: { ...TV, maxLoadOnTop: kg(40), print: 'Crystal UHD|55″' } },
    { id: 'washer-ww90', name: 'Washer WW90T carton', size: [66, 68, 90], massKg: 72, quantity: 24, meta: { stackable: true, allowTilt: false, maxLoadOnTop: kg(80), print: 'EcoBubble|9 kg' } },
    { id: 'microwave', name: 'Microwave MS23K carton', size: [58, 46, 36], massKg: 13, quantity: 40, meta: { stackable: true, allowTilt: false, maxLoadOnTop: kg(60), print: 'Microwave|23 L' } },
  ], null);
}

export interface SampleProject {
  readonly project: Project;
  /** Revision note in the history. */
  readonly summary: string;
}

/** The whole sample company, in the order it should appear. */
export function nileGateSample(): SampleProject[] {
  const yard = referenceVehicleDepot('Nile Gate · Nasr City last-mile van yard');
  return [
    { project: nileGateRamadanDC(), summary: 'Sample company: main distribution centre with stock' },
    { project: nileGatePortWarehouse(), summary: 'Sample company: port cross-dock' },
    { project: nileGateMegaDC(), summary: 'Sample company: large DC design study' },
    { project: nileGateTvContainer(), summary: 'Sample company: loaded TV container' },
    { project: nileGateApplianceContainer(), summary: 'Sample company: loaded appliance container' },
    { project: nileGatePhoneContainer(), summary: 'Sample company: high-value 20′ container' },
    { project: nileGateRetailTrailer(), summary: 'Sample company: multi-stop retail trailer' },
    { project: nileGatePracticeContainer(), summary: 'Sample company: container ready to plan' },
    { project: yard, summary: 'Sample company: last-mile van yard' },
  ];
}
