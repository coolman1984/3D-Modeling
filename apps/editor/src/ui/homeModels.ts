import type { ItemDefinition } from '@space-planner/core';
import * as THREE from 'three';
import { bx, cyl, mat, mesh, M, rbx } from './models3d.js';
import { artwork, bookSpines, marbleSlab, rugPattern, woodGrain } from './textures.js';

/**
 * 3D models of the home pack (decision 0027): the pieces an interior designer shows a client, so
 * they carry the details people recognise — loose cushions, folded throws, made beds, books on a
 * shelf, a laid table, a lamp that glows. Same frame as every model: width along X, depth along
 * Z, front facing −Z, standing on Y = 0. Colours come from the item type's meta (`fabric`, `wood`,
 * `art`), so a variant is a new catalog entry, not new code.
 */

export const HOME_SHAPES = new Set([
  'sectional', 'armchair', 'coffee-table', 'side-table', 'tv-unit', 'bookcase', 'rug', 'floor-lamp', 'house-plant', 'curtains',
  'wall-art', 'mirror', 'wall-tv', 'wall-shelf', 'dining-set', 'sideboard', 'pendant', 'bed', 'nightstand', 'wardrobe', 'dresser',
  'kitchen', 'island', 'fridge', 'bathtub', 'shower', 'toilet', 'basin', 'washer',
]);

// ─── Materials ────────────────────────────────────────────────────────────────────────────────

const std = (key: string, color: number, roughness: number, metalness = 0, extra: THREE.MeshStandardMaterialParameters = {}) =>
  mat(key, () => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra }));

const H = {
  /** Upholstery: soft, fully rough, a touch of sheen so folds read. */
  // Standard materials only: a physical sheen or transmission costs an extra shader or a whole
  // extra render pass on every frame, for a difference people do not see at room scale.
  fabric: (color: number) => std(`home-fabric:${color}`, color, 0.95),
  oak: () => mat('home-oak', () => new THREE.MeshStandardMaterial({ color: 0xc8a172, roughness: 0.55, map: woodGrain() })),
  walnut: () => mat('home-walnut', () => new THREE.MeshStandardMaterial({ color: 0x6e4a31, roughness: 0.5, map: woodGrain() })),
  linen: () => std('home-linen', 0xf6f3ee, 0.95),
  porcelain: () => std('home-porcelain', 0xfbfaf8, 0.18),
  ceramic: (color: number) => std(`home-ceramic:${color}`, color, 0.35),
  brass: () => std('home-brass', 0xc9a25e, 0.3, 1),
  chrome: () => M.chrome(),
  black: () => std('home-black', 0x1d1e20, 0.5, 0.2),
  lacquer: () => std('home-lacquer', 0xf3f1ec, 0.35),
  glass: () => mat('home-glass', () => new THREE.MeshStandardMaterial({ color: 0xdfeaf0, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.28, depthWrite: false })),
  mirror: () => std('home-mirror', 0xdfe6ea, 0.03, 1),
  /** A lamp shade lit from inside: warm and slightly translucent. */
  shade: () => mat('home-shade', () => new THREE.MeshStandardMaterial({ color: 0xfff4e2, emissive: 0xffd9a0, emissiveIntensity: 0.9, roughness: 0.9, side: THREE.DoubleSide })),
  bulb: () => M.emissive(0xffe2b0, 2.2),
  leaf: (color: number) => std(`home-leaf:${color}`, color, 0.6, 0, { side: THREE.DoubleSide }),
  soil: () => M.soil(),
  marble: () => mat('home-marble', () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.12, map: marbleSlab() })),
  steel: () => std('home-steel', 0xd5d8dc, 0.28, 0.85),
};

/** The wood (or stone) of a piece, from `meta.wood`. */
function wood(def: ItemDefinition): THREE.Material {
  switch (def.meta?.wood) {
    case 'walnut':
      return H.walnut();
    case 'white':
      return H.lacquer();
    case 'black':
      return H.black();
    case 'marble':
      return H.marble();
    default:
      return H.oak();
  }
}

const fabricOf = (def: ItemDefinition, fallback = 0xd9cfbf) => (typeof def.meta?.fabric === 'number' ? (def.meta.fabric as number) : fallback);
const artOf = (def: ItemDefinition) => (typeof def.meta?.art === 'number' ? (def.meta.art as number) : 1);
const styleOf = (def: ItemDefinition) => (typeof def.meta?.style === 'string' ? (def.meta.style as string) : '');

/** A darker or lighter tone of a colour, for piping, a throw or an accent cushion. */
function tone(color: number, k: number): number {
  const c = new THREE.Color(color);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.min(0.95, Math.max(0.05, hsl.l * k)));
  return c.getHex();
}

/** Thin tapered legs at the corners, set in from the edges. */
function taperedLegs(g: THREE.Group, w: number, d: number, height: number, material: THREE.Material, inset = 0.06, r = 0.018): void {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(cyl(r, r * 0.6, height, material, sx * (w / 2 - inset), height / 2, sz * (d / 2 - inset), 10));
}

function soft(w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number, r = 0.05): THREE.Mesh {
  return rbx(w, h, d, Math.min(r, h / 2.2, w / 2.2, d / 2.2), material, x, y, z);
}

// ─── Builder ──────────────────────────────────────────────────────────────────────────────────

/** Adds the model of a home shape to `g`; false when the shape is not a home shape. */
export function buildHomeModel(g: THREE.Group, shape: string, w: number, d: number, h: number, def: ItemDefinition): boolean {
  switch (shape) {
    case 'sofa':
      sofa(g, w, d, h, def);
      return true;
    case 'sectional':
      sectional(g, w, d, h, def);
      return true;
    case 'armchair':
      armchair(g, w, d, h, def);
      return true;
    case 'coffee-table':
      coffeeTable(g, w, d, h, def);
      return true;
    case 'side-table':
      sideTable(g, w, h, def);
      return true;
    case 'tv-unit':
      tvUnit(g, w, d, h, def);
      return true;
    case 'bookcase':
      bookcase(g, w, d, h, def);
      return true;
    case 'rug':
      rug(g, w, d, def);
      return true;
    case 'floor-lamp':
      floorLamp(g, w, d, h, def);
      return true;
    case 'house-plant':
      plant(g, w, h, def);
      return true;
    case 'curtains':
      curtains(g, w, d, h, def);
      return true;
    case 'wall-art':
      wallArt(g, w, d, h, def);
      return true;
    case 'mirror':
      mirror(g, w, d, h);
      return true;
    case 'wall-tv':
      wallTv(g, w, d, h);
      return true;
    case 'wall-shelf':
      wallShelf(g, w, d, h, def);
      return true;
    case 'dining-set':
      diningSet(g, w, d, h, def);
      return true;
    case 'sideboard':
      sideboard(g, w, d, h, def);
      return true;
    case 'pendant':
      pendant(g, w, h);
      return true;
    case 'bed':
      bed(g, w, d, h, def);
      return true;
    case 'nightstand':
      nightstand(g, w, d, h, def);
      return true;
    case 'wardrobe':
      wardrobe(g, w, d, h, def);
      return true;
    case 'dresser':
      dresser(g, w, d, h, def);
      return true;
    case 'kitchen':
      kitchen(g, w, d, h, def);
      return true;
    case 'island':
      island(g, w, d, h, def);
      return true;
    case 'fridge':
      fridge(g, w, d, h);
      return true;
    case 'bathtub':
      bathtub(g, w, d, h);
      return true;
    case 'shower':
      shower(g, w, d, h);
      return true;
    case 'toilet':
      toilet(g, w, d, h);
      return true;
    case 'basin':
      basin(g, w, d, h, def);
      return true;
    case 'washer':
      washer(g, w, d, h);
      return true;
    default:
      return false;
  }
}

