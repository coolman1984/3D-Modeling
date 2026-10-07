import {
  containsPolygon,
  createProject,
  fromUnit,
  itemPolygon,
  polygonsOverlap,
  rotate,
  roomSpace,
  type Id,
  type ItemDefinition,
  type ItemInstance,
  type Meta,
  type Project,
  type Tick,
  type Vec2,
  type Zone,
} from '@space-planner/core';
import { walkwayRule, type RuleResult } from './rules.js';

/**
 * Home pack: apartments furnished for interior design. Real furniture sizes, the room each
 * piece needs in use (pull a chair out, open a wardrobe, walk round a bed), finishes as variants,
 * and three ready apartments. Built only on the core's public entry point (decision 0027).
 *
 * Meta on item types (read by the 3D view and the editor, never by the core):
 * - `fabric`: upholstery colour (0xRRGGBB); `wood`: oak | walnut | white | black;
 * - `art`: seed of the generated picture on wall art;
 * - `mount: 'wall'` with `elevation` (ticks): placed on a wall at that height, front to the room.
 */

const m = (v: number) => fromUnit(v, 'm');
const cm = (v: number) => fromUnit(v, 'cm');
const none = { front: 0, back: 0, left: 0, right: 0 };
const front = (v: number) => ({ ...none, front: cm(v) });

/** Upholstery colours designers ask for first: warm neutrals and two earthy accents. */
export const FABRICS = {
  linen: 0xd9cfbf,
  cream: 0xeee7da,
  boucle: 0xf1ece2,
  charcoal: 0x45474b,
  sage: 0x9aa58c,
  terracotta: 0xb8694a,
  navy: 0x2f3c55,
  ochre: 0xc49a45,
} as const;
export type Fabric = keyof typeof FABRICS;

function item(id: string, name: string, category: string, w: number, d: number, h: number, clearance = none, extra: { seats?: number; round?: boolean; surface?: boolean; meta?: Meta } = {}): ItemDefinition {
  return {
    id,
    name,
    category,
    size: { w: cm(w), d: cm(d), h: cm(h) },
    clearance,
    ...(extra.seats ? { seats: extra.seats } : {}),
    ...(extra.round ? { footprint: 'round' as const } : {}),
    ...(extra.surface ? { surface: true as const } : {}),
    ...(extra.meta ? { meta: extra.meta } : {}),
  };
}

const wall = (elevationCm: number, more: Meta = {}): Meta => ({ mount: 'wall', elevation: cm(elevationCm), ...more });

/**
 * The home catalog. Clearances follow common residential planning guidance (decision 0027):
 * 40–45 cm between a sofa and its coffee table, 60 cm to walk past a bed or a chair, 75 cm to pull
 * a dining chair out, 90 cm in front of a wardrobe or kitchen run, 60 cm in front of bathroom
 * fittings. Dining sets include their chairs, so the footprint is the table with chairs tucked in.
 * A TV keeps no clearance: viewing distance is advice, not a zone that must stay empty. The arc
 * lamp's head reaches over the sofa in 3D; only its base stands on the floor.
 */
