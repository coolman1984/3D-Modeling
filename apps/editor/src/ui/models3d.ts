import type { ItemDefinition } from '@space-planner/core';
import { STARTER_CATALOG, type RackSpec, type ShapeKey } from '@space-planner/starter';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {
  barrierStripes,
  cartonFace,
  cartonStack,
  checker,
  cladding,
  coachLivery,
  corrugated,
  curtainWall,
  flagTexture,
  lockerDoors,
  planks,
  plaster,
  precast,
  printedCarton,
  ribbonWindow,
  roofMetal,
  screenPicture,
  signTexture,
  stone,
  vendingFront,
} from './textures.js';

/**
 * One 3D model per item shape, in the item's own frame: width along X, depth along Z, front facing
 * −Z (plan north at rotation 0), standing on Y = 0. Models only dress the item's box: the planning
 * footprint and height in the core decide every check, never these meshes.
 *
 * Materials are shared through a small cache (same look, same material), so a scene with thousands
 * of items compiles a handful of shaders and the instancing in View3D can merge by material.
 */

export const COLORS = {
  floor: 0xf4f2ed,
  wall: 0xfbfaf8,
  wood: 0xb4865a,
  darkWood: 0x6f4f35,
  cloth: 0xfbfaf7,
  fabric: 0xd9d4ca,
  metal: 0x8c939c,
  stage: 0x161a22,
  box: 0xd3d7de,
  palletA: 0xc9a06a,
  palletB: 0x8fa3b0,
  palletC: 0xb7c19a,
  carBody: 0x3b5b8c,
  tyre: 0x1f1e1c,
  column: 0x3a3834,
  blocked: 0xb3261e,
  selected: 0x1f3bf5,
  error: 0xb3261e,
  warning: 0x8a5a00,
  grid: 0x0b0d12,
  rackUpright: 0x2f5a96,
  rackBeam: 0xe07a2c,
  palletWood: 0xc29a66,
  forklift: 0xf0b429,
  forkliftDark: 0x2c2b29,
  carton: 0xefeae0,
  dimStock: 0xe3e6eb,
  containerSteel: 0x3d78a8,
  containerFloor: 0xb88657,
  warehouseFloor: 0xe7e4dd,
  safetyYellow: 0xe8b923,
  walkGreen: 0x3f8f5a,
  dockPlate: 0x4a4844,
  brand: 0x1428a0,
};

// ─── Shared materials ─────────────────────────────────────────────────────────────────────────

const materials = new Map<string, THREE.Material>();

/** A cached standard material; `userData.shared` keeps it alive when a scene is disposed. */
export function mat(key: string, make: () => THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial | THREE.MeshBasicMaterial): THREE.Material {
  let m = materials.get(key);
  if (!m) {
    m = make();
    m.userData.shared = true;
    materials.set(key, m);
  }
  return m;
}

const std = (key: string, color: number, roughness = 0.7, metalness = 0, extra: THREE.MeshStandardMaterialParameters = {}) =>
  mat(key, () => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra }));

export const M = {
  paint: (color: number) => std(`paint:${color}`, color, 0.72),
  gloss: (color: number) => std(`gloss:${color}`, color, 0.32, 0.1),
  metal: (color: number) => std(`metal:${color}`, color, 0.38, 0.75),
  laminate: () => std('laminate', 0xf1efea, 0.45),
  oak: () => mat('oak', () => new THREE.MeshStandardMaterial({ color: 0xc49a6c, roughness: 0.55, map: planks() })),
  walnut: () => mat('walnut', () => new THREE.MeshStandardMaterial({ color: 0x7a5236, roughness: 0.5, map: planks() })),
  cloth: () => std('cloth', 0xfaf8f2, 0.95),
  fabric: (color: number) => std(`fabric:${color}`, color, 0.98),
  leather: () => std('leather', 0x26272a, 0.45),
  chrome: () => std('chrome', 0xdfe3e7, 0.18, 1),
  alu: () => std('alu', 0xc3c8ce, 0.32, 0.85),
  steel: () => std('steel', 0x8b939b, 0.42, 0.7),
  blackPlastic: () => std('black-plastic', 0x1e2024, 0.42),
  rubber: () => std('rubber', 0x1c1c1d, 0.9),
  glass: () => mat('glass', () => new THREE.MeshStandardMaterial({ color: 0xa9c4d6, roughness: 0.04, metalness: 0.2, transparent: true, opacity: 0.28, depthWrite: false })),
  tinted: () => std('tinted-glass', 0x1f2a36, 0.08, 0.6),
  emissive: (color: number, strength = 1.4) => mat(`emit:${color}:${strength}`, () => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: strength, roughness: 0.4 })),
  leaves: (color: number) => std(`leaves:${color}`, color, 0.88, 0, { flatShading: true }),
  bark: () => std('bark', 0x5d4633, 0.95),
  soil: () => std('soil', 0x3b2d22, 1),
  screen: () => mat('screen', () => new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: screenPicture(), emissiveIntensity: 1.1, roughness: 0.15 })),
  palletWood: () => mat('pallet-wood', () => new THREE.MeshStandardMaterial({ color: COLORS.palletWood, roughness: 0.9, map: planks() })),
  carton: () => mat('carton', () => new THREE.MeshStandardMaterial({ color: COLORS.carton, roughness: 0.85, map: cartonFace() })),
  plaster: () => mat('plaster-wall', () => new THREE.MeshStandardMaterial({ color: 0xf6f4ef, roughness: 0.9, map: plaster()?.map ?? null })),
};

// ─── Mesh helpers ─────────────────────────────────────────────────────────────────────────────

function mesh(geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[], x = 0, y = 0, z = 0, shadow = true): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}

/** A box from its size and centre. */
function bx(w: number, h: number, d: number, material: THREE.Material | THREE.Material[], x = 0, y = h / 2, z = 0): THREE.Mesh {
  return mesh(new THREE.BoxGeometry(Math.max(0.001, w), Math.max(0.001, h), Math.max(0.001, d)), material, x, y, z);
}

function rbx(w: number, h: number, d: number, radius: number, material: THREE.Material, x = 0, y = h / 2, z = 0): THREE.Mesh {
  const r = Math.max(0.001, Math.min(radius, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001));
  return mesh(new RoundedBoxGeometry(Math.max(0.002, w), Math.max(0.002, h), Math.max(0.002, d), 2, r), material, x, y, z);
}

function cyl(rTop: number, rBottom: number, h: number, material: THREE.Material, x = 0, y = h / 2, z = 0, segments = 20): THREE.Mesh {
  return mesh(new THREE.CylinderGeometry(rTop, rBottom, Math.max(0.001, h), segments), material, x, y, z);
}

/** A wheel: a tyre cylinder turned onto the X axis with a lighter hub. */
function wheel(g: THREE.Group, r: number, width: number, x: number, z: number): void {
  const tyre = cyl(r, r, width, M.rubber(), x, r, z, 18);
  tyre.rotation.z = Math.PI / 2;
  g.add(tyre);
  const hub = cyl(r * 0.55, r * 0.55, width + 0.01, M.alu(), x, r, z, 12);
  hub.rotation.z = Math.PI / 2;
  hub.castShadow = false;
  g.add(hub);
}

/** A copy of a shared texture with its own repeat, disposed with the scene. */
function repeated(texture: THREE.Texture | null | undefined, u: number, v: number): THREE.Texture | null {
  if (!texture) return null;
  const t = texture.clone();
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(u, v);
  t.userData.owned = true;
  t.needsUpdate = true;
  return t;
}

/** Deterministic 0–1 from a string (a definition id), for small variations between types. */
function pick(key: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10_000) / 10_000;
}

const CLOTHED = new Set(STARTER_CATALOG.filter((d) => d.category === 'table' || d.category === 'round-table' || d.category === 'counter').map((d) => d.id));

export interface ModelContext {
  readonly definition: ItemDefinition;
  readonly rack?: RackSpec | undefined;
  /** Racks show the real stock layer instead of placeholder loads. */
  readonly stocked?: boolean;
  /** Draw as a loaded pallet with this load colour (a stock material on the floor). */
  readonly pallet?: number | undefined;
  /** Height of the item above the floor, metres: posts of a raised shade reach down to the ground. */
  readonly elevation?: number;
  /** Partitions are cut like the room walls unless full walls are shown. */
  readonly wallCut?: number | null;
}

