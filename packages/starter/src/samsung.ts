import { createProject, roomSpace, type DoorSpec, type ItemDefinition, type ItemInstance, type Meta, type Project, type Zone } from '@space-planner/core';
import { bayZone, DEPOT_CATALOG, type BayType } from './depot.js';
import { STARTER_CATALOG } from './hallCatalog.js';
import { OFFICE_CATALOG } from './office.js';
import { TABLE_CATALOG } from './restaurant.js';
import { cm, FORKLIFT, forklift, kg, loadedContainer, m, none, palletBlock, region, warehouseSite, type MaterialSpec } from './sampleKit.js';
import type { SampleProject } from './samples.js';
import { buildingDefinition, SITE_CATALOG } from './site.js';

/**
 * "Samsung Electronics Egypt · Beni Suef": an illustrative model of the TV, monitor, phone and
 * tablet factory in the Kom Abu Radi industrial zone, Al Wasta, Beni Suef.
 *
 * Public figures it is built on (see decision 0016 for the sources): a 336,000 m² site on plot 98
 * of the zone's engineering sector; TV and monitor assembly since 2013 (24″ to 82″ sets, about 85–90%
 * exported); a phone and tablet plant of about 9,000 m² (tablets from 2022, phones from 2025);
 * about 5,000 direct and indirect jobs. No floor plans are public, so building positions, room
 * layouts and line lengths are a planner's illustration with typical industry sizes — not a
 * survey of the real site. Everything is deterministic: every copy of the sample is identical.
 */

export const SAMSUNG_COMPANY = 'Samsung Electronics Egypt · Beni Suef';
const P = 'Samsung Egypt · ';

/** Collects item types and placed items for one project; ids count up per prefix (D01, D02…). */
class Fit {
  readonly catalog = new Map<string, ItemDefinition>();
  readonly items: Record<string, ItemInstance> = {};
  private readonly counts = new Map<string, number>();

  constructor(base: readonly ItemDefinition[] = []) {
    for (const d of base) this.catalog.set(d.id, d);
  }

  /** Place `def` with its centre at (x, y) metres, turned `rotation` degrees counter-clockwise. */
  put(prefix: string, def: ItemDefinition, x: number, y: number, rotation = 0, extra: { elevation?: number; meta?: Meta } = {}): string {
    if (!this.catalog.has(def.id)) this.catalog.set(def.id, def);
    const n = (this.counts.get(prefix) ?? 0) + 1;
    this.counts.set(prefix, n);
    const id = `${prefix}${String(n).padStart(2, '0')}`;
    const turn = ((Math.round(rotation * 1000) % 360_000) + 360_000) % 360_000;
    this.items[id] = {
      id,
      definitionId: def.id,
      position: { x: m(x), y: m(y) },
      rotation: turn,
      locked: false,
      ...(extra.elevation ? { elevation: m(extra.elevation) } : {}),
      ...(extra.meta ? { meta: extra.meta } : {}),
    };
    return id;
  }

  /**
   * An axis-aligned partition from (x0, y0) to (x1, y1), metres, with doorway `gaps` given as
   * [from, to] distances along it. Each piece is its own item so a doorway is simply no wall.
   */
  wall(x0: number, y0: number, x1: number, y1: number, gaps: ReadonlyArray<readonly [number, number]> = [], glass = false, heightCm = 270): void {
    const horizontal = y0 === y1;
    const length = horizontal ? x1 - x0 : y1 - y0;
    const cuts = [...gaps].sort((a, b) => a[0] - b[0]);
    const pieces: Array<[number, number]> = [];
    let at = 0;
    for (const [g0, g1] of cuts) {
      if (g0 > at + 0.05) pieces.push([at, g0]);
      at = Math.max(at, g1);
    }
    if (length > at + 0.05) pieces.push([at, length]);
    for (const [a, b] of pieces) {
      const len = Math.round((b - a) * 100);
      const def: ItemDefinition = glass
        ? { id: `glass-${len}`, name: `Glass partition ${(len / 100).toFixed(2)} m`, category: 'glass-wall', size: { w: cm(len), d: cm(10), h: cm(heightCm) }, clearance: none }
        : { id: `wall-${len}`, name: `Partition wall ${(len / 100).toFixed(2)} m`, category: 'wall', size: { w: cm(len), d: cm(12), h: cm(heightCm) }, clearance: none };
      const mid = (a + b) / 2;
      if (horizontal) this.put('W', def, x0 + mid, y0, 0);
      else this.put('W', def, x0, y0 + mid, 90);
    }
  }

  project(name: string, space: Parameters<typeof createProject>[2]): Project {
    return { ...createProject('new', name, space), catalog: Object.fromEntries(this.catalog), items: { ...this.items } };
  }
}

const byId = (list: readonly ItemDefinition[], id: string): ItemDefinition => {
  const found = list.find((d) => d.id === id);
  if (!found) throw new Error(`no catalog item ${id}`);
  return found;
};
const office = (id: string) => byId(OFFICE_CATALOG, id);
const hall = (id: string) => byId(STARTER_CATALOG, id);
const site = (id: string) => byId(SITE_CATALOG, id);

const withDoors = (spec: { width: number; depth: number; height: number; doors: ReadonlyArray<DoorSpec & { readonly meta?: Meta }> }) => {
  const space = roomSpace({ width: m(spec.width), depth: m(spec.depth), ceilingHeight: m(spec.height), doors: spec.doors.map(({ id, wall, offset, width }) => ({ id, wall, offset, width })), columns: [] });
  return { ...space, doors: space.doors.map((door) => {
    const meta = spec.doors.find((d) => d.id === door.id)?.meta;
    return meta ? { ...door, meta } : door;
  }) };
};

// ─── Parking rows, shared by the campus and the transport yard ────────────────────────────────

interface ParkingRow {
  readonly prefix: string;
  /** Centre line of the row's bays and the way a nose-in vehicle's front points (0 north, 180 south). */
  readonly y: number;
  readonly direction: 0 | 180;
  readonly x0: number;
  readonly count: number;
  readonly pitch: number;
  readonly type: BayType;
  /** How many bays from the west end hold a vehicle; the rest are free. */
  readonly parked: number;
  readonly vehicles: readonly ItemDefinition[];
}

/**
 * Bays fill from the west (the end nearest the gates), so every free bay has a free neighbour on
 * the side a driver swings through when turning in from an eastbound lane.
 */
function parkingRow(fit: Fit, zones: Zone[], row: ParkingRow): void {
  for (let i = 0; i < row.count; i++) {
    const x = row.x0 + i * row.pitch;
    const id = `${row.prefix}${String(i + 1).padStart(2, '0')}`;
    zones.push(bayZone(id, { x: m(x), y: m(row.y) }, row.type, row.direction));
    if (i < row.parked) fit.put(`${row.prefix}V`, row.vehicles[(i * 7 + row.prefix.length) % row.vehicles.length]!, x, row.y, row.direction);
  }
}

const lane = (id: string, x0: number, y0: number, x1: number, y1: number): Zone => region(id, 'lane-two-way', x0, y0, x1, y1, { direction: 0 });

// ─── Item types for the Samsung sample ────────────────────────────────────────────────────────

