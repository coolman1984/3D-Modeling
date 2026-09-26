import { boundsOf, type Id, type Issue, type ItemDefinition, type ItemInstance, type Project, type Vec2 } from '@space-planner/core';
import { materialOf, materialsOf, rackSpecOf, rackStock, shapeOf, slotId, slotPlacement, type RackSpec, type ShapeKey } from '@space-planner/starter';
import { ArrowClockwise, ArrowCounterClockwise, Camera, CornersOut, Cube, Scissors, Square } from '@phosphor-icons/react';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { stockColor, type StockView } from './Stock.js';
import { cartonFace, cartonStack, corrugated, planks, printedCarton } from './textures.js';
import { headingQuarter, type ControlSettings } from '../logic/controls.js';
import type { Action } from '../logic/session.js';
import { snapMove } from '../logic/snap.js';
import { elevateCommands, movable, moveCommands } from '../logic/transform.js';

interface Props {
  /** What to draw: the saved project with any change in progress on top. */
  readonly project: Project;
  /** The saved project: drags are measured from here. */
  readonly saved: Project;
  readonly issues: readonly Issue[];
  readonly selectedIds: readonly Id[];
  readonly controls: ControlSettings;
  readonly dispatch: (action: Action) => void;
  /** Bump to re-frame the whole room. */
  readonly fitToken: number;
  /** Told which quarter-turn the camera faces (0 = north), so arrow keys can follow the view. */
  readonly onHeading?: (quarter: 0 | 1 | 2 | 3) => void;
  /** Pack-driven look: colours per item, items hidden (load playback), the near wall cut away. */
  readonly look?: SceneLook | undefined;
  /** Start with full-height walls (a container shell) instead of walls cut at 1.10 m. */
  readonly fullWallsAtStart?: boolean;
  /** Told when a stored pallet is clicked: its location id and rack row. */
  readonly onSlot?: ((slot: string, rackId: Id) => void) | undefined;
}

export interface SceneLook {
  readonly itemColors?: ReadonlyMap<Id, number>;
  readonly hidden?: ReadonlySet<Id>;
  /** Leave out the south wall (the one nearest the starting camera) to look inside. */
  readonly cutaway?: boolean;
  readonly routePoints?: readonly Vec2[];
  /** How rack stock is coloured, which material is picked out and which location is selected. */
  readonly stock?: StockView;
}

const TICKS_PER_METRE = 10_000;
const mt = (ticks: number) => ticks / TICKS_PER_METRE;
const DOOR_HEIGHT = 2.1;
const WALL_THICKNESS = 0.12;

const COLORS = {
  floor: 0xf4f2ed,
  wall: 0xfbfaf8,
  wood: 0xa7784e,
  darkWood: 0x6f4f35,
  cloth: 0xfbfaf7,
  fabric: 0xd9d4ca,
  metal: 0x8c939c,
  stage: 0x2b2a27,
  plantPot: 0x8a5a3c,
  leaves: 0x4f8a4b,
  box: 0xd6d2c9,
  palletA: 0xc9a06a,
  palletB: 0x8fa3b0,
  palletC: 0xb7c19a,
  palletWrap: 0xe8e4da,
  carBody: 0x3b5b8c,
  carGlass: 0x2a2e33,
  tyre: 0x1f1e1c,
  bayLine: 0xd8d3c6,
  column: 0x3a3834,
  blocked: 0xb93a2e,
  selected: 0x2b54d0,
  error: 0xb93a2e,
  warning: 0x9a6400,
  grid: 0x1a1917,
  rackUpright: 0x2f5a96,
  rackBeam: 0xe07a2c,
  palletWood: 0xc29a66,
  forklift: 0xf0b429,
  forkliftDark: 0x2c2b29,
  carton: 0xefeae0,
  dimStock: 0xe6e3dc,
  containerSteel: 0x3d78a8,
  containerFloor: 0xb88657,
  warehouseFloor: 0xe7e4dd,
  safetyYellow: 0xe8b923,
  walkGreen: 0x3f8f5a,
  dockPlate: 0x4a4844,
};

/**
 * Put the camera where the whole room is in view, looking down at it from the south, and aim
 * the sun's shadows at it. Returns the point the camera looks at.
 */
function frameRoom(scene: THREE.Scene, camera: THREE.PerspectiveCamera, room: { minX: number; minY: number; maxX: number; maxY: number }, aspect: number): THREE.Vector3 {
  const centre = new THREE.Vector3(mt((room.minX + room.maxX) / 2), 0, -mt((room.minY + room.maxY) / 2));
  const size = Math.max(mt(room.maxX - room.minX), mt(room.maxY - room.minY), 2);
  // Narrow panes (side-by-side view) need the camera further back to keep the room in frame.
  const back = aspect < 1.2 ? 1.05 / aspect : 1;
  camera.position.set(centre.x + size * 0.15 * back, size * 0.95 * back, centre.z + size * 1.05 * back);
  camera.lookAt(centre);
  const sun = scene.children.find((c) => (c as THREE.DirectionalLight).isDirectionalLight) as THREE.DirectionalLight | undefined;
  if (sun) {
    sun.position.set(centre.x - size * 0.4, size * 1.2, centre.z + size * 0.6);
    sun.target.position.copy(centre);
    const cam = sun.shadow.camera;
    cam.left = cam.bottom = -size;
    cam.right = cam.top = size;
    cam.far = size * 4;
    cam.updateProjectionMatrix();
  }
  return centre;
}

function lights(scene: THREE.Scene, background: number | null = 0xefede8): void {
  scene.background = background === null ? null : new THREE.Color(background);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb8b2a8, 1.25));
  const sun = new THREE.DirectionalLight(0xfff8ee, 1.9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
}

/**
 * Soft studio reflections and a tone curve that keeps the design colours: metal racking, printed
 * cartons and steel shells read as materials instead of flat paint.
 */
function studio(renderer: THREE.WebGLRenderer, scene: THREE.Scene, reflections = true): void {
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  // Building the reflection map blocks the page for a moment; one-off report pictures skip it.
  if (!reflections) return;
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.45;
  pmrem.dispose();
}

/**
 * A still picture of the whole room (PNG data URL) for reports, or null when the browser
 * cannot draw 3D. Uses its own renderer, so it works without an open 3D view.
 */