// ─── Living ───────────────────────────────────────────────────────────────────────────────────

/** Loose seat and back cushions on a low base, rounded arms, slim legs and two throw pillows. */
function sofa(g: THREE.Group, w: number, d: number, h: number, def: ItemDefinition): void {
  const cloth = H.fabric(fabricOf(def));
  const legH = 0.1;
  const arm = Math.min(0.2, w * 0.1);
  const seatTop = 0.44;
  const backD = Math.min(0.24, d * 0.26);
  g.add(soft(w, 0.2, d, cloth, 0, legH + 0.1, 0, 0.04)); // base
  g.add(soft(w - arm * 2 + 0.02, h - legH - 0.12, backD, cloth, 0, legH + 0.12 + (h - legH - 0.12) / 2, d / 2 - backD / 2, 0.06)); // back frame
  for (const sx of [-1, 1]) g.add(soft(arm, 0.62 - legH, d, cloth, sx * (w / 2 - arm / 2), legH + (0.62 - legH) / 2, 0, 0.08));
  const n = w > 1.9 ? 3 : w > 1.3 ? 2 : 1;
  const inner = w - arm * 2;
  const seatD = d - backD - 0.02;
  for (let k = 0; k < n; k++) {
    const x = -inner / 2 + (inner / n) * (k + 0.5);
    g.add(soft(inner / n - 0.015, seatTop - legH - 0.2, seatD, cloth, x, legH + 0.2 + (seatTop - legH - 0.2) / 2, -d / 2 + seatD / 2, 0.07));
    const back = soft(inner / n - 0.03, h - seatTop - 0.02, 0.17, cloth, x, seatTop + (h - seatTop) / 2, d / 2 - backD - 0.06, 0.08);
    back.rotation.x = -0.12;
    g.add(back);
  }
  // Two throw pillows in a deeper tone, turned a little.
  const accent = H.fabric(tone(fabricOf(def), 0.72));
  for (const sx of [-1, 1]) {
    const p = soft(0.42, 0.4, 0.13, accent, sx * (inner / 2 - 0.25), seatTop + 0.18, d / 2 - backD - 0.2, 0.06);
    p.rotation.set(-0.25, sx * 0.25, sx * 0.08);
    g.add(p);
  }
  taperedLegs(g, w, d, legH, wood(def), 0.07, 0.02);
}

/** An L-shaped corner sofa: the long run at the back, the chaise on the left reaching the front. */
function sectional(g: THREE.Group, w: number, d: number, h: number, def: ItemDefinition): void {
  const cloth = H.fabric(fabricOf(def));
  const runD = 0.98;
  const chaiseW = 0.95;
  const legH = 0.1;
  const seatTop = 0.44;
  const back = 0.24;
  // Long run along the back.
  g.add(soft(w, 0.2, runD, cloth, 0, legH + 0.1, d / 2 - runD / 2, 0.04));
  g.add(soft(w, h - legH - 0.12, back, cloth, 0, legH + 0.12 + (h - legH - 0.12) / 2, d / 2 - back / 2, 0.06));
  // Chaise on the left, front part.
  const chaiseD = d - runD;
  g.add(soft(chaiseW, 0.2, chaiseD + 0.02, cloth, -w / 2 + chaiseW / 2, legH + 0.1, -d / 2 + chaiseD / 2, 0.04));
  // Arm at the right end and along the chaise's outer side.
  g.add(soft(0.2, 0.62 - legH, runD, cloth, w / 2 - 0.1, legH + (0.62 - legH) / 2, d / 2 - runD / 2, 0.08));
  g.add(soft(0.2, 0.62 - legH, d - back, cloth, -w / 2 + 0.1, legH + (0.62 - legH) / 2, -back / 2, 0.08));
  // Seat cushions: three along the run, one long one on the chaise.
  const seatH = seatTop - legH - 0.2;
  const runInner = w - chaiseW - 0.2;
  for (let k = 0; k < 3; k++) {
    const x = -w / 2 + chaiseW + (runInner / 3) * (k + 0.5);
    g.add(soft(runInner / 3 - 0.015, seatH, runD - back - 0.02, cloth, x, legH + 0.2 + seatH / 2, d / 2 - back - (runD - back) / 2, 0.07));
    const b = soft(runInner / 3 - 0.03, h - seatTop - 0.02, 0.17, cloth, x, seatTop + (h - seatTop) / 2, d / 2 - back - 0.06, 0.08);
    b.rotation.x = -0.12;
    g.add(b);
  }
  g.add(soft(chaiseW - 0.22, seatH, d - back - 0.04, cloth, -w / 2 + 0.2 + (chaiseW - 0.2) / 2, legH + 0.2 + seatH / 2, -back / 2, 0.07));
  const cb = soft(chaiseW - 0.24, h - seatTop - 0.02, 0.17, cloth, -w / 2 + 0.2 + (chaiseW - 0.2) / 2, seatTop + (h - seatTop) / 2, d / 2 - back - 0.06, 0.08);
  cb.rotation.x = -0.12;
  g.add(cb);
  // Pillows and a folded throw over the chaise.
  const accent = H.fabric(tone(fabricOf(def), 0.7));
  for (const x of [w / 2 - 0.45, -w / 2 + chaiseW + 0.2]) {
    const p = soft(0.44, 0.42, 0.13, accent, x, seatTop + 0.19, d / 2 - back - 0.2, 0.06);
    p.rotation.set(-0.25, 0.2, 0.06);
    g.add(p);
  }
  g.add(soft(chaiseW - 0.3, 0.03, 0.5, H.fabric(tone(fabricOf(def), 0.55)), -w / 2 + 0.2 + (chaiseW - 0.2) / 2, seatTop + 0.015, -d / 2 + 0.4, 0.012));
  taperedLegs(g, w, d, legH, wood(def), 0.08, 0.02);
}

/** A rounded lounge chair: one-piece shell, deep seat cushion, wooden legs. */
function armchair(g: THREE.Group, w: number, d: number, h: number, def: ItemDefinition): void {
  const cloth = H.fabric(fabricOf(def));
  const legH = 0.14;
  const shell = new THREE.Group();
  shell.add(soft(w, 0.18, d, cloth, 0, legH + 0.09, 0, 0.06));
  shell.add(soft(w, h - legH - 0.1, 0.16, cloth, 0, legH + 0.1 + (h - legH - 0.1) / 2, d / 2 - 0.08, 0.08));
  for (const sx of [-1, 1]) shell.add(soft(0.13, 0.55 - legH, d - 0.04, cloth, sx * (w / 2 - 0.065), legH + (0.55 - legH) / 2 + 0.05, -0.02, 0.06));
  g.add(shell);
  g.add(soft(w - 0.28, 0.12, d - 0.22, cloth, 0, legH + 0.24, -0.05, 0.06));
  const p = soft(0.38, 0.34, 0.12, H.fabric(tone(fabricOf(def), 0.75)), 0, legH + 0.48, d / 2 - 0.26, 0.05);
  p.rotation.x = -0.25;
  g.add(p);
  taperedLegs(g, w, d, legH, wood(def), 0.08, 0.022);
}