const CAR_COLOURS = [0xe9e9e6, 0x2b2d31, 0x9aa1a9, 0xc8ccd1, 0x6b1e24, 0x1f3a5f, 0xb8b2a6];
const STAFF_CARS: readonly ItemDefinition[] = CAR_COLOURS.map((color, i) => ({ ...site('site-car'), id: `staff-car-${i + 1}`, name: `Staff car · ${['white', 'black', 'silver', 'pearl', 'maroon', 'navy', 'beige'][i]}`, meta: { ...site('site-car').meta, color } }));
const COACH = { ...site('site-coach'), id: 'seeg-coach', name: 'Staff coach 12 m · Samsung livery', meta: { ...site('site-coach').meta, color: 0xf4f4f2, livery: 'blue' } };
const MINIBUS = { ...site('site-minibus'), id: 'seeg-minibus', name: 'Staff minibus 7 m', meta: { ...site('site-minibus').meta, color: 0xe8ecef, livery: 'grey' } };
const TRUCK = { ...byId(DEPOT_CATALOG, 'depot-truck'), id: 'seeg-truck', name: 'Container truck · 40′ box', size: { w: cm(250), d: cm(1650), h: cm(400) }, meta: { ...byId(DEPOT_CATALOG, 'depot-truck').meta, color: 0x1f5fa8, trailer: 'container' } };

/** A production station: operators stand at its sides, so its side clearance is the working room. */
function station(id: string, name: string, category: string, wCm: number, dCm: number, hCm: number, kind: 'source' | 'machine' | 'buffer' | 'inspection' | 'sink', sideCm = 100, extra: Meta = {}): ItemDefinition {
  return { id, name, category, size: { w: cm(wCm), d: cm(dCm), h: cm(hCm) }, clearance: { front: 0, back: 0, left: cm(sideCm), right: cm(sideCm) }, meta: { kind, ...extra } };
}

const TRAINING_TABLE: ItemDefinition = { id: 'training-table-140', name: 'Training table 140 × 50', category: 'table', size: { w: cm(140), d: cm(50), h: cm(75) }, clearance: none };
const STOOL: ItemDefinition = { id: 'operator-stool', name: 'ESD operator stool', category: 'chair', size: { w: cm(40), d: cm(40), h: cm(70) }, clearance: none, seats: 1 };
const BENCH: ItemDefinition = { id: 'esd-bench-180', name: 'ESD workbench 180 × 75', category: 'workbench', size: { w: cm(180), d: cm(75), h: cm(95) }, clearance: none };

// ─── 1. Campus master plan ────────────────────────────────────────────────────────────────────

export function samsungCampus(name = `${P}Beni Suef campus — site plan (illustrative)`): Project {
  const fit = new Fit(SITE_CATALOG);
  const zones: Zone[] = [];
  const W = 600;
  const D = 560; // 336,000 m², the published site area

  // Ring road, spine and cross road; gate approaches.
  zones.push(
    region('road-south', 'road', 20, 20, 580, 32), region('road-north', 'road', 20, 528, 580, 540),
    region('road-west', 'road', 20, 32, 32, 528), region('road-east', 'road', 568, 32, 580, 528),
    region('road-spine', 'road', 294, 32, 306, 528), region('road-cross', 'road', 32, 256, 568, 268),
    region('gate-main-approach', 'road', 138, 0, 156, 20), region('gate-truck-approach', 'road', 468, 0, 488, 20),
    region('footpath-main', 'footpath', 156, 32, 160, 84), region('plaza-main', 'plaza', 64, 36, 136, 84),
    region('truck-yard', 'yard', 430, 40, 565, 126),
    region('green-west', 'green', 36, 272, 120, 380), region('green-centre', 'green', 160, 190, 290, 250),
    region('green-north', 'green', 36, 390, 160, 460), region('green-east', 'green', 310, 272, 565, 316),
    region('substation-fence', 'no-go', 322, 489, 358, 515),
  );

  // Buildings (outer size; the inside of each is its own project).
  const blue = 0x1428a0;
  const plant1 = buildingDefinition('b-plant-tv', 'Plant 1 · TV & monitor assembly', 240, 150, 14, 'production', { sign: 'SAMSUNG', facade: 'cladding', color: 0xeef0f3, storeys: 1 });
  const plant2 = buildingDefinition('b-plant-mobile', 'Plant 2 · mobile & tablet (≈ 9,000 m²)', 100, 90, 12, 'production', { sign: 'SAMSUNG', facade: 'cladding', color: 0xf1f2f4 });
  const fgWh = buildingDefinition('b-fg-warehouse', 'Finished-goods warehouse & export docks', 120, 110, 13, 'warehouse', { facade: 'cladding', color: 0xdfe3e8, sign: 'SAMSUNG' });
  const partsWh = buildingDefinition('b-parts-warehouse', 'Parts & panel warehouse', 110, 80, 12, 'warehouse', { facade: 'cladding', color: 0xe3e6ea });
  const admin = buildingDefinition('b-admin', 'Administration & HR building', 72, 24, 13, 'office', { storeys: 3, facade: 'glass', sign: 'SAMSUNG', color: 0xd9e2ec });
  const training = buildingDefinition('b-training', 'Meeting & training centre', 48, 30, 9, 'training', { storeys: 2, facade: 'glass', color: 0xd4dde8 });
  const events = buildingDefinition('b-events', 'Events hall', 48, 32, 10, 'training', { facade: 'stone', color: 0xe8e2d6 });
  const canteen = buildingDefinition('b-canteen', 'Staff canteen & break building', 64, 40, 7, 'canteen', { facade: 'stone', color: 0xece6da });
  const mosque = buildingDefinition('b-prayer', 'Prayer hall', 24, 24, 8, 'mosque', { facade: 'stone', color: 0xf0ebe0 });
  const substation = buildingDefinition('b-substation', 'Main electrical substation', 30, 20, 7, 'utility', { facade: 'concrete', color: 0xc9ccd0 });
  const chillers = buildingDefinition('b-chillers', 'Chiller & compressed-air plant', 36, 18, 8, 'utility', { facade: 'cladding', color: 0xcfd3d8 });
  const tanks = buildingDefinition('b-water', 'Water tanks & fire pumps', 24, 20, 9, 'utility', { facade: 'concrete', color: 0xc4c9ce });
  const wwtp = buildingDefinition('b-wwtp', 'Wastewater treatment', 40, 24, 5, 'utility', { facade: 'concrete', color: 0xbfc5ca });
  const gatehouse = buildingDefinition('b-gatehouse', 'Main gatehouse & visitor reception', 16, 10, 5, 'security', { facade: 'glass', color: 0xd9e2ec });
  const truckGate = buildingDefinition('b-truck-gate', 'Truck gate & weighbridge office', 12, 8, 4.5, 'security', { facade: 'concrete', color: 0xd0d4d8 });
  const clinic = buildingDefinition('b-clinic', 'Medical clinic & first aid', 20, 14, 5, 'office', { facade: 'stone', color: 0xf2eee6 });

  fit.put('B', plant1, 437, 400);
  fit.put('B', plant2, 365, 190);
  fit.put('B', fgWh, 495, 190, 0, { meta: { docks: 8 } });
  fit.put('B', partsWh, 225, 420);
  fit.put('B', admin, 100, 100);
  fit.put('B', training, 205, 100);
  fit.put('B', events, 205, 160);
  fit.put('B', canteen, 230, 300);
  fit.put('B', mosque, 140, 300);
  fit.put('B', substation, 340, 502);
  fit.put('B', chillers, 395, 502);
  fit.put('B', tanks, 445, 502);
  fit.put('B', wwtp, 510, 502);
  fit.put('B', gatehouse, 176, 12);
  fit.put('B', truckGate, 504, 10);
  fit.put('B', clinic, 205, 215);

  // Staff bus park: two rows of 14 m coach bays on a 20 m lane, next to the main gate.
  zones.push(lane('bus-lane', 36, 172, 168, 192));
  parkingRow(fit, zones, { prefix: 'BN', y: 199, direction: 0, x0: 42, count: 27, pitch: 4.4, type: 'bus', parked: 24, vehicles: [COACH, COACH, COACH, MINIBUS] });
  parkingRow(fit, zones, { prefix: 'BS', y: 165, direction: 180, x0: 42, count: 27, pitch: 4.4, type: 'bus', parked: 23, vehicles: [COACH, COACH, MINIBUS, COACH] });

  // Staff car park north-west: three lanes, six rows of 2.5 × 5 m bays; shades over two rows.
  zones.push(lane('car-lane-1', 36, 473, 262, 479), lane('car-lane-2', 36, 489, 262, 495), lane('car-lane-3', 36, 505, 262, 511));
  const carRows: Array<[string, number, 0 | 180, number]> = [['CA', 470.5, 180, 58], ['CB', 481.5, 0, 62], ['CC', 486.5, 180, 55], ['CD', 497.5, 0, 60], ['CE', 502.5, 180, 50], ['CF', 513.5, 0, 44]];
  for (const [prefix, y, direction, parked] of carRows) parkingRow(fit, zones, { prefix, y, direction, x0: 42, count: 80, pitch: 2.6, type: 'perpendicular', parked, vehicles: STAFF_CARS });
  for (let k = 0; k < 11; k++) {
    fit.put('SH', site('site-shade'), 42 - 1.25 + 6.25 + k * 13, 481.5, 0, { elevation: 2.6 });
    fit.put('SH', site('site-shade'), 42 - 1.25 + 6.25 + k * 13, 497.5, 0, { elevation: 2.6 });
  }

  // Trucks at the finished-goods docks and waiting in the yard.
  for (let k = 0; k < 6; k++) fit.put('T', TRUCK, 452 + k * 16, 126.45, 180);
  for (let k = 0; k < 5; k++) fit.put('T', TRUCK, 448 + k * 20, 58, 90);

  // Main gate: barriers and guard booths; flag poles on the plaza.
  fit.put('G', site('site-barrier'), 144.5, 24, 0);
  fit.put('G', site('site-barrier'), 149.5 + 0.1, 24, 180);
  fit.put('G', site('site-guard-booth'), 132, 12);
  fit.put('G', site('site-barrier'), 475, 25, 0);
  fit.put('G', site('site-barrier'), 481, 25, 180);
  fit.put('G', site('site-flag'), 100, 62);

  // Trees: avenues along the spine, the south road and the plaza; groves in the green areas.
  for (let y = 44; y <= 516; y += 12) {
    if (y > 250 && y < 274) continue;
    fit.put('TR', site('site-tree'), 288, y);
    fit.put('TR', site('site-tree'), 311.5, y);
  }
  for (let x = 44; x <= 556; x += 14) {
    if ((x > 130 && x < 186) || (x > 460 && x < 516) || (x > 280 && x < 320) || (x > 425 && x < 470)) continue;
    fit.put('TR', site('site-palm'), x, 38);
  }
  for (let x = 50; x <= 112; x += 14) for (let y = 286; y <= 372; y += 16) fit.put('TR', site('site-tree'), x, y);
  for (let x = 44; x <= 152; x += 12) for (let y = 400; y <= 452; y += 13) fit.put('TR', site('site-tree'), x, y);
  for (let x = 330; x <= 556; x += 15) fit.put('TR', site('site-palm'), x, 294);
  for (let x = 170; x <= 284; x += 14) fit.put('TR', site('site-tree'), x, 238);
  for (let x = 44; x <= 128; x += 12) { fit.put('TR', site('site-palm'), x, 226); fit.put('TR', site('site-palm'), x, 244); }

  // Street lights along the ring road and the spine (on the verge, off the carriageway).
  for (let x = 40; x <= 560; x += 30) { fit.put('L', site('site-lamp'), x, 34.5); fit.put('L', site('site-lamp'), x, 525.5); }
  for (let y = 60; y <= 500; y += 30) { fit.put('L', site('site-lamp'), 292, y + 6); fit.put('L', site('site-lamp'), 34.5, y); fit.put('L', site('site-lamp'), 565.5, y); }

  // Outdoor break shelters near the plants.
  for (const [x, y] of [[270, 350], [270, 372], [420, 245], [340, 250]] as const) fit.put('SH', site('site-shade'), x, y, 0, { elevation: 2.6 });

  const space = withDoors({
    width: W, depth: D, height: 60,
    doors: [
      { id: 'main-gate', wall: 'south', offset: m(140), width: m(14), meta: { role: 'gate' } },
      { id: 'truck-gate', wall: 'south', offset: m(470), width: m(16), meta: { role: 'gate' } },
      { id: 'emergency-gate', wall: 'east', offset: m(300), width: m(10), meta: { role: 'gate' } },
    ],
  });
  return fit.project(name, { ...space, zones, meta: { pack: 'site', company: 'samsung-egypt' } });
}

