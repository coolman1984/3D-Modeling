import * as THREE from 'three';

/**
 * Procedural textures drawn once on a canvas and shared by every scene: floors, facades, cartons,
 * signs. No image files: everything is generated from a seeded, tileable noise, so every machine
 * draws the same pixels and the app stays a one-click install. Textures that repeat carry the
 * real-world size of one tile in `userData.metres`, so a floor keeps its true scale at any size.
 */

const cache = new Map<string, THREE.Texture | null>();

function canvasOf(width: number, height: number): { canvas: HTMLCanvasElement; g: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d');
  return g ? { canvas, g } : null;
}

function finish(canvas: HTMLCanvasElement, options: { repeat?: boolean; color?: boolean; metres?: number; anisotropy?: number }): THREE.Texture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = options.color === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  texture.anisotropy = options.anisotropy ?? 8;
  if (options.repeat) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  if (options.metres) texture.userData.metres = options.metres;
  return texture;
}

function canvasTexture(key: string, width: number, height: number, draw: (g: CanvasRenderingContext2D) => void, repeat = false): THREE.Texture | null {
  if (cache.has(key)) return cache.get(key)!;
  const c = canvasOf(width, height);
  let texture: THREE.Texture | null = null;
  if (c) {
    draw(c.g);
    texture = finish(c.canvas, { repeat, anisotropy: 4 });
  }
  cache.set(key, texture);
  return texture;
}

// ─── Seeded, tileable noise ───────────────────────────────────────────────────────────────────

function hash(x: number, y: number, seed: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Value noise that tiles every `period` lattice cells. */
function noise(x: number, y: number, period: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const w = (v: number) => ((v % period) + period) % period;
  const a = hash(w(x0), w(y0), seed);
  const b = hash(w(x0 + 1), w(y0), seed);
  const c = hash(w(x0), w(y0 + 1), seed);
  const d = hash(w(x0 + 1), w(y0 + 1), seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Fractal noise in [0, 1]; `u`, `v` in [0, 1) tile seamlessly. */
function fbm(u: number, v: number, base: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let f = base;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(u * f, v * f, f, seed + o * 17);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

// ─── Physically based surface sets (colour + normal + roughness) ──────────────────────────────

export interface Surface {
  readonly map: THREE.Texture;
  readonly normalMap?: THREE.Texture;
  readonly roughnessMap?: THREE.Texture;
  /** Real-world size of one tile, metres. */
  readonly metres: number;
}

const surfaces = new Map<string, Surface | null>();

/**
 * Build a surface from per-pixel functions: colour (0–255 RGB), height (for the normal map) and
 * roughness (0–1). Everything tiles, since every input does.
 */
function surface(key: string, size: number, metres: number, sample: (u: number, v: number, px: number, py: number) => { rgb: readonly [number, number, number]; height: number; rough: number }, bump = 2): Surface | null {
  if (surfaces.has(key)) return surfaces.get(key)!;
  const colour = canvasOf(size, size);
  const normal = canvasOf(size, size);
  const rough = canvasOf(size, size);
  if (!colour || !normal || !rough) {
    surfaces.set(key, null);
    return null;
  }
  const heights = new Float32Array(size * size);
  const colourData = colour.g.createImageData(size, size);
  const roughData = rough.g.createImageData(size, size);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const s = sample(px / size, py / size, px, py);
      const k = py * size + px;
      heights[k] = s.height;
      colourData.data[k * 4] = s.rgb[0];
      colourData.data[k * 4 + 1] = s.rgb[1];
      colourData.data[k * 4 + 2] = s.rgb[2];
      colourData.data[k * 4 + 3] = 255;
      const r = Math.max(0, Math.min(255, Math.round(s.rough * 255)));
      roughData.data[k * 4] = r;
      roughData.data[k * 4 + 1] = r;
      roughData.data[k * 4 + 2] = r;
      roughData.data[k * 4 + 3] = 255;
    }
  }
  const normalData = normal.g.createImageData(size, size);
  const at = (x: number, y: number) => heights[((y + size) % size) * size + ((x + size) % size)]!;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const dx = (at(px + 1, py) - at(px - 1, py)) * bump;
      const dy = (at(px, py + 1) - at(px, py - 1)) * bump;
      const len = Math.hypot(dx, dy, 1);
      const k = (py * size + px) * 4;
      normalData.data[k] = Math.round((-dx / len * 0.5 + 0.5) * 255);
      normalData.data[k + 1] = Math.round((dy / len * 0.5 + 0.5) * 255);
      normalData.data[k + 2] = Math.round((1 / len * 0.5 + 0.5) * 255);
      normalData.data[k + 3] = 255;
    }
  }
  colour.g.putImageData(colourData, 0, 0);
  normal.g.putImageData(normalData, 0, 0);
  rough.g.putImageData(roughData, 0, 0);
  const result: Surface = {
    map: finish(colour.canvas, { repeat: true, metres }),
    normalMap: finish(normal.canvas, { repeat: true, color: false, metres }),
    roughnessMap: finish(rough.canvas, { repeat: true, color: false, metres }),
    metres,
  };
  surfaces.set(key, result);
  return result;
}