/** Oak: a slab top, a lower shelf, books and a bowl. Marble: a round top on a fluted pedestal. */
function coffeeTable(g: THREE.Group, w: number, d: number, h: number, def: ItemDefinition): void {
  const top = wood(def);
  if (def.footprint === 'round') {
    const slab = cyl(w / 2, w / 2, 0.04, top, 0, h - 0.02, 0, 48);
    g.add(slab);
    g.add(cyl(w * 0.22, w * 0.26, h - 0.04, H.ceramic(0xe8e1d6), 0, (h - 0.04) / 2, 0, 24));
  } else {
    g.add(rbx(w, 0.035, d, 0.012, top, 0, h - 0.0175));
    g.add(bx(w - 0.1, 0.02, d - 0.1, top, 0, 0.12));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(bx(0.04, h - 0.035, 0.04, top, sx * (w / 2 - 0.06), (h - 0.035) / 2, sz * (d / 2 - 0.06)));
  }
  // A stack of books and a ceramic bowl.
  const books = [0x2f3c55, 0xe9e2d4, 0xb8694a];
  books.forEach((c, i) => {
    const b = bx(0.26 - i * 0.03, 0.03, 0.2 - i * 0.02, H.ceramic(c), -w * 0.18, h + 0.015 + i * 0.03, 0);
    b.rotation.y = 0.15 * (i - 1);
    g.add(b);
  });
  g.add(cyl(0.11, 0.06, 0.07, H.ceramic(0x2b2b2b), w * 0.2, h + 0.035, 0, 24));
}

function sideTable(g: THREE.Group, w: number, h: number, def: ItemDefinition): void {
  const m = wood(def);
  g.add(cyl(w / 2, w / 2, 0.03, m, 0, h - 0.015, 0, 32));
  g.add(cyl(0.025, 0.025, h - 0.03, m, 0, (h - 0.03) / 2, 0, 12));
  g.add(cyl(w * 0.35, w * 0.38, 0.02, m, 0, 0.01, 0, 32));
  g.add(cyl(0.05, 0.07, 0.18, H.ceramic(0xd9cfbf), 0, h + 0.09, 0, 16));
  g.add(sprigs(0.18, h + 0.18));
}

/** A low cabinet with slatted doors, the TV on its stand and a soundbar. */
function tvUnit(g: THREE.Group, w: number, d: number, h: number, def: ItemDefinition): void {
  const m = wood(def);
  const legH = 0.12;
  g.add(rbx(w, h - legH, d, 0.01, m, 0, legH + (h - legH) / 2));
  const slat = mat('home-slat', () => new THREE.MeshStandardMaterial({ color: 0x000000, transparent: true, opacity: 0.18 }));
  for (let x = -w / 2 + 0.05; x < w / 2 - 0.03; x += 0.035) g.add(bx(0.006, h - legH - 0.06, 0.004, slat, x, legH + (h - legH) / 2, -d / 2 - 0.002));
  taperedLegs(g, w, d, legH, m, 0.08, 0.018);
  const tvW = Math.min(1.45, w * 0.82);
  const tvH = tvW * 0.575;
  g.add(bx(0.3, 0.015, 0.2, H.black(), 0, h + 0.0075, 0.02));
  g.add(bx(0.05, 0.08, 0.03, H.black(), 0, h + 0.05, 0.05));
  g.add(bx(tvW, tvH, 0.03, H.black(), 0, h + 0.09 + tvH / 2, 0.05));
  g.add(bx(tvW - 0.02, tvH - 0.02, 0.002, M.screen(), 0, h + 0.09 + tvH / 2, 0.034));
  g.add(rbx(tvW * 0.6, 0.06, 0.09, 0.02, H.black(), 0, h + 0.03, -d / 2 + 0.08));
}

/** Shelves of books (generated spines) with a vase and a box here and there. */
function bookcase(g: THREE.Group, w: number, d: number, h: number, def: ItemDefinition): void {
  const m = wood(def);
  const t = 0.025;
  for (const sx of [-1, 1]) g.add(bx(t, h, d, m, sx * (w / 2 - t / 2), h / 2, 0));
  g.add(bx(w, t, d, m, 0, h - t / 2, 0));
  g.add(bx(w, 0.06, d, m, 0, 0.03, 0));
  g.add(bx(w - t * 2, h - 0.08, 0.01, m, 0, h / 2, d / 2 - 0.005));
  const shelves = 5;
  const step = (h - 0.08) / shelves;
  for (let i = 0; i < shelves; i++) {
    const y = 0.06 + step * i;
    if (i > 0) g.add(bx(w - t * 2, t, d - 0.01, m, 0, y, -0.005));
    const filled = (w - t * 2) * (i % 2 ? 0.62 : 0.78);
    const spines = mat(`home-spines:${i}`, () => new THREE.MeshStandardMaterial({ map: bookSpines(i + 3), transparent: true, alphaTest: 0.5, roughness: 0.7 }));
    const row = new THREE.Mesh(new THREE.PlaneGeometry(filled, step * 0.78), spines);
    row.position.set(-w / 2 + t + filled / 2 + (i % 2 ? 0.02 : 0), y + t / 2 + step * 0.39, -d / 2 + 0.04);
    row.rotation.y = Math.PI;
    row.scale.x = -1;
    g.add(row);
    g.add(bx(filled, step * 0.7, d * 0.55, mat('home-book-block', () => new THREE.MeshStandardMaterial({ color: 0xe9e2d4, roughness: 0.9 })), row.position.x, y + t / 2 + step * 0.35, 0.02));
    const free = w - t * 2 - filled;
    if (free > 0.12) {
      const x = i % 2 ? w / 2 - t - free / 2 : w / 2 - t - free / 2;
      if (i % 2) g.add(cyl(0.05, 0.07, step * 0.45, H.ceramic(i % 4 === 1 ? 0xb8694a : 0xe8e1d6), x, y + t / 2 + step * 0.225, 0, 16));
      else g.add(bx(Math.min(0.16, free - 0.02), 0.1, 0.16, H.ceramic(0x2b2b2b), x, y + t / 2 + 0.05, 0));
    }
  }
}

/** A woven rug lying flat, its pattern from `meta.art` and colour from `meta.fabric`. */
function rug(g: THREE.Group, w: number, d: number, def: ItemDefinition): void {
  const pattern = mat(`home-rug:${artOf(def)}:${fabricOf(def)}`, () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, map: rugPattern(artOf(def), fabricOf(def)) }));
  const geometry = def.footprint === 'round' ? new THREE.CylinderGeometry(w / 2, w / 2, 0.012, 64) : new THREE.BoxGeometry(w, 0.012, d);
  const r = mesh(geometry, pattern, 0, 0.006, 0, false);
  if (def.footprint === 'round') r.scale.z = d / w;
  g.add(r);
}