export function renderSnapshot(project: Project, issues: readonly Issue[], width: number, height: number, look?: SceneLook, fullWalls = false): string | null {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  } catch {
    return null;
  }
  try {
    renderer.setPixelRatio(2);
    renderer.setSize(width, height, false);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    lights(scene);
    studio(renderer, scene, false);
    const content = buildScene(project, issues, [], fullWalls, look);
    scene.add(content);
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.05, 2000);
    frameRoom(scene, camera, boundsOf(project.space.boundary), width / height);
    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL('image/png');
    disposeTree(content);
    scene.environment?.dispose();
    return url;
  } catch {
    return null;
  } finally {
    renderer.dispose();
    renderer.forceContextLoss(); // browsers allow only a few live 3D canvases
  }
}

/** Plan (x east, y north, z up) → three.js (X east, Y up, Z south). */
const at = (p: Vec2, height = 0) => new THREE.Vector3(mt(p.x), height, -mt(p.y));

function material(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.05 });
}

function box(w: number, h: number, d: number, color: number, x = 0, y = h / 2, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(color));
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function cylinder(r: number, h: number, color: number, x = 0, y = h / 2, z = 0, segments = 32): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, segments), material(color));
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * A simple model for each shape, in the item's local frame: width along X, depth along Z,
 * front facing -Z (plan north at rotation 0), standing on Y = 0.
 */
interface ModelExtra {
  /** Text printed on a carton's large faces: "line|size". */
  readonly print?: string | undefined;
  /** Racks show the real stock layer instead of placeholder loads. */
  readonly stocked?: boolean;
  /** Draw as a loaded pallet with this load colour (a stock material on the floor). */
  readonly pallet?: number | undefined;
}