const metaText = (d: ItemDefinition, key: string) => (typeof d.meta?.[key] === 'string' ? (d.meta[key] as string) : undefined);
const metaNumber = (d: ItemDefinition, key: string) => (typeof d.meta?.[key] === 'number' ? (d.meta[key] as number) : undefined);
const mt = (ticks: number) => ticks / 10_000;

// ─── Models ───────────────────────────────────────────────────────────────────────────────────

export function buildModel(shape: ShapeKey, w: number, d: number, h: number, ctx: ModelContext): THREE.Group {
  const g = new THREE.Group();
  const def = ctx.definition;
  const id = def.id;
  switch (shape) {
    case 'table':
      table(g, w, d, h, def);
      break;
    case 'round-table':
      roundTable(g, w, d, h, def);
      break;
    case 'chair':
      chair(g, w, d, h, id);
      break;
    case 'sofa':
      sofa(g, w, d, h, def);
      break;
    case 'desk':
      desk(g, w, d, h, id);
      break;
    case 'counter':
      counter(g, w, d, h, id);
      break;
    case 'stage': {
      g.add(bx(w, h - 0.03, d, M.paint(0x232220)));
      const top = bx(w + 0.02, 0.03, d + 0.02, mat('stage-top', () => new THREE.MeshStandardMaterial({ color: 0x3a2c22, roughness: 0.35, map: planks() })), 0, h - 0.015);
      g.add(top);
      const strip = bx(w, 0.02, 0.02, M.emissive(0x7fb2ff, 1.8), 0, h - 0.06, -d / 2 - 0.005);
      strip.castShadow = false;
      g.add(strip);
      break;
    }
    case 'shelf':
      shelf(g, w, d, h, def);
      break;
    case 'plant':
      plant(g, w, d, h);
      break;
    case 'dance-floor': {
      const floor = bx(w, Math.max(0.01, h), d, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25, map: repeated(checker(), w / 1.2, d / 1.2) }));
      floor.castShadow = false;
      g.add(floor);
      break;
    }
    case 'rack':
      rack(g, w, d, h, ctx);
      break;
    case 'forklift':
      forklift(g, w, d, h);
      break;
    case 'car':
      vehicle(g, w, d, h, def);
      break;
    case 'bus':
      bus(g, w, d, h, def);
      break;
    case 'tree':
      tree(g, w, d, h, def);
      break;
    case 'building':
      building(g, w, d, h, def);
      break;
    case 'lamp':
      lamp(g, h);
      break;
    case 'canopy':
      canopy(g, w, d, h, ctx.elevation ?? 0);
      break;
    case 'flag':
      flags(g, w, h);
      break;
    case 'barrier': {
      g.add(bx(0.32, 1.0, 0.32, M.paint(0xdedad2), -w / 2 + 0.16));
      const arm = bx(w - 0.32, 0.07, 0.07, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, map: repeated(barrierStripes(), (w - 0.32) / 2, 1) }), 0.16, Math.min(h, 1.0) - 0.08);
      g.add(arm);
      break;
    }
    case 'wall':
    case 'glass-wall':
      partition(g, w, d, ctx.wallCut ? Math.min(h, ctx.wallCut) : h, shape === 'glass-wall');
      break;
    case 'screen':
      screen(g, w, d, h);
      break;
    case 'machine':
      machine(g, w, d, h, def);
      break;
    case 'conveyor':
      conveyor(g, w, d, h, def);
      break;
    case 'workbench':
      workbench(g, w, d, h, def);
      break;
    case 'locker':
      locker(g, w, d, h);
      break;
    case 'vending': {
      const front = mat('vending-front', () => new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveMap: vendingFront(), emissiveIntensity: 0.55, map: vendingFront(), roughness: 0.25 }));
      const side = M.paint(0x1b2230);
      g.add(bx(w, h, d, [side, side, side, side, side, front]));
      break;
    }
    case 'box':
    default:
      boxLike(g, w, d, h, ctx);
  }
  return g;
}

function legs(g: THREE.Group, w: number, d: number, height: number, material: THREE.Material, size = 0.04, inset = 0.04): void {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(bx(size, height, size, material, sx * (w / 2 - inset - size / 2), height / 2, sz * (d / 2 - inset - size / 2)));
}

function table(g: THREE.Group, w: number, d: number, h: number, def: ItemDefinition): void {
  if (CLOTHED.has(def.id)) {
    // A banquet table under a floor-length cloth.
    g.add(bx(w + 0.04, 0.02, d + 0.04, M.cloth(), 0, h - 0.01));
    g.add(bx(w + 0.03, h - 0.02, d + 0.03, M.cloth(), 0, (h - 0.02) / 2));
    return;
  }
  const low = h < 0.55;
  const wood = def.id.includes('meeting') || def.id.includes('coffee') || def.meta?.kind === 'table';
  const top = wood ? M.walnut() : M.laminate();
  g.add(rbx(w, 0.035, d, 0.012, top, 0, h - 0.0175));
  if (low || w <= 1.2) legs(g, w, d, h - 0.035, low ? M.walnut() : M.steel(), low ? 0.05 : 0.04, 0.05);
  else {
    // Panel legs with a cable tray, as on meeting and training tables.
    for (const sx of [-1, 1]) g.add(bx(0.04, h - 0.035, d * 0.7, M.steel(), sx * (w / 2 - 0.12), (h - 0.035) / 2));
    g.add(bx(w - 0.3, 0.05, 0.08, M.steel(), 0, h - 0.12));
  }
  // Tables that carry covers (restaurant families) show their chairs around them.
  const seats = def.seats ?? 0;
  if (def.meta?.kind === 'table' && seats > 0) chairsAround(g, w, d, seats, false);
}

function roundTable(g: THREE.Group, w: number, d: number, h: number, def: ItemDefinition): void {
  const r = Math.min(w, d) / 2;
  if (CLOTHED.has(def.id)) {
    g.add(cyl(r + 0.02, r + 0.02, 0.02, M.cloth(), 0, h - 0.01, 0, 40));
    g.add(cyl(r + 0.02, r + 0.12, h - 0.02, M.cloth(), 0, (h - 0.02) / 2, 0, 40));
    // A small centrepiece.
    g.add(cyl(0.05, 0.07, 0.12, M.gloss(0xe8e2d4), 0, h + 0.06, 0, 12));
    const flowers = mesh(new THREE.IcosahedronGeometry(0.11, 1), M.leaves(0xd98ca0), 0, h + 0.2, 0);
    g.add(flowers);
    return;
  }
  g.add(cyl(r, r, 0.035, M.walnut(), 0, h - 0.0175, 0, 40));
  g.add(cyl(0.04, 0.04, h - 0.035, M.steel(), 0, (h - 0.035) / 2));
  g.add(cyl(r * 0.45, r * 0.5, 0.025, M.steel(), 0, 0.0125));
  const seats = def.seats ?? 0;
  if (def.meta?.kind === 'table' && seats > 0) chairsAround(g, w, d, seats, true);
}

/** Chairs implied by a restaurant table's cover count, placed round its edge. */
function chairsAround(g: THREE.Group, w: number, d: number, seats: number, round: boolean): void {
  const place = (x: number, z: number, turn: number) => {
    const c = new THREE.Group();
    chair(c, 0.44, 0.46, 0.86, 'canteen-chair');
    c.position.set(x, 0, z);
    c.rotation.y = turn;
    g.add(c);
  };
  if (round) {
    const r = Math.min(w, d) / 2 + 0.22;
    for (let k = 0; k < seats; k++) {
      const a = (k / seats) * Math.PI * 2;
      place(Math.sin(a) * r, -Math.cos(a) * r, a + Math.PI);
    }
    return;
  }
  const long = w >= d;
  const side = long ? w : d;
  const perSide = Math.max(1, Math.round(seats / (seats <= 4 && Math.abs(w - d) < 0.05 ? 4 : 2)));
  if (seats <= 4 && Math.abs(w - d) < 0.05) {
    place(0, -d / 2 - 0.22, Math.PI);
    place(0, d / 2 + 0.22, 0);
    if (seats > 2) {
      place(-w / 2 - 0.22, 0, -Math.PI / 2);
      place(w / 2 + 0.22, 0, Math.PI / 2);
    }
    return;
  }
  for (let k = 0; k < perSide; k++) {
    const t = -side / 2 + (side / perSide) * (k + 0.5);
    if (long) {
      place(t, -d / 2 - 0.22, Math.PI);
      place(t, d / 2 + 0.22, 0);
    } else {
      place(-w / 2 - 0.22, t, -Math.PI / 2);
      place(w / 2 + 0.22, t, Math.PI / 2);
    }
  }
}