/** Arc lamp: marble base, brass arc, a dome reaching forward. Tripod: oak legs and a drum shade. */
function floorLamp(g: THREE.Group, w: number, d: number, h: number, def: ItemDefinition): void {
  if (styleOf(def) === 'arc') {
    g.add(cyl(w / 2, w / 2, 0.06, H.marble(), 0, 0.03, 0, 32));
    const reach = 1.5;
    const curve = new THREE.CubicBezierCurve3(new THREE.Vector3(0, 0.06, 0), new THREE.Vector3(0, h * 1.05, 0), new THREE.Vector3(0, h * 1.1, -reach * 0.6), new THREE.Vector3(0, h - 0.25, -reach));
    g.add(mesh(new THREE.TubeGeometry(curve, 48, 0.012, 8, false), H.brass()));
    g.add(mesh(new THREE.SphereGeometry(0.2, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), H.brass(), 0, h - 0.33, -reach));
    const glow = mesh(new THREE.CircleGeometry(0.19, 32), H.bulb(), 0, h - 0.331, -reach, false);
    glow.rotation.x = Math.PI / 2; // facing down
    g.add(glow);
    return;
  }
  const legMat = H.walnut();
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    const leg = cyl(0.012, 0.015, h * 0.82, legMat, Math.cos(a) * w * 0.28, h * 0.41, Math.sin(a) * w * 0.28, 8);
    leg.rotation.set(Math.sin(a) * 0.14, 0, -Math.cos(a) * 0.14);
    g.add(leg);
  }
  g.add(mesh(new THREE.CylinderGeometry(w * 0.42, w * 0.48, 0.32, 32, 1, true), H.shade(), 0, h - 0.16, 0));
  g.add(mesh(new THREE.SphereGeometry(0.05, 12, 8), H.bulb(), 0, h - 0.2, 0, false));
}

/** Small leafy sprigs in a vase, for side tables and shelves. */
function sprigs(size: number, y: number): THREE.Group {
  const s = new THREE.Group();
  for (let k = 0; k < 6; k++) {
    const leaf = mesh(new THREE.PlaneGeometry(size * 0.25, size * 0.5), H.leaf(0x5f7a4f), Math.sin(k * 2.4) * size * 0.2, y + size * (0.3 + (k % 3) * 0.15), Math.cos(k * 2.4) * size * 0.2);
    leaf.rotation.set(0.3, k * 1.1, 0.4);
    s.add(leaf);
  }
  return s;
}

/** Fiddle-leaf fig: a slim trunk and broad leaves. Snake plant: upright sword leaves. Both potted. */
function plant(g: THREE.Group, w: number, h: number, def: ItemDefinition): void {
  const potH = Math.min(0.42, h * 0.3);
  g.add(cyl(w * 0.4, w * 0.32, potH, H.ceramic(0xe8e1d6), 0, potH / 2, 0, 28));
  g.add(cyl(w * 0.37, w * 0.37, 0.02, H.soil(), 0, potH - 0.02, 0, 20));
  if (styleOf(def) === 'snake') {
    for (let k = 0; k < 11; k++) {
      const a = k * 2.39;
      const len = (h - potH) * (0.6 + ((k * 37) % 10) / 25);
      const leaf = mesh(new THREE.ConeGeometry(0.035, len, 4, 1), H.leaf(k % 2 ? 0x3f6b3a : 0x587f45), Math.cos(a) * w * 0.15, potH + len / 2, Math.sin(a) * w * 0.15);
      leaf.scale.set(1, 1, 0.25);
      leaf.rotation.set(Math.sin(a) * 0.12, a, -Math.cos(a) * 0.12);
      g.add(leaf);
    }
    return;
  }
  const trunk = cyl(0.015, 0.022, h - potH - 0.1, M.bark(), 0, potH + (h - potH - 0.1) / 2, 0, 8);
  g.add(trunk);
  const leafGeo = new THREE.SphereGeometry(0.1, 10, 6);
  leafGeo.scale(1, 1.25, 0.18);
  for (let k = 0; k < 26; k++) {
    const a = k * 2.399;
    const t = k / 26;
    const y = potH + 0.25 + t * (h - potH - 0.35);
    const r = w * (0.18 + 0.28 * Math.sin(t * Math.PI));
    const leaf = mesh(leafGeo, H.leaf(k % 3 ? 0x2f5a2c : 0x41723a), Math.cos(a) * r, y, Math.sin(a) * r);
    leaf.rotation.set(0.6, -a, 0.2);
    g.add(leaf);
  }
}

/** Floor-length linen curtains hung in soft folds from a slim rod. */
function curtains(g: THREE.Group, w: number, d: number, h: number, def: ItemDefinition): void {
  const cloth = mat(`home-curtain:${fabricOf(def)}`, () => new THREE.MeshStandardMaterial({ color: fabricOf(def), roughness: 1, side: THREE.DoubleSide, transparent: true, opacity: 0.92 }));
  for (const side of [-1, 1]) {
    const pw = w * 0.32;
    const geo = new THREE.PlaneGeometry(pw, h - 0.06, 24, 1);
    const pos = geo.attributes.position!;
    for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin((pos.getX(i) / pw) * Math.PI * 7) * d * 0.35);
    geo.computeVertexNormals();
    g.add(mesh(geo, cloth, side * (w / 2 - pw / 2), (h - 0.06) / 2, 0));
  }
  const rod = cyl(0.01, 0.01, w, H.brass(), 0, h - 0.03, 0, 8);
  rod.rotation.z = Math.PI / 2;
  g.add(rod);
}

// ─── Walls ────────────────────────────────────────────────────────────────────────────────────

/** Framed prints: one, or a set of three side by side; the picture comes from `meta.art`. */
function wallArt(g: THREE.Group, w: number, d: number, h: number, def: ItemDefinition): void {
  const n = w > 1.2 ? 3 : 1;
  const gap = 0.06;
  const fw = (w - gap * (n - 1)) / n;
  const frame = artOf(def) % 2 ? H.oak() : H.black();
  for (let k = 0; k < n; k++) {
    const x = -w / 2 + fw / 2 + k * (fw + gap);
    g.add(bx(fw, h, d * 0.6, frame, x, h / 2, d * 0.2));
    g.add(bx(fw - 0.04, h - 0.04, 0.004, H.linen(), x, h / 2, -d * 0.1));
    const picture = mat(`home-art:${artOf(def) + k}`, () => new THREE.MeshStandardMaterial({ map: artwork(artOf(def) + k), roughness: 0.85 }));
    const p = new THREE.Mesh(new THREE.PlaneGeometry(fw - 0.14, h - 0.14), picture);
    p.position.set(x, h / 2, -d * 0.1 - 0.003);
    p.rotation.y = Math.PI;
    g.add(p);
  }
}