function buildModel(shape: ShapeKey, w: number, d: number, h: number, rack?: RackSpec, extra: ModelExtra = {}): THREE.Group {
  const g = new THREE.Group();
  const leg = Math.min(0.05, w / 8, d / 8);
  const legs = (height: number, color: number, inset = 0.04) => {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(leg, height, leg, color, sx * (w / 2 - inset - leg / 2), height / 2, sz * (d / 2 - inset - leg / 2)));
  };
  switch (shape) {
    case 'table': {
      g.add(box(w, 0.04, d, COLORS.cloth, 0, h - 0.02));
      legs(h - 0.04, COLORS.darkWood);
      break;
    }
    case 'round-table': {
      const r = Math.min(w, d) / 2;
      g.add(cylinder(r, 0.04, COLORS.cloth, 0, h - 0.02));
      g.add(cylinder(0.05, h - 0.04, COLORS.metal, 0, (h - 0.04) / 2));
      g.add(cylinder(r * 0.4, 0.03, COLORS.metal, 0, 0.015));
      break;
    }
    case 'chair': {
      const seat = Math.min(0.46, h * 0.5);
      g.add(box(w * 0.92, 0.05, d * 0.9, COLORS.fabric, 0, seat));
      g.add(box(w * 0.92, h - seat, 0.05, COLORS.fabric, 0, seat + (h - seat) / 2, d / 2 - 0.05));
      legs(seat - 0.025, COLORS.metal, 0.05);
      break;
    }
    case 'sofa': {
      const seat = h * 0.5;
      g.add(box(w, seat, d, COLORS.fabric, 0, seat / 2));
      g.add(box(w, h - seat, d * 0.22, COLORS.fabric, 0, seat + (h - seat) / 2, d / 2 - d * 0.11));
      for (const sx of [-1, 1]) g.add(box(0.14, h * 0.7, d, COLORS.fabric, sx * (w / 2 - 0.07), (h * 0.7) / 2));
      break;
    }
    case 'desk': {
      g.add(box(w, 0.04, d, COLORS.wood, 0, h - 0.02));
      for (const sx of [-1, 1]) g.add(box(0.04, h - 0.04, d * 0.9, COLORS.wood, sx * (w / 2 - 0.02), (h - 0.04) / 2));
      g.add(box(w - 0.08, (h - 0.04) * 0.5, 0.02, COLORS.wood, 0, h - 0.04 - ((h - 0.04) * 0.5) / 2, d / 2 - 0.05));
      break;
    }
    case 'counter': {
      g.add(box(w, h - 0.04, d * 0.94, COLORS.wood, 0, (h - 0.04) / 2, 0.01));
      g.add(box(w + 0.04, 0.04, d, COLORS.cloth, 0, h - 0.02));
      break;
    }
    case 'stage': {
      g.add(box(w, h, d, COLORS.stage));
      g.add(box(w, 0.02, d, 0x3a3834, 0, h + 0.01));
      break;
    }
    case 'shelf': {
      for (const sx of [-1, 1]) g.add(box(0.03, h, d, COLORS.wood, sx * (w / 2 - 0.015)));
      g.add(box(w, h, 0.02, COLORS.wood, 0, h / 2, d / 2 - 0.01));
      for (let i = 0; i < 5; i++) g.add(box(w - 0.06, 0.025, d - 0.02, COLORS.wood, 0, 0.05 + (i * (h - 0.08)) / 4));
      break;
    }
    case 'rack': {
      if (!rack) { g.add(box(w, h, d, COLORS.metal)); break; }
      const upright = mt(rack.uprightWidth);
      const bay = mt(rack.bayWidth);
      // Level 1 is the floor; every level above stands on a pair of beams (same pitch as `slotPlacement`).
      const pitch = h / rack.levels;
      const post = Math.min(0.09, upright);
      for (let b = 0; b <= rack.bays; b++) {
        const x = -w / 2 + upright / 2 + b * (bay + upright);
        for (const z of [-d / 2 + post / 2, d / 2 - post / 2]) g.add(box(post, h, post, COLORS.rackUpright, x, h / 2, z));
        // Frame bracing between the front and back posts.
        for (let k = 0; k < Math.max(2, Math.round(h / 1.2)); k++) g.add(box(0.03, 0.03, d - post, COLORS.rackUpright, x, 0.15 + (k * (h - 0.3)) / Math.max(1, Math.round(h / 1.2) - 1)));
      }
      for (let level = 2; level <= rack.levels; level++) {
        const y = (level - 1) * pitch;
        for (const z of [-d / 2 + post / 2, d / 2 - post / 2]) g.add(box(w - upright, 0.11, 0.05, COLORS.rackBeam, 0, y - 0.055, z));
      }
      if (!extra.stocked) {
        // Placeholder loads for racks with no stock data: at most 3 per level keeps long rows cheap.
        const loadColors = [COLORS.palletA, COLORS.palletB, COLORS.palletC];
        const loadD = Math.max(0.1, d - post * 2 - 0.04);
        const loadH = Math.max(0.12, Math.min(1.5, pitch - 0.3));
        const groups = Math.min(rack.bays, 3);
        const baysPerGroup = Math.ceil(rack.bays / groups);
        for (let level = 1; level <= rack.levels; level++) {
          const y = (level - 1) * pitch;
          for (let gStart = 0; gStart < rack.bays; gStart += baysPerGroup) {
            const gEnd = Math.min(rack.bays, gStart + baysPerGroup);
            const x0 = -w / 2 + upright + gStart * (bay + upright);
            const x1 = -w / 2 + upright + (gEnd - 1) * (bay + upright) + bay;
            const gw = (x1 - x0) * 0.94;
            g.add(box(gw, 0.14, loadD * 0.9, COLORS.palletWood, (x0 + x1) / 2, y + 0.07));
            g.add(box(gw * 0.97, loadH - 0.14, loadD * 0.86, loadColors[(gStart / baysPerGroup + level) % loadColors.length]!, (x0 + x1) / 2, y + 0.14 + (loadH - 0.14) / 2));
          }
        }
      }
      break;
    }
    case 'forklift': {
      // Front (forks) faces -Z like every model; body, counterweight and overhead guard behind.
      const bodyD = d * 0.6;
      const bodyZ = d / 2 - bodyD / 2;
      const wheel = Math.min(0.28, h * 0.13);
      g.add(box(w * 0.92, h * 0.34, bodyD, COLORS.forklift, 0, wheel + h * 0.17, bodyZ));
      g.add(box(w * 0.94, h * 0.3, 0.32, COLORS.forkliftDark, 0, wheel + h * 0.15, d / 2 - 0.16));
      g.add(box(w * 0.5, 0.08, 0.45, COLORS.forkliftDark, 0, wheel + h * 0.34 + 0.12, bodyZ + 0.05));
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.05, h * 0.52, 0.05, COLORS.forkliftDark, sx * (w * 0.42), wheel + h * 0.34 + h * 0.26, bodyZ + sz * bodyD * 0.38));
      g.add(box(w * 0.9, 0.04, bodyD * 0.82, COLORS.forkliftDark, 0, h - 0.02, bodyZ));
      const mastZ = d / 2 - bodyD - 0.06;
      for (const sx of [-1, 1]) g.add(box(0.09, h * 1.02, 0.12, COLORS.forkliftDark, sx * w * 0.28, (h * 1.02) / 2, mastZ));
      g.add(box(w * 0.66, 0.5, 0.05, COLORS.forkliftDark, 0, 0.35, mastZ - 0.08));
      const forkL = d - bodyD - 0.2;
      for (const sx of [-1, 1]) g.add(box(0.12, 0.05, forkL, COLORS.metal, sx * w * 0.2, 0.06, mastZ - 0.1 - forkL / 2));
      for (const sx of [-1, 1]) for (const z of [bodyZ - bodyD * 0.3, d / 2 - 0.3]) g.add(box(0.2, wheel * 2, wheel * 2, COLORS.tyre, sx * (w / 2 - 0.1), wheel, z));
      break;
    }
    case 'plant': {
      const r = Math.min(w, d) / 2;
      g.add(cylinder(r * 0.6, Math.min(0.45, h * 0.3), COLORS.plantPot));
      const foliage = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), material(COLORS.leaves));
      foliage.scale.set(1, Math.max(1, (h * 0.7) / (2 * r)), 1);
      foliage.position.y = Math.min(0.45, h * 0.3) + (h - Math.min(0.45, h * 0.3)) / 2;
      foliage.castShadow = true;
      g.add(foliage);
      break;
    }
    case 'car': {
      const bodyH = h * 0.55;
      g.add(box(w, bodyH, d, COLORS.carBody, 0, bodyH / 2));
      g.add(box(w * 0.82, h - bodyH, d * 0.5, COLORS.carGlass, 0, bodyH + (h - bodyH) / 2, -d * 0.08));
      const wheelH = Math.min(0.18, h * 0.15);
      const wheelZ = d / 2 - wheelH * 1.4;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.08, wheelH * 2, wheelH * 2, COLORS.tyre, sx * (w / 2 + 0.02), wheelH, sz * wheelZ));
      break;
    }
    case 'dance-floor': {
      // Checkered tiles of about 60 cm, alternating two woods.
      const nx = Math.max(1, Math.round(w / 0.6));
      const nz = Math.max(1, Math.round(d / 0.6));
      for (let i = 0; i < nx; i++) {
        for (let k = 0; k < nz; k++) {
          const tile = box(w / nx, Math.max(0.005, h), d / nz, (i + k) % 2 ? COLORS.wood : COLORS.darkWood, -w / 2 + (i + 0.5) * (w / nx), Math.max(0.005, h) / 2, -d / 2 + (k + 0.5) * (d / nz));
          tile.castShadow = false;
          g.add(tile);
        }
      }
      break;
    }
    default: {
      if (extra.pallet !== undefined) {
        // A stock material standing on the floor: wooden pallet, stretch-wrapped load on top.
        g.add(box(w, 0.14, d, COLORS.palletWood));
        const load = new THREE.Mesh(new THREE.BoxGeometry(w * 0.97, Math.max(0.05, h - 0.14), d * 0.95), new THREE.MeshStandardMaterial({ color: extra.pallet, map: cartonStack(), roughness: 0.6 }));
        load.position.y = 0.14 + Math.max(0.05, h - 0.14) / 2;
        load.castShadow = true;
        load.receiveShadow = true;
        g.add(load);
        break;
      }
      const map = extra.print ? printedCarton(extra.print) : null;
      const face = cartonFace();
      if (!map) {
        const plainBox = box(w, h, d, COLORS.box);
        if (face) (plainBox.material as THREE.MeshStandardMaterial).map = face;
        g.add(plainBox);
        break;
      }
      // Print on the two large upright faces; box faces are ordered +x, −x, +y, −y, +z, −z.
      const plain = new THREE.MeshStandardMaterial({ color: COLORS.carton, map: face, roughness: 0.85 });
      const printed = new THREE.MeshStandardMaterial({ color: 0xffffff, map, roughness: 0.7 });
      const onZ = w >= d;
      const faces = onZ ? [plain, plain, plain, plain, printed, printed] : [printed, printed, plain, plain, plain, plain];
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), faces);
      mesh.position.y = h / 2;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh);
    }
  }
  return g;
}

/**
 * Fold a model's meshes into one geometry per look, so a rack row with 60 posts and beams costs
 * two draw calls instead of sixty; every part keeps its place through its own matrix.
 */