function chair(g: THREE.Group, w: number, d: number, h: number, id: string): void {
  const seat = Math.min(0.47, h * 0.52);
  if (id.includes('office-chair')) {
    // Task chair: five-star base, gas lift, mesh back and arms.
    for (let k = 0; k < 5; k++) {
      const spoke = bx(0.04, 0.03, Math.min(w, d) * 0.46, M.blackPlastic(), 0, 0.07, 0);
      spoke.geometry.translate(0, 0, Math.min(w, d) * 0.23);
      spoke.rotation.y = (k / 5) * Math.PI * 2;
      g.add(spoke);
    }
    g.add(cyl(0.03, 0.03, seat - 0.12, M.chrome(), 0, 0.08 + (seat - 0.12) / 2));
    g.add(rbx(w * 0.82, 0.07, d * 0.78, 0.03, M.fabric(0x2f3238), 0, seat, -d * 0.02));
    const back = rbx(w * 0.76, h - seat - 0.08, 0.05, 0.02, M.fabric(0x26282c), 0, seat + (h - seat) / 2 + 0.02, d * 0.36);
    back.rotation.x = -0.1;
    g.add(back);
    for (const sx of [-1, 1]) g.add(bx(0.04, 0.22, d * 0.4, M.blackPlastic(), sx * w * 0.4, seat + 0.14, 0));
    return;
  }
  if (id.includes('stool')) {
    g.add(cyl(w * 0.45, w * 0.45, 0.06, M.fabric(0x2d3a52), 0, h - 0.03, 0, 20));
    g.add(cyl(0.025, 0.025, h - 0.1, M.chrome(), 0, (h - 0.1) / 2 + 0.04));
    g.add(cyl(w * 0.4, w * 0.42, 0.03, M.blackPlastic(), 0, 0.015, 0, 16));
    return;
  }
  if (id.includes('meeting') || id.includes('canteen')) {
    // Sled-base meeting chair: chrome frame, upholstered seat and back.
    const colour = id.includes('canteen') ? 0x3d6ea5 : 0x5b6470;
    for (const sx of [-1, 1]) {
      g.add(bx(0.02, 0.02, d * 0.9, M.chrome(), sx * w * 0.42, 0.01, 0));
      g.add(bx(0.02, seat, 0.02, M.chrome(), sx * w * 0.42, seat / 2, -d * 0.4));
      g.add(bx(0.02, h - 0.05, 0.02, M.chrome(), sx * w * 0.42, (h - 0.05) / 2, d * 0.4));
    }
    g.add(rbx(w * 0.92, 0.06, d * 0.86, 0.025, M.fabric(colour), 0, seat, -d * 0.03));
    g.add(rbx(w * 0.9, h - seat - 0.12, 0.05, 0.02, M.fabric(colour), 0, seat + (h - seat) / 2 + 0.02, d * 0.42));
    return;
  }
  // Banquet or Chiavari chair: four legs, cushioned seat, ladder back.
  const legMat = id.includes('chiavari') ? M.gloss(0xc8a45a) : M.gloss(0xbfb7a8);
  legs(g, w, d, seat - 0.03, legMat, 0.03, 0.03);
  g.add(rbx(w * 0.92, 0.06, d * 0.9, 0.02, M.fabric(0xf4efe4), 0, seat));
  for (const sx of [-1, 1]) g.add(bx(0.03, h - seat, 0.03, legMat, sx * (w / 2 - 0.045), seat + (h - seat) / 2, d / 2 - 0.045));
  for (const y of [seat + (h - seat) * 0.45, h - 0.04]) g.add(bx(w * 0.86, 0.04, 0.025, legMat, 0, y, d / 2 - 0.045));
}

function sofa(g: THREE.Group, w: number, d: number, h: number, def: ItemDefinition): void {
  const colour = metaNumber(def, 'color') ?? (CLOTHED.has(def.id) || def.id === 'loveseat' ? 0xd8cdb8 : 0x4d5560);
  const cloth = M.fabric(colour);
  const seat = h * 0.48;
  const arm = Math.min(0.16, w * 0.12);
  g.add(rbx(w, seat * 0.55, d, 0.04, cloth, 0, 0.08 + seat * 0.275));
  const n = Math.max(1, Math.min(4, def.seats ?? Math.round(w / 0.7)));
  const inner = w - arm * 2;
  for (let k = 0; k < n; k++) {
    const x = -inner / 2 + (inner / n) * (k + 0.5);
    g.add(rbx(inner / n - 0.02, seat * 0.35, d * 0.72, 0.05, cloth, x, 0.08 + seat * 0.55 + seat * 0.175, -d * 0.08));
    g.add(rbx(inner / n - 0.03, h - seat - 0.04, d * 0.2, 0.06, cloth, x, seat + (h - seat) / 2, d / 2 - d * 0.14));
  }
  for (const sx of [-1, 1]) g.add(rbx(arm, h * 0.68, d, 0.05, cloth, sx * (w / 2 - arm / 2), 0.08 + (h * 0.68) / 2 - 0.04));
  legs(g, w, d, 0.08, M.walnut(), 0.04, 0.06);
}

function desk(g: THREE.Group, w: number, d: number, h: number, id: string): void {
  if (id === 'lectern') {
    g.add(bx(w * 0.8, h - 0.1, d * 0.7, M.walnut(), 0, (h - 0.1) / 2));
    const top = bx(w, 0.04, d, M.walnut(), 0, h - 0.05);
    top.rotation.x = 0.25;
    g.add(top);
    return;
  }
  const manager = id.includes('manager');
  const top = manager ? M.walnut() : M.laminate();
  g.add(rbx(w, 0.03, d, 0.01, top, 0, h - 0.015));
  if (manager) {
    for (const sx of [-1, 1]) g.add(bx(0.05, h - 0.03, d, M.walnut(), sx * (w / 2 - 0.025), (h - 0.03) / 2));
    g.add(bx(w * 0.3, h * 0.6, d * 0.9, M.walnut(), w / 2 - 0.05 - w * 0.15, h * 0.3));
  } else {
    // Steel frame: two T-legs and a beam.
    for (const sx of [-1, 1]) {
      g.add(bx(0.05, h - 0.03, 0.05, M.paint(0x3a3d42), sx * (w / 2 - 0.08), (h - 0.03) / 2));
      g.add(bx(0.06, 0.03, d * 0.9, M.paint(0x3a3d42), sx * (w / 2 - 0.08), 0.015));
    }
    g.add(bx(w - 0.2, 0.06, 0.04, M.paint(0x3a3d42), 0, h - 0.09, -d * 0.25));
  }
  // Modesty panel on the visitor side, a screen and keyboard on the user side (user sits at +Z).
  g.add(bx(w * 0.9, h * 0.45, 0.02, manager ? M.walnut() : M.paint(0xd9d6cf), 0, h - 0.03 - h * 0.225, -d / 2 + 0.03));
  if (id === 'reception') {
    g.add(bx(w, 1.1 - h + 0.05, 0.05, M.walnut(), 0, h + (1.1 - h) / 2, -d / 2 + 0.03));
    g.add(bx(w, 0.03, 0.28, M.laminate(), 0, 1.1, -d / 2 + 0.1));
  }
  const screens = w >= 1.5 && !manager ? 2 : 1;
  for (let k = 0; k < screens; k++) {
    const x = screens === 1 ? 0 : (k - 0.5) * 0.56;
    g.add(bx(0.2, 0.012, 0.16, M.blackPlastic(), x, h + 0.006, -d * 0.18));
    g.add(bx(0.04, 0.16, 0.03, M.blackPlastic(), x, h + 0.08, -d * 0.2));
    const panel = bx(0.54, 0.32, 0.025, [M.blackPlastic(), M.blackPlastic(), M.blackPlastic(), M.blackPlastic(), M.screen(), M.blackPlastic()], x, h + 0.33, -d * 0.2);
    g.add(panel);
  }
  g.add(bx(0.44, 0.02, 0.14, M.paint(0x2c2e33), 0, h + 0.01, d * 0.15));
}