/** An arched mirror in a slim brass frame; the glass faces the room (−Z). */
function mirror(g: THREE.Group, w: number, d: number, h: number): void {
  const arch = (r: number, bottom: number) => {
    const shape = new THREE.Shape();
    shape.moveTo(-r, bottom);
    shape.lineTo(r, bottom);
    shape.lineTo(r, h - w / 2);
    shape.absarc(0, h - w / 2, r, 0, Math.PI, false);
    shape.lineTo(-r, bottom);
    return shape;
  };
  g.add(mesh(new THREE.ExtrudeGeometry(arch(w / 2, 0), { depth: d * 0.6, bevelEnabled: false, curveSegments: 32 }), H.brass(), 0, 0, -d * 0.3));
  const glass = mesh(new THREE.ShapeGeometry(arch(w / 2 - 0.02, 0.02), 32), H.mirror(), 0, 0, -d * 0.31, false);
  glass.rotation.y = Math.PI;
  g.add(glass);
}

function wallTv(g: THREE.Group, w: number, d: number, h: number): void {
  g.add(bx(w, h, d, H.black(), 0, h / 2, 0));
  const screen = bx(w - 0.02, h - 0.02, 0.002, M.screen(), 0, h / 2, -d / 2 - 0.001);
  g.add(screen);
}

function wallShelf(g: THREE.Group, w: number, d: number, h: number, def: ItemDefinition): void {
  g.add(bx(w, h, d, wood(def), 0, h / 2, 0));
  const row = mat('home-spines:9', () => new THREE.MeshStandardMaterial({ map: bookSpines(9), transparent: true, alphaTest: 0.5 }));
  const books = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.4, 0.22), row);
  books.position.set(-w * 0.22, h + 0.11, -0.02);
  books.rotation.y = Math.PI;
  books.scale.x = -1;
  g.add(books);
  g.add(cyl(0.05, 0.06, 0.18, H.ceramic(0xb8694a), w * 0.25, h + 0.09, 0, 16));
  g.add(sprigs(0.2, h + 0.15));
  g.children[g.children.length - 1]!.position.x = w * 0.25;
}

// ─── Dining ───────────────────────────────────────────────────────────────────────────────────

/** An upholstered dining chair facing −Z, seat at 46 cm. */
function diningChair(cloth: THREE.Material, frame: THREE.Material): THREE.Group {
  const c = new THREE.Group();
  c.add(soft(0.46, 0.07, 0.46, cloth, 0, 0.46, 0, 0.03));
  c.add(soft(0.44, 0.38, 0.06, cloth, 0, 0.7, 0.21, 0.03));
  c.children[1]!.rotation.x = -0.08;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) c.add(cyl(0.014, 0.011, 0.43, frame, sx * 0.19, 0.215, sz * 0.19, 8));
  return c;
}

/** A place setting: dinner plate, side plate, a glass and cutlery, laid toward −Z of its frame. */
function placeSetting(): THREE.Group {
  const s = new THREE.Group();
  s.add(cyl(0.135, 0.12, 0.015, H.porcelain(), 0, 0.0075, 0, 32));
  s.add(cyl(0.1, 0.09, 0.012, H.porcelain(), 0, 0.02, 0, 32));
  s.add(mesh(new THREE.TorusGeometry(0.13, 0.004, 6, 32), H.ceramic(0xc9a25e), 0, 0.016, 0));
  s.children[2]!.rotation.x = Math.PI / 2;
  const glass = mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.12, 16, 1, true), H.glass(), 0.15, 0.06, -0.14);
  s.add(glass);
  for (const sx of [-1, 1]) s.add(bx(0.012, 0.004, 0.2, H.steel(), sx * 0.17, 0.002, 0));
  s.add(soft(0.14, 0.006, 0.2, H.linen(), -0.2, 0.003, 0, 0.002));
  return s;
}

/**
 * A dining table with its chairs and laid places. Rectangular sets seat along both long sides
 * (the item's width is the table length, its depth includes the chairs); round sets seat around.
 */
function diningSet(g: THREE.Group, w: number, d: number, h: number, def: ItemDefinition): void {
  const top = wood(def);
  const cloth = H.fabric(fabricOf(def));
  const seats = def.seats ?? 4;
  const chairFrame = def.meta?.wood === 'white' ? H.black() : top;
  if (def.footprint === 'round') {
    const r = Math.min(w, d) / 2 - 0.42;
    g.add(cyl(r, r, 0.04, top, 0, h - 0.02, 0, 48));
    g.add(cyl(0.07, 0.07, h - 0.04, top, 0, (h - 0.04) / 2, 0, 16));
    g.add(cyl(0.3, 0.32, 0.03, top, 0, 0.015, 0, 32));
    for (let k = 0; k < seats; k++) {
      const a = (k / seats) * Math.PI * 2 + Math.PI / 4;
      const chair = diningChair(cloth, chairFrame);
      chair.position.set(Math.sin(a) * (r + 0.12), 0, -Math.cos(a) * (r + 0.12));
      chair.rotation.y = -a + Math.PI;
      g.add(chair);
      const place = placeSetting();
      place.position.set(Math.sin(a) * (r - 0.2), h, -Math.cos(a) * (r - 0.2));
      place.rotation.y = -a + Math.PI;
      g.add(place);
    }
    centrepiece(g, h);
    return;
  }
  const tableD = Math.max(0.8, d - 1.1);
  g.add(rbx(w, 0.045, tableD, 0.01, top, 0, h - 0.0225));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(bx(0.06, h - 0.045, 0.06, top, sx * (w / 2 - 0.1), (h - 0.045) / 2, sz * (tableD / 2 - 0.1)));
  const perSide = Math.max(1, Math.round(seats / 2));
  for (const side of [-1, 1]) {
    for (let k = 0; k < perSide; k++) {
      const x = -w / 2 + (w / perSide) * (k + 0.5);
      const chair = diningChair(cloth, chairFrame);
      chair.position.set(x, 0, side * (tableD / 2 + 0.12));
      chair.rotation.y = side > 0 ? 0 : Math.PI;
      g.add(chair);
      const place = placeSetting();
      place.position.set(x, h, side * (tableD / 2 - 0.2));
      place.rotation.y = side > 0 ? 0 : Math.PI;
      g.add(place);
    }
  }
  g.add(bx(w * 0.8, 0.003, 0.36, H.fabric(0xd9cfbf), 0, h + 0.0015, 0));
  centrepiece(g, h);
}

/** A vase of greenery between two candles. */
function centrepiece(g: THREE.Group, h: number): void {
  g.add(cyl(0.06, 0.08, 0.22, H.ceramic(0xe8e1d6), 0, h + 0.11, 0, 20));
  g.add(sprigs(0.32, h + 0.18));
  for (const sx of [-1, 1]) {
    g.add(cyl(0.025, 0.03, 0.04, H.brass(), sx * 0.24, h + 0.02, 0, 12));
    g.add(cyl(0.012, 0.012, 0.22, H.linen(), sx * 0.24, h + 0.15, 0, 10));
    g.add(mesh(new THREE.SphereGeometry(0.012, 8, 6), H.bulb(), sx * 0.24, h + 0.27, 0, false));
  }
}

