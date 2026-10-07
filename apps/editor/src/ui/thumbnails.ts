import type { ItemDefinition } from '@space-planner/core';
import { shapeOf } from '@space-planner/starter';
import { useSyncExternalStore } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildModel } from './models3d.js';

/**
 * Catalogue pictures of item types, rendered from their own 3D models (decision 0027): a soft
 * studio light, a three-quarter view from the front, a transparent background. One small
 * renderer draws them one at a time between frames, so opening the library never stalls the
 * editor; each picture is made once per item type and kept for the session. Where WebGL is not
 * available the library keeps its line drawings.
 */

const SIZE = 240;
const pictures = new Map<string, string | null>();
const waiting: ItemDefinition[] = [];
const listeners = new Set<() => void>();
let version = 0;
let scheduled = false;
let studio: { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera } | null | undefined;

/** Same type, same picture: the key holds everything the model is drawn from. */
function keyOf(d: ItemDefinition): string {
  return `${d.id}|${d.category}|${d.size.w}x${d.size.d}x${d.size.h}|${d.footprint ?? ''}|${JSON.stringify(d.meta ?? {})}`;
}

function setUp(): typeof studio {
  if (studio !== undefined) return studio;
  try {
    const canvas = document.createElement('canvas');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
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

function render(d: ItemDefinition): string | null {
  const s = setUp();
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
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.geometry.dispose();
      for (const material of [mesh.material].flat()) if (!material.userData.shared) material.dispose();
    }
  });
  return url;
}

function work(): void {
  scheduled = false;
  const started = performance.now();
  // A few pictures per slice, then give the frame back.
  while (waiting.length > 0 && performance.now() - started < 24) {
    const d = waiting.shift()!;
    const key = keyOf(d);
    if (pictures.has(key)) continue;
    let url: string | null = null;
    try {
      url = render(d);
    } catch {
      url = null;
    }
    pictures.set(key, url);
    version++;
  }
  for (const listener of listeners) listener();
  if (waiting.length > 0) schedule();
}

function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  const idle = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  if (idle) idle(work, { timeout: 200 });
  else setTimeout(work, 16);
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
  if (typeof document !== 'undefined' && !waiting.some((w) => keyOf(w) === key)) {
    waiting.push(d);
    schedule();
  }
  return undefined;
}