function counter(g: THREE.Group, w: number, d: number, h: number, id: string): void {
  if (id.includes('buffet')) {
    g.add(bx(w + 0.03, h, d + 0.03, M.cloth(), 0, h / 2));
    const n = Math.max(2, Math.floor(w / 0.6));
    for (let k = 0; k < n; k++) {
      const x = -w / 2 + (w / n) * (k + 0.5);
      g.add(bx(w / n - 0.08, 0.08, d * 0.55, M.chrome(), x, h + 0.04));
      const lid = mesh(new THREE.SphereGeometry(0.2, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.chrome(), x, h + 0.08, 0);
      lid.scale.set((w / n - 0.12) / 0.4, 0.45, (d * 0.5) / 0.4);
      g.add(lid);
    }
    g.add(bx(w, 0.01, d * 0.4, M.glass(), 0, h + 0.42, -d * 0.1));
    return;
  }
  if (id.includes('kitchenette')) {
    g.add(bx(w, h - 0.04, d - 0.02, M.paint(0xf3f1ec), 0, (h - 0.04) / 2, 0.01));
    for (let k = 1; k < Math.round(w / 0.6); k++) g.add(bx(0.006, h - 0.14, 0.004, M.paint(0xc6cbd3), -w / 2 + k * 0.6, (h - 0.04) / 2, -d / 2 - 0.001));
    g.add(bx(w + 0.02, 0.04, d + 0.02, M.gloss(0x5d5a55), 0, h - 0.02));
    g.add(bx(0.5, 0.012, d * 0.55, M.chrome(), -w * 0.2, h + 0.001));
    g.add(bx(w, 0.7, d * 0.55, M.paint(0xf3f1ec), 0, h + 0.62 + 0.35, d / 2 - d * 0.28));
    g.add(cyl(0.12, 0.12, 0.3, M.chrome(), w * 0.3, h + 0.15, 0));
    return;
  }
  // Bar, DJ booth or service counter: wood front, stone top.
  g.add(bx(w, h - 0.04, d * 0.94, M.walnut(), 0, (h - 0.04) / 2, 0.01));
  g.add(bx(w + 0.04, 0.04, d, M.gloss(0x2f2d2a), 0, h - 0.02));
  if (id === 'dj') for (const x of [-0.45, 0.45]) g.add(cyl(0.15, 0.15, 0.03, M.blackPlastic(), x, h + 0.015, 0));
}

function shelf(g: THREE.Group, w: number, d: number, h: number, def: ItemDefinition): void {
  const id = def.id;
  if (id === 'cabinet') {
    g.add(bx(w, h, d, M.paint(0xb8bec5)));
    const drawers = Math.max(3, Math.round(h / 0.45));
    for (let k = 0; k < drawers; k++) {
      const y = (h / drawers) * (k + 0.5);
      g.add(bx(w - 0.04, 0.006, 0.004, M.paint(0x6d747c), 0, y + h / drawers / 2 - 0.01, -d / 2 - 0.002));
      g.add(bx(0.14, 0.02, 0.02, M.chrome(), 0, y + 0.08, -d / 2 - 0.01));
    }
    return;
  }
  if (id === 'locker') {
    locker(g, w, d, h);
    return;
  }
  const industrial = def.meta?.kind !== undefined || id.includes('kitting') || id.includes('rack');
  const frame = industrial ? M.paint(0x3a5f95) : M.walnut();
  for (const sx of [-1, 1]) g.add(bx(0.03, h, d, frame, sx * (w / 2 - 0.015)));
  if (!industrial) g.add(bx(w, h, 0.02, frame, 0, h / 2, d / 2 - 0.01));
  const levels = Math.max(3, Math.round(h / 0.4));
  for (let i = 0; i < levels; i++) {
    const y = 0.05 + (i * (h - 0.08)) / (levels - 1);
    g.add(bx(w - 0.06, 0.025, d - 0.02, industrial ? M.steel() : M.walnut(), 0, y));
    if (i === levels - 1) continue;
    // Books or parts bins on each level.
    const slots = Math.max(2, Math.floor((w - 0.06) / (industrial ? 0.4 : 0.09)));
    for (let k = 0; k < slots; k++) {
      const x = -w / 2 + 0.04 + ((w - 0.08) / slots) * (k + 0.5);
      const tall = industrial ? 0.18 : 0.18 + pick(id, i * 31 + k) * 0.1;
      const colour = industrial ? 0x2a6fd6 : [0x8a3b2e, 0x2d4f6f, 0x5b6b3a, 0xd8cfb8, 0x333333][(i + k) % 5]!;
      g.add(bx(((w - 0.08) / slots) * 0.86, tall, d * 0.7, M.paint(colour), x, y + 0.0125 + tall / 2));
    }
  }
}

function plant(g: THREE.Group, w: number, d: number, h: number): void {
  const r = Math.min(w, d) / 2;
  const potH = Math.min(0.45, h * 0.28);
  g.add(cyl(r * 0.62, r * 0.48, potH, M.gloss(0xd9d2c4), 0, potH / 2, 0, 20));
  g.add(cyl(r * 0.58, r * 0.58, 0.02, M.soil(), 0, potH - 0.02));
  const leaf = M.leaves(0x4f8a4b);
  const blobs = 5;
  for (let k = 0; k < blobs; k++) {
    const a = (k / blobs) * Math.PI * 2;
    const y = potH + (h - potH) * (0.35 + (k % 3) * 0.2);
    const s = r * (0.55 + (k % 2) * 0.15);
    const blob = mesh(new THREE.IcosahedronGeometry(s, 1), leaf, Math.cos(a) * r * 0.35, y, Math.sin(a) * r * 0.35);
    blob.scale.y = 1.25;
    g.add(blob);
  }
}

function rack(g: THREE.Group, w: number, d: number, h: number, ctx: ModelContext): void {
  const spec = ctx.rack;
  if (!spec) {
    g.add(bx(w, h, d, M.steel()));
    return;
  }
  const upright = mt(spec.uprightWidth);
  const bay = mt(spec.bayWidth);
  const pitch = h / spec.levels;
  const post = Math.min(0.09, upright);
  const blue = M.gloss(COLORS.rackUpright);
  const orange = M.gloss(COLORS.rackBeam);
  for (let b = 0; b <= spec.bays; b++) {
    const x = -w / 2 + upright / 2 + b * (bay + upright);
    for (const z of [-d / 2 + post / 2, d / 2 - post / 2]) {
      g.add(bx(post, h, post, blue, x, h / 2, z));
      g.add(bx(post + 0.08, 0.01, post + 0.08, M.steel(), x, 0.005, z));
    }
    const braces = Math.max(2, Math.round(h / 1.2));
    for (let k = 0; k < braces; k++) g.add(bx(0.03, 0.03, d - post, blue, x, 0.15 + (k * (h - 0.3)) / Math.max(1, braces - 1)));
  }
  // Yellow row-end guards protect the uprights from forklifts.
  for (const sx of [-1, 1]) g.add(bx(0.12, 0.4, d + 0.12, M.gloss(COLORS.safetyYellow), sx * (w / 2 + 0.08), 0.2));
  for (let level = 2; level <= spec.levels; level++) {
    const y = (level - 1) * pitch;
    for (const z of [-d / 2 + post / 2, d / 2 - post / 2]) g.add(bx(w - upright, 0.11, 0.05, orange, 0, y - 0.055, z));
  }
  if (ctx.stocked) return;
  // Placeholder loads for racks with no stock data: at most 3 per level keeps long rows cheap.
  const loadColors = [COLORS.palletA, COLORS.palletB, COLORS.palletC];
  const loadD = Math.max(0.1, d - post * 2 - 0.04);
  const loadH = Math.max(0.12, Math.min(1.5, pitch - 0.3));
  const groups = Math.min(spec.bays, 3);
  const baysPerGroup = Math.ceil(spec.bays / groups);
  for (let level = 1; level <= spec.levels; level++) {
    const y = (level - 1) * pitch;
    for (let gStart = 0; gStart < spec.bays; gStart += baysPerGroup) {
      const gEnd = Math.min(spec.bays, gStart + baysPerGroup);
      const x0 = -w / 2 + upright + gStart * (bay + upright);
      const x1 = -w / 2 + upright + (gEnd - 1) * (bay + upright) + bay;
      const gw = (x1 - x0) * 0.94;
      g.add(bx(gw, 0.14, loadD * 0.9, M.palletWood(), (x0 + x1) / 2, y + 0.07));
      g.add(bx(gw * 0.97, loadH - 0.14, loadD * 0.86, mat(`load:${loadColors[(gStart / baysPerGroup + level) % loadColors.length]}`, () => new THREE.MeshStandardMaterial({ color: loadColors[(gStart / baysPerGroup + level) % loadColors.length]!, map: cartonStack(), roughness: 0.6 })), (x0 + x1) / 2, y + 0.14 + (loadH - 0.14) / 2));
    }
  }
}

function forklift(g: THREE.Group, w: number, d: number, h: number): void {
  const bodyD = d * 0.6;
  const bodyZ = d / 2 - bodyD / 2;
  const r = Math.min(0.28, h * 0.13);
  const yellow = M.gloss(COLORS.forklift);
  const dark = M.paint(COLORS.forkliftDark);
  g.add(rbx(w * 0.92, h * 0.34, bodyD, 0.06, yellow, 0, r + h * 0.17, bodyZ));
  g.add(rbx(w * 0.94, h * 0.3, 0.34, 0.06, dark, 0, r + h * 0.15, d / 2 - 0.17));
  g.add(bx(w * 0.5, 0.08, 0.45, M.fabric(0x222222), 0, r + h * 0.34 + 0.12, bodyZ + 0.05));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(bx(0.05, h * 0.52, 0.05, dark, sx * (w * 0.42), r + h * 0.34 + h * 0.26, bodyZ + sz * bodyD * 0.38));
  g.add(bx(w * 0.9, 0.04, bodyD * 0.82, dark, 0, h - 0.02, bodyZ));
  g.add(bx(0.06, 0.06, 0.06, M.emissive(0xff9a1f, 2), 0, h + 0.03, bodyZ + bodyD * 0.3));
  const mastZ = d / 2 - bodyD - 0.06;
  for (const sx of [-1, 1]) g.add(bx(0.09, h * 1.02, 0.12, dark, sx * w * 0.28, (h * 1.02) / 2, mastZ));
  g.add(bx(w * 0.66, 0.5, 0.05, dark, 0, 0.35, mastZ - 0.08));
  const forkL = d - bodyD - 0.2;
  for (const sx of [-1, 1]) g.add(bx(0.12, 0.05, forkL, M.steel(), sx * w * 0.2, 0.06, mastZ - 0.1 - forkL / 2));
  for (const sx of [-1, 1]) for (const z of [bodyZ - bodyD * 0.3, d / 2 - 0.3]) wheel(g, r, 0.2, sx * (w / 2 - 0.1), z);
}

function vehicle(g: THREE.Group, w: number, d: number, h: number, def: ItemDefinition): void {
  const colour = metaNumber(def, 'color') ?? COLORS.carBody;
  const paint = mat(`car-paint:${colour}`, () => new THREE.MeshPhysicalMaterial({ color: colour, roughness: 0.28, metalness: 0.55, clearcoat: 1, clearcoatRoughness: 0.08 }));
  if (d > 7.5) {
    truck(g, w, d, h, def, colour, paint);
    return;
  }
  const r = Math.min(0.34, h * 0.21);
  const van = h > 1.9;
  if (van) {
    g.add(rbx(w, h - r * 0.8, d, 0.18, paint, 0, r * 0.8 + (h - r * 0.8) / 2));
    g.add(bx(w * 0.94, (h - r) * 0.34, 0.02, M.tinted(), 0, h * 0.72, -d / 2 - 0.005));
    for (const sx of [-1, 1]) g.add(bx(0.02, (h - r) * 0.3, d * 0.2, M.tinted(), sx * (w / 2 + 0.005), h * 0.72, -d / 2 + d * 0.14));
  } else {
    const bodyH = h * 0.42;
    const y0 = r * 0.55;
    g.add(rbx(w, bodyH, d, 0.14, paint, 0, y0 + bodyH / 2));
    const cabin = rbx(w * 0.84, h - y0 - bodyH, d * 0.5, 0.16, M.tinted(), 0, y0 + bodyH + (h - y0 - bodyH) / 2 - 0.02, d * 0.04);
    g.add(cabin);
    g.add(rbx(w * 0.8, 0.04, d * 0.4, 0.02, paint, 0, h - 0.02, d * 0.05));
  }
  const axle = d / 2 - Math.min(0.9, d * 0.18);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) wheel(g, r, 0.22, sx * (w / 2 - 0.1), sz * axle);
  for (const sx of [-1, 1]) {
    const light = bx(w * 0.18, 0.07, 0.03, M.emissive(0xfff3d6, 1.2), sx * w * 0.32, r + h * 0.22, -d / 2 - 0.005);
    light.castShadow = false;
    g.add(light);
    const tail = bx(w * 0.16, 0.06, 0.03, M.emissive(0xb3121c, 0.9), sx * w * 0.34, r + h * 0.24, d / 2 + 0.005);
    tail.castShadow = false;
    g.add(tail);
  }
}