/** Low cabinet on legs with four doors, a lamp and a bowl on top. */
function sideboard(g: THREE.Group, w: number, d: number, h: number, def: ItemDefinition): void {
  const m = wood(def);
  const legH = 0.14;
  g.add(rbx(w, h - legH, d, 0.008, m, 0, legH + (h - legH) / 2));
  const line = mat('home-groove', () => new THREE.MeshStandardMaterial({ color: 0x000000, transparent: true, opacity: 0.35 }));
  for (let k = 1; k < 4; k++) g.add(bx(0.004, h - legH - 0.03, 0.003, line, -w / 2 + (w / 4) * k, legH + (h - legH) / 2, -d / 2 - 0.0015));
  for (let k = 0; k < 4; k++) g.add(cyl(0.008, 0.008, 0.12, H.brass(), -w / 2 + (w / 4) * k + (k % 2 ? 0.04 : w / 4 - 0.04), legH + (h - legH) / 2, -d / 2 - 0.01, 8));
  taperedLegs(g, w, d, legH, m, 0.08, 0.02);
  tableLamp(g, -w * 0.32, h, 0);
  g.add(cyl(0.16, 0.08, 0.08, H.ceramic(0x2b2b2b), w * 0.25, h + 0.04, 0, 24));
}

function tableLamp(g: THREE.Group, x: number, y: number, z: number): void {
  g.add(mesh(new THREE.SphereGeometry(0.08, 20, 14), H.ceramic(0xe8e1d6), x, y + 0.08, z));
  g.add(cyl(0.008, 0.008, 0.12, H.brass(), x, y + 0.2, z, 8));
  g.add(mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.16, 28, 1, true), H.shade(), x, y + 0.32, z));
}

/** A dome pendant hanging from a cord; its underside glows. */
function pendant(g: THREE.Group, w: number, h: number): void {
  g.add(cyl(0.003, 0.003, 0.4, H.black(), 0, h + 0.2, 0, 6));
  g.add(mesh(new THREE.SphereGeometry(w / 2, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), H.ceramic(0xe8e1d6), 0, h * 0.2, 0));
  g.add(mesh(new THREE.CircleGeometry(w / 2 - 0.01, 32), H.bulb(), 0, h * 0.2 - 0.001, 0, false));
  g.children[g.children.length - 1]!.rotation.x = Math.PI / 2;
}

// ─── Bedroom ──────────────────────────────────────────────────────────────────────────────────

/**
 * A made bed: upholstered frame and channel-tufted headboard at the back (+Z), mattress, a duvet
 * folded back, pillows, cushions and a throw across the foot (−Z).
 */
function bed(g: THREE.Group, w: number, d: number, h: number, def: ItemDefinition): void {
  const fabric = fabricOf(def);
  const cloth = H.fabric(fabric);
  const frameH = 0.3;
  g.add(soft(w, frameH - 0.06, d - 0.08, cloth, 0, 0.06 + (frameH - 0.06) / 2, -0.04, 0.04));
  taperedLegs(g, w, d - 0.08, 0.06, wood(def), 0.08, 0.025);
  // Headboard of vertical channels.
  const channels = Math.max(3, Math.round(w / 0.22));
  const cw = w / channels;
  for (let k = 0; k < channels; k++) g.add(soft(cw - 0.008, h - 0.06, 0.09, cloth, -w / 2 + cw * (k + 0.5), 0.06 + (h - 0.06) / 2, d / 2 - 0.045, 0.04));
  // Mattress, duvet, pillows.
  const mw = w - 0.1;
  const md = d - 0.22;
  g.add(soft(mw, 0.22, md, H.linen(), 0, frameH + 0.11, -0.07, 0.05));
  const duvet = soft(mw + 0.06, 0.07, md * 0.72, H.fabric(0xf8f6f1), 0, frameH + 0.24, -0.07 - md * 0.14, 0.035);
  g.add(duvet);
  g.add(soft(mw + 0.07, 0.08, 0.2, H.fabric(0xf8f6f1), 0, frameH + 0.265, -0.07 - md * 0.14 + md * 0.36 + 0.05, 0.04)); // fold
  const pillows = w > 1.2 ? 2 : 1;
  for (let k = 0; k < pillows; k++) {
    const x = pillows === 1 ? 0 : (k ? 1 : -1) * mw * 0.24;
    const p = soft(Math.min(0.62, mw / pillows - 0.06), 0.14, 0.4, H.linen(), x, frameH + 0.31, d / 2 - 0.35, 0.06);
    p.rotation.x = -0.35;
    g.add(p);
    const c = soft(0.42, 0.36, 0.12, H.fabric(tone(fabric, 0.75)), x * 0.8, frameH + 0.34, d / 2 - 0.5, 0.05);
    c.rotation.x = -0.3;
    g.add(c);
  }
  g.add(soft(mw + 0.08, 0.035, 0.42, H.fabric(tone(fabric, 0.6)), 0, frameH + 0.29, -d / 2 + 0.42, 0.015));
}

function nightstand(g: THREE.Group, w: number, d: number, h: number, def: ItemDefinition): void {
  const m = wood(def);
  const legH = 0.14;
  g.add(rbx(w, h - legH, d, 0.008, m, 0, legH + (h - legH) / 2));
  g.add(bx(w - 0.04, 0.003, 0.003, mat('home-groove', () => new THREE.MeshStandardMaterial({ color: 0x000000, transparent: true, opacity: 0.35 })), 0, legH + (h - legH) * 0.62, -d / 2 - 0.0015));
  g.add(cyl(0.008, 0.008, 0.08, H.brass(), 0, legH + (h - legH) * 0.8, -d / 2 - 0.01, 8));
  g.children[g.children.length - 1]!.rotation.z = Math.PI / 2;
  taperedLegs(g, w, d, legH, m, 0.05, 0.014);
  tableLamp(g, -w * 0.12, h, 0.02);
  g.add(bx(0.16, 0.025, 0.22, H.ceramic(0x2f3c55), w * 0.2, h + 0.0125, -0.04));
}

/** Tall doors with slim brass pulls on a recessed plinth. */
function wardrobe(g: THREE.Group, w: number, d: number, h: number, def: ItemDefinition): void {
  const m = wood(def);
  g.add(bx(w, 0.08, d - 0.04, H.black(), 0, 0.04, 0.02));
  g.add(rbx(w, h - 0.08, d, 0.006, m, 0, 0.08 + (h - 0.08) / 2));
  const doors = Math.max(2, Math.round(w / 0.5));
  const line = mat('home-groove', () => new THREE.MeshStandardMaterial({ color: 0x000000, transparent: true, opacity: 0.35 }));
  for (let k = 1; k < doors; k++) g.add(bx(0.004, h - 0.1, 0.003, line, -w / 2 + (w / doors) * k, 0.08 + (h - 0.08) / 2, -d / 2 - 0.0015));
  for (let k = 0; k < doors; k++) {
    const x = -w / 2 + (w / doors) * (k + (k % 2 ? 0.12 : 0.88));
    g.add(cyl(0.007, 0.007, 0.45, H.brass(), x, 1.05, -d / 2 - 0.015, 8));
  }
}