export const HOME_CATALOG: readonly ItemDefinition[] = [
  // Living
  item('home-sofa-linen', 'Sofa Lena · 3 seats · linen', 'sofa', 220, 95, 82, front(40), { seats: 3, meta: { fabric: FABRICS.linen, wood: 'oak' } }),
  item('home-sofa-sage', 'Sofa Lena · 3 seats · sage', 'sofa', 220, 95, 82, front(40), { seats: 3, meta: { fabric: FABRICS.sage, wood: 'walnut' } }),
  item('home-sofa-charcoal', 'Sofa Lena · 3 seats · charcoal', 'sofa', 220, 95, 82, front(40), { seats: 3, meta: { fabric: FABRICS.charcoal, wood: 'black' } }),
  item('home-loveseat', 'Loveseat Lena · 2 seats · cream', 'sofa', 160, 90, 82, front(40), { seats: 2, meta: { fabric: FABRICS.cream, wood: 'oak' } }),
  item('home-sectional', 'Corner sofa Lena · 280 × 200 · linen', 'sectional', 280, 200, 82, front(40), { seats: 5, meta: { fabric: FABRICS.linen, wood: 'oak' } }),
  item('home-armchair-terracotta', 'Armchair Oslo · terracotta', 'armchair', 78, 82, 78, front(40), { seats: 1, meta: { fabric: FABRICS.terracotta, wood: 'walnut' } }),
  item('home-armchair-boucle', 'Armchair Oslo · bouclé', 'armchair', 78, 82, 78, front(40), { seats: 1, meta: { fabric: FABRICS.boucle, wood: 'oak' } }),
  item('home-coffee-oak', 'Coffee table · oak · 120 × 60', 'coffee-table', 120, 60, 40, none, { meta: { wood: 'oak' } }),
  item('home-coffee-marble', 'Coffee table · marble · Ø 90', 'coffee-table', 90, 90, 38, none, { round: true, meta: { wood: 'marble' } }),
  item('home-side-table', 'Side table · walnut · Ø 45', 'side-table', 45, 45, 55, none, { round: true, meta: { wood: 'walnut' } }),
  item('home-tv-unit', 'TV unit · oak · 180 with 65″ TV', 'tv-unit', 180, 42, 50, none, { meta: { wood: 'oak' } }),
  item('home-bookcase', 'Bookcase · walnut · 100 × 35', 'bookcase', 100, 35, 200, front(60), { meta: { wood: 'walnut' } }),
  item('home-rug-cream', 'Rug · wool · 240 × 170 · cream', 'rug', 240, 170, 1, none, { surface: true, meta: { fabric: FABRICS.cream, art: 3 } }),
  item('home-rug-terracotta', 'Rug · wool · 300 × 200 · terracotta', 'rug', 300, 200, 1, none, { surface: true, meta: { fabric: FABRICS.terracotta, art: 7 } }),
  item('home-rug-round', 'Rug · round · Ø 200 · sage', 'rug', 200, 200, 1, none, { round: true, surface: true, meta: { fabric: FABRICS.sage, art: 11 } }),
  item('home-floor-lamp-arc', 'Floor lamp · arc · brass', 'floor-lamp', 40, 40, 200, none, { meta: { style: 'arc' } }),
  item('home-floor-lamp', 'Floor lamp · linen shade', 'floor-lamp', 45, 45, 165, none, { round: true, meta: { style: 'tripod' } }),
  item('home-plant-fig', 'Plant · fiddle-leaf fig', 'house-plant', 55, 55, 170, none, { round: true, meta: { style: 'fig' } }),
  item('home-plant-snake', 'Plant · snake plant', 'house-plant', 35, 35, 80, none, { round: true, meta: { style: 'snake' } }),
  item('home-curtains', 'Curtains · linen · 240', 'curtains', 240, 12, 250, none, { meta: { fabric: FABRICS.linen } }),
  // Walls
  item('home-art-90', 'Wall art · 90 × 60', 'wall-art', 90, 4, 60, none, { meta: wall(130, { art: 1 }) }),
  item('home-art-60', 'Wall art · 60 × 80', 'wall-art', 60, 4, 80, none, { meta: wall(120, { art: 5 }) }),
  item('home-art-trio', 'Wall art · set of three', 'wall-art', 150, 4, 50, none, { meta: wall(135, { art: 9 }) }),
  item('home-mirror', 'Mirror · arched · 60 × 100', 'mirror', 60, 4, 100, none, { meta: wall(110) }),
  item('home-tv-wall', 'TV 65″ · on the wall', 'wall-tv', 145, 6, 84, none, { meta: wall(95) }),
  item('home-shelf', 'Wall shelf · oak · 120', 'wall-shelf', 120, 25, 4, none, { meta: wall(150, { wood: 'oak' }) }),
  // Dining
  item('home-dining-6', 'Dining set · oak · 6 seats', 'dining-set', 180, 200, 76, { front: cm(30), back: cm(30), left: cm(60), right: cm(60) }, { seats: 6, meta: { wood: 'oak', fabric: FABRICS.cream } }),
  item('home-dining-4', 'Dining set · walnut · 4 seats', 'dining-set', 140, 190, 76, { front: cm(30), back: cm(30), left: cm(60), right: cm(60) }, { seats: 4, meta: { wood: 'walnut', fabric: FABRICS.linen } }),
  item('home-dining-round', 'Dining set · round · 4 seats', 'dining-set', 190, 190, 76, { front: cm(30), back: cm(30), left: cm(30), right: cm(30) }, { seats: 4, round: true, meta: { wood: 'white', fabric: FABRICS.sage } }),
  item('home-sideboard', 'Sideboard · walnut · 180', 'sideboard', 180, 45, 75, front(70), { meta: { wood: 'walnut' } }),
  item('home-pendant', 'Pendant light · Ø 50', 'pendant', 50, 50, 40, none, { round: true, meta: { mount: 'ceiling' } }),
  // Bedroom
  item('home-bed-king', 'Bed · king · 180 × 200', 'bed', 190, 215, 100, front(60), { meta: { fabric: FABRICS.linen, wood: 'oak', size: 'king' } }),
  item('home-bed-queen', 'Bed · queen · 160 × 200', 'bed', 170, 215, 100, front(60), { meta: { fabric: FABRICS.sage, wood: 'walnut', size: 'queen' } }),
  item('home-bed-single', 'Bed · single · 90 × 200', 'bed', 100, 210, 90, front(50), { meta: { fabric: FABRICS.ochre, wood: 'white', size: 'single' } }),
  item('home-nightstand', 'Nightstand with lamp', 'nightstand', 50, 40, 55, none, { meta: { wood: 'oak' } }),
  item('home-wardrobe-2', 'Wardrobe · 2 doors · 100', 'wardrobe', 100, 60, 220, front(90), { meta: { wood: 'white' } }),
  item('home-wardrobe-3', 'Wardrobe · 3 doors · 150', 'wardrobe', 150, 60, 220, front(90), { meta: { wood: 'oak' } }),
  item('home-dresser', 'Dresser · 6 drawers · 120', 'dresser', 120, 50, 80, front(80), { meta: { wood: 'walnut' } }),
  item('home-desk', 'Desk · oak · 120 × 60', 'desk', 120, 60, 75, none, { meta: { wood: 'oak' } }),
  item('home-desk-chair', 'Desk chair', 'chair', 55, 55, 85, { ...none, back: cm(60) }, { seats: 1 }),
  // Kitchen
  item('home-kitchen-300', 'Kitchen run · 300 · sink and hob', 'kitchen', 300, 62, 220, front(100), { meta: { wood: 'white' } }),
  item('home-kitchen-240', 'Kitchen run · 240 · sink and hob', 'kitchen', 240, 62, 220, front(100), { meta: { wood: 'oak' } }),
  item('home-island', 'Kitchen island · 180 × 90 · 3 stools', 'island', 180, 90, 92, { ...none, front: cm(90), back: cm(100) }, { seats: 3, meta: { wood: 'marble' } }),
  item('home-fridge', 'Fridge · 70 cm', 'fridge', 70, 68, 190, front(100)),
  // Bathroom
  item('home-bathtub', 'Bathtub · 170 × 75', 'bathtub', 170, 75, 58, front(70)),
  item('home-shower', 'Shower · glass · 90 × 90', 'shower', 90, 90, 210, front(60)),
  item('home-toilet', 'Toilet · wall-hung', 'toilet', 40, 55, 80, front(60)),
  item('home-basin', 'Vanity basin · 80', 'basin', 80, 48, 85, front(70), { meta: { wood: 'oak' } }),
  item('home-washer', 'Washing machine', 'washer', 60, 60, 85, front(90)),
  // Fit-out: interior walls are partitions; a gap between two is a doorway.
  item('home-wall-100', 'Interior wall · 1 m', 'wall', 100, 10, 270),
  item('home-wall-200', 'Interior wall · 2 m', 'wall', 200, 10, 270),
  item('home-wall-300', 'Interior wall · 3 m', 'wall', 300, 10, 270),
];

