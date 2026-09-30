import type { ItemDefinition, ItemInstance, Meta, Project, Zone } from '@space-planner/core';
import { cm, m, none, region } from './sampleKit.js';
import { newProductionLine } from './production.js';
import type { SampleProject } from './samples.js';

/**
 * Nile Vision Electronics (plan 40-SPACE-PLANNER WP-S4): the fictional TV plant of the whole ecosystem demo, as it stands in
 * `complete-company/scenario` (company NVE, plant EG-NV1, lines SMT-1, THT-1, FA-1, FA-2; a station is `<line>-<operation>`).
 * Every station and area carries `eco.code` (the GMES code), so the link panel can tag the whole plan in one step once the
 * plant tree has been imported ("Link by code"). The tag itself (`eco.ref`) is added then, not here: the ids belong to GMES.
 * Illustrative layout built from the scenario book's stations, not a survey.
 */

export const NILE_VISION_COMPANY = 'Nile Vision Electronics';

type Kind = 'work' | 'test' | 'inspection' | 'pack';
/** Final assembly operations, in flow order: code, name, kind, length along the line in metres. The aging conveyor (30 min dwell) is the long one. */
export const FA_STATIONS: ReadonlyArray<readonly [string, string, Kind, number]> = [
  ['CHS', 'Chassis loading + serial label', 'work', 2], ['LED', 'LED bar mounting', 'work', 2], ['BLT', 'BLU lighting test', 'test', 2], ['OPT', 'Optical films, clean booth', 'work', 2],
  ['OCM', 'Open cell mounting', 'work', 2], ['FLP', 'Flipper', 'work', 2], ['BRD', 'Main board and power board', 'work', 2], ['BCV', 'Back cover and screwing', 'work', 2],
  ['SWD', 'Power-on and software download', 'test', 2], ['AGE', 'In-line aging 30 min', 'test', 10], ['WB', 'White balance', 'test', 2], ['FT', 'Function test', 'test', 2],
  ['HPT', 'Hi-pot test', 'test', 2], ['VIS', 'Final visual', 'inspection', 2], ['ACC', 'Accessories', 'work', 2], ['PKG', 'Packing', 'pack', 2],
  ['WCK', 'Check weigher', 'inspection', 2], ['PAL', 'Palletizing', 'pack', 2],
];
export const SMT_STATIONS: ReadonlyArray<readonly [string, string, Kind]> = [
  ['LDR', 'Board loader', 'work'], ['SPP', 'Solder paste printer', 'work'], ['SPI', '3D paste inspection', 'inspection'], ['MT1', 'Chip mounter', 'work'], ['MT2', 'Flexible mounter', 'work'],
  ['RFL', 'Reflow oven', 'work'], ['AOI', 'Optical inspection', 'inspection'], ['ICT', 'In-circuit test', 'test'], ['FCT', 'Function test', 'test'],
];
export const THT_STATIONS: ReadonlyArray<readonly [string, string, Kind]> = [
  ['INS', 'Manual insertion', 'work'], ['WAV', 'Wave solder', 'work'], ['TUP', 'Touch-up and visual', 'inspection'], ['ICT', 'In-circuit test', 'test'], ['HPT', 'Hi-pot test', 'test'], ['BRN', 'Burn-in rack', 'test'],
];

const GAP = 3; // metres between stations along a line: room for the material handler to pass (see flowPoints)

/** What the production pack calls the station's role (source at the start, sink at the end, tests and inspections between). */
const roleOf = (kind: Kind, index: number, last: number): string => (index === 0 ? 'source' : index === last ? 'sink' : kind === 'test' || kind === 'inspection' ? 'inspection' : 'machine');

const stationDefinition = (id: string, name: string, kind: string, along: number): ItemDefinition => ({
  id, name, category: 'box', size: { w: m(2.6), d: m(along), h: m(2.2) }, clearance: { ...none, front: cm(0) }, meta: { kind },
});

interface Row { readonly line: string; readonly y: number; readonly x0: number; readonly stations: ReadonlyArray<{ code: string; name: string; kind: Kind; along: number }> }

/** A production floor with rows of stations (and one repair bench per row): items, catalog and the zone of each line. */
function stationFloor(name: string, width: number, depth: number, rows: readonly Row[], repairAt: ReadonlyArray<readonly [number, number]>): Project {
  const base = newProductionLine(name, width, depth, 7);
  const catalog: Record<string, ItemDefinition> = { ...base.catalog };
  const items: Record<string, ItemInstance> = {};
  const zones: Zone[] = [];
  rows.forEach((row, r) => {
    let x = row.x0;
    row.stations.forEach((s, i) => {
      const id = `${row.line}-${s.code}`;
      catalog[`type-${id}`] = stationDefinition(`type-${id}`, `${row.line} ${s.name}`, roleOf(s.kind, i, row.stations.length - 1), s.along);
      // rotated 270° the station's depth runs along the line (east), as in the reference line
      const meta: Meta = { step: i + 1, 'eco.code': id, 'eco.type': 'station' };
      items[id] = { id, definitionId: `type-${id}`, position: { x: m(x + s.along / 2), y: m(row.y) }, rotation: 270_000, locked: false, meta };
      x += s.along + GAP;
    });
    const [rx, ry] = repairAt[r]!;
    const repair = `${row.line}-RPR`;
    catalog[`type-${repair}`] = stationDefinition(`type-${repair}`, `${row.line} Repair bench`, 'buffer', 3);
    items[repair] = { id: repair, definitionId: `type-${repair}`, position: { x: m(rx), y: m(ry) }, rotation: 270_000, locked: false, meta: { 'eco.code': repair, 'eco.type': 'station' } };
    zones.push({ ...region(`Z-${row.line}`, 'line', row.x0 - 1, row.y - 3, x, row.y + 3), meta: { 'eco.code': row.line, 'eco.type': 'line' } });
  });
  return { ...base, catalog, items, space: { ...base.space, zones } };
}