// ─── 2. Plant 1 · TV & monitor assembly hall ──────────────────────────────────────────────────

const TV_STATIONS: ReadonlyArray<readonly [ItemDefinition, number]> = [
  [station('tv-kitting', 'Panel & parts kitting rack', 'shelf', 300, 120, 200, 'source', 60), 1.2],
  [station('tv-panel-loader', 'Open-cell panel loading robot', 'machine', 260, 200, 220, 'machine'), 2],
  [station('tv-module-line', 'Backlight & module assembly conveyor · 14 m', 'conveyor', 160, 1400, 95, 'machine'), 14],
  [station('tv-set-line', 'Set assembly conveyor · 18 m', 'conveyor', 160, 1800, 95, 'machine'), 18],
  [station('tv-aging', 'Ageing (burn-in) tunnel · 45 min', 'machine', 350, 1600, 240, 'buffer', 80, { capacity: 120 }), 16],
  [station('tv-final-test', 'Final test & picture-quality booth', 'machine', 300, 400, 250, 'inspection'), 4],
  [station('tv-packing', 'Auto packing & strapping', 'machine', 260, 500, 220, 'machine'), 5],
  [station('tv-fg', 'Palletising & finished-goods handover', 'workbench', 300, 300, 110, 'sink', 60), 3],
];

export function samsungTvPlant(name = `${P}Plant 1 — TV & monitor assembly hall`): Project {
  const fit = new Fit(OFFICE_CATALOG.filter((d) => ['meeting-round-120', 'meeting-chair', 'staff-lockers', 'vending', 'kitchenette', 'desk-160', 'office-chair', 'plant', 'cabinet', 'display-75'].includes(d.id)));
  const lines: Array<[number, string]> = [[8, 'L1 · QLED & Neo QLED 55–85″'], [18, 'L2 · Crystal UHD 43–65″'], [28, 'L3 · Crystal UHD 32–50″'], [38, 'L4 · Monitors 24–32″']];
  for (const [y, label] of lines) {
    let x = 8;
    TV_STATIONS.forEach(([def, length], k) => {
      const showcase = y === 8;
      fit.put(showcase ? 'S' : `L${Math.round(y / 10) + 1}-`, def, x + length / 2, y, 270, { meta: showcase ? { step: k + 1, line: label } : { line: label } });
      x += length + 3;
    });
  }
  // Finished-goods pallets waiting for the shuttle to the warehouse.
  const tvPallet: ItemDefinition = { id: 'tv-fg-pallet', name: 'Pallet of QLED 65″ cartons', category: 'box', size: { w: cm(120), d: cm(100), h: cm(190) }, clearance: none, mass: kg(290), meta: { print: 'QLED|65″' } };
  for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) fit.put('FG', tvPallet, 98 + c * 1.6, 5 + r * 10, 0);
  // Break area along the north wall: tables, lockers, vending, tea point; line leaders' desks.
  for (let k = 0; k < 6; k++) {
    const x = 64 + k * 8;
    fit.put('BR', office('meeting-round-120'), x, 52.5);
    fit.put('BR', office('meeting-chair'), x, 51.6, 0);
    fit.put('BR', office('meeting-chair'), x, 53.4, 180);
    fit.put('BR', office('meeting-chair'), x - 0.9, 52.5, 270);
    fit.put('BR', office('meeting-chair'), x + 0.9, 52.5, 90);
  }
  for (let k = 0; k < 12; k++) fit.put('LK', office('staff-lockers'), 62 + k * 1.25, 59.6, 180);
  for (let k = 0; k < 3; k++) fit.put('VM', office('vending'), 80 + k * 1.1, 59.5, 180);
  fit.put('VM', office('kitchenette'), 86.5, 59.6, 180);
  // Line office: glass room with leaders' desks.
  fit.wall(4, 47, 20, 47, [[13, 14.2]], true, 280);
  fit.wall(20, 47.06, 20, 59.9, [], true, 280);
  for (let k = 0; k < 4; k++) {
    fit.put('LD', office('desk-160'), 6.5 + k * 3.4, 55.5);
    fit.put('LD', office('office-chair'), 6.5 + k * 3.4, 54.75);
  }
  fit.put('LD', office('display-75'), 12, 59.5, 180);
  const space = withDoors({
    width: 120, depth: 60, height: 12,
    doors: [
      { id: 'panels-in', wall: 'west', offset: m(20), width: m(5), meta: { role: 'receiving' } },
      { id: 'fg-out', wall: 'east', offset: m(22), width: m(5), meta: { role: 'shipping' } },
      { id: 'staff-1', wall: 'south', offset: m(30), width: cm(120) },
      { id: 'staff-2', wall: 'south', offset: m(70), width: cm(120) },
      { id: 'staff-3', wall: 'north', offset: m(40), width: cm(120) },
    ],
  });
  const zones = [
    region('main-aisle', 'main-aisle', 1, 43, 119, 46),
    region('fg-staging', 'staging', 96, 1, 118, 42),
    region('break-area', 'break', 58, 49, 104, 59.8),
    region('line-office', 'office', 4, 47, 20, 59.9),
  ];
  return fit.project(name, { ...space, zones, meta: { pack: 'production', company: 'samsung-egypt' } });
}