const CATALOG_BY_ID = new Map(HOME_CATALOG.map((d) => [d.id, d]));

export type HomeStyle = 'apartment';
export const HOME_STYLES: readonly { readonly id: HomeStyle; readonly label: string }[] = [{ id: 'apartment', label: 'Apartment' }];

export const isHome = (project: Project): boolean => project.space.meta?.pack === 'home';

/** Room-name zones in an apartment: drawn and labelled, never checked against. */
export const HOME_ROOM_KINDS = ['living', 'dining', 'kitchen', 'bedroom', 'bathroom', 'hall', 'study'] as const;

/** Clear width a person needs to walk from every seat to the front door (common guidance). */
export const HOME_WALKWAY = cm(80);
/** Free strip beside a bed so someone can get in and make it (common guidance). */
export const BED_ACCESS = cm(60);
/** The bed's head end where nightstands stand; the strip starts after it. */
const BED_HEAD = cm(55);

/**
 * Every bed can be reached along at least one long side: a 60 cm strip from past the nightstand
 * to the foot, inside the room and clear of every other item standing on the floor. Rugs and
 * things hung above 90 cm do not block it.
 */
export function bedAccessRule(project: Project): RuleResult {
  const items = Object.values(project.items).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const beds = items.filter((i) => project.catalog[i.definitionId]?.category === 'bed');
  if (beds.length === 0) return { code: 'bed-access', unit: 'beds', status: 'unknown', reason: 'no-beds', entityIds: [] };
  const blocked: Id[] = [];
  for (const bed of beds) {
    const def = project.catalog[bed.definitionId]!;
    const sides = [1, -1].map((side) => strip(bed, def, side));
    const free = sides.some((polygon) => containsPolygon(project.space.boundary, polygon) && !items.some((other) => other.id !== bed.id && blocks(project, other, polygon)));
    if (!free) blocked.push(bed.id);
  }
  return { code: 'bed-access', unit: 'beds', required: beds.length, measured: beds.length - blocked.length, status: blocked.length === 0 ? 'pass' : 'fail', entityIds: blocked };
}

