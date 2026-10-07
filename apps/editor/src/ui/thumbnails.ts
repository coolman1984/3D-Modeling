import type { ItemDefinition } from '@space-planner/core';
import { shapeOf } from '@space-planner/starter';
import { useSyncExternalStore } from 'react';
import type * as THREE_NS from 'three';

// The 3D engine loads only when the first picture is drawn, so the editor opens without it.
type Engine = { THREE: typeof THREE_NS; RoomEnvironment: typeof import('three/examples/jsm/environments/RoomEnvironment.js').RoomEnvironment; buildModel: typeof import('./models3d.js').buildModel };
let engine: Promise<Engine> | undefined;
const loadEngine = () =>
  (engine ??= Promise.all([import('three'), import('three/examples/jsm/environments/RoomEnvironment.js'), import('./models3d.js')]).then(([THREE, env, models]) => ({ THREE, RoomEnvironment: env.RoomEnvironment, buildModel: models.buildModel })));

/**
 * Catalogue pictures of item types, rendered from their own 3D models (decision 0027): a soft
 * studio light, a three-quarter view from the front, a transparent background. One small
 * renderer draws them one at a time when the browser is idle, after the page has opened, so the
 * library never slows opening the editor; each picture is drawn once and kept on this device. Where WebGL is not
 * available the library keeps its line drawings.
 */

const SIZE = 240;
const pictures = new Map<string, string | null>();
const waiting: ItemDefinition[] = [];
const listeners = new Set<() => void>();
let version = 0;
let scheduled = false;
let slow = false;
let studio: { renderer: THREE_NS.WebGLRenderer; scene: THREE_NS.Scene; camera: THREE_NS.PerspectiveCamera } | null | undefined;

/** Same type, same picture: the key holds everything the model is drawn from. */
function keyOf(d: ItemDefinition): string {
  return `${d.id}|${d.category}|${d.size.w}x${d.size.d}x${d.size.h}|${d.footprint ?? ''}|${JSON.stringify(d.meta ?? {})}`;
}