const mix = (a: readonly [number, number, number], b: readonly [number, number, number], t: number): [number, number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const shade = (c: readonly [number, number, number], k: number): [number, number, number] => [c[0] * k, c[1] * k, c[2] * k];

/** Power-floated warehouse concrete: cloudy trowel marks, fine aggregate, saw-cut joints every 4 m. */
export function concreteFloor(): Surface | null {
  return surface('concrete', 1024, 4, (u, v, px, py) => {
    const cloud = fbm(u, v, 3, 5, 11);
    const speck = hash(px, py, 7);
    const joint = px < 2 || py < 2 ? 1 : 0;
    const base = mix([196, 194, 188], [168, 166, 160], cloud);
    const c = joint ? shade(base, 0.62) : speck > 0.985 ? shade(base, 0.8) : speck < 0.01 ? shade(base, 1.07) : base;
    return { rgb: c, height: cloud * 0.4 + (joint ? -2 : 0) + speck * 0.05, rough: 0.42 + cloud * 0.28 + (joint ? 0.3 : 0) };
  }, 1.4);
}

/** Epoxy production floor: smooth, faint flecks; tinted by the material colour. */
export function epoxyFloor(): Surface | null {
  return surface('epoxy', 512, 3, (u, v, px, py) => {
    const cloud = fbm(u, v, 2, 3, 23);
    const fleck = hash(px, py, 29) > 0.992 ? 0.9 : 1;
    const c = shade(mix([236, 238, 236], [222, 226, 224], cloud), fleck);
    return { rgb: c, height: cloud * 0.1, rough: 0.22 + cloud * 0.12 };
  }, 0.6);
}

/** Road asphalt: dark binder with light and dark aggregate, a little patchy. */
export function asphalt(): Surface | null {
  return surface('asphalt', 1024, 4, (u, v, px, py) => {
    const patch = fbm(u, v, 4, 4, 41);
    const stone = hash(px, py, 43);
    const grain = hash(px >> 1, py >> 1, 47);
    let c = mix([74, 76, 79], [58, 60, 63], patch);
    if (stone > 0.93) c = mix(c, [128, 128, 124], (stone - 0.93) * 10);
    if (grain < 0.05) c = shade(c, 0.78);
    return { rgb: c, height: grain * 0.8 + (stone > 0.93 ? 0.6 : 0), rough: 0.86 + patch * 0.1 };
  }, 1.1);
}

/** Irrigated lawn: two greens in patches, fine blade noise, a few dry spots. */
export function grass(): Surface | null {
  return surface('grass', 1024, 5, (u, v, px, py) => {
    const patch = fbm(u, v, 3, 5, 61);
    const blade = hash(px, py, 67);
    const dry = fbm(u, v, 6, 3, 71);
    let c = mix([86, 128, 58], [62, 104, 44], patch);
    c = mix(c, [150, 150, 88], Math.max(0, dry - 0.62) * 1.8);
    c = shade(c, 0.86 + blade * 0.28);
    return { rgb: c, height: blade * 0.9 + patch * 0.3, rough: 0.96 };
  }, 1.6);
}

/** Desert sand around the plot: warm beige with wind ripples. */
export function sand(): Surface | null {
  return surface('sand', 512, 12, (u, v, px, py) => {
    const dune = fbm(u, v, 2, 4, 83);
    const ripple = 0.5 + 0.5 * Math.sin((v + dune * 0.2) * Math.PI * 2 * 18);
    const grain = hash(px, py, 89);
    const c = shade(mix([222, 200, 160], [196, 170, 128], dune), 0.94 + grain * 0.1 + ripple * 0.03);
    return { rgb: c, height: ripple * 0.5 + dune, rough: 0.98 };
  }, 1.2);
}

/** Interlocking concrete pavers (20 × 10 cm, running bond) for plazas and footpaths. */
export function pavers(): Surface | null {
  const size = 512;
  const metres = 2;
  const px_m = size / metres;
  return surface('pavers', size, metres, (u, v, px, py) => {
    const bw = 0.2 * px_m;
    const bh = 0.1 * px_m;
    const row = Math.floor(py / bh);
    const shift = row % 2 ? bw / 2 : 0;
    const col = Math.floor((px + shift) / bw);
    const inX = (px + shift) % bw;
    const inY = py % bh;
    const grout = inX < 2 || inY < 2;
    const tint = hash(col, row, 97);
    const base = mix([196, 184, 164], [170, 156, 136], tint);
    const c = grout ? [120, 112, 100] as const : shade(base, 0.95 + fbm(u, v, 8, 2, 101) * 0.1);
    return { rgb: c, height: grout ? 0 : 1, rough: grout ? 0.95 : 0.8 };
  }, 1.5);
}

/** Office carpet tiles, 50 cm, laid in alternating fibre directions. */
export function carpet(): Surface | null {
  const size = 512;
  return surface('carpet', size, 2, (_u, _v, px, py) => {
    const tile = size / 4;
    const tx = Math.floor(px / tile);
    const ty = Math.floor(py / tile);
    const along = (tx + ty) % 2 === 0 ? px : py;
    const fibre = 0.5 + 0.5 * Math.sin(along * 1.7) * 0.5 + hash(px, py, 107) * 0.5;
    const seam = px % tile === 0 || py % tile === 0;
    const c = shade([150, 154, 160], 0.82 + fibre * 0.22 - (seam ? 0.1 : 0));
    return { rgb: c, height: fibre * 0.6, rough: 1 };
  }, 0.8);
}

/** 60 cm porcelain tiles with light grout, for canteens and pantries. */
export function ceramic(): Surface | null {
  const size = 512;
  return surface('ceramic', size, 2.4, (u, v, px, py) => {
    const tile = size / 4;
    const tx = Math.floor(px / tile);
    const ty = Math.floor(py / tile);
    const grout = px % tile < 2 || py % tile < 2;
    const tint = hash(tx, ty, 113) * 0.06;
    const cloud = fbm(u, v, 4, 3, 127) * 0.05;
    const c = grout ? [178, 174, 166] as const : shade([238, 234, 226], 0.97 - tint + cloud);
    return { rgb: c, height: grout ? 0 : 1, rough: grout ? 0.9 : 0.18 };
  }, 1.2);
}

/** Polished marble slabs, 1.2 m, with soft veins: event halls and lobbies. */
export function marble(): Surface | null {
  const size = 1024;
  return surface('marble', size, 4.8, (u, v, px, py) => {
    const tile = size / 4;
    const tx = Math.floor(px / tile);
    const ty = Math.floor(py / tile);
    const joint = px % tile < 1 || py % tile < 1;
    const warp = fbm(u, v, 3, 5, 131 + tx * 3 + ty * 7);
    const vein = Math.pow(1 - Math.abs(Math.sin((u * 3 + v * 2 + warp * 2.4) * Math.PI)), 12);
    const c = joint ? [190, 184, 174] as const : mix(mix([236, 231, 222], [222, 214, 200], warp), [150, 140, 128], vein * 0.55);
    return { rgb: c, height: joint ? 0 : 1, rough: joint ? 0.6 : 0.08 + warp * 0.06 };
  }, 0.8);
}

/** Painted plaster for inside walls: almost flat, a faint roller texture. */
export function plaster(): Surface | null {
  return surface('plaster', 256, 2, (u, v, px, py) => {
    const cloud = fbm(u, v, 6, 3, 137);
    const c = shade([246, 244, 239], 0.97 + cloud * 0.04 + hash(px, py, 139) * 0.01);
    return { rgb: c, height: cloud * 0.4, rough: 0.9 };
  }, 0.5);
}

/** Trapezoidal steel cladding, 1 m wide per tile, ribs every 25 cm; white base, tinted per building. */
export function cladding(): Surface | null {
  const size = 256;
  return surface('cladding', size, 1, (u, v, px, py) => {
    const t = (u * 4) % 1;
    const rib = t < 0.18 ? 1 : t < 0.26 ? 1 - (t - 0.18) / 0.08 : t > 0.92 ? (t - 0.92) / 0.08 : 0;
    const light = 0.9 + rib * 0.1 - (t > 0.26 && t < 0.32 ? 0.06 : 0);
    const c = shade([245, 246, 247], light + hash(px, py, 149) * 0.01 + fbm(u, v, 4, 2, 151) * 0.02);
    return { rgb: c, height: rib, rough: 0.45 };
  }, 3);
}

/** Standing-seam metal roof, seams every 50 cm. */
export function roofMetal(): Surface | null {
  const size = 256;
  return surface('roof', size, 2, (u, v, px, py) => {
    const t = (u * 4) % 1;
    const seam = t < 0.04 ? 1 : 0;
    const c = shade([206, 210, 214], 0.94 + seam * 0.08 + fbm(u, v, 5, 3, 157) * 0.05 + hash(px, py, 163) * 0.01);
    return { rgb: c, height: seam, rough: 0.5 };
  }, 2);
}

/** Precast concrete panels, 3 × 3 m, with recessed joints and form-tie dots. */
export function precast(): Surface | null {
  const size = 512;
  return surface('precast', size, 3, (u, v, px, py) => {
    const joint = px < 3 || py < 3;
    const tie = [0.25, 0.75].some((a) => [0.25, 0.75].some((b) => Math.hypot(u - a, v - b) < 0.012));
    const cloud = fbm(u, v, 4, 4, 167);
    const c = joint ? [150, 150, 146] as const : shade(mix([214, 212, 206], [192, 190, 184], cloud), tie ? 0.8 : 1);
    return { rgb: c, height: joint ? 0 : 1 - (tie ? 0.3 : 0), rough: 0.8 };
  }, 1.4);
}

/** Cut limestone blocks (1.2 × 0.6 m), warm, as on Egyptian public buildings. */
export function stone(): Surface | null {
  const size = 512;
  const metres = 2.4;
  const pxm = size / metres;
  return surface('stone', size, metres, (u, v, px, py) => {
    const bh = 0.6 * pxm;
    const bw = 1.2 * pxm;
    const row = Math.floor(py / bh);
    const shift = row % 2 ? bw / 2 : 0;
    const col = Math.floor((px + shift) / bw);
    const joint = (px + shift) % bw < 2 || py % bh < 2;
    const tint = hash(col, row, 173);
    const cloud = fbm(u, v, 6, 4, 179);
    const c = joint ? [170, 158, 138] as const : shade(mix([232, 220, 196], [214, 198, 170], tint * 0.7 + cloud * 0.3), 0.96 + hash(px, py, 181) * 0.06);
    return { rgb: c, height: joint ? 0 : 1, rough: 0.85 };
  }, 1.3);
}

/**
 * A curtain wall of one storey: mullions every 1.5 m, a transom at sill height, glass panes with
 * a sky reflection and the odd blind half down. 3 m wide × 3.5 m tall per tile.
 */
export function curtainWall(): THREE.Texture | null {
  const key = 'curtain-wall';
  if (cache.has(key)) return cache.get(key)!;
  const c = canvasOf(512, 600);
  if (!c) { cache.set(key, null); return null; }
  const { g } = c;
  const W = 512;
  const H = 600;
  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#a9c3dd');
  sky.addColorStop(0.55, '#5f7f9e');
  sky.addColorStop(1, '#2d4056');
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);
  for (let pane = 0; pane < 2; pane++) {
    const blind = hash(pane, 3, 191);
    if (blind > 0.5) {
      g.fillStyle = 'rgba(232, 228, 216, 0.55)';
      g.fillRect(pane * 256 + 8, 0, 240, H * (0.2 + blind * 0.35));
    }
    const glare = g.createLinearGradient(pane * 256, 0, pane * 256 + 256, H);
    glare.addColorStop(0, 'rgba(255,255,255,0.18)');
    glare.addColorStop(0.4, 'rgba(255,255,255,0)');
    glare.addColorStop(0.7, 'rgba(255,255,255,0.06)');
    g.fillStyle = glare;
    g.fillRect(pane * 256, 0, 256, H);
  }
  g.fillStyle = '#3b4148';
  for (const x of [0, 256]) g.fillRect(x, 0, 10, H);
  g.fillRect(0, 0, W, 10);
  g.fillRect(0, 430, W, 16);
  g.fillStyle = '#5a6068';
  g.fillRect(0, 446, W, H - 446);
  const texture = finish(c.canvas, { repeat: true, metres: 3 });
  cache.set(key, texture);
  return texture;
}