function mergeTemplate(template: THREE.Group): Array<{ geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[]; castShadow: boolean; receiveShadow: boolean }> {
  template.updateMatrixWorld(true);
  const groups = new Map<string, { material: THREE.Material; geometries: THREE.BufferGeometry[]; castShadow: boolean; receiveShadow: boolean }>();
  const parts: Array<{ geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[]; castShadow: boolean; receiveShadow: boolean }> = [];
  template.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    if (Array.isArray(mesh.material)) {
      parts.push({ geometry, material: mesh.material, castShadow: mesh.castShadow, receiveShadow: mesh.receiveShadow });
      return;
    }
    const m = mesh.material as THREE.MeshStandardMaterial;
    const key = `${m.color?.getHex()}|${m.emissive?.getHex()}|${m.emissiveIntensity}|${m.map?.uuid ?? ''}|${m.transparent}|${m.opacity}|${mesh.castShadow}`;
    const group = groups.get(key);
    if (group) group.geometries.push(geometry);
    else groups.set(key, { material: m, geometries: [geometry], castShadow: mesh.castShadow, receiveShadow: mesh.receiveShadow });
  });
  for (const { material, geometries, castShadow, receiveShadow } of groups.values()) {
    const merged = geometries.length === 1 ? geometries[0]! : mergeGeometries(geometries);
    if (merged) {
      if (merged !== geometries[0]) geometries.forEach((x) => x.dispose());
      parts.push({ geometry: merged, material, castShadow, receiveShadow });
    } else geometries.forEach((geometry) => parts.push({ geometry, material, castShadow, receiveShadow }));
  }
  return parts;
}

/** Give every mesh of a model one colour (colour by stop, weight or loading step). */
function restyle(group: THREE.Object3D, change: (m: THREE.MeshStandardMaterial) => void): void {
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const one = (source: THREE.Material) => {
      const m = (source as THREE.MeshStandardMaterial).clone();
      change(m);
      return m;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(one) : one(mesh.material);
  });
}

function paint(group: THREE.Object3D, color: number): void {
  restyle(group, (m) => (m.color = new THREE.Color(color)));
}

function tint(group: THREE.Object3D, color: number, strength: number): void {
  restyle(group, (m) => {
    m.emissive = new THREE.Color(color);
    m.emissiveIntensity = strength;
  });
}

function disposeTree(object: THREE.Object3D): void {
  object.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh || (o as THREE.Line).isLine) {
      mesh.geometry.dispose();
      (o as THREE.InstancedMesh).isInstancedMesh && (o as THREE.InstancedMesh).dispose();
      (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((m) => {
        // Shared textures stay cached; per-wall copies (their own repeat) go with the scene.
        const map = (m as THREE.MeshStandardMaterial).map;
        if (map?.userData.owned) map.dispose();
        m.dispose();
      });
    }
  });
}

/** Wall pieces along one boundary edge, leaving gaps where doors hang on it. */
function wallEdge(project: Project, a: Vec2, b: Vec2, height: number, group: THREE.Group, skin?: (length: number) => THREE.Material): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return;
  const ux = dx / length;
  const uy = dy / length;
  const gaps: Array<[number, number]> = [];
  for (const door of project.space.doors) {
    const t = ((door.hinge.x - a.x) * ux + (door.hinge.y - a.y) * uy) / length;
    const off = Math.abs((door.hinge.x - a.x) * uy - (door.hinge.y - a.y) * ux);
    if (off > 5 || t < -0.001 || t > 1.001) continue;
    const angle = (door.angle / 1000) * (Math.PI / 180);
    const along = Math.cos(angle) * ux + Math.sin(angle) * uy;
    if (Math.abs(Math.abs(along) - 1) > 1e-6) continue;
    const t2 = t + (along * door.width) / length;
    gaps.push([Math.min(t, t2), Math.max(t, t2)]);
  }
  gaps.sort((p, q) => p[0] - q[0]);
  const pieces: Array<[number, number, number, number]> = []; // t0, t1, bottom, top
  let cursor = 0;
  for (const [g0, g1] of gaps) {
    if (g0 > cursor) pieces.push([cursor, g0, 0, height]);
    if (height > DOOR_HEIGHT) pieces.push([g0, g1, DOOR_HEIGHT, height]);
    cursor = Math.max(cursor, g1);
  }
  if (cursor < 1) pieces.push([cursor, 1, 0, height]);
  const outward = { x: uy, y: -ux }; // counter-clockwise boundary: the outside is on the right
  for (const [t0, t1, bottom, top] of pieces) {
    const len = mt(length * (t1 - t0));
    if (len <= 0.001 || top - bottom <= 0.001) continue;
    const mid = { x: a.x + dx * ((t0 + t1) / 2) + (outward.x * WALL_THICKNESS * TICKS_PER_METRE) / 2, y: a.y + dy * ((t0 + t1) / 2) + (outward.y * WALL_THICKNESS * TICKS_PER_METRE) / 2 };
    const wall = box(len + WALL_THICKNESS, top - bottom, WALL_THICKNESS, COLORS.wall);
    if (skin) {
      (wall.material as THREE.Material).dispose();
      wall.material = skin(len + WALL_THICKNESS);
    }
    wall.position.copy(at(mid, (top + bottom) / 2));
    wall.rotation.y = Math.atan2(dy, dx);
    group.add(wall);
  }
}