function strip(bed: ItemInstance, def: ItemDefinition, side: number): Vec2[] {
  const w = def.size.w / 2;
  const d = def.size.d / 2;
  const x0 = side > 0 ? w : -w - BED_ACCESS;
  const x1 = side > 0 ? w + BED_ACCESS : -w;
  // Local +y is the front (the foot of the bed); the head is at −y.
  const local: Vec2[] = [{ x: x0, y: -d + BED_HEAD }, { x: x1, y: -d + BED_HEAD }, { x: x1, y: d }, { x: x0, y: d }];
  return local.map((p) => {
    const r = rotate(p, bed.rotation);
    return { x: Math.round(bed.position.x + r.x), y: Math.round(bed.position.y + r.y) };
  });
}

function blocks(project: Project, other: ItemInstance, polygon: readonly Vec2[]): boolean {
  const def = project.catalog[other.definitionId];
  if (!def || def.surface === true || (other.elevation ?? 0) >= cm(90)) return false;
  return polygonsOverlap(itemPolygon(other, def), polygon);
}

/** Home rules, always in the same order: walkway to the door, then bed access. */
export function checkHome(project: Project): RuleResult[] {
  return [walkwayRule(project, HOME_WALKWAY), bedAccessRule(project)];
}

// ─── Apartments ──────────────────────────────────────────────────────────────────────────────

/** A placed piece: catalog id, centre in metres, rotation in degrees (0 = front to the north). */
type Piece = readonly [def: string, x: number, y: number, rotation?: number];

const NORTH = 0;
const WEST = 90;
const SOUTH = 180;
const EAST = 270;