/** A horizontal ribbon window (one pane per 1.5 m), for clad industrial buildings. */
export function ribbonWindow(): THREE.Texture | null {
  return canvasTexture('ribbon-window', 256, 128, (g) => {
    const sky = g.createLinearGradient(0, 0, 0, 128);
    sky.addColorStop(0, '#b7cde0');
    sky.addColorStop(1, '#46607a');
    g.fillStyle = sky;
    g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#39404a';
    g.fillRect(0, 0, 6, 128);
    g.fillRect(128, 0, 6, 128);
    g.fillRect(0, 0, 256, 6);
    g.fillRect(0, 122, 256, 6);
  }, true);
}

/** Lettering for a building front, drawn on a transparent canvas: company blue on the facade. */
export function signTexture(text: string): THREE.Texture | null {
  return canvasTexture(`sign:${text}`, 1024, 256, (g) => {
    g.clearRect(0, 0, 1024, 256);
    g.fillStyle = '#1428a0';
    g.font = '800 190px Geist, "Helvetica Neue", Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const spaced = text.split('').join(' ');
    g.fillText(spaced, 512, 136, 1000);
  });
}

/** A lively picture for TVs and wall displays (lit as emissive). */
export function screenPicture(): THREE.Texture | null {
  return canvasTexture('screen-picture', 512, 288, (g) => {
    const sky = g.createLinearGradient(0, 0, 0, 288);
    sky.addColorStop(0, '#0b1f5c');
    sky.addColorStop(0.55, '#2e67d8');
    sky.addColorStop(0.75, '#f4a259');
    sky.addColorStop(1, '#1b2436');
    g.fillStyle = sky;
    g.fillRect(0, 0, 512, 288);
    g.fillStyle = 'rgba(255, 230, 160, 0.9)';
    g.beginPath();
    g.arc(360, 190, 34, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#10182a';
    g.beginPath();
    g.moveTo(0, 288);
    g.lineTo(120, 190);
    g.lineTo(210, 240);
    g.lineTo(330, 170);
    g.lineTo(512, 250);
    g.lineTo(512, 288);
    g.fill();
  });
}

/** The side of a staff coach: dark window band, a coloured stripe, a door. */
export function coachLivery(stripe: string): THREE.Texture | null {
  return canvasTexture(`coach:${stripe}`, 1024, 256, (g) => {
    g.fillStyle = '#f6f6f4';
    g.fillRect(0, 0, 1024, 256);
    const glass = g.createLinearGradient(0, 40, 0, 140);
    glass.addColorStop(0, '#5d6f82');
    glass.addColorStop(1, '#1f2833');
    g.fillStyle = glass;
    g.fillRect(40, 40, 944, 100);
    g.fillStyle = '#f6f6f4';
    for (let x = 150; x < 980; x += 110) g.fillRect(x, 40, 6, 100);
    g.fillStyle = stripe;
    g.beginPath();
    g.moveTo(0, 180);
    g.bezierCurveTo(300, 150, 600, 210, 1024, 160);
    g.lineTo(1024, 196);
    g.bezierCurveTo(600, 240, 300, 186, 0, 214);
    g.fill();
    g.fillStyle = 'rgba(20, 24, 30, 0.8)';
    g.fillRect(48, 40, 60, 190);
  });
}

/** Grid of steel locker doors with vents and handles. */
export function lockerDoors(): THREE.Texture | null {
  return canvasTexture('lockers', 256, 256, (g) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(40, 50, 60, 0.55)';
    g.lineWidth = 3;
    for (let c = 0; c < 3; c++) for (let r = 0; r < 2; r++) {
      g.strokeRect(c * 85 + 3, r * 128 + 3, 79, 122);
      g.fillStyle = 'rgba(40, 50, 60, 0.35)';
      for (let k = 0; k < 4; k++) g.fillRect(c * 85 + 22, r * 128 + 16 + k * 7, 40, 3);
      g.fillStyle = 'rgba(30, 30, 30, 0.7)';
      g.fillRect(c * 85 + 66, r * 128 + 60, 5, 14);
    }
  });
}