// ─── 3. Plant 2 · mobile & tablet plant (≈ 9,000 m²) ──────────────────────────────────────────

const SMT: ReadonlyArray<readonly [ItemDefinition, number]> = [
  [station('smt-loader', 'PCB loader & laser marker', 'machine', 120, 120, 160, 'source', 80), 1.2],
  [station('smt-printer', 'Solder paste printer', 'machine', 140, 130, 150, 'machine', 80), 1.3],
  [station('smt-spi', 'SPI · 3D solder paste inspection', 'machine', 120, 110, 150, 'inspection', 80), 1.1],
  [station('smt-mounter-hs', 'Chip mounter · high speed', 'machine', 160, 180, 150, 'machine', 80), 1.8],
  [station('smt-mounter-mf', 'Chip mounter · multi-function', 'machine', 160, 180, 150, 'machine', 80), 1.8],
  [station('smt-reflow', 'Reflow oven · 10 zones', 'machine', 150, 550, 150, 'machine', 80), 5.5],
  [station('smt-aoi', 'AOI · automated optical inspection', 'machine', 120, 110, 150, 'inspection', 80), 1.1],
  [station('smt-buffer', 'Board magazine buffer', 'machine', 100, 80, 120, 'buffer', 60, { capacity: 50 }), 0.8],
  [station('mob-assembly', 'Phone final assembly cell · 6 m', 'conveyor', 160, 600, 95, 'machine', 80), 6],
  [station('mob-rf-test', 'RF & function test cell', 'machine', 200, 200, 200, 'inspection', 80), 2],
  [station('mob-packing', 'Packing, IMEI labelling & sealing', 'conveyor', 160, 300, 95, 'machine', 80), 3],
  [station('mob-fg', 'Finished-goods handover', 'workbench', 120, 120, 100, 'sink', 60), 1.2],
];

export function samsungMobilePlant(name = `${P}Plant 2 — mobile & tablet assembly (≈ 9,000 m²)`): Project {
  const fit = new Fit(OFFICE_CATALOG.filter((d) => ['meeting-round-120', 'meeting-chair', 'staff-lockers', 'vending', 'kitchenette', 'desk-160', 'office-chair', 'cabinet', 'display-75'].includes(d.id)));
  // Six SMT lines in the clean room; line 1 runs through to final assembly, test and packing.
  for (let k = 0; k < 6; k++) {
    const y = 8 + k * 7;
    let x = 5;
    const stations = k === 0 ? SMT : SMT.slice(0, 8);
    stations.forEach(([def, length], s) => {
      fit.put(k === 0 ? 'S' : `M${k + 1}-`, def, x + length / 2, y, 270, { meta: k === 0 ? { step: s + 1, line: 'SMT 1 · Galaxy A-series main board' } : { line: `SMT ${k + 1}` } });
      x += length + 1.5;
    });
  }
  // Tablet assembly benches (Galaxy Tab education tablets), operators seated on ESD stools.
  for (let r = 0; r < 4; r++) for (let c = 0; c < 17; c++) {
    const x = 63 + c * 2;
    const y = 10 + r * 8;
    fit.put('TB', BENCH, x, y);
    fit.put('ST', STOOL, x, y - 0.7);
  }
  // Kitting shelves and ESD storage along the north side.
  for (let k = 0; k < 14; k++) fit.put('KS', office('cabinet'), 6 + k * 1.2, 88.6, 180);
  // Break area with lockers, vending and tables; gowning room partition.
  for (let k = 0; k < 5; k++) {
    const x = 66 + k * 6;
    fit.put('BR', office('meeting-round-120'), x, 80);
    fit.put('BR', office('meeting-chair'), x, 79.1, 0);
    fit.put('BR', office('meeting-chair'), x, 80.9, 180);
    fit.put('BR', office('meeting-chair'), x - 0.9, 80, 270);
    fit.put('BR', office('meeting-chair'), x + 0.9, 80, 90);
  }
  for (let k = 0; k < 16; k++) fit.put('LK', office('staff-lockers'), 62.6 + k * 1.25, 89.6, 180);
  for (let k = 0; k < 3; k++) fit.put('VM', office('vending'), 88 + k * 1.1, 89.5, 180);
  fit.wall(40, 60, 60, 60, [[16, 17.2]], false, 300);
  fit.wall(40, 60.06, 40, 89.94, [], false, 300);
  for (let k = 0; k < 3; k++) {
    fit.put('LD', office('desk-160'), 44 + k * 4, 68);
    fit.put('LD', office('office-chair'), 44 + k * 4, 67.25);
  }
  fit.put('LD', office('display-75'), 50, 89.5, 180);
  const space = withDoors({
    width: 100, depth: 90, height: 8,
    doors: [
      { id: 'parts-in', wall: 'west', offset: m(60), width: m(4), meta: { role: 'receiving' } },
      { id: 'fg-out', wall: 'east', offset: m(50), width: m(4), meta: { role: 'shipping' } },
      { id: 'staff-1', wall: 'south', offset: m(30), width: cm(120) },
      { id: 'staff-2', wall: 'south', offset: m(75), width: cm(120) },
    ],
  });
  const zones = [
    region('smt-clean-room', 'clean-room', 2, 3, 58, 49),
    region('tablet-assembly', 'assembly', 61, 5, 98, 40),
    region('main-aisle', 'main-aisle', 1, 51, 99, 54),
    region('esd-gowning', 'office', 40, 60, 60, 89.9),
    region('break-area', 'break', 61, 74, 98, 89.9),
  ];
  return fit.project(name, { ...space, zones, meta: { pack: 'production', company: 'samsung-egypt' } });
}

// ─── 4. Finished-goods warehouse ──────────────────────────────────────────────────────────────