function buildScene(project: Project, issues: readonly Issue[], selectedIds: readonly Id[], fullWalls: boolean, look: SceneLook = {}): THREE.Group {
  const group = new THREE.Group();
  const ceiling = project.space.ceilingHeight === undefined ? 3 : mt(project.space.ceilingHeight);
  const wallHeight = fullWalls ? ceiling : Math.min(1.1, ceiling);

  const pack = project.space.meta?.pack;
  const isContainer = pack === 'container';
  const isWarehouse = pack === 'warehouse';
  const shape = new THREE.Shape(project.space.boundary.map((p) => new THREE.Vector2(mt(p.x), mt(p.y))));
  // Shape UVs are in metres, so a repeating texture keeps its real size on any floor.
  const floorMaterial = isContainer
    ? new THREE.MeshStandardMaterial({ color: COLORS.containerFloor, map: planks(), roughness: 0.8 })
    : material(isWarehouse ? COLORS.warehouseFloor : COLORS.floor);
  if (isWarehouse) floorMaterial.roughness = 0.55;
  const floor = new THREE.Mesh(new THREE.ShapeGeometry(shape), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  const lines = new Map<number, THREE.BufferGeometry[]>();
  for (const zone of project.space.zones ?? []) {
    const kind = zone.kind;
    const color = kind === 'no-go' || kind === 'pedestrian' ? 0xb76e64 : kind === 'bay' ? COLORS.bayLine : kind.includes('aisle') ? 0x7bb198 : 0x829fc3;
    const region = new THREE.Shape(zone.polygon.map((p) => new THREE.Vector2(mt(p.x), mt(p.y))));
    const overlay = new THREE.Mesh(new THREE.ShapeGeometry(region), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: kind === 'storage' ? 0.08 : isWarehouse ? 0.16 : 0.23, side: THREE.DoubleSide, depthWrite: false }));
    overlay.rotation.x = -Math.PI / 2;
    overlay.position.y = 0.009;
    group.add(overlay);
    if (!isWarehouse || kind === 'storage') continue;
    // Painted floor lines around warehouse zones: yellow for traffic, green walkways, red no-go.
    const paint = kind === 'pedestrian' ? COLORS.walkGreen : kind === 'no-go' ? COLORS.error : COLORS.safetyYellow;
    const list = lines.get(paint) ?? [];
    zone.polygon.forEach((p, i) => {
      const q = zone.polygon[(i + 1) % zone.polygon.length]!;
      const length = mt(Math.hypot(q.x - p.x, q.y - p.y));
      if (length < 0.01) return;
      const strip = new THREE.BoxGeometry(length + 0.1, 0.004, 0.1);
      strip.applyMatrix4(new THREE.Matrix4().compose(at({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }, 0.012), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(q.y - p.y, q.x - p.x)), new THREE.Vector3(1, 1, 1)));
      list.push(strip);
    });
    lines.set(paint, list);
  }
  for (const [color, geometries] of lines) {
    const merged = mergeGeometries(geometries);
    geometries.forEach((g) => g.dispose());
    if (merged) group.add(new THREE.Mesh(merged, new THREE.MeshBasicMaterial({ color })));
  }

  // A light one-metre grid on the floor, as on the plan.
  const box3 = boundsOf(project.space.boundary);
  const points: THREE.Vector3[] = [];
  for (let x = Math.ceil(box3.minX / TICKS_PER_METRE) * TICKS_PER_METRE; x <= box3.maxX; x += TICKS_PER_METRE) points.push(at({ x, y: box3.minY }, 0.003), at({ x, y: box3.maxY }, 0.003));
  for (let y = Math.ceil(box3.minY / TICKS_PER_METRE) * TICKS_PER_METRE; y <= box3.maxY; y += TICKS_PER_METRE) points.push(at({ x: box3.minX, y }, 0.003), at({ x: box3.maxX, y }, 0.003));
  if (points.length > 0) group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: COLORS.grid, transparent: true, opacity: 0.07 })));

  const b = project.space.boundary;
  const south = boundsOf(b).minY;
  for (let i = 0; i < b.length; i++) {
    const a = b[i]!;
    const c = b[(i + 1) % b.length]!;
    if (look.cutaway && a.y === south && c.y === south) continue;
    wallEdge(project, a, c, wallHeight, group, isContainer ? (length) => {
      // Corrugated steel: about one rib every 28 cm, on a copy so each wall keeps its own repeat.
      const map = corrugated()?.clone() ?? null;
      if (map) {
        map.repeat.set(length / 0.28, 1);
        map.userData.owned = true;
        map.needsUpdate = true;
      }
      return new THREE.MeshStandardMaterial({ color: COLORS.containerSteel, map, roughness: 0.5, metalness: 0.35 });
    } : undefined);
  }

  for (const door of project.space.doors) {
    const open = ((door.angle + (door.swing === 'left' ? 90_000 : -90_000)) / 1000) * (Math.PI / 180);
    if (door.meta?.role) {
      // A loading dock: a dock leveller plate inside the opening with yellow edges, no swinging leaf.
      const along = (door.angle / 1000) * (Math.PI / 180);
      const plateDepth = 2.2;
      const centre = {
        x: door.hinge.x + (Math.cos(along) * door.width) / 2 + Math.cos(open) * (plateDepth / 2) * TICKS_PER_METRE,
        y: door.hinge.y + (Math.sin(along) * door.width) / 2 + Math.sin(open) * (plateDepth / 2) * TICKS_PER_METRE,
      };
      const plate = box(mt(door.width) * 0.8, 0.03, plateDepth, COLORS.dockPlate);
      plate.position.copy(at(centre, 0.015));
      plate.rotation.y = along;
      group.add(plate);
      for (const side of [-1, 1]) {
        const edge = box(0.12, 0.035, plateDepth, COLORS.safetyYellow);
        edge.position.copy(at({ x: centre.x + Math.cos(along) * side * (door.width * 0.4 + 600), y: centre.y + Math.sin(along) * side * (door.width * 0.4 + 600) }, 0.017));
        edge.rotation.y = along;
        group.add(edge);
      }
      continue;
    }
    const leaf = box(mt(door.width), DOOR_HEIGHT, 0.04, COLORS.darkWood);
    const centre = { x: door.hinge.x + (Math.cos(open) * door.width) / 2, y: door.hinge.y + (Math.sin(open) * door.width) / 2 };
    leaf.position.copy(at(centre, DOOR_HEIGHT / 2));
    leaf.rotation.y = open;
    group.add(leaf);
  }

  for (const o of project.space.obstacles) {
    const s = new THREE.Shape(o.polygon.map((p) => new THREE.Vector2(mt(p.x), mt(p.y))));
    const height = o.kind === 'column' ? wallHeight : 0.01;
    const mesh = new THREE.Mesh(
      new THREE.ExtrudeGeometry(s, { depth: height, bevelEnabled: false }),
      o.kind === 'column' ? material(COLORS.column) : new THREE.MeshStandardMaterial({ color: COLORS.blocked, transparent: true, opacity: 0.35 }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  const severity = new Map<Id, 'error' | 'warning'>();
  for (const issue of issues) {
    const first = issue.entityIds[0];
    if (!first || issue.severity === 'info') continue;
    if (issue.severity === 'error' || !severity.has(first)) severity.set(first, issue.severity);
  }

  const stocked = materialsOf(project).length > 0;
  group.add(buildItems(project, severity, selectedIds, look, stocked));
  const stock = stocked ? buildStock(project, look.stock ?? { colorBy: 'material', find: null, slot: null }) : null;
  if (stock) group.add(stock);
  if (look.routePoints?.length) {
    const points = look.routePoints.map((p) => at(p, 0.07));
    const route = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: 0x2b54d0, depthTest: false }));
    route.name = 'warehouse-route';
    route.renderOrder = 20;
    group.add(route);
    for (const [index, point] of [points[0]!, points[points.length - 1]!].entries()) {
      const marker = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 6), new THREE.MeshBasicMaterial({ color: index === 0 ? 0xffffff : 0x2b54d0, depthTest: false }));
      marker.position.copy(point);
      marker.renderOrder = 21;
      group.add(marker);
    }
  }
  return group;
}