/** Front of a vending machine: lit product shelves behind glass, a panel on the right. */
export function vendingFront(): THREE.Texture | null {
  return canvasTexture('vending', 256, 512, (g) => {
    g.fillStyle = '#1b2230';
    g.fillRect(0, 0, 256, 512);
    g.fillStyle = '#e9eef6';
    g.fillRect(12, 16, 172, 380);
    const colours = ['#d23b3b', '#f0a92c', '#2a6fd6', '#2e9b57', '#8a3fb5', '#e8e2d0'];
    for (let r = 0; r < 6; r++) {
      g.fillStyle = '#9aa6b6';
      g.fillRect(12, 16 + r * 63 + 56, 172, 4);
      for (let c = 0; c < 6; c++) {
        g.fillStyle = colours[(r * 5 + c * 3) % colours.length]!;
        g.fillRect(18 + c * 28, 16 + r * 63 + 18, 18, 38);
      }
    }
    g.fillStyle = '#39465a';
    g.fillRect(196, 60, 48, 120);
    g.fillStyle = '#7fd1ff';
    g.fillRect(202, 70, 36, 22);
    g.fillStyle = '#0b0f16';
    g.fillRect(24, 420, 150, 60);
  });
}

/** Red and white stripes for a barrier arm. */
export function barrierStripes(): THREE.Texture | null {
  return canvasTexture('barrier', 256, 16, (g) => {
    for (let k = 0; k < 8; k++) {
      g.fillStyle = k % 2 ? '#ffffff' : '#c62a2a';
      g.fillRect(k * 32, 0, 32, 16);
    }
  }, true);
}