function dresser(g: THREE.Group, w: number, d: number, h: number, def: ItemDefinition): void {
  const m = wood(def);
  const legH = 0.12;
  g.add(rbx(w, h - legH, d, 0.008, m, 0, legH + (h - legH) / 2));
  const line = mat('home-groove', () => new THREE.MeshStandardMaterial({ color: 0x000000, transparent: true, opacity: 0.35 }));
  const rows = 3;
  const rh = (h - legH) / rows;
  for (let r = 1; r < rows; r++) g.add(bx(w - 0.02, 0.003, 0.003, line, 0, legH + rh * r, -d / 2 - 0.0015));
  g.add(bx(0.003, h - legH - 0.02, 0.003, line, 0, legH + (h - legH) / 2, -d / 2 - 0.0015));
  for (let r = 0; r < rows; r++) for (const sx of [-1, 1]) {
    const pull = cyl(0.006, 0.006, 0.12, H.brass(), sx * w / 4, legH + rh * (r + 0.5), -d / 2 - 0.012, 8);
    pull.rotation.z = Math.PI / 2;
    g.add(pull);
  }
  taperedLegs(g, w, d, legH, m, 0.06, 0.016);
  g.add(cyl(0.05, 0.06, 0.24, H.ceramic(0xe8e1d6), w * 0.3, h + 0.12, 0, 16));
  g.add(sprigs(0.26, h + 0.2));
  g.children[g.children.length - 1]!.position.x = w * 0.3;
  g.add(bx(0.24, 0.05, 0.18, H.ceramic(0xb8694a), -w * 0.25, h + 0.025, 0));
}

// ─── Kitchen ──────────────────────────────────────────────────────────────────────────────────

/**
 * A kitchen run: base units with a stone worktop, sink and hob, a tiled splashback, wall units
 * and a slim hood. The item's height includes the wall units.
 */
function kitchen(g: THREE.Group, w: number, d: number, h: number, def: ItemDefinition): void {
  const fronts = wood(def);
  const worktop = H.marble();
  const baseH = 0.86;
  g.add(bx(w, 0.1, d - 0.06, H.black(), 0, 0.05, 0.03));
  g.add(bx(w, baseH - 0.14, d - 0.02, fronts, 0, 0.1 + (baseH - 0.14) / 2, 0.01));
  g.add(bx(w + 0.01, 0.04, d + 0.01, worktop, 0, baseH - 0.02, 0));
  const line = mat('home-groove', () => new THREE.MeshStandardMaterial({ color: 0x000000, transparent: true, opacity: 0.35 }));
  const units = Math.max(2, Math.round(w / 0.6));
  for (let k = 1; k < units; k++) g.add(bx(0.004, baseH - 0.16, 0.003, line, -w / 2 + (w / units) * k, 0.1 + (baseH - 0.14) / 2, -d / 2 + 0.0085));
  for (let k = 0; k < units; k++) g.add(bx(0.18, 0.012, 0.012, H.steel(), -w / 2 + (w / units) * (k + 0.5), baseH - 0.1, -d / 2));
  // Sink with tap, hob with rings.
  const sinkX = -w * 0.22;
  g.add(bx(0.5, 0.02, 0.38, H.steel(), sinkX, baseH + 0.001, -0.03));
  g.add(bx(0.44, 0.005, 0.32, mat('home-sink-hole', () => new THREE.MeshStandardMaterial({ color: 0x5a5e63, roughness: 0.3, metalness: 0.8 })), sinkX, baseH + 0.012, -0.03));
  const tap = new THREE.CubicBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.32, 0), new THREE.Vector3(0, 0.32, -0.18), new THREE.Vector3(0, 0.22, -0.2));
  g.add(mesh(new THREE.TubeGeometry(tap, 24, 0.011, 8, false), H.chrome(), sinkX, baseH, d / 2 - 0.12));
  const hobX = w * 0.22;
  g.add(bx(0.6, 0.008, 0.5, mat('home-hob', () => new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.08, metalness: 0.3 })), hobX, baseH + 0.004, -0.02));
  const ring = mat('home-hob-ring', () => new THREE.MeshStandardMaterial({ color: 0x55585c, roughness: 0.3 }));
  for (const [dx, dz, r] of [[-0.15, -0.1, 0.09], [0.15, -0.1, 0.07], [-0.15, 0.12, 0.07], [0.15, 0.12, 0.09]] as const) {
    const t = mesh(new THREE.TorusGeometry(r, 0.004, 4, 32), ring, hobX + dx, baseH + 0.009, -0.02 + dz, false);
    t.rotation.x = Math.PI / 2;
    g.add(t);
  }
  // Splashback, wall units and hood.
  const wallD = 0.35;
  const wallBottom = 1.45;
  if (h > wallBottom + 0.3) {
    g.add(bx(w, wallBottom - baseH, 0.012, mat('home-tiles', () => new THREE.MeshStandardMaterial({ color: 0xe9e4da, roughness: 0.25 })), 0, baseH + (wallBottom - baseH) / 2, d / 2 - 0.006));
    const upper = h - wallBottom;
    const wallUnits = units;
    for (let k = 0; k < wallUnits; k++) {
      const x = -w / 2 + (w / wallUnits) * (k + 0.5);
      if (Math.abs(x - hobX) < w / wallUnits / 2) {
        g.add(bx(0.6, 0.1, wallD, H.steel(), hobX, wallBottom + 0.1, d / 2 - wallD / 2));
        g.add(bx(0.24, upper - 0.2, 0.22, H.steel(), hobX, wallBottom + 0.2 + (upper - 0.2) / 2, d / 2 - 0.11));
        continue;
      }
      g.add(bx(w / wallUnits - 0.006, upper, wallD, fronts, x, wallBottom + upper / 2, d / 2 - wallD / 2));
    }
  }
  // A few things on the worktop.
  g.add(cyl(0.07, 0.07, 0.2, H.ceramic(0xe8e1d6), w * 0.42, baseH + 0.1, 0.12, 16));
  g.add(bx(0.4, 0.02, 0.28, H.oak(), -w * 0.42, baseH + 0.01, 0.0));
}

/** A stone-topped island with an overhang on the front and three stools tucked in. */
function island(g: THREE.Group, w: number, d: number, h: number, def: ItemDefinition): void {
  const top = def.meta?.wood === 'marble' ? H.marble() : wood(def);
  const body = H.lacquer();
  const over = 0.28;
  g.add(bx(w, 0.1, d - over - 0.04, H.black(), 0, 0.05, over / 2));
  g.add(bx(w, h - 0.14, d - over, body, 0, 0.1 + (h - 0.14) / 2, over / 2));
  g.add(bx(w + 0.04, 0.04, d + 0.02, top, 0, h - 0.02, 0));
  const seats = def.seats ?? 3;
  for (let k = 0; k < seats; k++) {
    const x = -w / 2 + (w / seats) * (k + 0.5);
    const s = new THREE.Group();
    s.add(cyl(0.18, 0.17, 0.05, H.fabric(0x45474b), 0, 0.66, 0, 24));
    s.add(cyl(0.012, 0.012, 0.64, H.brass(), 0, 0.32, 0, 8));
    s.add(cyl(0.16, 0.16, 0.012, H.brass(), 0, 0.006, 0, 24));
    s.add(mesh(new THREE.TorusGeometry(0.15, 0.007, 6, 24), H.brass(), 0, 0.28, 0));
    s.children[3]!.rotation.x = Math.PI / 2;
    s.position.set(x, 0, -d / 2 - 0.05);
    g.add(s);
  }
  g.add(cyl(0.16, 0.1, 0.08, H.ceramic(0xe8e1d6), w * 0.25, h + 0.04, 0.1, 24));
}