interface ApartmentSpec {
  readonly name: string;
  readonly width: number;
  readonly depth: number;
  /** Front door on the south wall, offset from the west corner, metres. */
  readonly door: number;
  readonly rooms: ReadonlyArray<readonly [kind: (typeof HOME_ROOM_KINDS)[number], label: string, x0: number, y0: number, x1: number, y1: number]>;
  /** Interior walls, 10 cm thick, from one end to the other along x or y, metres. */
  readonly walls: ReadonlyArray<readonly [x0: number, y0: number, x1: number, y1: number]>;
  readonly pieces: readonly Piece[];
}

function region(id: string, kind: string, label: string, x0: number, y0: number, x1: number, y1: number): Zone {
  return { id, kind, polygon: [{ x: m(x0), y: m(y0) }, { x: m(x1), y: m(y0) }, { x: m(x1), y: m(y1) }, { x: m(x0), y: m(y1) }], meta: { label } };
}

/** An empty apartment shell with the home catalog: one front door on the south wall. */
export function newHome(name: string, width = 9, depth = 7, height = 2.8): Project {
  if (![width, depth, height].every((v) => Number.isFinite(v) && v >= 2 && v <= 100)) throw new RangeError('apartment dimensions must be 2 to 100 m');
  const door = Math.max(0.2, Math.min(width - 1.1, width / 2 - 0.45));
  return shell(name, width, depth, height, door, []);
}

function shell(name: string, width: number, depth: number, height: number, doorOffset: number, zones: Zone[]): Project {
  const space = roomSpace({ width: m(width), depth: m(depth), ceilingHeight: m(height), doors: [{ id: 'front-door', wall: 'south', offset: m(doorOffset), width: cm(90) }], columns: [] });
  return {
    ...createProject('new', name, { ...space, ...(zones.length ? { zones } : {}), meta: { pack: 'home' } }),
    catalog: Object.fromEntries(HOME_CATALOG.map((d) => [d.id, d])),
  };
}

function furnish(spec: ApartmentSpec): Project {
  const zones = spec.rooms.map(([kind, label, x0, y0, x1, y1], i) => region(`room-${i + 1}`, kind, label, x0, y0, x1, y1));
  const project = shell(spec.name, spec.width, spec.depth, 2.8, spec.door, zones);
  const catalog: Record<Id, ItemDefinition> = { ...project.catalog };
  const counts = new Map<string, number>();
  const items: Record<Id, ItemInstance> = {};
  const add = (def: ItemDefinition, x: number, y: number, rotation: number) => {
    const prefix = def.category.replace(/[^a-z]/g, '').slice(0, 8) || 'item';
    const n = (counts.get(prefix) ?? 0) + 1;
    counts.set(prefix, n);
    const id = `${prefix}-${n}`;
    const elevation = typeof def.meta?.elevation === 'number' ? (def.meta.elevation as Tick) : def.meta?.mount === 'ceiling' ? m(2.8) - def.size.h - cm(40) : 0;
    items[id] = { id, definitionId: def.id, position: { x: m(x), y: m(y) }, rotation: (((rotation % 360) + 360) % 360) * 1000, locked: false, ...(elevation > 0 ? { elevation } : {}) };
  };
  for (const [x0, y0, x1, y1] of spec.walls) {
    const length = Math.round(Math.abs(x1 - x0 + (y1 - y0)) * 100);
    const id = `home-wall-${length}`;
    catalog[id] ??= item(id, `Interior wall · ${(length / 100).toFixed(2)} m`, 'wall', length, 10, 270);
    add(catalog[id]!, (x0 + x1) / 2, (y0 + y1) / 2, y0 === y1 ? NORTH : WEST);
  }
  for (const [defId, x, y, rotation = NORTH] of spec.pieces) {
    const def = CATALOG_BY_ID.get(defId);
    if (!def) throw new Error(`unknown home item ${defId}`);
    add(def, x, y, rotation);
  }
  return { ...project, catalog, items };
}

/**
 * Studio, 7.5 × 6.5 m (49 m²): bed alcove by the west wall, bathroom in the north-west corner,
 * kitchen along the north wall, a round dining table and a living corner with the sofa to the east.
 */