/** A flag: 'eg' is Egypt's red, white and black with a gold emblem; otherwise a company flag. */
export function flagTexture(kind: 'eg' | 'company', text = ''): THREE.Texture | null {
  return canvasTexture(`flag:${kind}:${text}`, 300, 200, (g) => {
    if (kind === 'eg') {
      g.fillStyle = '#ce1126';
      g.fillRect(0, 0, 300, 67);
      g.fillStyle = '#ffffff';
      g.fillRect(0, 67, 300, 66);
      g.fillStyle = '#000000';
      g.fillRect(0, 133, 300, 67);
      g.fillStyle = '#c09300';
      g.beginPath();
      g.moveTo(150, 78);
      g.lineTo(168, 96);
      g.lineTo(160, 122);
      g.lineTo(140, 122);
      g.lineTo(132, 96);
      g.fill();
      return;
    }
    g.fillStyle = '#1428a0';
    g.fillRect(0, 0, 300, 200);
    g.fillStyle = '#ffffff';
    g.font = '800 44px Geist, Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 150, 102, 280);
  });
}

// ─── Carton, pallet and container textures (from the logistics sample) ────────────────────────

/** A retail carton face: product line, size and a TV outline, with handling marks. */
export function printedCarton(print: string): THREE.Texture | null {
  return canvasTexture(`print:${print}`, 512, 320, (g) => {
    g.fillStyle = '#f2ead9';
    g.fillRect(0, 0, 512, 320);
    g.fillStyle = 'rgba(120, 90, 50, 0.08)';
    for (let x = 0; x < 512; x += 6) g.fillRect(x, 0, 2, 320);
    g.fillStyle = '#10151c';
    g.fillRect(0, 250, 512, 70);
    g.fillStyle = '#1428a0';
    g.fillRect(0, 244, 512, 6);
    const grad = g.createLinearGradient(150, 40, 360, 200);
    grad.addColorStop(0, '#1d3f8f');
    grad.addColorStop(0.5, '#4a86d8');
    grad.addColorStop(1, '#0e1b3a');
    g.fillStyle = grad;
    g.fillRect(170, 36, 300, 170);
    g.strokeStyle = '#10151c';
    g.lineWidth = 6;
    g.strokeRect(170, 36, 300, 170);
    g.strokeStyle = 'rgba(40, 30, 15, 0.6)';
    g.lineWidth = 8;
    g.strokeRect(0, 0, 512, 320);
    g.fillStyle = '#10151c';
    g.font = '600 44px Geist, Arial, sans-serif';
    const [line, size] = print.split('|');
    g.fillText(line ?? print, 22, 92, 140);
    g.font = '300 64px Geist, Arial, sans-serif';
    if (size) g.fillText(size, 22, 170, 140);
    g.fillStyle = '#f7f6f2';
    g.font = '500 26px Geist, Arial, sans-serif';
    g.fillText('FRAGILE · HANDLE WITH CARE', 22, 294);
    g.strokeStyle = '#f7f6f2';
    g.lineWidth = 5;
    for (const x of [430, 470]) {
      g.beginPath();
      g.moveTo(x, 305);
      g.lineTo(x, 268);
      g.moveTo(x - 10, 280);
      g.lineTo(x, 266);
      g.lineTo(x + 10, 280);
      g.stroke();
    }
  });
}