/** Products made in Beni Suef, one euro pallet each; sizes and weights are typical, rounded. */
export const SAMSUNG_MATERIALS: readonly MaterialSpec[] = [
  { id: 'QA55Q60D', name: 'QLED 55″ Q60D · QA55Q60D', line: 'QLED TV', units: 12, massKg: 250, heightCm: 160, velocity: 'A', moves: 60, color: 0x1428a0, stock: 150 },
  { id: 'QA65Q60D', name: 'QLED 65″ Q60D · QA65Q60D', line: 'QLED TV', units: 8, massKg: 280, heightCm: 170, velocity: 'A', moves: 40, color: 0x2f4fd0, stock: 120 },
  { id: 'QA75QN85D', name: 'Neo QLED 75″ QN85D · QA75QN85D', line: 'Neo QLED TV', units: 5, massKg: 300, heightCm: 185, velocity: 'B', moves: 10, color: 0x4b3fb0, stock: 40 },
  { id: 'UA43DU7000', name: 'Crystal UHD 43″ DU7000 · UA43DU7000', line: 'Crystal UHD TV', units: 20, massKg: 250, heightCm: 150, velocity: 'A', moves: 85, color: 0x2e8c86, stock: 170 },
  { id: 'UA50DU7000', name: 'Crystal UHD 50″ DU7000 · UA50DU7000', line: 'Crystal UHD TV', units: 16, massKg: 270, heightCm: 155, velocity: 'A', moves: 55, color: 0x47a79e, stock: 130 },
  { id: 'UA55DU7000', name: 'Crystal UHD 55″ DU7000 · UA55DU7000', line: 'Crystal UHD TV', units: 14, massKg: 285, heightCm: 165, velocity: 'A', moves: 50, color: 0x68bfb2, stock: 140 },
  { id: 'UA65DU7000', name: 'Crystal UHD 65″ DU7000 · UA65DU7000', line: 'Crystal UHD TV', units: 8, massKg: 260, heightCm: 170, velocity: 'B', moves: 22, color: 0x8fd1c6, stock: 70 },
  { id: 'UA32T5300', name: 'HD Smart TV 32″ T5300 · UA32T5300', line: 'HD TV', units: 30, massKg: 240, heightCm: 150, velocity: 'B', moves: 18, color: 0x7a8c99, stock: 60 },
  { id: 'LS24C310', name: 'Essential monitor S3 24″ · LS24C310', line: 'Monitors', units: 40, massKg: 220, heightCm: 160, velocity: 'B', moves: 20, color: 0x9b3b4a, stock: 60 },
  { id: 'LS27CG510', name: 'Odyssey G5 27″ · LS27CG510', line: 'Monitors', units: 30, massKg: 200, heightCm: 170, velocity: 'C', moves: 7, color: 0xb85466, stock: 30 },
  { id: 'LS32CM703', name: 'Smart Monitor M7 32″ · LS32CM703', line: 'Monitors', units: 20, massKg: 210, heightCm: 170, velocity: 'C', moves: 6, color: 0xd07a88, stock: 25 },
  { id: 'SM-A165', name: 'Galaxy A16 · SM-A165 (master cartons)', line: 'Mobile', units: 480, massKg: 150, heightCm: 120, velocity: 'A', moves: 45, color: 0x26303a, stock: 60 },
  { id: 'SM-A265', name: 'Galaxy A26 · SM-A265 (master cartons)', line: 'Mobile', units: 480, massKg: 150, heightCm: 120, velocity: 'A', moves: 40, color: 0x3c4a58, stock: 55 },
  { id: 'SM-A366', name: 'Galaxy A36 · SM-A366 (master cartons)', line: 'Mobile', units: 400, massKg: 150, heightCm: 120, velocity: 'B', moves: 25, color: 0x566779, stock: 35 },
  { id: 'SM-X216', name: 'Galaxy Tab A9+ education tablets · SM-X216', line: 'Tablets', units: 200, massKg: 180, heightCm: 130, velocity: 'B', moves: 15, color: 0xc98a3c, stock: 40 },
];

export function samsungFgWarehouse(name = `${P}Finished-goods warehouse & export docks`): Project {
  const rack = { bays: 9, bayWidth: cm(270), depth: cm(110), height: cm(1000), levels: 5, positionsPerLevel: 3, uprightWidth: cm(10) };
  const ys = [10, 14.2, 18.4, 22.6, 26.8, 31, 35.2, 39.4];
  const rows = [
    ...ys.map((y, i) => ({ id: `W${String(i + 1).padStart(2, '0')}`, x: 18.5, y })),
    ...ys.map((y, i) => ({ id: `E${String(i + 1).padStart(2, '0')}`, x: 50.5, y })),
  ];
  const outbound = ['QA55Q60D', 'UA43DU7000', 'UA55DU7000', 'SM-A165', 'QA65Q60D', 'LS24C310'];
  const inbound = ['UA50DU7000', 'SM-A265', 'QA55Q60D', 'SM-X216'];
  return warehouseSite({
    name,
    width: 72, depth: 50, height: 12,
    docks: [
      { id: 'IN1', wall: 'south', offset: m(6), width: m(3.5), role: 'receiving', zone: 'inbound-docks' },
      { id: 'IN2', wall: 'south', offset: m(11), width: m(3.5), role: 'receiving', zone: 'inbound-docks' },
      { id: 'EX1', wall: 'south', offset: m(40), width: m(3.5), role: 'shipping', zone: 'export-docks' },
      { id: 'EX2', wall: 'south', offset: m(45), width: m(3.5), role: 'shipping', zone: 'export-docks' },
      { id: 'EX3', wall: 'south', offset: m(50), width: m(3.5), role: 'shipping', zone: 'export-docks' },
      { id: 'EX4', wall: 'south', offset: m(55), width: m(3.5), role: 'shipping', zone: 'export-docks' },
    ],
    zones: [
      region('inbound-docks', 'receiving', 5, 0.3, 15.5, 3.6),
      region('export-docks', 'shipping', 39, 0.3, 59.5, 3.6),
      region('inbound-staging', 'staging', 1.2, 0.8, 4.8, 7.4),
      region('export-staging', 'staging', 61, 0.8, 71.7, 7.4),
      region('dock-apron', 'main-aisle', 5, 3.6, 59.5, 8.4),
      region('west-block', 'storage', 5, 9, 31.5, 41),
      region('east-block', 'storage', 37.5, 9, 63.5, 41),
      region('cross-aisle', 'cross-aisle', 31.5, 9, 37.5, 41),
      region('mobile-cage', 'picking', 65, 9, 71.5, 38),
      region('forklift-charging', 'charging', 64, 43, 71.5, 49.5),
      region('walkway', 'pedestrian', 0.3, 9, 1.4, 49.5),
    ],
    rack,
    rows,
    floor: [
      ...palletBlock('IN', inbound, 2.1, 1.6, 3, 5, 1.1, 1.3, 90_000),
      ...palletBlock('EX', outbound, 62, 1.6, 8, 5, 1.2, 1.3, 90_000),
      forklift('FL1', 66, 46.5), forklift('FL2', 67.5, 46.5), forklift('FL3', 69, 46.5), forklift('FL4', 70.5, 46.5),
    ],
    extraCatalog: [FORKLIFT],
    fill: 0.82,
    seed: 2013_0525,
    materials: SAMSUNG_MATERIALS,
  });
}

// ─── 5. Staff transport yard (close-up of bus and car parking) ────────────────────────────────