export function studioApartment(name = 'Studio apartment · 49 m²'): Project {
  return furnish({
    name, width: 7.5, depth: 6.5, door: 3.3,
    rooms: [['bathroom', 'Bath', 0, 4.5, 2.35, 6.5], ['bedroom', 'Sleep', 0, 0, 3, 4.4], ['kitchen', 'Kitchen', 2.45, 4.9, 6.3, 6.5], ['dining', 'Dining', 3, 2.6, 5.2, 4.9], ['living', 'Living', 4.2, 0, 7.5, 2.6]],
    walls: [[0, 4.45, 1.5, 4.45], [2.4, 4.4, 2.4, 6.5]],
    pieces: [
      ['home-toilet', 0.4, 6.2, SOUTH], ['home-basin', 1.0, 6.25, SOUTH], ['home-mirror', 1.0, 6.47, SOUTH], ['home-shower', 1.88, 6.0, SOUTH],
      ['home-bed-queen', 1.1, 1.95, EAST], ['home-nightstand', 0.22, 0.8, EAST], ['home-nightstand', 0.22, 3.1, EAST], ['home-art-90', 0.03, 1.95, EAST], ['home-wardrobe-2', 2.75, 0.3],
      ['home-kitchen-300', 4.0, 6.19, SOUTH], ['home-fridge', 5.9, 6.16, SOUTH], ['home-dining-round', 4.0, 3.9], ['home-pendant', 4.0, 3.9],
      ['home-rug-cream', 5.7, 1.25, WEST], ['home-sofa-linen', 7.0, 1.25, WEST], ['home-coffee-marble', 5.65, 1.25], ['home-tv-unit', 4.5, 1.15, EAST],
      ['home-art-trio', 7.47, 1.25, WEST], ['home-floor-lamp-arc', 7.2, 2.75, SOUTH], ['home-plant-fig', 5.0, 0.35],
    ],
  });
}

/**
 * One bedroom, 10 × 7 m (70 m²): living room by the front door, dining and an open kitchen to the
 * east, the bedroom and bathroom along the north.
 */
export function oneBedroomApartment(name = 'One-bedroom apartment · 70 m²'): Project {
  return furnish({
    name, width: 10, depth: 7, door: 1.2,
    rooms: [['bedroom', 'Bedroom', 0, 4.05, 4.5, 7], ['bathroom', 'Bath', 4.6, 4.65, 7, 7], ['kitchen', 'Kitchen', 7.1, 4.4, 10, 7], ['dining', 'Dining', 5.2, 0.9, 10, 4.4], ['living', 'Living', 0, 0, 5.2, 4]],
    walls: [[0, 4, 3.6, 4], [4.55, 4, 4.55, 7], [4.6, 4.6, 5.5, 4.6], [6.3, 4.6, 7, 4.6], [7.05, 4.55, 7.05, 7]],
    pieces: [
      ['home-bed-king', 2.0, 5.92, SOUTH], ['home-nightstand', 0.7, 6.78, SOUTH], ['home-nightstand', 3.3, 6.78, SOUTH], ['home-art-90', 2.0, 6.97, SOUTH],
      ['home-wardrobe-3', 4.18, 5.6, WEST], ['home-rug-round', 2.0, 4.9], ['home-plant-snake', 0.3, 4.35],
      ['home-bathtub', 5.5, 6.6, SOUTH], ['home-toilet', 6.7, 5.2, WEST], ['home-basin', 4.88, 5.1, EAST], ['home-mirror', 4.625, 5.1, EAST],
      ['home-kitchen-240', 8.32, 6.69, SOUTH], ['home-fridge', 9.66, 4.9, WEST],
      ['home-dining-6', 7.6, 2.6, WEST], ['home-pendant', 7.6, 2.6], ['home-sideboard', 9.77, 2.6, WEST], ['home-art-90', 9.97, 2.6, WEST],
      ['home-rug-terracotta', 2.0, 2.3], ['home-sofa-linen', 0.5, 2.3, EAST], ['home-coffee-marble', 1.85, 2.25], ['home-armchair-boucle', 1.9, 3.53, SOUTH],
      ['home-tv-unit', 3.6, 2.3, WEST], ['home-floor-lamp', 0.35, 3.7], ['home-side-table', 0.35, 0.85], ['home-plant-fig', 4.9, 0.4], ['home-art-trio', 0.03, 2.3, EAST],
    ],
  });
}