function fridge(g: THREE.Group, w: number, d: number, h: number): void {
  const body = H.steel();
  g.add(rbx(w, h, d, 0.02, body, 0, h / 2));
  g.add(bx(w - 0.01, 0.006, 0.004, mat('home-groove', () => new THREE.MeshStandardMaterial({ color: 0x000000, transparent: true, opacity: 0.35 })), 0, h * 0.62, -d / 2 - 0.002));
  for (const [y, len] of [[h * 0.8, 0.5], [h * 0.4, 0.42]] as const) g.add(cyl(0.008, 0.008, len, H.chrome(), w / 2 - 0.06, y, -d / 2 - 0.03, 8));
}

// ─── Bathroom ─────────────────────────────────────────────────────────────────────────────────

/** A freestanding tub: glossy shell, a water-coloured hollow, a floor-standing tap. */
function bathtub(g: THREE.Group, w: number, d: number, h: number): void {
  const shell = H.porcelain();
  const outer = new THREE.CapsuleGeometry(d / 2, w - d, 8, 32);
  outer.rotateZ(Math.PI / 2);
  outer.scale(1, (h * 1.1) / d, 1);
  const tub = mesh(outer, shell, 0, h * 0.55, 0);
  g.add(tub);
  const inner = new THREE.CapsuleGeometry(d / 2 - 0.05, w - d, 6, 28);
  inner.rotateZ(Math.PI / 2);
  inner.scale(1, 0.05 / d, 1);
  g.add(mesh(inner, mat('home-water', () => new THREE.MeshStandardMaterial({ color: 0xcfe3ea, roughness: 0.05, metalness: 0.1 })), 0, h - 0.02, 0, false));
  const spout = new THREE.CubicBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, h + 0.35, 0), new THREE.Vector3(0, h + 0.35, 0.18), new THREE.Vector3(0, h + 0.2, 0.2));
  g.add(mesh(new THREE.TubeGeometry(spout, 24, 0.014, 8, false), H.chrome(), w / 2 - 0.1, 0, -d / 2 - 0.12));
  g.children[g.children.length - 1]!.rotation.y = Math.PI / 2;
}

function shower(g: THREE.Group, w: number, d: number, h: number): void {
  g.add(bx(w, 0.04, d, H.porcelain(), 0, 0.02, 0));
  const glass = H.glass();
  g.add(bx(0.008, h - 0.04, d, glass, -w / 2 + 0.004, 0.04 + (h - 0.04) / 2, 0));
  g.add(bx(w * 0.55, h - 0.04, 0.008, glass, w * 0.2, 0.04 + (h - 0.04) / 2, -d / 2 + 0.004));
  g.add(bx(0.02, h - 0.04, 0.02, H.black(), -w / 2 + 0.01, 0.04 + (h - 0.04) / 2, -d / 2 + 0.01));
  g.add(cyl(0.01, 0.01, h - 0.2, H.chrome(), w / 2 - 0.08, (h - 0.2) / 2 + 0.05, d / 2 - 0.05, 8));
  g.add(cyl(0.13, 0.13, 0.01, H.chrome(), w / 2 - 0.25, h - 0.15, d / 2 - 0.25, 24));
  g.add(bx(0.01, 0.01, 0.22, H.chrome(), w / 2 - 0.25, h - 0.13, d / 2 - 0.14));
  g.add(bx(w - 0.1, 0.002, d - 0.1, mat('home-tray-drain', () => new THREE.MeshStandardMaterial({ color: 0xe8e4dc, roughness: 0.3 })), 0, 0.041, 0));
}

/** Wall-hung toilet: a flush plate on the wall, the bowl off the floor, a slim seat. */
function toilet(g: THREE.Group, w: number, d: number, h: number): void {
  g.add(bx(w + 0.1, h, 0.06, H.lacquer(), 0, h / 2, d / 2 - 0.03));
  g.add(rbx(0.2, 0.14, 0.008, 0.01, H.chrome(), 0, h - 0.12, d / 2 - 0.064));
  const bowl = new THREE.SphereGeometry(0.2, 28, 18);
  bowl.scale(w / 0.42, 0.55, (d - 0.06) / 0.42);
  g.add(mesh(bowl, H.porcelain(), 0, 0.33, -0.03));
  g.add(bx(w * 0.7, 0.12, 0.16, H.porcelain(), 0, 0.33, d / 2 - 0.12));
  const seat = new THREE.TorusGeometry(0.16, 0.02, 10, 32);
  seat.scale(w / 0.4, (d - 0.08) / 0.4, 1);
  g.add(mesh(seat, H.porcelain(), 0, 0.43, -0.03));
  g.children[g.children.length - 1]!.rotation.x = Math.PI / 2;
}

/** Wall-hung vanity: a wooden drawer unit, a stone top with a round basin and a tap. */
function basin(g: THREE.Group, w: number, d: number, h: number, def: ItemDefinition): void {
  const m = wood(def);
  g.add(rbx(w, 0.42, d, 0.01, m, 0, h - 0.06 - 0.21));
  g.add(bx(w - 0.04, 0.003, 0.003, mat('home-groove', () => new THREE.MeshStandardMaterial({ color: 0x000000, transparent: true, opacity: 0.35 })), 0, h - 0.27, -d / 2 - 0.0015));
  g.add(bx(w + 0.01, 0.04, d + 0.01, H.marble(), 0, h - 0.04, 0));
  g.add(cyl(0.17, 0.12, 0.13, H.porcelain(), 0, h + 0.065, -0.02, 32));
  g.add(cyl(0.155, 0.155, 0.002, mat('home-water', () => new THREE.MeshStandardMaterial({ color: 0xcfe3ea, roughness: 0.05, metalness: 0.1 })), 0, h + 0.125, -0.02, 32));
  g.add(cyl(0.012, 0.012, 0.3, H.chrome(), 0, h + 0.15, d / 2 - 0.06, 8));
  g.add(bx(0.02, 0.02, 0.16, H.chrome(), 0, h + 0.29, d / 2 - 0.13));
}

function washer(g: THREE.Group, w: number, d: number, h: number): void {
  g.add(rbx(w, h, d, 0.02, H.lacquer(), 0, h / 2));
  g.add(bx(w - 0.04, 0.1, 0.004, mat('home-panel', () => new THREE.MeshStandardMaterial({ color: 0xe6e3dd, roughness: 0.4 })), 0, h - 0.08, -d / 2 - 0.002));
  const door = mesh(new THREE.TorusGeometry(0.17, 0.025, 10, 40), H.steel(), 0, h * 0.45, -d / 2 - 0.02);
  g.add(door);
  const window = mesh(new THREE.CircleGeometry(0.15, 40), mat('home-washer-glass', () => new THREE.MeshStandardMaterial({ color: 0x1d2b33, roughness: 0.05, metalness: 0.4 })), 0, h * 0.45, -d / 2 - 0.021, false);
  window.rotation.y = Math.PI;
  g.add(window);
  g.add(cyl(0.025, 0.025, 0.02, H.steel(), w / 2 - 0.08, h - 0.08, -d / 2 - 0.01, 16));
  g.children[g.children.length - 1]!.rotation.x = Math.PI / 2;
}