function setUp({ THREE, RoomEnvironment }: Engine): typeof studio {
  if (studio !== undefined) return studio;
  try {
    const canvas = document.createElement('canvas');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    // Software-only graphics (no graphics card) draws each picture in seconds and freezes the page:
    // there the library keeps its line drawings.
    const gl = renderer.getContext();
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    if (/swiftshader|llvmpipe|software|softpipe/i.test(name)) {
      renderer.dispose();
      studio = null;
      return studio;
    }
    renderer.setPixelRatio(1);
    renderer.setSize(SIZE, SIZE * 0.8, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.86;
    renderer.shadowMap.enabled = true;
    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.55;
    pmrem.dispose();
    scene.add(new THREE.HemisphereLight(0xffffff, 0xe8e2d8, 0.6));
    const key = new THREE.DirectionalLight(0xfff6ea, 1.6);
    key.position.set(-2, 4, -3);
    key.castShadow = true;
    key.shadow.mapSize.set(512, 512);
    scene.add(key);
    // A floor that only catches the soft contact shadow.
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.ShadowMaterial({ opacity: 0.12 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    studio = { renderer, scene, camera: new THREE.PerspectiveCamera(28, 1.25, 0.01, 100) };
  } catch {
    studio = null;
  }
  return studio;
}

function render(e: Engine, d: ItemDefinition): string | null {
  const { THREE, buildModel } = e;
  const s = setUp(e);
  if (!s) return null;
  const m = (ticks: number) => ticks / 10_000;
  const model = buildModel(shapeOf(d.category), m(d.size.w), m(d.size.d), m(d.size.h), { definition: d });
  s.scene.add(model);
  const box = new THREE.Box3().setFromObject(model);
  const centre = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  // Frame the footprint and height, not the arc of a lamp or the stools in front of an island.
  const radius = Math.max(0.15, Math.hypot(Math.max(size.x, size.z), size.y) / 2);
  // Front is −Z: look from the front-left and above; flat things (rugs) from higher up.
  const flat = size.y < 0.08;
  const direction = new THREE.Vector3(-0.75, flat ? 1.6 : 0.62, -1.15).normalize();
  const distance = (radius / Math.sin(THREE.MathUtils.degToRad(s.camera.fov / 2))) * 0.78;
  s.camera.position.copy(centre).addScaledVector(direction, distance);
  s.camera.lookAt(centre);
  s.camera.near = distance / 50;
  s.camera.far = distance * 4;
  s.camera.updateProjectionMatrix();
  s.renderer.render(s.scene, s.camera);
  const url = s.renderer.domElement.toDataURL('image/webp', 0.86);
  s.scene.remove(model);
  model.traverse((o) => {
    const mesh = o as THREE_NS.Mesh;
    if (mesh.isMesh) {
      mesh.geometry.dispose();
      for (const material of [mesh.material].flat()) if (!material.userData.shared) material.dispose();
    }
  });
  return url;
}

/** True when this browser draws with software only (no graphics card): asked of a bare canvas, without loading the 3D engine. */
let software: boolean | undefined;
function softwareGraphics(): boolean {
  if (software !== undefined) return software;
  try {
    const gl = document.createElement('canvas').getContext('webgl2') ?? document.createElement('canvas').getContext('webgl');
    if (!gl) return (software = true);
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    software = /swiftshader|llvmpipe|software|softpipe/i.test(name);
  } catch {
    software = true;
  }
  return software;
}

async function work(): Promise<void> {
  if (softwareGraphics()) {
    // Each picture would take seconds and freeze the page: the library keeps its line drawings.
    for (const d of waiting.splice(0)) pictures.set(keyOf(d), null);
    version++;
    for (const listener of listeners) listener();
    scheduled = false;
    return;
  }
  let e: Engine;
  try {
    e = await loadEngine();
  } catch {
    // No 3D engine (offline chunk failed): the library keeps its line drawings.
    for (const d of waiting.splice(0)) pictures.set(keyOf(d), null);
    version++;
    for (const listener of listeners) listener();
    scheduled = false;
    return;
  }
  scheduled = false;
  if (slow) {
    for (const d of waiting.splice(0)) pictures.set(keyOf(d), null);
    version++;
    for (const listener of listeners) listener();
    return;
  }
  const started = performance.now();
  // A few pictures per slice, then give the frame back.
  while (waiting.length > 0 && !slow && performance.now() - started < 24) {
    const d = waiting.shift()!;
    const key = keyOf(d);
    if (pictures.has(key)) continue;
    let url: string | null = null;
    const t0 = performance.now();
    try {
      url = render(e, d);
    } catch {
      url = null;
    }
    // A slow device: one picture took over a quarter of a second (after the first, which also
    // prepares the shaders). Stop drawing for this visit rather than make the page stutter.
    if (performance.now() - t0 > 250 && pictures.size > 0) slow = true;
    pictures.set(key, url);
    if (url) remember(key, url);
    version++;
  }
  for (const listener of listeners) listener();
  if (waiting.length > 0) schedule(slow ? 0 : 200);
}

/** Pictures already drawn on this device, by key; drawn once, kept across visits. */
// Change the version when the 3D models change, so old pictures are drawn again.
const STORE = 'atrium.thumb.v1:';
function remembered(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(STORE + key) ?? null;
  } catch {
    return null;
  }
}
function remember(key: string, url: string): void {
  try {
    globalThis.localStorage?.setItem(STORE + key, url);
  } catch {
    // Storage full or refused: the picture is drawn again next visit.
  }
}

/** Never compete with opening a page: wait until the browser has nothing else to do. */
function schedule(delay = 0): void {
  if (scheduled) return;
  scheduled = true;
  const idle = (globalThis as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback;
  const run = () => void work();
  setTimeout(() => (idle ? idle(run) : setTimeout(run, 50)), delay);
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The picture of an item type: a data URL once drawn, undefined while waiting, null without WebGL. */
export function useThumbnail(d: ItemDefinition): string | null | undefined {
  useSyncExternalStore(subscribe, () => version);
  const key = keyOf(d);
  if (pictures.has(key)) return pictures.get(key);
  const kept = remembered(key);
  if (kept) {
    pictures.set(key, kept);
    return kept;
  }
  if (typeof document !== 'undefined' && !waiting.some((w) => keyOf(w) === key)) {
    waiting.push(d);
    schedule(1200); // after the page that asked has opened
  }
  return undefined;
}