export function samsungTransportYard(name = `${P}Staff transport yard — buses & cars`): Project {
  const fit = new Fit([...DEPOT_CATALOG, ...SITE_CATALOG]);
  const zones: Zone[] = [];
  zones.push(lane('bus-lane', 3, 30, 98, 50));
  parkingRow(fit, zones, { prefix: 'BN', y: 57, direction: 0, x0: 8, count: 21, pitch: 4.2, type: 'bus', parked: 18, vehicles: [COACH, COACH, MINIBUS, COACH] });
  parkingRow(fit, zones, { prefix: 'BS', y: 23, direction: 180, x0: 8, count: 21, pitch: 4.2, type: 'bus', parked: 17, vehicles: [COACH, MINIBUS, COACH, COACH] });
  zones.push(lane('car-lane-1', 118, 30, 178, 36), lane('car-lane-2', 118, 46, 178, 52), lane('car-lane-3', 118, 62, 178, 68));
  const rows: Array<[string, number, 0 | 180, number]> = [['CA', 27.5, 180, 22], ['CB', 38.5, 0, 24], ['CC', 43.5, 180, 21], ['CD', 54.5, 0, 23], ['CE', 59.5, 180, 19], ['CF', 70.5, 0, 16]];
  for (const [prefix, y, direction, parked] of rows) parkingRow(fit, zones, { prefix, y, direction, x0: 121, count: 21, pitch: 2.6, type: 'perpendicular', parked: parked - 6, vehicles: STAFF_CARS });
  for (let k = 0; k < 4; k++) {
    fit.put('SH', site('site-shade'), 121 - 1.25 + 6.25 + k * 13, 38.5, 0, { elevation: 2.6 });
    fit.put('SH', site('site-shade'), 121 - 1.25 + 6.25 + k * 13, 54.5, 0, { elevation: 2.6 });
  }
  // Waiting shelters where the shift walks to the turnstiles; guard booth and barriers at the gates.
  const shelter: ItemDefinition = { id: 'bus-shelter', name: 'Staff waiting shelter 12 × 4 m', category: 'canopy', size: { w: m(12), d: m(4), h: cm(20) }, clearance: none };
  for (const x of [15, 35, 55, 75]) fit.put('WS', shelter, x, 76, 0, { elevation: 2.8 });
  fit.put('G', site('site-guard-booth'), 36, 6);
  fit.put('G', site('site-barrier'), 22.5, 13, 0);
  fit.put('G', site('site-barrier'), 27.7, 13, 180);
  fit.put('G', site('site-barrier'), 152.5, 13, 0);
  fit.put('G', site('site-barrier'), 157.7, 13, 180);
  for (let x = 5; x <= 175; x += 10) if (x < 40 || x > 65) fit.put('TR', site(x % 20 === 5 ? 'site-palm' : 'site-tree'), x, 104);
  for (let y = 84; y <= 96; y += 12) for (let x = 110; x <= 170; x += 12) fit.put('TR', site('site-tree'), x, y);
  for (let x = 10; x <= 170; x += 20) fit.put('L', site('site-lamp'), x, 100);
  zones.push(region('walkway-to-turnstiles', 'footpath', 3, 80, 98, 84), region('green-north', 'green', 100, 78, 178, 108), region('green-divider', 'green', 100, 16, 116, 76), region('green-west', 'green', 3, 86, 98, 108));
  const space = withDoors({
    width: 180, depth: 110, height: 12,
    doors: [
      { id: 'gate-in', wall: 'south', offset: m(20), width: m(10), meta: { role: 'gate' } },
      { id: 'gate-out', wall: 'south', offset: m(150), width: m(10), meta: { role: 'gate' } },
      { id: 'turnstiles', wall: 'north', offset: m(50), width: m(6), meta: { role: 'gate' } },
    ],
  });
  return fit.project(name, { ...space, zones, meta: { pack: 'depot', company: 'samsung-egypt' } });
}

// ─── 6. HR department floor ───────────────────────────────────────────────────────────────────

export function samsungHrFloor(name = `${P}Administration — HR department floor`): Project {
  const fit = new Fit(OFFICE_CATALOG);
  // Partition line between the open south band and the rooms; glass on the interview and meeting rooms.
  fit.wall(0.02, 7, 12.99, 7, [[3.6, 4.7], [11.6, 12.7]]);
  fit.wall(13.01, 7, 20.99, 7, [[2.5, 3.6], [6.5, 7.6]], true);
  fit.wall(21.01, 7, 32.99, 7, [[3.6, 4.7], [10.6, 11.7]]);
  fit.wall(33.01, 7, 35.98, 7, [[0.5, 1.6]], true);
  for (const x of [5, 13, 17, 21, 26, 33]) fit.wall(x, 7.07, x, 17.97, [], x === 17);

  // Records room.
  for (let k = 0; k < 9; k++) fit.put('RC', office('cabinet'), 0.36, 8.5 + k * 0.85, 270);
  for (let k = 0; k < 9; k++) fit.put('RC', office('cabinet'), 4.62, 8.5 + k * 0.85, 90);
  fit.put('RD', office('desk-140'), 2.5, 16.9);
  fit.put('RD', office('office-chair'), 2.5, 16.2);

  // Onboarding & induction room: 3 × 4 training tables facing a screen.
  const table = TRAINING_TABLE;
  for (const x of [6.6, 9.0, 11.4]) for (const y of [9.1, 11.2, 13.3, 15.4]) {
    fit.put('OT', table, x, y);
    fit.put('OC', office('meeting-chair'), x - 0.35, y - 0.55);
    fit.put('OC', office('meeting-chair'), x + 0.35, y - 0.55);
  }
  fit.put('OS', office('display-75'), 9, 17.5, 180);

  // Two interview rooms.
  for (const x0 of [13, 17]) {
    const cx = x0 + 2;
    fit.put('IT', office('meeting-round-120'), cx, 13);
    fit.put('IC', office('meeting-chair'), cx, 12.1, 0);
    fit.put('IC', office('meeting-chair'), cx, 13.9, 180);
    fit.put('IC', office('meeting-chair'), cx + 1.15, 13, 90);
    fit.put('IP', office('plant'), x0 + 3.5, 17.5);
  }

  // HR business partner office.
  fit.put('BP', office('desk-160'), 23.5, 12.5);
  fit.put('BP', office('office-chair'), 23.5, 11.75);
  fit.put('BP', office('meeting-chair'), 23, 13.35, 180);
  fit.put('BP', office('meeting-chair'), 24, 13.35, 180);
  fit.put('BP', office('bookcase'), 23.5, 17.6, 180);
  fit.put('BP', office('plant'), 25.4, 17.4);

  // HR director's office.
  fit.put('HD', office('manager-desk'), 29.5, 13);
  fit.put('HD', office('office-chair'), 29.5, 12.2);
  fit.put('HD', office('meeting-chair'), 29, 14.1, 180);
  fit.put('HD', office('meeting-chair'), 30, 14.1, 180);
  fit.put('HD', office('sofa'), 29.5, 17.35, 180);
  fit.put('HD', office('coffee-table'), 29.5, 15.9);
  fit.put('HD', office('cabinet'), 32.6, 9, 90);
  fit.put('HD', office('plant'), 26.5, 17.4);

  // Small meeting room "Karnak".
  const slim: ItemDefinition = { id: 'meeting-table-140', name: 'Meeting table 140 × 70', category: 'table', size: { w: cm(140), d: cm(70), h: cm(75) }, clearance: none };
  fit.put('KM', slim, 35.4, 12.5, 90);
  fit.put('KM', office('meeting-chair'), 34.7, 12.1, 270);
  fit.put('KM', office('meeting-chair'), 34.7, 12.9, 270);
  fit.put('KM', office('display-75'), 34.5, 17.5, 180);

  // Reception and recruitment waiting area.
  fit.put('RE', office('desk-160'), 6.5, 4.2, 180);
  fit.put('RE', office('office-chair'), 6.5, 4.95, 180);
  fit.put('RE', office('sofa'), 2, 5.9, 180);
  fit.put('RE', office('armchair'), 0.9, 3.6, 270);
  fit.put('RE', office('coffee-table'), 2.4, 4.2);
  fit.put('RE', office('plant'), 0.5, 0.5);

  // Open-plan HR team: payroll, personnel files, training coordination, employee relations.
  for (let k = 0; k < 12; k++) {
    const x = 9.7 + k * 1.62;
    fit.put('D', office('desk-160'), x, 2.39);
    fit.put('C', office('office-chair'), x, 1.64);
    fit.put('D', office('desk-160'), x, 3.21, 180);
    fit.put('C', office('office-chair'), x, 3.96, 180);
  }
  fit.put('PR', office('printer'), 29.3, 6.2, 180);

  // Pantry and break corner.
  fit.put('PT', office('kitchenette'), 34.9, 0.35);
  fit.put('PT', office('vending'), 30.5, 6.45, 180);
  fit.put('PT', office('meeting-round-120'), 33.5, 3.3);
  fit.put('PT', office('meeting-chair'), 33.5, 4.2, 180);
  fit.put('PT', office('meeting-chair'), 33.5, 2.4, 0);
  fit.put('PT', office('meeting-chair'), 34.4, 3.3, 90);
  fit.put('PT', office('meeting-chair'), 32.6, 3.3, 270);

  const space = withDoors({
    width: 36, depth: 18, height: 3,
    doors: [
      { id: 'entrance', wall: 'south', offset: m(3), width: cm(150) },
      { id: 'fire-exit', wall: 'south', offset: m(31), width: cm(120) },
    ],
  });
  const zones = [
    region('zone-reception', 'reception', 0.1, 0.1, 8.4, 6.9),
    region('zone-open-plan', 'open-plan', 8.6, 0.1, 29.9, 6.9),
    region('zone-pantry', 'break', 30, 0.1, 35.9, 6.9),
  ];
  return fit.project(name, { ...space, zones, meta: { company: 'samsung-egypt', style: 'open-plan' } });
}