function truck(g: THREE.Group, w: number, d: number, h: number, def: ItemDefinition, colour: number, paint: THREE.Material): void {
  const r = 0.5;
  const cabL = 2.4;
  const cabH = Math.min(h, 3.3);
  g.add(rbx(w, cabH - r * 0.9, cabL, 0.2, paint, 0, r * 0.9 + (cabH - r * 0.9) / 2, -d / 2 + cabL / 2));
  g.add(bx(w * 0.9, cabH * 0.26, 0.02, M.tinted(), 0, cabH * 0.72, -d / 2 - 0.005));
  g.add(bx(w * 0.7, 0.3, cabL * 0.6, M.paint(0x2a2c30), 0, cabH + 0.15, -d / 2 + cabL * 0.55));
  g.add(bx(w * 0.8, 0.25, d - 0.4, M.paint(0x25272b), 0, r + 0.3, 0.2));
  const boxL = d - cabL - 0.3;
  const boxZ = -d / 2 + cabL + 0.3 + boxL / 2;
  const container = def.meta?.trailer === 'container';
  const boxMat = container
    ? mat(`container-box:${colour}`, () => new THREE.MeshStandardMaterial({ color: colour, roughness: 0.55, metalness: 0.3, map: corrugated() }))
    : M.paint(0xf1f1ee);
  const boxBody = bx(w, h - r * 2 - 0.2, boxL, boxMat, 0, r * 2 + 0.2 + (h - r * 2 - 0.2) / 2, boxZ);
  if (container) {
    const map = repeated(corrugated(), boxL / 0.28, 1);
    boxBody.material = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.55, metalness: 0.3, map });
  }
  g.add(boxBody);
  for (const sx of [-1, 1]) {
    wheel(g, r, 0.3, sx * (w / 2 - 0.18), -d / 2 + 1.1);
    for (const z of [d / 2 - 1.4, d / 2 - 2.7, d / 2 - 4.0]) wheel(g, r, 0.3, sx * (w / 2 - 0.18), z);
  }
}

function bus(g: THREE.Group, w: number, d: number, h: number, def: ItemDefinition): void {
  const r = 0.5;
  const livery = metaText(def, 'livery') === 'grey' ? '#8a96a3' : '#1428a0';
  const side = mat(`coach-side:${livery}`, () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.2, map: coachLivery(livery) }));
  const white = M.gloss(0xf4f4f2);
  const front = mat('coach-front', () => new THREE.MeshStandardMaterial({ color: 0x1b2430, roughness: 0.08, metalness: 0.5 }));
  const body = bx(w, h - r * 0.7, d, [side, side, white, white, white, front], 0, r * 0.7 + (h - r * 0.7) / 2);
  g.add(body);
  g.add(rbx(w * 0.9, 0.16, d * 0.94, 0.08, white, 0, h + 0.06));
  g.add(bx(w * 0.6, 0.28, 2.2, M.paint(0xd9dcdf), 0, h + 0.2, d * 0.1));
  g.add(bx(w, 0.35, 0.05, M.paint(0x2c3138), 0, r * 0.7 + 0.2, -d / 2 - 0.02));
  for (const sx of [-1, 1]) {
    g.add(bx(0.05, 0.3, 0.12, M.blackPlastic(), sx * (w / 2 + 0.22), h * 0.7, -d / 2 + 0.2));
    const light = bx(0.34, 0.1, 0.03, M.emissive(0xfff3d6, 1.3), sx * (w / 2 - 0.3), r + 0.35, -d / 2 - 0.03);
    light.castShadow = false;
    g.add(light);
  }
  const axles = d > 9 ? [-d / 2 + 2.6, d / 2 - 3.2, d / 2 - 2.0] : [-d / 2 + 1.5, d / 2 - 1.6];
  for (const sx of [-1, 1]) for (const z of axles) wheel(g, r, 0.3, sx * (w / 2 - 0.2), z);
}