/** Cartons stacked on a pallet under stretch wrap: seams in a regular grid. */
export function cartonStack(): THREE.Texture | null {
  return canvasTexture('carton-stack', 256, 256, (g) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(40, 32, 20, 0.28)';
    g.lineWidth = 3;
    for (let y = 0; y <= 256; y += 64) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(256, y);
      g.stroke();
      const shift = (y / 64) % 2 ? 42 : 0;
      for (let x = shift; x <= 256; x += 85) {
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x, y + 64);
        g.stroke();
      }
    }
    const sheen = g.createLinearGradient(0, 0, 256, 256);
    sheen.addColorStop(0, 'rgba(255,255,255,0.35)');
    sheen.addColorStop(0.5, 'rgba(255,255,255,0)');
    sheen.addColorStop(1, 'rgba(255,255,255,0.25)');
    g.fillStyle = sheen;
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = 'rgba(255,255,255,0.95)';
    g.fillRect(150, 150, 70, 46);
    g.fillStyle = 'rgba(20,20,20,0.7)';
    for (let i = 0; i < 5; i++) g.fillRect(156 + i * 11, 172, 5, 18);
  });
}

/** A plain carton face with darker edges and a tape strip, so neighbouring boxes read as separate pieces. */
export function cartonFace(): THREE.Texture | null {
  return canvasTexture('carton-face', 128, 128, (g) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = 'rgba(60, 45, 25, 0.10)';
    g.fillRect(56, 0, 16, 128);
    g.strokeStyle = 'rgba(40, 30, 15, 0.55)';
    g.lineWidth = 6;
    g.strokeRect(0, 0, 128, 128);
  });
}