// ─── 7. Meeting & training centre ─────────────────────────────────────────────────────────────

export function samsungMeetingCentre(name = `${P}Meeting & training centre`): Project {
  const fit = new Fit(OFFICE_CATALOG);
  // Corridor y 10.5–13.5; rooms south and north of it.
  fit.wall(0.02, 10.5, 39.98, 10.5, [[8.4, 9.6], [18.4, 19.6], [20.6, 21.8], [30.5, 31.7], [32.5, 33.6], [36.5, 37.6]]);
  fit.wall(0.02, 13.5, 20.99, 13.5, [[5.5, 6.6], [12.5, 13.6], [19.5, 20.6]], true);
  fit.wall(33.01, 13.5, 39.98, 13.5, [[0.5, 1.6]], true);
  for (const x of [10, 20, 32, 36]) fit.wall(x, 0.03, x, 10.43, [], x >= 32);
  for (const x of [7, 14, 21, 33]) fit.wall(x, 13.57, x, 23.97, [], x < 21);

  // Training rooms A and B.
  for (const x0 of [0, 10]) {
    for (const cx of [2, 5, 8]) for (const y of [2.2, 4.3, 6.4]) {
      fit.put('TT', TRAINING_TABLE, x0 + cx, y);
      fit.put('TC', office('meeting-chair'), x0 + cx - 0.35, y - 0.55);
      fit.put('TC', office('meeting-chair'), x0 + cx + 0.35, y - 0.55);
    }
    fit.put('TS', office('display-75'), x0 + 5, 9.8, 180);
    fit.put('TW', office('whiteboard'), x0 + 2, 10.3, 180);
  }

  // Boardroom "Nile": 4.8 m table, 18 seats, screen on the east wall.
  fit.put('BT', office('meeting-table-240'), 24.8, 5.2);
  fit.put('BT', office('meeting-table-240'), 27.21, 5.2);
  for (let k = 0; k < 8; k++) {
    const x = 23.9 + k * 0.6;
    fit.put('BC', office('meeting-chair'), x, 4.3, 0);
    fit.put('BC', office('meeting-chair'), x, 6.1, 180);
  }
  fit.put('BC', office('meeting-chair'), 23.25, 5.2, 270);
  fit.put('BC', office('meeting-chair'), 28.76, 5.2, 90);
  fit.put('BS', office('display-75'), 31.5, 5.2, 90);
  fit.put('BP', office('plant'), 20.6, 0.6);
  fit.put('BP', office('plant'), 31.4, 0.6);
  fit.put('BK', office('cabinet'), 26, 0.36, 0);

  // Huddle rooms.
  for (const x0 of [32, 36]) {
    const cx = x0 + 2;
    fit.put('HT', office('meeting-round-120'), cx, 5);
    fit.put('HS', office('display-75'), cx, 0.4);
    fit.put('HC', office('meeting-chair'), cx, 5.9, 180);
    fit.put('HC', office('meeting-chair'), cx - 0.9, 5, 270);
    fit.put('HC', office('meeting-chair'), cx + 0.9, 5, 90);
  }

  // Meeting rooms Luxor, Aswan, Siwa: 8 seats around a 2.4 m table, screen on the north wall.
  for (const x0 of [0, 7, 14]) {
    const cx = x0 + 3.5;
    fit.put('MT', office('meeting-table-240'), cx, 19, 90);
    for (const y of [18.3, 19, 19.7]) {
      fit.put('MC', office('meeting-chair'), cx - 0.95, y, 270);
      fit.put('MC', office('meeting-chair'), cx + 0.95, y, 90);
    }
    fit.put('MC', office('meeting-chair'), cx, 20.55, 180);
    fit.put('MC', office('meeting-chair'), cx, 17.45, 0);
    fit.put('MS', office('display-75'), cx, 23.5, 180);
  }

  // Lobby and breakout lounge, open to the corridor.
  for (const [x, y, r] of [[24, 17, 0], [24, 21.2, 180], [30, 17, 0], [30, 21.2, 180]] as const) fit.put('LS', office('sofa'), x, y, r);
  fit.put('LT', office('coffee-table'), 24, 19.1);
  fit.put('LT', office('coffee-table'), 30, 19.1);
  fit.put('LA', office('armchair'), 21.8, 19.1, 270);
  fit.put('LA', office('armchair'), 32.2, 19.1, 90);
  fit.put('LK', office('kitchenette'), 27, 23.6, 180);
  fit.put('LV', office('vending'), 22, 23.5, 180);
  fit.put('LV', office('vending'), 23.1, 23.5, 180);
  fit.put('LP', office('plant'), 21.5, 14.2);
  fit.put('LP', office('plant'), 32.5, 14.2);

  // Video-conference room.
  fit.put('VT', office('meeting-table-240'), 36.5, 19);
  for (const x of [35.8, 36.5, 37.2]) {
    fit.put('VC', office('meeting-chair'), x, 18.1, 0);
    fit.put('VC', office('meeting-chair'), x, 19.9, 180);
  }
  fit.put('VS', office('display-75'), 36.5, 23.5, 180);

  const space = withDoors({
    width: 40, depth: 24, height: 3.2,
    doors: [
      { id: 'lobby-entrance', wall: 'west', offset: m(10.8), width: m(2.4) },
      { id: 'fire-exit-east', wall: 'east', offset: m(11.4), width: cm(120) },
    ],
  });
  const zones = [region('corridor', 'corridor', 0.1, 10.6, 39.9, 13.4), region('lobby', 'lounge', 21.1, 13.6, 32.9, 23.9)];
  return fit.project(name, { ...space, zones, meta: { company: 'samsung-egypt', style: 'meeting' } });
}

// ─── 8. Events hall (town hall, awards night) ─────────────────────────────────────────────────