function tree(g: THREE.Group, w: number, d: number, h: number, def: ItemDefinition): void {
  const r = Math.min(w, d) / 2;
  if (metaText(def, 'species') === 'palm') {
    const trunkH = h * 0.82;
    g.add(cyl(0.2, 0.3, trunkH, mat('palm-bark', () => new THREE.MeshStandardMaterial({ color: 0x7a6248, roughness: 1 })), 0, trunkH / 2, 0, 10));
    for (let k = 0; k < 4; k++) g.add(cyl(0.3 - k * 0.02, 0.31 - k * 0.02, 0.08, M.bark(), 0, trunkH * (0.2 + k * 0.2), 0, 10));
    const frond = M.leaves(0x4c7a34);
    for (let k = 0; k < 11; k++) {
      const a = (k / 11) * Math.PI * 2;
      const len = r * 1.05;
      const leaf = mesh(new THREE.ConeGeometry(0.34, len, 4, 1), frond, 0, 0, 0);
      leaf.geometry.translate(0, len / 2, 0);
      leaf.geometry.scale(1, 1, 0.18);
      leaf.position.set(0, trunkH, 0);
      leaf.rotation.set(0, a, 0);
      leaf.rotateX(Math.PI / 2 - 0.35 - (k % 3) * 0.18);
      g.add(leaf);
    }
    g.add(mesh(new THREE.IcosahedronGeometry(0.34, 0), M.leaves(0x9a6a2c), 0, trunkH - 0.2, 0));
    return;
  }
  const trunkH = h * 0.36;
  g.add(cyl(0.16, 0.26, trunkH + 0.4, M.bark(), 0, (trunkH + 0.4) / 2, 0, 10));
  const tones = [0x3f7a37, 0x4a8a3e, 0x356a31];
  const blobs = [
    [0, trunkH + (h - trunkH) * 0.48, 0, 0.62],
    [r * 0.42, trunkH + (h - trunkH) * 0.38, r * 0.1, 0.5],
    [-r * 0.38, trunkH + (h - trunkH) * 0.4, -r * 0.2, 0.52],
    [r * 0.05, trunkH + (h - trunkH) * 0.7, -r * 0.3, 0.44],
    [-r * 0.1, trunkH + (h - trunkH) * 0.36, r * 0.42, 0.46],
  ] as const;
  blobs.forEach(([x, y, z, s], k) => {
    const blob = mesh(new THREE.IcosahedronGeometry(r * s, 1), M.leaves(tones[k % tones.length]!), x, y, z);
    blob.scale.set(1, 0.8, 1);
    g.add(blob);
  });
}

function building(g: THREE.Group, w: number, d: number, h: number, def: ItemDefinition): void {
  const facade = metaText(def, 'facade') ?? 'cladding';
  const colour = metaNumber(def, 'color') ?? 0xeef0f3;
  const storeys = Math.max(1, metaNumber(def, 'storeys') ?? 1);
  const use = metaText(def, 'use');
  const faceMaterial = (faceW: number): THREE.Material => {
    if (facade === 'glass') {
      return new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.12, metalness: 0.55, map: repeated(curtainWall(), faceW / 3, storeys) });
    }
    const s = facade === 'stone' ? stone() : facade === 'concrete' ? precast() : cladding();
    const tile = s?.metres ?? 1;
    return new THREE.MeshStandardMaterial({
      color: colour,
      roughness: facade === 'cladding' ? 0.45 : 0.85,
      metalness: facade === 'cladding' ? 0.35 : 0,
      map: repeated(s?.map, faceW / tile, h / tile),
      normalMap: repeated(s?.normalMap, faceW / tile, h / tile),
    });
  };
  const roofMat = new THREE.MeshStandardMaterial({ color: 0xd4d8dc, roughness: 0.55, metalness: 0.3, map: repeated(roofMetal()?.map, w / 2, d / 2) });
  const alongX = faceMaterial(d);
  const alongZ = faceMaterial(w);
  const base = M.paint(0x8b8e90);
  g.add(bx(w, h, d, [alongX, alongX, roofMat, base, alongZ, alongZ]));
  // Parapet coping and a plinth line.
  g.add(bx(w + 0.3, 0.25, d + 0.3, M.paint(facade === 'stone' ? 0xcdbb98 : 0x9aa1a8), 0, h + 0.12));
  g.add(bx(w + 0.08, 0.5, d + 0.08, M.paint(0x6f7479), 0, 0.25));
  // Ribbon windows on clad buildings, per storey.
  if (facade === 'cladding') {
    const band = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1, metalness: 0.6, map: repeated(ribbonWindow(), w / 1.5, 1) });
    const bandX = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1, metalness: 0.6, map: repeated(ribbonWindow(), d / 1.5, 1) });
    const bandH = Math.min(1.6, h * 0.14);
    for (let s = 0; s < storeys; s++) {
      const y = (h / storeys) * s + (h / storeys) * 0.62;
      g.add(bx(w * 0.92, bandH, 0.08, band, 0, y, -d / 2 - 0.04));
      g.add(bx(w * 0.92, bandH, 0.08, band, 0, y, d / 2 + 0.04));
      g.add(bx(0.08, bandH, d * 0.9, bandX, -w / 2 - 0.04, y, 0));
      g.add(bx(0.08, bandH, d * 0.9, bandX, w / 2 + 0.04, y, 0));
    }
  }
  if (facade === 'stone' || facade === 'concrete') {
    const win = M.tinted();
    const n = Math.max(1, Math.floor(w / 4));
    for (let s = 0; s < storeys; s++) for (let k = 0; k < n; k++) {
      const x = -w / 2 + (w / n) * (k + 0.5);
      const y = (h / storeys) * s + (h / storeys) * 0.55;
      for (const z of [-d / 2 - 0.03, d / 2 + 0.03]) g.add(bx(Math.min(2, (w / n) * 0.5), Math.min(1.8, h / storeys * 0.45), 0.06, win, x, y, z));
    }
  }
  // Rooftop plant: a few units, placed from the id so every copy of a type looks the same.
  const units = Math.max(1, Math.min(6, Math.round((w * d) / 1800)));
  for (let k = 0; k < units; k++) {
    const x = (pick(def.id, k) - 0.5) * w * 0.7;
    const z = (pick(def.id, k + 11) - 0.5) * d * 0.7;
    g.add(bx(Math.min(6, w * 0.12), 1.4, Math.min(3, d * 0.1), M.paint(0xc5cacf), x, h + 0.7, z));
    g.add(cyl(0.5, 0.5, 0.2, M.paint(0x6c737a), x, h + 1.5, z, 16));
  }
  // Entrance canopy on the plan-south face (+Z), where the roads and visitors are.
  if (use === 'office' || use === 'training' || use === 'canteen' || use === 'security') {
    const cw = Math.min(12, w * 0.4);
    g.add(bx(cw, 0.3, 3, M.paint(0xe9ecef), 0, Math.min(3.6, h * 0.6), d / 2 + 1.5));
    for (const sx of [-1, 1]) g.add(cyl(0.12, 0.12, Math.min(3.6, h * 0.6), M.steel(), sx * (cw / 2 - 0.3), Math.min(3.6, h * 0.6) / 2, d / 2 + 2.7));
    g.add(bx(Math.min(4, cw * 0.5), 2.6, 0.08, M.glass(), 0, 1.3, d / 2 + 0.04));
  }
  if (use === 'mosque') {
    g.add(mesh(new THREE.SphereGeometry(Math.min(w, d) * 0.32, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), M.gloss(0xe8e2d4), 0, h, 0));
    const tower = cyl(1.1, 1.3, h * 2.2, M.paint(0xefe9dd), w / 2 - 1.6, h * 1.1, d / 2 - 1.6, 12);
    g.add(tower);
    g.add(mesh(new THREE.ConeGeometry(1.2, 3, 12), M.gloss(0xd9cfb9), w / 2 - 1.6, h * 2.2 + 1.5, d / 2 - 1.6));
  }
  // Loading docks on the plan-south face.
  const docks = metaNumber(def, 'docks') ?? 0;
  for (let k = 0; k < docks; k++) {
    const x = -w / 2 + (w / (docks + 1)) * (k + 1);
    g.add(bx(3.4, 4, 0.1, M.paint(0x41474e), x, 2.6, d / 2 + 0.05));
    for (const sx of [-1, 1]) g.add(bx(0.25, 0.35, 0.3, M.rubber(), x + sx * 1.9, 1.2, d / 2 + 0.2));
    g.add(bx(4.2, 1.2, 0.2, M.paint(0x2f343a), x, 1.1, d / 2 + 0.1));
  }
  if (docks > 0) g.add(bx(w * 0.9, 0.25, 3.5, M.paint(0xdfe3e6), 0, 5.4, d / 2 + 1.75));
  const sign = metaText(def, 'sign');
  if (sign) {
    const texture = signTexture(sign);
    const sw = Math.min(w * 0.45, 42);
    const sh = sw / 4;
    const signMat = mat(`sign:${sign}`, () => new THREE.MeshStandardMaterial({ map: texture, transparent: true, roughness: 0.4, metalness: 0.2, emissive: 0x1428a0, emissiveIntensity: 0.15 }));
    for (const [z, turn] of [[d / 2 + 0.06, 0], [-d / 2 - 0.06, Math.PI]] as const) {
      const plane = mesh(new THREE.PlaneGeometry(sw, sh), signMat, 0, h - sh / 2 - 0.6, z, false);
      plane.rotation.y = turn;
      g.add(plane);
    }
  }
}