/** Vertical ribs of a steel container wall. */
export function corrugated(): THREE.Texture | null {
  return canvasTexture('corrugated', 128, 16, (g) => {
    const grad = g.createLinearGradient(0, 0, 128, 0);
    for (let i = 0; i <= 4; i++) {
      grad.addColorStop(i / 4, '#ffffff');
      if (i < 4) grad.addColorStop(i / 4 + 0.125, '#b9bcc0');
    }
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 16);
  }, true);
}

/** Hardwood planks of a container floor or a stage. */
export function planks(): THREE.Texture | null {
  return canvasTexture('planks', 256, 256, (g) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 ? 'rgba(90,60,30,0.10)' : 'rgba(90,60,30,0.02)';
      g.fillRect(0, i * 32, 256, 32);
      g.fillStyle = 'rgba(60,40,20,0.35)';
      g.fillRect(0, i * 32, 256, 2);
      g.fillRect(((i * 97) % 256), i * 32, 2, 32);
    }
  }, true);
}

/** Checkered dance floor, 60 cm squares, two woods. */
export function checker(): THREE.Texture | null {
  return canvasTexture('checker', 256, 256, (g) => {
    for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) {
      g.fillStyle = (r + c) % 2 ? '#a7784e' : '#5f422b';
      g.fillRect(c * 128, r * 128, 128, 128);
      g.fillStyle = 'rgba(255,255,255,0.05)';
      g.fillRect(c * 128, r * 128, 128, 4);
    }
  }, true);
}