export function samsungEventsHall(name = `${P}Events hall — annual awards night, 450 guests`): Project {
  const fit = new Fit(STARTER_CATALOG);
  fit.put('ST', hall('stage-6x3'), 21, 29.5, 180);
  fit.put('ST', hall('stage-6x3'), 27.01, 29.5, 180);
  fit.put('SC', hall('screen'), 14, 31.5, 180);
  fit.put('SC', hall('screen'), 34, 31.5, 180);
  fit.put('SP', hall('speaker'), 17.4, 29);
  fit.put('SP', hall('speaker'), 30.6, 29);
  fit.put('LE', hall('lectern'), 26.6, 29.9, 180, { elevation: 0.6 });
  for (const x of [16, 19, 29, 32]) fit.put('VIP', hall('sofa'), x, 24.8);
  const chairs = 10;
  for (let c = 0; c < 9; c++) for (let r = 0; r < 5; r++) {
    const x = 5.5 + c * 4.2;
    const y = 5 + r * 4.2;
    fit.put('T', hall('round-180'), x, y);
    for (let k = 0; k < chairs; k++) {
      const a = (k / chairs) * 2 * Math.PI;
      const cx = x + Math.sin(a) * 1.22;
      const cy = y - Math.cos(a) * 1.22;
      // The chair faces the table centre: its front (+Y at 0°) turned toward (x, y).
      fit.put('C', hall('chair'), Math.round(cx * 1000) / 1000, Math.round(cy * 1000) / 1000, (k / chairs) * 360);
    }
  }
  for (const y of [8, 12.1, 16.2, 20.3]) fit.put('BF', hall('buffet-hot'), 46.4, y, 90);
  fit.put('PB', hall('backdrop'), 1, 16, 270);
  fit.put('DJ', hall('dj'), 16, 1.2);
  for (const [x, y] of [[0.6, 0.6], [47.4, 0.6], [0.6, 31.4], [47.4, 31.4]] as const) fit.put('PL', hall('plant'), x, y);
  const space = withDoors({
    width: 48, depth: 32, height: 8,
    doors: [
      { id: 'door-west', wall: 'south', offset: m(8), width: cm(180) },
      { id: 'door-main', wall: 'south', offset: m(23.1), width: cm(180) },
      { id: 'door-east', wall: 'south', offset: m(38.2), width: cm(180) },
      { id: 'service', wall: 'north', offset: m(44), width: cm(120) },
    ],
  });
  return fit.project(name, { ...space, meta: { company: 'samsung-egypt', style: 'banquet' } });
}

// ─── 9. Staff canteen and break areas ─────────────────────────────────────────────────────────

export function samsungCanteen(name = `${P}Staff canteen & break areas`): Project {
  const fit = new Fit([...TABLE_CATALOG, hall('buffet-hot')]);
  const communal = byId(TABLE_CATALOG, 'table-communal-10');
  const four = byId(TABLE_CATALOG, 'table-4top');
  const six = byId(TABLE_CATALOG, 'table-6top');
  for (let c = 0; c < 7; c++) for (let r = 0; r < 9; r++) fit.put('T', communal, 5 + c * 4.2, 4 + r * 2.7);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) fit.put('P', four, 38 + c * 2.4, 5 + r * 2.4);
  for (let c = 0; c < 8; c++) for (let r = 0; r < 4; r++) fit.put('S', six, 38 + c * 3, 19 + r * 3.1);
  // Serving counters either side of the kitchen pass.
  for (const x of [19.5, 22.6, 25.7, 36.4, 39.5, 42.6]) fit.put('SV', hall('buffet-hot'), x, 37.5, 180);
  // Break lounge: sofas round a screen, vending along the east wall.
  fit.put('BL', office('display-75'), 56, 14.4, 180);
  for (const [x, y, r] of [[53, 9, 0], [59, 9, 0], [53, 5.2, 0], [59, 5.2, 0]] as const) fit.put('BL', office('sofa'), x, y, r);
  fit.put('BL', office('coffee-table'), 56, 7.1);
  for (let k = 0; k < 4; k++) fit.put('VM', office('vending'), 63.5, 3 + k * 1.1, 90);
  fit.put('WC', office('kitchenette'), 63.6, 9, 90);
  for (const [x, y] of [[0.6, 0.6], [63.4, 39.4], [0.6, 39.4], [34.2, 0.6]] as const) fit.put('PL', office('plant'), x, y);
  const space = withDoors({
    width: 64, depth: 40, height: 5,
    doors: [
      { id: 'entrance-west', wall: 'south', offset: m(10), width: m(2), meta: { role: 'entrance' } },
      { id: 'entrance-east', wall: 'south', offset: m(52), width: m(2), meta: { role: 'entrance' } },
      { id: 'pass', wall: 'north', offset: m(30), width: cm(240), meta: { role: 'pass' } },
      { id: 'fire-exit-west', wall: 'west', offset: m(20), width: cm(120) },
      { id: 'fire-exit-east', wall: 'east', offset: m(24), width: cm(120) },
    ],
  });
  const zones = [
    region('main-dining', 'dining', 1, 1, 33.5, 27),
    region('guest-dining', 'private', 36, 3, 48, 15),
    region('break-lounge', 'lounge', 50, 1.5, 62, 15.5),
    region('family-dining', 'dining', 36, 17, 63, 33),
    region('serving-line', 'service', 17, 35, 45, 39.8),
  ];
  return fit.project(name, { ...space, zones, meta: { pack: 'restaurant', company: 'samsung-egypt', style: 'quick-service' } });
}

// ─── 10. Export container ─────────────────────────────────────────────────────────────────────

export function samsungExportContainer(): Project {
  const tv = { stackable: true, allowTilt: false };
  const project = loadedContainer(`${P}Export 40′HC — Made in Egypt TVs & monitors (Beni Suef → Alexandria → Mombasa)`, '40hc', [
    { id: 'tv-qn75', name: 'Neo QLED 75″ QN85D carton', size: [182, 20, 112], massKg: 42, quantity: 20, meta: { stackable: false, allowTilt: false, print: 'Neo QLED|75″' } },
    { id: 'tv-q65', name: 'QLED 65″ Q60D carton', size: [158, 17, 98], massKg: 27, quantity: 90, meta: { ...tv, maxLoadOnTop: kg(30), print: 'QLED|65″' } },
    { id: 'tv-du55', name: 'Crystal UHD 55″ DU7000 carton', size: [136, 14, 85], massKg: 17, quantity: 150, meta: { ...tv, maxLoadOnTop: kg(40), print: 'Crystal UHD|55″' } },
    { id: 'mon-27', name: 'Odyssey G5 27″ monitor carton', size: [70, 17, 48], massKg: 7, quantity: 120, meta: { stackable: true, allowTilt: true, maxLoadOnTop: kg(35), print: 'Odyssey|27″' } },
  ], 'largest-first');
  return { ...project, space: { ...project.space, meta: { ...project.space.meta, company: 'samsung-egypt' } } };
}

/** The whole Samsung sample, in the order it should appear. */
export function samsungSample(): SampleProject[] {
  return [
    { project: samsungCampus(), summary: 'Samsung sample: Beni Suef campus site plan' },
    { project: samsungTvPlant(), summary: 'Samsung sample: TV & monitor assembly hall' },
    { project: samsungMobilePlant(), summary: 'Samsung sample: mobile & tablet plant' },
    { project: samsungFgWarehouse(), summary: 'Samsung sample: finished-goods warehouse' },
    { project: samsungTransportYard(), summary: 'Samsung sample: staff transport yard' },
    { project: samsungHrFloor(), summary: 'Samsung sample: HR department floor' },
    { project: samsungMeetingCentre(), summary: 'Samsung sample: meeting & training centre' },
    { project: samsungEventsHall(), summary: 'Samsung sample: events hall' },
    { project: samsungCanteen(), summary: 'Samsung sample: staff canteen & break areas' },
    { project: samsungExportContainer(), summary: 'Samsung sample: export container' },
  ];
}