type ItemState = 'normal' | 'selected' | 'error' | 'warning';
const STATE_TINT: Readonly<Record<Exclude<ItemState, 'normal'>, [number, number]>> = {
  selected: [COLORS.selected, 0.45],
  error: [COLORS.error, 0.55],
  warning: [COLORS.warning, 0.35],
};

/**
 * Every placed item, drawn with instancing: items of the same shape, size, orientation and state
 * share one model whose meshes become `InstancedMesh`es, so 500 chairs cost a few draw calls
 * instead of 3 000 meshes. `userData.itemIds[instanceId]` maps a hit back to the item.
 */
function buildItems(project: Project, severity: ReadonlyMap<Id, 'error' | 'warning'>, selectedIds: readonly Id[], look: SceneLook, stocked: boolean): THREE.Group {
  const group = new THREE.Group();
  group.name = 'items';
  const selected = new Set(selectedIds);
  const batches = new Map<string, { definition: ItemDefinition; tilt: ItemInstance['tilt']; state: ItemState; color: number | undefined; items: ItemInstance[] }>();
  const ordered = Object.values(project.items).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const item of ordered) {
    const definition = project.catalog[item.definitionId];
    if (!definition || look.hidden?.has(item.id)) continue;
    const state: ItemState = selected.has(item.id) ? 'selected' : (severity.get(item.id) ?? 'normal');
    const color = look.itemColors?.get(item.id);
    const key = `${definition.id}|${item.tilt ?? ''}|${state}|${color ?? ''}`;
    const batch = batches.get(key);
    if (batch) batch.items.push(item);
    else batches.set(key, { definition, tilt: item.tilt, state, color, items: [item] });
  }
  const itemMatrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const unit = new THREE.Vector3(1, 1, 1);
  for (const { definition, tilt, state, color, items } of batches.values()) {
    const { w, d, h } = definition.size;
    const print = typeof definition.meta?.print === 'string' ? definition.meta.print : undefined;
    const asMaterial = materialOf(definition);
    const pallet = asMaterial ? stockColor(asMaterial, look.stock?.colorBy ?? 'material') : undefined;
    const template = buildModel(shapeOf(definition.category), mt(w), mt(d), mt(h), rackSpecOf(definition), { print, stocked, pallet });
    // A lying item: turn the upright model about its centre, then stand it on the floor again.
    const placedHeight = tilt === 'x' ? mt(w) : tilt === 'y' ? mt(d) : mt(h);
    const lay = new THREE.Matrix4()
      .makeTranslation(0, placedHeight / 2, 0)
      .multiply(tilt === 'x' ? new THREE.Matrix4().makeRotationZ(Math.PI / 2) : tilt === 'y' ? new THREE.Matrix4().makeRotationX(Math.PI / 2) : new THREE.Matrix4())
      .multiply(new THREE.Matrix4().makeTranslation(0, -mt(h) / 2, 0));
    if (color !== undefined) paint(template, color);
    if (state !== 'normal') tint(template, ...STATE_TINT[state]);
    const ids = items.map((i) => i.id);
    for (const part of mergeTemplate(template)) {
      const instanced = new THREE.InstancedMesh(part.geometry, part.material, items.length);
      items.forEach((item, k) => {
        quaternion.setFromAxisAngle(up, (item.rotation / 1000) * (Math.PI / 180));
        itemMatrix.compose(at(item.position, mt(item.elevation ?? 0)), quaternion, unit).multiply(lay);
        instanced.setMatrixAt(k, itemMatrix);
      });
      instanced.instanceMatrix.needsUpdate = true;
      instanced.computeBoundingSphere();
      instanced.castShadow = part.castShadow;
      instanced.receiveShadow = part.receiveShadow;
      instanced.userData.itemIds = ids;
      instanced.name = 'item';
      group.add(instanced);
    }
  }
  return group;
}

/**
 * Every stored pallet, from the racks' stock data: all wooden bases in one instanced mesh and all
 * loads in another, coloured per instance, so ten thousand pallets are two draw calls. When one
 * material is picked out, the rest fade to a pale grey.
 */
function buildStock(project: Project, view: StockView): THREE.Group | null {
  const pallets: Array<{ slot: string; rackId: Id; center: Vec2; rotation: number; elevation: number; width: number; depth: number; loadHeight: number; color: number }> = [];
  const heightOf = new Map<Id, number>();
  for (const rack of Object.values(project.items).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const spec = rackSpecOf(project.catalog[rack.definitionId]);
    const stock = spec && rackStock(project, rack.id);
    if (!spec || !stock) continue;
    stock.forEach((levels, b) => levels.forEach((positions, l) => positions.forEach((material, p) => {
      if (!material) return;
      const slot = { rackId: rack.id, bay: b + 1, level: l + 1, position: p + 1 };
      const place = slotPlacement(rack, spec, slot);
      const definition = project.catalog[material];
      if (!heightOf.has(material)) heightOf.set(material, definition ? mt(definition.size.h) : 1.2);
      const info = materialOf(definition);
      const picked = view.find === null || view.find === material;
      pallets.push({
        slot: slotId(slot),
        rackId: rack.id,
        center: place.center,
        rotation: rack.rotation,
        elevation: mt(place.elevation),
        width: mt(place.width) * 0.84,
        depth: mt(place.depth) * 0.84,
        loadHeight: Math.max(0.2, Math.min(heightOf.get(material)! - 0.14, mt(place.height) - 0.32)),
        color: picked ? stockColor(info, view.colorBy) : COLORS.dimStock,
      });
    })));
  }
  if (pallets.length === 0) return null;
  const group = new THREE.Group();
  group.name = 'stock';
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const bases = new THREE.InstancedMesh(unitBox, new THREE.MeshStandardMaterial({ color: COLORS.palletWood, roughness: 0.9 }), pallets.length);
  const loads = new THREE.InstancedMesh(unitBox.clone(), new THREE.MeshStandardMaterial({ color: 0xffffff, map: cartonStack(), roughness: 0.6 }), pallets.length);
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const tint = new THREE.Color();
  pallets.forEach((p, k) => {
    quaternion.setFromAxisAngle(up, (p.rotation / 1000) * (Math.PI / 180));
    bases.setMatrixAt(k, matrix.compose(at(p.center, p.elevation + 0.07), quaternion, new THREE.Vector3(p.width, 0.14, p.depth)));
    loads.setMatrixAt(k, matrix.compose(at(p.center, p.elevation + 0.14 + p.loadHeight / 2), quaternion, new THREE.Vector3(p.width * 0.97, p.loadHeight, p.depth * 0.95)));
    loads.setColorAt(k, tint.setHex(p.color));
  });
  for (const mesh of [bases, loads]) {
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.slotIds = pallets.map((p) => p.slot);
    mesh.userData.rackIds = pallets.map((p) => p.rackId);
    group.add(mesh);
  }
  if (loads.instanceColor) loads.instanceColor.needsUpdate = true;
  const selected = pallets.find((p) => p.slot === view.slot);
  if (selected) {
    const outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(selected.width + 0.12, selected.loadHeight + 0.26, selected.depth + 0.12)), new THREE.LineBasicMaterial({ color: COLORS.selected, depthTest: false }));
    outline.position.copy(at(selected.center, selected.elevation + (selected.loadHeight + 0.14) / 2));
    outline.rotation.y = (selected.rotation / 1000) * (Math.PI / 180);
    outline.renderOrder = 22;
    group.add(outline);
  }
  return group;
}