/**
 * Two bedrooms, 12 × 9 m (108 m²): a living-dining room across the south with the kitchen and an
 * island to the east, the main bedroom, bathroom and a second bedroom with a desk to the north.
 */
export function twoBedroomApartment(name = 'Two-bedroom apartment · 108 m²'): Project {
  return furnish({
    name, width: 12, depth: 9, door: 5.5,
    rooms: [['bedroom', 'Main bedroom', 0, 5.05, 4.6, 9], ['bathroom', 'Bath', 4.7, 6.05, 7.3, 9], ['bedroom', 'Bedroom 2', 7.4, 5.05, 12, 9], ['living', 'Living', 0, 0, 6.2, 4.95], ['dining', 'Dining', 6.2, 0, 8.9, 4.95], ['kitchen', 'Kitchen', 8.9, 0, 12, 4.95]],
    walls: [[0, 5, 3.6, 5], [4.65, 5, 4.65, 9], [4.7, 6, 5.4, 6], [6.2, 6, 7.3, 6], [7.35, 5, 7.35, 9], [8.3, 5, 12, 5]],
    pieces: [
      ['home-bed-king', 2.3, 7.92, SOUTH], ['home-nightstand', 1.0, 8.78, SOUTH], ['home-nightstand', 3.6, 8.78, SOUTH], ['home-art-90', 2.3, 8.97, SOUTH],
      ['home-wardrobe-3', 0.32, 6.0, EAST], ['home-dresser', 4.33, 7.4, WEST], ['home-mirror', 4.58, 7.4, WEST], ['home-rug-cream', 2.3, 6.3],
      ['home-bathtub', 6.0, 8.6, SOUTH], ['home-toilet', 7.0, 7.0, WEST], ['home-basin', 4.98, 7.0, EAST], ['home-mirror', 4.725, 7.0, EAST],
      ['home-bed-single', 10.95, 7.45, WEST], ['home-nightstand', 11.78, 8.25, WEST], ['home-wardrobe-2', 8.0, 8.68, SOUTH], ['home-desk', 9.15, 8.68, SOUTH], ['home-desk-chair', 9.1, 8.05],
      ['home-art-60', 11.97, 7.45, WEST], ['home-plant-snake', 11.7, 5.4],
      ['home-rug-terracotta', 1.9, 2.4], ['home-sectional', 1.6, 1.1], ['home-coffee-marble', 2.0, 2.97], ['home-armchair-boucle', 3.7, 2.9, WEST],
      ['home-tv-unit', 1.6, 4.72, SOUTH], ['home-floor-lamp-arc', 0.3, 2.75, SOUTH], ['home-plant-fig', 0.4, 4.5], ['home-art-trio', 0.03, 1.1, EAST],
      ['home-dining-6', 7.5, 2.4, WEST], ['home-pendant', 7.5, 2.4], ['home-sideboard', 7.5, 0.24], ['home-art-90', 7.5, 0.03],
      ['home-kitchen-300', 11.69, 2.0, WEST], ['home-fridge', 11.66, 4.2, WEST], ['home-island', 9.9, 2.0, WEST],
    ],
  });
}

/** The ready apartments, for templates and the create dialog. */
export const HOME_TEMPLATES = [
  { id: 'home-studio', name: 'Studio', area: '49 m²', build: studioApartment },
  { id: 'home-one-bedroom', name: 'One bedroom', area: '70 m²', build: oneBedroomApartment },
  { id: 'home-two-bedroom', name: 'Two bedrooms', area: '108 m²', build: twoBedroomApartment },
] as const;