const fa = (along?: (code: string) => number) => FA_STATIONS.map(([code, name, kind, length]) => ({ code, name, kind, along: along ? along(code) : length }));

/** Final assembly hall: FA-1 (43-55") and FA-2 (55-65") side by side, 18 stations each in flow order, a repair bench under each. */
export function nileVisionFinalAssembly(): Project {
  return stationFloor('Nile Vision · Final assembly hall (FA-1, FA-2)', 110, 50, [
    { line: 'FA-1', y: 14, x0: 5, stations: fa() },
    { line: 'FA-2', y: 36, x0: 5, stations: fa() },
  ], [[60, 22], [60, 44]]);
}

/** SMT line and THT cell: the boards that final assembly mounts. */
export function nileVisionBoards(): Project {
  const rowOf = (line: string, y: number, stations: ReadonlyArray<readonly [string, string, Kind]>): Row => ({ line, y, x0: 4, stations: stations.map(([code, name, kind]) => ({ code, name, kind, along: 2 })) });
  return stationFloor('Nile Vision · SMT line and THT cell', 56, 30, [rowOf('SMT-1', 8, SMT_STATIONS), rowOf('THT-1', 21, THT_STATIONS)], [[50, 13], [40, 26]]);
}

/** Areas of the plant (from the book's layout): zones tagged with their GMES area code, storage and docks as blocks. */
const AREAS: ReadonlyArray<readonly [string, string, number, number, number, number]> = [
  ['A-OFF', 'Offices, training room, clinic, canteen', 0, 0, 30, 18], ['A-FA', 'Final assembly hall', 32, 8, 100, 50], ['A-RMW', 'Raw material warehouse', 0, 20, 30, 50],
  ['A-RCV', 'Receiving dock and IQC', 0, 70, 30, 18], ['A-SMT', 'SMT and THT area (ESD protected)', 32, 62, 40, 26], ['A-QA', 'OQC, ORT aging room, quality lab', 74, 62, 26, 26],
  ['A-MNT', 'Maintenance workshop', 102, 62, 30, 26], ['A-FGW', 'Finished goods warehouse and shipping', 134, 8, 24, 80],
];
const BLOCKS: ReadonlyArray<readonly [string, string, number, number, number, number, number]> = [
  ['WH-RM', 'Raw material and packaging racks', 2, 22, 26, 46, 6], ['QA-HOLD', 'Quarantine cage', 2, 72, 10, 8, 2.5], ['IQC-BENCH', 'IQC bench and panel lighting test', 14, 72, 14, 8, 2.5],
  ['WH-SF', 'Semi-finished board supermarket', 60, 76, 10, 8, 2.5], ['WH-FG', 'Finished goods block stacking and racking', 136, 20, 20, 60, 6], ['WH-RTN', 'Customer returns', 136, 10, 10, 8, 2.5],
  ['WH-SCR', 'Scrap and return to vendor', 146, 10, 10, 8, 2.5], ['DOCK-OUT', 'Shipping docks', 146, 82, 10, 5, 2.5], ['DOCK-IN', 'Receiving docks', 0, 88, 30, 2, 2.5],
  ['QA-ORT', 'ORT aging room', 76, 64, 12, 10, 2.5], ['QA-OQC', 'OQC AQL table', 90, 64, 10, 10, 2.5],
];

/** The whole plant 160 × 90 m, flow from receiving in the west to shipping in the east. */
export function nileVisionPlant(): Project {
  const base = newProductionLine('Nile Vision · Plant EG-NV1 (160 × 90 m)', 160, 90, 10);
  const zones: Zone[] = AREAS.map(([code, , x, y, w, d]) => ({ ...region(`Z-${code}`, 'area', x, y, x + w, y + d), meta: { 'eco.code': code, 'eco.type': 'area' } }));
  const catalog: Record<string, ItemDefinition> = { ...base.catalog };
  const items: Record<string, ItemInstance> = {};
  for (const [code, name, x, y, w, d, h] of BLOCKS) {
    catalog[`type-${code}`] = { id: `type-${code}`, name, category: 'box', size: { w: m(w), d: m(d), h: m(h) }, clearance: none };
    items[code] = { id: code, definitionId: `type-${code}`, position: { x: m(x + w / 2), y: m(y + d / 2) }, rotation: 0, locked: false, meta: { 'eco.code': code } };
  }
  return { ...base, catalog, items, space: { ...base.space, zones } };
}

export function nileVisionSample(): SampleProject[] {
  return [
    { project: nileVisionPlant(), summary: 'Sample company: the plant, areas and storage' },
    { project: nileVisionFinalAssembly(), summary: 'Sample company: final assembly lines FA-1 and FA-2' },
    { project: nileVisionBoards(), summary: 'Sample company: SMT line and THT cell' },
  ];
}