function lamp(g: THREE.Group, h: number): void {
  g.add(cyl(0.2, 0.25, 0.4, M.paint(0x9a9d9f), 0, 0.2, 0, 10));
  g.add(cyl(0.05, 0.09, h - 0.4, M.paint(0x5c6166), 0, 0.4 + (h - 0.4) / 2, 0, 10));
  g.add(bx(0.06, 0.06, 1.4, M.paint(0x5c6166), 0, h - 0.05, -0.7));
  g.add(bx(0.3, 0.1, 0.6, M.paint(0x3d4146), 0, h - 0.08, -1.35));
  const glow = bx(0.24, 0.02, 0.5, M.emissive(0xfff1c8, 2.2), 0, h - 0.14, -1.35);
  glow.castShadow = false;
  g.add(glow);
}

function canopy(g: THREE.Group, w: number, d: number, h: number, elevation: number): void {
  const membrane = mat('shade-membrane', () => new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.85, side: THREE.DoubleSide }));
  const roof = bx(w, Math.max(0.05, h * 0.4), d, membrane, 0, h * 0.6);
  roof.rotation.x = -0.04;
  g.add(roof);
  g.add(bx(w, 0.12, 0.12, M.steel(), 0, h * 0.4, d / 2 - 0.3));
  if (elevation <= 0) return;
  const posts = Math.max(2, Math.round(w / 6) + 1);
  for (let k = 0; k < posts; k++) {
    const x = -w / 2 + 0.3 + ((w - 0.6) / (posts - 1)) * k;
    g.add(bx(0.14, elevation + h * 0.4, 0.14, M.steel(), x, (h * 0.4 - elevation) / 2, d / 2 - 0.3));
  }
}

function flags(g: THREE.Group, w: number, h: number): void {
  const kinds: Array<'eg' | 'company'> = ['eg', 'company', 'eg'];
  kinds.forEach((kind, k) => {
    const x = -w / 2 + (w / 3) * (k + 0.5);
    g.add(cyl(0.05, 0.07, h, M.chrome(), x, h / 2, 0, 10));
    const cloth = mesh(new THREE.PlaneGeometry(1.8, 1.2, 8, 1), mat(`flag:${kind}`, () => new THREE.MeshStandardMaterial({ map: flagTexture(kind, 'SAMSUNG'), side: THREE.DoubleSide, roughness: 0.8 })), x + 0.92, h - 0.8, 0, false);
    const p = cloth.geometry.attributes.position!;
    for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin((p.getX(i) + 0.9) * 2.4) * 0.12);
    cloth.geometry.computeVertexNormals();
    g.add(cloth);
  });
}

function partition(g: THREE.Group, w: number, d: number, h: number, glass: boolean): void {
  if (!glass) {
    g.add(bx(w, h, d, M.plaster()));
    g.add(bx(w + 0.002, 0.08, d + 0.012, M.paint(0x6f6a61), 0, 0.04));
    return;
  }
  const frame = M.alu();
  g.add(bx(w, 0.05, d, frame, 0, 0.025));
  g.add(bx(w, 0.05, d, frame, 0, h - 0.025));
  const pane = bx(w, h - 0.1, d * 0.3, M.glass(), 0, h / 2);
  pane.castShadow = false;
  g.add(pane);
  // Frosted manifestation band at eye level, as safety glazing needs.
  if (h > 1.2) g.add(bx(w, 0.12, d * 0.32, mat('frost', () => new THREE.MeshStandardMaterial({ color: 0xf2f5f7, roughness: 0.6, transparent: true, opacity: 0.7 })), 0, 1.1));
  const mullions = Math.max(1, Math.round(w / 1.2));
  for (let k = 0; k <= mullions; k++) g.add(bx(0.04, h, d, frame, -w / 2 + 0.02 + ((w - 0.04) / mullions) * k, h / 2));
}

function screen(g: THREE.Group, w: number, d: number, h: number): void {
  const panelW = w * 0.96;
  const panelH = Math.min(panelW * 0.5625, h * 0.62);
  const face = [M.blackPlastic(), M.blackPlastic(), M.blackPlastic(), M.blackPlastic(), M.blackPlastic(), M.screen()];
  g.add(bx(panelW, panelH, 0.05, face, 0, h - panelH / 2, 0));
  g.add(bx(0.08, h - panelH, 0.06, M.alu(), 0, (h - panelH) / 2, 0.02));
  g.add(bx(Math.min(w * 0.5, 0.9), 0.03, d * 0.9, M.alu(), 0, 0.015, 0));
}

function machine(g: THREE.Group, w: number, d: number, h: number, def: ItemDefinition): void {
  const name = def.name.toLowerCase();
  const body = M.gloss(0xe9ebee);
  const trim = M.paint(0x2f3a4a);
  g.add(bx(w, 0.12, d, trim, 0, 0.06));
  g.add(rbx(w * 0.98, h * 0.7, d * 0.98, 0.04, body, 0, 0.12 + h * 0.35));
  g.add(bx(w * 0.98, h - 0.12 - h * 0.7, d * 0.98, M.paint(0xcfd4d9), 0, 0.12 + h * 0.7 + (h - 0.12 - h * 0.7) / 2));
  // A window band along both long sides; long machines (ovens, tunnels) show what runs inside.
  const glassY = 0.12 + h * 0.46;
  const glassH = h * 0.26;
  for (const sx of [-1, 1]) {
    const pane = bx(0.03, glassH, d * 0.86, M.tinted(), sx * (w * 0.49 + 0.01), glassY, 0);
    g.add(pane);
  }
  if (name.includes('ageing') || name.includes('aging')) {
    const n = Math.floor(d / 1.2);
    for (let k = 0; k < n; k++) for (const sx of [-1, 1]) {
      const tv = bx(0.02, glassH * 0.7, 0.9, M.screen(), sx * (w * 0.49 + 0.03), glassY, -d / 2 + 0.6 + k * 1.2 + 0.1);
      tv.castShadow = false;
      g.add(tv);
    }
  }
  if (name.includes('reflow') || name.includes('oven')) for (const z of [-d / 4, d / 4]) g.add(cyl(0.12, 0.12, 0.6, M.steel(), 0, h + 0.3, z, 12));
  if (name.includes('robot')) {
    g.add(cyl(0.25, 0.3, 0.4, M.gloss(0xf0b429), 0, h + 0.2, 0, 16));
    const arm = bx(0.16, 1.1, 0.16, M.gloss(0xf0b429), 0, h + 0.8, -0.1);
    arm.rotation.x = 0.5;
    g.add(arm);
  }
  // Signal tower (green, amber, red) and a control panel at the front corner.
  const tx = w / 2 - 0.12;
  const tz = -d / 2 + 0.12;
  g.add(cyl(0.02, 0.02, 0.2, M.steel(), tx, h + 0.1, tz, 8));
  [0x2fbf5a, 0xf2b01e, 0xd93a2e].forEach((c, k) => g.add(cyl(0.045, 0.045, 0.08, M.emissive(c, k === 0 ? 2 : 0.5), tx, h + 0.24 + k * 0.085, tz, 12)));
  g.add(bx(0.36, 0.3, 0.06, [M.blackPlastic(), M.blackPlastic(), M.blackPlastic(), M.blackPlastic(), M.blackPlastic(), M.screen()], w * 0.2, h * 0.62, -d / 2 - 0.035));
  g.add(bx(w * 0.4, 0.05, 0.01, mat('brand-stripe', () => new THREE.MeshStandardMaterial({ color: COLORS.brand, roughness: 0.4 })), -w * 0.2, h * 0.84, -d / 2 - 0.006));
}