/**
 * The same project as a 3D model. Drag empty space to orbit (right button pans, wheel zooms);
 * drag an item to slide it over the floor, Shift+drag to raise or lower it, Alt for precision;
 * click / Shift-click selects. Every drag is one saved change.
 */
export function View3D({ project, saved, issues, selectedIds, controls: settings, dispatch, fitToken, onHeading, look, fullWallsAtStart = false, onSlot }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const three = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    content: THREE.Group | null;
  } | null>(null);
  const [fullWalls, setFullWalls] = useState(fullWallsAtStart);
  const [topView, setTopView] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The event handlers are set up once; they read the latest props through this ref.
  const latest = useRef({ saved, selectedIds, settings, dispatch, onHeading, onSlot });
  latest.current = { saved, selectedIds, settings, dispatch, onHeading, onSlot };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
    } catch {
      setError('This browser cannot show the 3D view.');
      return;
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    lights(scene, null);
    studio(renderer, scene);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 2000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI / 2 - 0.02;
    three.current = { renderer, scene, camera, controls, content: null };

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = host;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    renderer.setAnimationLoop(() => {
      controls.update();
      renderer.render(scene, camera);
    });

    let lastQuarter = -1;
    const reportHeading = () => {
      const quarter = headingQuarter(controls.target.x - camera.position.x, -(controls.target.z - camera.position.z));
      if (quarter !== lastQuarter) {
        lastQuarter = quarter;
        latest.current.onHeading?.(quarter);
      }
    };
    controls.addEventListener('change', reportHeading);

    const canvas = renderer.domElement;
    const ray = new THREE.Raycaster();
    const rayAt = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), camera);
      return ray;
    };
    /** The nearest item or stored pallet under the pointer: a pallet in front of its rack wins. */
    const hitAt = (e: PointerEvent): { item: Id } | { slot: string; rack: Id } | null => {
      const content = three.current?.content;
      const hit = content ? rayAt(e).intersectObjects(content.children, true).find((h) => (h.object.userData.itemIds || h.object.userData.slotIds) && h.instanceId !== undefined) : undefined;
      if (!hit) return null;
      const data = hit.object.userData;
      if (data.slotIds) return { slot: (data.slotIds as string[])[hit.instanceId!]!, rack: (data.rackIds as Id[])[hit.instanceId!]! };
      const item = (data.itemIds as readonly Id[])[hit.instanceId!];
      return item ? { item } : null;
    };
    const itemAt = (e: PointerEvent): Id | null => {
      const hit = hitAt(e);
      return hit && 'item' in hit ? hit.item : null;
    };
    const onPlane = (e: PointerEvent, height: number): THREE.Vector3 | null =>
      rayAt(e).ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -height), new THREE.Vector3());

    type Drag = {
      ids: Id[];
      pointerId: number;
      start: { x: number; y: number };
      planeHeight: number;
      from: THREE.Vector3;
      lastY: number;
      rise: number;
      /** Metres per screen pixel at the item's distance, for raising with the mouse. */
      perPixel: number;
      moved: boolean;
    };
    let drag: Drag | null = null;
    let click: { x: number; y: number; id: Id | null; additive: boolean; wasSelected: boolean; slot?: { slot: string; rack: Id } } | null = null;

    // Runs before the camera controls (capture phase), so grabbing an item never orbits the camera.
    const onDown = (e: PointerEvent) => {
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      const hit = e.button === 0 ? hitAt(e) : null;
      if (hit && 'slot' in hit && latest.current.onSlot) {
        // A stored pallet: a click selects its location; dragging still orbits the camera.
        click = { x: e.clientX, y: e.clientY, id: null, additive, wasSelected: false, slot: hit };
        return;
      }
      const id = hit && 'item' in hit ? hit.item : null;
      const { saved: p, selectedIds: selection, dispatch: send } = latest.current;
      click = { x: e.clientX, y: e.clientY, id, additive, wasSelected: id !== null && selection.includes(id) };
      if (!id) return;
      e.stopImmediatePropagation();
      let ids = selection.includes(id) ? [...selection] : [id];
      if (additive && !selection.includes(id)) ids = [...selection, id];
      if (!selection.includes(id)) send({ type: 'select', ids: [id], mode: additive ? 'add' : 'replace' });
      const moving = movable(p, ids).map((i) => i.id);
      const item = p.items[id];
      if (moving.length === 0 || !item) return;
      const planeHeight = mt(item.elevation ?? 0);
      const from = onPlane(e, planeHeight);
      if (!from) return;
      const distance = camera.position.distanceTo(from);
      const perPixel = (2 * distance * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, canvas.clientHeight);
      drag = { ids: moving, pointerId: e.pointerId, start: { x: e.clientX, y: e.clientY }, planeHeight, from, lastY: e.clientY, rise: 0, perPixel, moved: false };
      canvas.setPointerCapture(e.pointerId);
      controls.enabled = false;
    };
    const onMove = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.pointerId) {
        if (e.buttons === 0) canvas.style.cursor = itemAt(e) ? 'grab' : '';
        return;
      }
      if (!drag.moved && Math.hypot(e.clientX - drag.start.x, e.clientY - drag.start.y) < 3) return;
      drag.moved = true;
      canvas.style.cursor = 'grabbing';
      const { saved: p, settings: s, dispatch: send } = latest.current;
      const speed = e.altKey ? s.fineDragSpeed : s.dragSpeed;
      const free = e.altKey || e.ctrlKey || e.metaKey;
      if (e.shiftKey) {
        // Raise / lower: up the screen is up in the room.
        drag.rise += -(e.clientY - drag.lastY) * drag.perPixel * TICKS_PER_METRE * speed;
        drag.lastY = e.clientY;
        const step = free ? 1 : s.raiseStep;
        send({ type: 'preview', command: elevateCommands(p, drag.ids, Math.round(drag.rise / step) * step) });
        return;
      }
      drag.lastY = e.clientY;
      const to = onPlane(e, drag.planeHeight);
      if (!to) return;
      const raw = { x: (to.x - drag.from.x) * TICKS_PER_METRE * speed, y: -(to.z - drag.from.z) * TICKS_PER_METRE * speed };
      const { delta } = snapMove(p, drag.ids, raw, { grid: free ? 1 : s.grid, guides: false, threshold: 0 });
      send({ type: 'preview', command: moveCommands(p, drag.ids, delta) });
    };
    const onUp = (e: PointerEvent) => {
      const { dispatch: send } = latest.current;
      if (drag && e.pointerId === drag.pointerId) {
        const moved = drag.moved;
        drag = null;
        controls.enabled = true;
        canvas.releasePointerCapture(e.pointerId);
        canvas.style.cursor = '';
        if (moved) {
          send({ type: 'preview-commit' });
          click = null;
          return;
        }
      }
      // A click (not a drag): pick the item under the pointer, or clear on empty space.
      if (!click || Math.hypot(e.clientX - click.x, e.clientY - click.y) > 4) return;
      const { id, additive, wasSelected, slot } = click;
      click = null;
      if (slot) {
        latest.current.onSlot?.(slot.slot, slot.rack);
        return;
      }
      if (id && wasSelected) send({ type: 'select', ids: [id], mode: additive ? 'toggle' : 'replace' });
      else if (!id && !additive) send({ type: 'select', ids: [] });
    };
    canvas.addEventListener('pointerdown', onDown, { capture: true });
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);

    return () => {
      observer.disconnect();
      renderer.setAnimationLoop(null);
      controls.removeEventListener('change', reportHeading);
      canvas.removeEventListener('pointerdown', onDown, { capture: true });
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      controls.dispose();
      if (three.current?.content) disposeTree(three.current.content);
      scene.environment?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      three.current = null;
    };
  }, []);

  // Rebuild the model whenever the project, issues or selection change.
  useEffect(() => {
    const t = three.current;
    if (!t) return;
    if (t.content) {
      t.scene.remove(t.content);
      disposeTree(t.content);
    }
    t.content = buildScene(project, issues, selectedIds, fullWalls, look);
    t.scene.add(t.content);
    hostRef.current?.setAttribute('data-items', String(Object.keys(project.items).length - (look?.hidden?.size ?? 0)));
    hostRef.current?.setAttribute('data-selected', selectedIds.join(' '));
  }, [project, issues, selectedIds, fullWalls, look]);

  // Frame the room when asked, and when the room itself changes size.
  const room = boundsOf(project.space.boundary);
  const roomKey = `${room.minX},${room.minY},${room.maxX},${room.maxY}`;
  useEffect(() => {
    const t = three.current;
    if (!t) return;
    const host = hostRef.current;
    const aspect = host && host.clientHeight > 0 ? host.clientWidth / host.clientHeight : 1.6;
    t.controls.target.copy(frameRoom(t.scene, t.camera, room, aspect));
    t.controls.update();
    setTopView(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomKey, fitToken]);

  const savePicture = () => {
    const t = three.current;
    if (!t) return;
    t.renderer.render(t.scene, t.camera);
    // A blob link keeps the file name; large data: links are saved as "download".
    t.renderer.domElement.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${project.name} - 3D.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'image/png');
  };

  /** Turn the camera around the point it looks at, keeping its height and distance. */
  const orbit = (degrees: number) => {
    const t = three.current;
    if (!t) return;
    const offset = t.camera.position.clone().sub(t.controls.target);
    if (topView) {
      setTopView(false);
      t.controls.target.copy(frameRoom(t.scene, t.camera, room, aspect()));
      t.controls.update();
      return;
    }
    offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), (degrees * Math.PI) / 180);
    t.camera.position.copy(t.controls.target).add(offset);
    t.controls.update();
  };
  const aspect = () => {
    const host = hostRef.current;
    return host && host.clientHeight > 0 ? host.clientWidth / host.clientHeight : 1.6;
  };
  const perspective = () => {
    const t = three.current;
    if (!t) return;
    setTopView(false);
    t.controls.target.copy(frameRoom(t.scene, t.camera, room, aspect()));
    t.controls.update();
  };
  const fromAbove = () => {
    const t = three.current;
    if (!t) return;
    setTopView(true);
    const centre = frameRoom(t.scene, t.camera, room, aspect());
    const size = Math.max(mt(room.maxX - room.minX), mt(room.maxY - room.minY), 2);
    const back = aspect() < 1.2 ? 1.05 / aspect() : 1;
    t.controls.target.copy(centre);
    t.camera.position.set(centre.x, size * 1.3 * back, centre.z + 0.001);
    t.controls.update();
  };

  const tools: Array<{ label: string; icon: ReactElement; onClick: () => void; on?: boolean; sep?: boolean }> = [
    { label: 'Fit view', icon: <CornersOut size={15} />, onClick: perspective },
    { label: 'Orbit left', icon: <ArrowCounterClockwise size={15} />, onClick: () => orbit(-45) },
    { label: 'Orbit right', icon: <ArrowClockwise size={15} />, onClick: () => orbit(45), sep: true },
    { label: 'Perspective', icon: <Cube size={15} />, onClick: perspective, on: !topView },
    { label: 'Top view', icon: <Square size={15} />, onClick: fromAbove, on: topView, sep: true },
    { label: fullWalls ? 'Cut the walls at 1.10 m' : 'Show full walls', icon: <Scissors size={15} />, onClick: () => setFullWalls((v) => !v), on: !fullWalls },
    { label: 'Save image', icon: <Camera size={15} />, onClick: savePicture },
  ];

  return (
    <div className="view3d" ref={hostRef} data-testid="view3d" aria-label="3D view">
      <div className="pane-title">
        <div className="serif">{topView ? 'Top view' : 'Perspective'}</div>
        <div className="sub">{fullWalls ? 'Full-height walls' : 'Walls cut at 1.10 m'} · Drag to orbit · Scroll to zoom</div>
      </div>
      {error ? (
        <p className="view3d-error">{error}</p>
      ) : (
        <div className="floating-tools" role="toolbar" aria-label="3D view tools">
          {tools.map((t) => (
            <span key={t.label} style={{ display: 'contents' }}>
              <button type="button" title={t.label} aria-label={t.label} aria-pressed={t.on} className={t.on ? 'on' : ''} onClick={t.onClick}>
                {t.icon}
              </button>
              {t.sep && <span className="sep" />}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