function conveyor(g: THREE.Group, w: number, d: number, h: number, def: ItemDefinition): void {
  const name = def.name.toLowerCase();
  const frame = M.alu();
  const belt = mat('belt', () => new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.75 }));
  g.add(bx(w * 0.8, 0.04, d, belt, 0, h - 0.02));
  for (const sx of [-1, 1]) g.add(bx(0.05, 0.12, d, frame, sx * (w * 0.4 + 0.03), h - 0.04));
  const legsN = Math.max(2, Math.round(d / 1.5) + 1);
  for (let k = 0; k < legsN; k++) {
    const z = -d / 2 + 0.1 + ((d - 0.2) / (legsN - 1)) * k;
    for (const sx of [-1, 1]) g.add(bx(0.05, h - 0.1, 0.05, frame, sx * w * 0.36, (h - 0.1) / 2, z));
  }
  // Work in progress on the belt: TV sets lie face down, phones ride in trays.
  const tv = name.includes('tv') || name.includes('set') || name.includes('module') || name.includes('backlight');
  const pitch = tv ? 1.8 : 0.6;
  const n = Math.floor(d / pitch);
  for (let k = 0; k < n; k++) {
    const z = -d / 2 + pitch * (k + 0.5);
    if (tv) g.add(bx(w * 0.72, 0.05, 1.1, [M.blackPlastic(), M.blackPlastic(), M.paint(0x3a3f47), M.blackPlastic(), M.blackPlastic(), M.blackPlastic()], 0, h + 0.03, z));
    else g.add(bx(w * 0.5, 0.05, 0.35, M.paint(0x5d7896), 0, h + 0.03, z));
  }
  // Tool gantries over the line every 4 m: screwdrivers on balancers for the operators.
  const gantries = Math.max(1, Math.floor(d / 4));
  for (let k = 0; k < gantries; k++) {
    const z = -d / 2 + (d / gantries) * (k + 0.5);
    for (const sx of [-1, 1]) g.add(bx(0.06, 2.1, 0.06, M.paint(0x3a5f95), sx * (w / 2 + 0.25), 1.05, z));
    g.add(bx(w + 0.56, 0.08, 0.08, M.paint(0x3a5f95), 0, 2.1, z));
    for (const sx of [-1, 1]) g.add(cyl(0.02, 0.02, 0.5, M.blackPlastic(), sx * w * 0.3, 1.8, z, 8));
    const lamp = bx(w * 0.8, 0.03, 0.2, M.emissive(0xf5f9ff, 1.6), 0, 2.05, z + 0.2);
    lamp.castShadow = false;
    g.add(lamp);
  }
}

function workbench(g: THREE.Group, w: number, d: number, h: number, def: ItemDefinition): void {
  const top = mat('esd-mat', () => new THREE.MeshStandardMaterial({ color: 0x5d7896, roughness: 0.8 }));
  g.add(bx(w, 0.04, d, top, 0, h - 0.02));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(bx(0.05, h - 0.04, 0.05, M.paint(0xb9bfc6), sx * (w / 2 - 0.05), (h - 0.04) / 2, sz * (d / 2 - 0.05)));
  g.add(bx(w - 0.1, 0.02, d - 0.1, M.steel(), 0, 0.2));
  if (def.meta?.kind === 'sink') {
    for (let k = 0; k < 2; k++) g.add(bx(0.8, 0.14, 0.6, M.palletWood(), -w / 4 + k * (w / 2), h + 0.07, 0));
    return;
  }
  // Rear upright with a shelf of parts bins and a task light (operator sits at +Z).
  for (const sx of [-1, 1]) g.add(bx(0.04, 0.7, 0.04, M.paint(0xb9bfc6), sx * (w / 2 - 0.05), h + 0.35, -d / 2 + 0.05));
  g.add(bx(w - 0.1, 0.02, 0.25, M.steel(), 0, h + 0.45, -d / 2 + 0.15));
  const bins = Math.max(2, Math.floor(w / 0.3));
  for (let k = 0; k < bins; k++) g.add(bx(0.22, 0.12, 0.2, M.paint(0x2a6fd6), -w / 2 + 0.2 + ((w - 0.4) / (bins - 1)) * k, h + 0.52, -d / 2 + 0.15));
  const light = bx(w * 0.7, 0.03, 0.08, M.emissive(0xf6fbff, 1.6), 0, h + 0.68, -d / 2 + 0.2);
  light.castShadow = false;
  g.add(light);
  g.add(bx(0.3, 0.2, 0.02, [M.blackPlastic(), M.blackPlastic(), M.blackPlastic(), M.blackPlastic(), M.screen(), M.blackPlastic()], w * 0.25, h + 0.2, -d / 2 + 0.3));
}

function locker(g: THREE.Group, w: number, d: number, h: number): void {
  const doors = mat('locker-doors', () => new THREE.MeshStandardMaterial({ color: 0x7f9bb8, roughness: 0.5, metalness: 0.3, map: lockerDoors() }));
  const side = M.paint(0x7f9bb8);
  g.add(bx(w, h - 0.1, d, [side, side, side, side, side, doors], 0, 0.1 + (h - 0.1) / 2));
  g.add(bx(w, 0.1, d - 0.05, M.paint(0x3d4146), 0, 0.05));
}

function boxLike(g: THREE.Group, w: number, d: number, h: number, ctx: ModelContext): void {
  const def = ctx.definition;
  const kind = def.meta?.kind;
  if (kind === 'source' || kind === 'machine' || kind === 'buffer' || kind === 'inspection' || kind === 'sink') {
    machine(g, w, d, h, def);
    return;
  }
  switch (def.id) {
    case 'whiteboard':
      g.add(bx(w, h * 0.45, 0.03, M.paint(0xfafafa), 0, h * 0.72));
      for (const sx of [-1, 1]) g.add(bx(0.04, h, 0.04, M.alu(), sx * (w / 2 - 0.05), h / 2));
      for (const sx of [-1, 1]) g.add(bx(0.05, 0.03, 0.5, M.alu(), sx * (w / 2 - 0.05), 0.015));
      return;
    case 'printer':
      g.add(rbx(w, h * 0.6, d, 0.03, M.paint(0xe6e7e8), 0, h * 0.3));
      g.add(rbx(w * 0.96, h * 0.4, d * 0.9, 0.03, M.paint(0x3a3d42), 0, h * 0.8));
      return;
    case 'phone-booth':
      g.add(bx(w, h, d, M.glass()));
      g.add(bx(w, 0.1, d, M.paint(0x4a4f57), 0, h - 0.05));
      g.add(bx(w, 0.05, d, M.paint(0x4a4f57), 0, 0.025));
      return;
    case 'speaker':
      g.add(bx(0.05, h * 0.6, 0.05, M.blackPlastic(), 0, h * 0.3));
      g.add(rbx(w * 0.9, h * 0.35, d * 0.8, 0.03, M.paint(0x1a1b1d), 0, h * 0.8));
      return;
    case 'screen':
      g.add(bx(w, h * 0.72, 0.03, M.paint(0xf6f6f6), 0, h * 0.6, -d / 2 + 0.05));
      for (const sx of [-1, 1]) g.add(bx(0.05, h, 0.05, M.blackPlastic(), sx * (w / 2 - 0.05), h / 2, 0));
      return;
    case 'backdrop':
      g.add(bx(w, h, d * 0.3, mat('backdrop', () => new THREE.MeshStandardMaterial({ color: 0x1428a0, roughness: 0.7 })), 0, h / 2));
      return;
    default:
  }
  const palletColour = ctx.pallet;
  if (palletColour !== undefined) {
    g.add(bx(w, 0.14, d, M.palletWood()));
    const load = mesh(new THREE.BoxGeometry(w * 0.97, Math.max(0.05, h - 0.14), d * 0.95), mat(`pallet-load:${palletColour}`, () => new THREE.MeshStandardMaterial({ color: palletColour, map: cartonStack(), roughness: 0.6 })), 0, 0.14 + Math.max(0.05, h - 0.14) / 2);
    g.add(load);
    return;
  }
  const print = metaText(def, 'print');
  const map = print ? printedCarton(print) : null;
  if (!map) {
    g.add(bx(w, h, d, M.carton()));
    return;
  }
  // Print on the two large upright faces; box faces are ordered +x, −x, +y, −y, +z, −z.
  const plain = M.carton();
  const printed = mat(`printed:${print}`, () => new THREE.MeshStandardMaterial({ color: 0xffffff, map, roughness: 0.7 }));
  const faces = w >= d ? [plain, plain, plain, plain, printed, printed] : [printed, printed, plain, plain, plain, plain];
  g.add(bx(w, h, d, faces));
}
