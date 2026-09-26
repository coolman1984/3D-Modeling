import { boundsOf, type Id, type Issue, type ItemDefinition, type ItemInstance, type Project, type Vec2, type Zone } from '@space-planner/core';
import { detectPack, materialOf, materialsOf, rackSpecOf, rackStock, shapeOf, slotId, slotPlacement, type PackId } from '@space-planner/starter';
import { ArrowClockwise, ArrowCounterClockwise, Camera, CornersOut, Cube, Gauge, Scissors, Square } from '@phosphor-icons/react';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { addEnvironment, addLights, aimSun, isSoftwareRenderer, StillPass } from './environment3d.js';
import { DEFAULT_QUALITY, FrameWatch, lighter, loadQuality, nextQuality, QUALITY_LABEL, QUALITY_PROFILES, saveQuality, type Quality } from '../logic/graphics.js';
import { buildModel, COLORS, M } from './models3d.js';
import { stockColor, type StockView } from './Stock.js';
import { asphalt, carpet, cartonStack, ceramic, cladding, concreteFloor, corrugated, epoxyFloor, grass, marble, pavers, planks, plaster, precast, sand, type Surface } from './textures.js';
import { headingQuarter, ownsKeys, type ControlSettings } from '../logic/controls.js';
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
  /** True while this view has the keyboard: with nothing selected, arrows turn and tilt the camera. */
  readonly keyboardActive?: () => boolean;
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
const WALL_CUT = 1.1;
const PERIMETER_WALL = 2.6;

/** Site plans and parking yards are outside: sky, sun, haze, ground beyond the plot. */
const isOutdoor = (pack: PackId) => pack === 'site' || pack === 'depot';

function spanOf(project: Project): number {
  const b = boundsOf(project.space.boundary);
  return Math.max(mt(b.maxX - b.minX), mt(b.maxY - b.minY), 2);
}

/**
 * Put the camera where the whole room is in view, looking down at it from the south, and aim
 * the sun's shadows at it. Returns the point the camera looks at.
 */
function frameRoom(camera: THREE.PerspectiveCamera, sun: THREE.DirectionalLight | null, room: { minX: number; minY: number; maxX: number; maxY: number }, aspect: number, outdoor: boolean): THREE.Vector3 {
  const centre = new THREE.Vector3(mt((room.minX + room.maxX) / 2), 0, -mt((room.minY + room.maxY) / 2));
  const size = Math.max(mt(room.maxX - room.minX), mt(room.maxY - room.minY), 2);
  // Narrow panes (side-by-side view) need the camera further back to keep the room in frame.
  const back = aspect < 1.2 ? 1.05 / aspect : 1;
  const lift = outdoor ? 0.62 : 0.95;
  camera.position.set(centre.x + size * 0.15 * back, size * lift * back, centre.z + size * 1.05 * back);
  camera.near = Math.max(0.05, size / 4000);
  camera.far = Math.max(2000, size * 12);
  camera.updateProjectionMatrix();
  camera.lookAt(centre);
  if (sun) aimSun(sun, centre, size);
  return centre;
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
    // A report picture is drawn once, so it may use more than the live view, but still follows
    // the chosen level: a weak graphics chip can stall on a 4096-pixel shadow map at twice the size.
    const quality = isSoftwareRenderer(renderer) ? 'fast' : (loadQuality() ?? DEFAULT_QUALITY);
    const profile = QUALITY_PROFILES[quality];
    renderer.setPixelRatio(quality === 'high' ? 2 : 1.5);
    renderer.setSize(width, height, false);
    renderer.shadowMap.enabled = profile.shadows;
    renderer.shadowMap.type = profile.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const pack = detectPack(project);
    const outdoor = isOutdoor(pack);
    const scene = new THREE.Scene();
    const sun = addLights(scene, outdoor, profile);
    // Building the reflection map blocks the page for a moment; one-off report pictures skip it.
    const disposeEnv = addEnvironment(renderer, scene, outdoor, false, spanOf(project));
    if (!outdoor) scene.background = new THREE.Color(0xf5f6f8);
    const content = buildScene(project, issues, [], fullWalls, look);
    scene.add(content);
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.05, 2000);
    frameRoom(camera, sun, boundsOf(project.space.boundary), width / height, outdoor);
    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL('image/png');
    disposeTree(content);
    disposeEnv();
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

/**
 * Fold a model's meshes into one geometry per material, so a rack row with 60 posts and beams
 * costs two draw calls instead of sixty; every part keeps its place through its own matrix.
 */
function mergeTemplate(template: THREE.Group): Array<{ geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[]; castShadow: boolean; receiveShadow: boolean }> {
  template.updateMatrixWorld(true);
  const groups = new Map<string, { material: THREE.Material; geometries: THREE.BufferGeometry[]; castShadow: boolean; receiveShadow: boolean }>();
  const parts: Array<{ geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[]; castShadow: boolean; receiveShadow: boolean }> = [];
  template.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    mesh.geometry.dispose();
    if (Array.isArray(mesh.material)) {
      parts.push({ geometry, material: mesh.material, castShadow: mesh.castShadow, receiveShadow: mesh.receiveShadow });
      return;
    }
    const m = mesh.material as THREE.MeshStandardMaterial;
    // Shared materials merge by identity; per-item copies (tints, colour-by) by how they look.
    const key = m.userData.shared
      ? `${m.uuid}|${mesh.castShadow}|${geometry.index ? 'i' : 'n'}`
      : `${m.color?.getHex()}|${m.emissive?.getHex()}|${m.emissiveIntensity}|${m.map?.uuid ?? ''}|${m.transparent}|${m.opacity}|${m.roughness}|${m.metalness}|${mesh.castShadow}|${geometry.index ? 'i' : 'n'}`;
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

/** Give every mesh of a model a changed copy of its material (colour by stop, selection tint). */
function restyle(group: THREE.Object3D, change: (m: THREE.MeshStandardMaterial) => void): void {
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const one = (source: THREE.Material) => {
      const m = (source as THREE.MeshStandardMaterial).clone();
      m.userData = {};
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
        // Shared materials and textures stay cached; per-item copies go with the scene.
        if (m.userData.shared) return;
        for (const slot of ['map', 'normalMap', 'roughnessMap', 'emissiveMap'] as const) {
          const texture = (m as THREE.MeshStandardMaterial)[slot];
          if (texture?.userData.owned) texture.dispose();
        }
        m.dispose();
      });
    }
  });
}

/** A textured material whose texture repeats at its real size on a floor whose UVs are metres. */
function surfaceMaterial(s: Surface | null, color: number, extra: THREE.MeshStandardMaterialParameters = {}, normalScale = 1): THREE.MeshStandardMaterial {
  const own = (t: THREE.Texture | undefined) => {
    if (!t) return null;
    const c = t.clone();
    c.repeat.set(1 / (s?.metres ?? 1), 1 / (s?.metres ?? 1));
    c.userData.owned = true;
    c.needsUpdate = true;
    return c;
  };
  return new THREE.MeshStandardMaterial({
    color,
    map: own(s?.map),
    normalMap: own(s?.normalMap),
    roughnessMap: own(s?.roughnessMap),
    normalScale: new THREE.Vector2(normalScale, normalScale),
    roughness: 1,
    ...extra,
  });
}

/** The floor finish of each activity: what the room would really be paved with. */
function floorMaterial(pack: PackId, project: Project): THREE.Material {
  switch (pack) {
    case 'container':
      return new THREE.MeshStandardMaterial({ color: COLORS.containerFloor, map: planks(), roughness: 0.8 });
    case 'warehouse':
      return surfaceMaterial(concreteFloor(), 0xffffff);
    case 'production':
      return surfaceMaterial(epoxyFloor(), 0xb9c4c0, {}, 0.6);
    case 'office':
      return surfaceMaterial(carpet(), project.space.meta?.style === 'meeting' ? 0x9aa6b4 : 0xb2b6bb);
    case 'restaurant':
      return surfaceMaterial(ceramic(), 0xffffff);
    case 'hall':
      return surfaceMaterial(marble(), 0xffffff);
    case 'depot':
      return surfaceMaterial(asphalt(), 0xffffff, {}, 0.9);
    case 'site':
      return surfaceMaterial(concreteFloor(), 0xbfbab0, {}, 0.5);
  }
}

/** A zone's polygon as a flat mesh a little above the floor. */
function zoneMesh(zone: Zone, material: THREE.Material, height: number): THREE.Mesh {
  const shape = new THREE.Shape(zone.polygon.map((p) => new THREE.Vector2(mt(p.x), mt(p.y))));
  const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), material);
  m.rotation.x = -Math.PI / 2;
  m.position.y = height;
  m.receiveShadow = true;
  return m;
}

/** Outline strips along a polygon's edges, merged into one geometry. */
function outlineStrips(polygon: readonly Vec2[], width: number, y: number, dashed = false): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  polygon.forEach((p, i) => {
    const q = polygon[(i + 1) % polygon.length]!;
    const length = mt(Math.hypot(q.x - p.x, q.y - p.y));
    if (length < 0.01) return;
    const angle = Math.atan2(q.y - p.y, q.x - p.x);
    const pieces = dashed ? Math.max(1, Math.floor(length / 3)) : 1;
    for (let k = 0; k < pieces; k++) {
      const seg = dashed ? 1.5 : length + width;
      const t = dashed ? (k + 0.25) / pieces : 0.5;
      const mid = { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
      const strip = new THREE.BoxGeometry(Math.min(seg, length + width), 0.004, width);
      strip.applyMatrix4(new THREE.Matrix4().compose(at(mid, y), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle), new THREE.Vector3(1, 1, 1)));
      out.push(strip);
    }
  });
  return out;
}

/** A dashed centre line along the long axis of a rectangular road or lane. */
function centreLine(zone: Zone, y: number): THREE.BufferGeometry[] {
  const b = boundsOf(zone.polygon);
  const wide = b.maxX - b.minX >= b.maxY - b.minY;
  const a = wide ? { x: b.minX, y: (b.minY + b.maxY) / 2 } : { x: (b.minX + b.maxX) / 2, y: b.minY };
  const c = wide ? { x: b.maxX, y: (b.minY + b.maxY) / 2 } : { x: (b.minX + b.maxX) / 2, y: b.maxY };
  if (Math.min(b.maxX - b.minX, b.maxY - b.minY) < 50_000) return [];
  return outlineStrips([a, c], 0.15, y, true).slice(0, Math.max(0, Math.floor(mt(Math.hypot(c.x - a.x, c.y - a.y)) / 3)));
}

type Lines = Map<number, THREE.BufferGeometry[]>;
const addLines = (lines: Lines, color: number, geometries: THREE.BufferGeometry[]) => lines.set(color, [...(lines.get(color) ?? []), ...geometries]);

/** Outdoor ground: asphalt roads and lanes, lawns, pavers, concrete yards, painted bays and lines. */
function outdoorZones(project: Project, group: THREE.Group, lines: Lines, span: number): void {
  // Layers must stay apart at the depth precision of a camera 700 m away: lift them with the site.
  const lift = Math.max(0.004, span / 60000);
  const layered = (m: THREE.Material, k: number) => {
    m.polygonOffset = true;
    m.polygonOffsetFactor = -1 - k;
    m.polygonOffsetUnits = -4 * (k + 1);
    return m;
  };
  const road = layered(surfaceMaterial(asphalt(), 0xb7b9bc, {}, 0.9), 2);
  const lawn = layered(surfaceMaterial(grass(), 0xffffff, {}, 0.7), 0);
  const paving = layered(surfaceMaterial(pavers(), 0xffffff), 4);
  const yard = layered(surfaceMaterial(concreteFloor(), 0xd2cec6), 1);
  const zones = [...(project.space.zones ?? [])];
  const order = (k: string) => (k === 'green' ? 0 : k === 'yard' ? 1 : k === 'road' ? 2 : k.startsWith('lane') ? 3 : k === 'footpath' || k === 'plaza' ? 4 : 5);
  zones.sort((a, b) => order(a.kind) - order(b.kind));
  zones.forEach((zone, k) => {
    const y = lift * (1 + order(zone.kind)) + k * 0.00001;
    switch (zone.kind) {
      case 'road':
      case 'lane-one-way':
      case 'lane-two-way':
        group.add(zoneMesh(zone, road, y));
        addLines(lines, 0xf4f1e6, centreLine(zone, y + lift * 0.5));
        break;
      case 'green': {
        const lawnMesh = zoneMesh(zone, lawn, y);
        group.add(lawnMesh);
        // Kerbs around lawns.
        addLines(lines, 0xcfcac0, outlineStrips(zone.polygon, 0.18, y + 0.06));
        break;
      }
      case 'footpath':
      case 'plaza':
        group.add(zoneMesh(zone, paving, y));
        break;
      case 'yard':
        group.add(zoneMesh(zone, yard, y));
        break;
      case 'bay': {
        const bus = zone.meta?.bayType === 'bus';
        addLines(lines, bus ? 0xf2c230 : 0xf7f7f2, outlineStrips(zone.polygon, 0.12, lift * 5));
        break;
      }
      case 'no-go':
        group.add(zoneMesh(zone, new THREE.MeshStandardMaterial({ color: COLORS.error, transparent: true, opacity: 0.22, depthWrite: false }), y));
        addLines(lines, COLORS.error, outlineStrips(zone.polygon, 0.12, y + 0.003));
        break;
      default:
        group.add(zoneMesh(zone, new THREE.MeshBasicMaterial({ color: 0x829fc3, transparent: true, opacity: 0.18, depthWrite: false }), y));
    }
  });
}

/** Indoor zones: a light tint and, where traffic runs, painted floor lines. */
function indoorZones(project: Project, group: THREE.Group, lines: Lines, painted: boolean): void {
  for (const zone of project.space.zones ?? []) {
    const kind = zone.kind;
    const color = kind === 'no-go' || kind === 'pedestrian' ? 0xb76e64 : kind === 'bay' ? 0xd8d3c6 : kind.includes('aisle') ? 0x7bb198 : kind === 'clean-room' ? 0x9fc3e0 : kind === 'break' || kind === 'lounge' ? 0xd9b98f : 0x829fc3;
    const overlay = zoneMesh(zone, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: kind === 'storage' ? 0.06 : painted ? 0.12 : 0.18, side: THREE.DoubleSide, depthWrite: false }), 0.009);
    group.add(overlay);
    if (!painted || kind === 'storage') continue;
    const line = kind === 'pedestrian' ? COLORS.walkGreen : kind === 'no-go' ? COLORS.error : kind === 'clean-room' ? 0x3d7fc4 : COLORS.safetyYellow;
    addLines(lines, line, outlineStrips(zone.polygon, 0.1, 0.012));
  }
}

/** Wall pieces along one boundary edge, leaving gaps where doors hang on it. */
function wallEdge(project: Project, a: Vec2, b: Vec2, height: number, group: THREE.Group, skin: (length: number) => THREE.Material, cap?: THREE.Material): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return;
  const ux = dx / length;
  const uy = dy / length;
  const gaps: Array<[number, number, boolean]> = [];
  for (const door of project.space.doors) {
    const t = ((door.hinge.x - a.x) * ux + (door.hinge.y - a.y) * uy) / length;
    const off = Math.abs((door.hinge.x - a.x) * uy - (door.hinge.y - a.y) * ux);
    if (off > 5 || t < -0.001 || t > 1.001) continue;
    const angle = (door.angle / 1000) * (Math.PI / 180);
    const along = Math.cos(angle) * ux + Math.sin(angle) * uy;
    if (Math.abs(Math.abs(along) - 1) > 1e-6) continue;
    const t2 = t + (along * door.width) / length;
    gaps.push([Math.min(t, t2), Math.max(t, t2), door.meta?.role === 'gate']);
  }
  gaps.sort((p, q) => p[0] - q[0]);
  const pieces: Array<[number, number, number, number]> = []; // t0, t1, bottom, top
  let cursor = 0;
  for (const [g0, g1, open] of gaps) {
    if (g0 > cursor) pieces.push([cursor, g0, 0, height]);
    if (!open && height > DOOR_HEIGHT) pieces.push([g0, g1, DOOR_HEIGHT, height]);
    cursor = Math.max(cursor, g1);
  }
  if (cursor < 1) pieces.push([cursor, 1, 0, height]);
  const outward = { x: uy, y: -ux }; // counter-clockwise boundary: the outside is on the right
  for (const [t0, t1, bottom, top] of pieces) {
    const len = mt(length * (t1 - t0));
    if (len <= 0.001 || top - bottom <= 0.001) continue;
    const mid = { x: a.x + dx * ((t0 + t1) / 2) + (outward.x * WALL_THICKNESS * TICKS_PER_METRE) / 2, y: a.y + dy * ((t0 + t1) / 2) + (outward.y * WALL_THICKNESS * TICKS_PER_METRE) / 2 };
    const wall = new THREE.Mesh(new THREE.BoxGeometry(len + WALL_THICKNESS, top - bottom, WALL_THICKNESS), skin(len + WALL_THICKNESS));
    wall.castShadow = true;
    wall.receiveShadow = true;
    wall.position.copy(at(mid, (top + bottom) / 2));
    wall.rotation.y = Math.atan2(dy, dx);
    group.add(wall);
    if (cap && bottom === 0) {
      // A darker top edge makes a cut wall read as a section, as on an architect's model.
      const edge = new THREE.Mesh(new THREE.BoxGeometry(len + WALL_THICKNESS + 0.01, 0.02, WALL_THICKNESS + 0.01), cap);
      edge.position.copy(at(mid, top + 0.01));
      edge.rotation.y = wall.rotation.y;
      group.add(edge);
    }
  }
}

function wallSkin(pack: PackId, height: number): (length: number) => THREE.Material {
  if (pack === 'container') {
    return (length) => {
      const map = corrugated()?.clone() ?? null;
      if (map) {
        map.repeat.set(length / 0.28, 1);
        map.userData.owned = true;
        map.needsUpdate = true;
      }
      return new THREE.MeshStandardMaterial({ color: COLORS.containerSteel, map, roughness: 0.5, metalness: 0.35 });
    };
  }
  const textured = (s: Surface | null, color: number, extra: THREE.MeshStandardMaterialParameters = {}) => (length: number) => {
    const own = (t: THREE.Texture | undefined) => {
      if (!t) return null;
      const c = t.clone();
      c.repeat.set(length / (s?.metres ?? 1), height / (s?.metres ?? 1));
      c.userData.owned = true;
      c.needsUpdate = true;
      return c;
    };
    return new THREE.MeshStandardMaterial({ color, map: own(s?.map), normalMap: own(s?.normalMap), roughness: 0.8, ...extra });
  };
  if (pack === 'site' || pack === 'depot') return textured(precast(), 0xe4e1da);
  if (pack === 'warehouse' || pack === 'production') return textured(cladding(), 0xdfe3e7, { metalness: 0.3, roughness: 0.5 });
  return textured(plaster(), 0xf7f5f0);
}

/** Doors by role: gates are open posts, docks get a leveller plate, other doors a leaf. */
function doors(project: Project, group: THREE.Group, fullWalls: boolean): void {
  for (const door of project.space.doors) {
    const open = ((door.angle + (door.swing === 'left' ? 90_000 : -90_000)) / 1000) * (Math.PI / 180);
    const along = (door.angle / 1000) * (Math.PI / 180);
    const role = door.meta?.role;
    if (role === 'gate') {
      for (const t of [0, 1]) {
        const p = { x: door.hinge.x + Math.cos(along) * door.width * t, y: door.hinge.y + Math.sin(along) * door.width * t };
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.7, 3.2, 0.7), M.paint(0xd9d4c8));
        post.position.copy(at(p, 1.6));
        post.castShadow = true;
        group.add(post);
        const top = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.25, 0.8), M.gloss(COLORS.brand));
        top.position.copy(at(p, 3.3));
        group.add(top);
      }
      continue;
    }
    if (role === 'receiving' || role === 'shipping') {
      // A loading dock: a dock leveller plate inside the opening with yellow edges.
      const plateDepth = 2.2;
      const centre = {
        x: door.hinge.x + (Math.cos(along) * door.width) / 2 + Math.cos(open) * (plateDepth / 2) * TICKS_PER_METRE,
        y: door.hinge.y + (Math.sin(along) * door.width) / 2 + Math.sin(open) * (plateDepth / 2) * TICKS_PER_METRE,
      };
      const plate = new THREE.Mesh(new THREE.BoxGeometry(mt(door.width) * 0.8, 0.03, plateDepth), M.metal(COLORS.dockPlate));
      plate.position.copy(at(centre, 0.015));
      plate.rotation.y = along;
      plate.receiveShadow = true;
      group.add(plate);
      for (const side of [-1, 1]) {
        const edge = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.035, plateDepth), M.gloss(COLORS.safetyYellow));
        edge.position.copy(at({ x: centre.x + Math.cos(along) * side * (door.width * 0.4 + 600), y: centre.y + Math.sin(along) * side * (door.width * 0.4 + 600) }, 0.017));
        edge.rotation.y = along;
        group.add(edge);
      }
      if (fullWalls) {
        // A sectional door rolled up under the lintel.
        const mid = { x: door.hinge.x + (Math.cos(along) * door.width) / 2, y: door.hinge.y + (Math.sin(along) * door.width) / 2 };
        const roll = new THREE.Mesh(new THREE.BoxGeometry(mt(door.width), 0.45, 0.3), M.paint(0x6d7680));
        roll.position.copy(at(mid, DOOR_HEIGHT + 1.6));
        roll.rotation.y = along;
        group.add(roll);
      }
      continue;
    }
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(mt(door.width), DOOR_HEIGHT, 0.045), M.walnut());
    const centre = { x: door.hinge.x + (Math.cos(open) * door.width) / 2, y: door.hinge.y + (Math.sin(open) * door.width) / 2 };
    leaf.position.copy(at(centre, DOOR_HEIGHT / 2));
    leaf.rotation.y = open;
    leaf.castShadow = true;
    group.add(leaf);
  }
}

function buildScene(project: Project, issues: readonly Issue[], selectedIds: readonly Id[], fullWalls: boolean, look: SceneLook = {}): THREE.Group {
  const group = new THREE.Group();
  const pack = detectPack(project);
  const outdoor = isOutdoor(pack);
  const ceiling = project.space.ceilingHeight === undefined ? 3 : mt(project.space.ceilingHeight);
  const wallHeight = outdoor ? PERIMETER_WALL : fullWalls ? ceiling : Math.min(WALL_CUT, ceiling);
  const box = boundsOf(project.space.boundary);
  const span = spanOf(project);

  // Shape UVs are in metres, so a repeating texture keeps its real size on any floor.
  const shape = new THREE.Shape(project.space.boundary.map((p) => new THREE.Vector2(mt(p.x), mt(p.y))));
  const floor = new THREE.Mesh(new THREE.ShapeGeometry(shape), floorMaterial(pack, project));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  if (outdoor) {
    // The land around the plot, fading into the haze: the site no longer floats in space.
    const size = span * 8;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(size, size), surfaceMaterial(sand(), 0xd3c9b2, {}, 0.6));
    const uv = ground.geometry.attributes.uv!;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * size, uv.getY(i) * size);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(mt((box.minX + box.maxX) / 2), -Math.max(0.03, span / 2000), -mt((box.minY + box.maxY) / 2));
    ground.receiveShadow = true;
    group.add(ground);
  }

  const lines: Lines = new Map();
  if (outdoor) outdoorZones(project, group, lines, span);
  else indoorZones(project, group, lines, pack === 'warehouse' || pack === 'production');
  for (const [color, geometries] of lines) {
    if (geometries.length === 0) continue;
    const merged = mergeGeometries(geometries);
    geometries.forEach((g) => g.dispose());
    if (merged) {
      const paintLines = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ color, roughness: 0.6 }));
      paintLines.receiveShadow = true;
      group.add(paintLines);
    }
  }

  if (!outdoor && pack !== 'container') {
    // A light one-metre grid on the floor, as on the plan.
    const points: THREE.Vector3[] = [];
    for (let x = Math.ceil(box.minX / TICKS_PER_METRE) * TICKS_PER_METRE; x <= box.maxX; x += TICKS_PER_METRE) points.push(at({ x, y: box.minY }, 0.003), at({ x, y: box.maxY }, 0.003));
    for (let y = Math.ceil(box.minY / TICKS_PER_METRE) * TICKS_PER_METRE; y <= box.maxY; y += TICKS_PER_METRE) points.push(at({ x: box.minX, y }, 0.003), at({ x: box.maxX, y }, 0.003));
    if (points.length > 0) group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: COLORS.grid, transparent: true, opacity: 0.05 })));
  }

  const b = project.space.boundary;
  const south = box.minY;
  const skin = wallSkin(pack, wallHeight);
  const cap = !outdoor && !fullWalls && pack !== 'container' ? M.paint(0x3a3f48) : undefined;
  for (let i = 0; i < b.length; i++) {
    const a = b[i]!;
    const c = b[(i + 1) % b.length]!;
    if (look.cutaway && a.y === south && c.y === south) continue;
    wallEdge(project, a, c, wallHeight, group, skin, cap);
  }
  doors(project, group, fullWalls);

  for (const o of project.space.obstacles) {
    const s = new THREE.Shape(o.polygon.map((p) => new THREE.Vector2(mt(p.x), mt(p.y))));
    const height = o.kind === 'column' ? (fullWalls ? ceiling : Math.max(wallHeight, 1.1)) : 0.01;
    const mesh = new THREE.Mesh(
      new THREE.ExtrudeGeometry(s, { depth: height, bevelEnabled: false }),
      o.kind === 'column' ? M.paint(0xd5d9e0) : new THREE.MeshStandardMaterial({ color: COLORS.blocked, transparent: true, opacity: 0.35 }),
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
  group.add(buildItems(project, severity, selectedIds, look, stocked, fullWalls ? null : WALL_CUT));
  const stock = stocked ? buildStock(project, look.stock ?? { colorBy: 'material', find: null, slot: null }) : null;
  if (stock) group.add(stock);
  if (look.routePoints?.length) {
    const points = look.routePoints.map((p) => at(p, 0.07));
    const route = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: 0x1f3bf5, depthTest: false }));
    route.name = 'warehouse-route';
    route.renderOrder = 20;
    group.add(route);
    for (const [index, point] of [points[0]!, points[points.length - 1]!].entries()) {
      const marker = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.09, span / 600), 10, 6), new THREE.MeshBasicMaterial({ color: index === 0 ? 0xffffff : 0x1f3bf5, depthTest: false }));
      marker.position.copy(point);
      marker.renderOrder = 21;
      group.add(marker);
    }
  }
  group.traverse((o) => {
    o.matrixAutoUpdate = false;
    o.updateMatrix();
  });
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
function buildItems(project: Project, severity: ReadonlyMap<Id, 'error' | 'warning'>, selectedIds: readonly Id[], look: SceneLook, stocked: boolean, wallCut: number | null): THREE.Group {
  const group = new THREE.Group();
  group.name = 'items';
  const selected = new Set(selectedIds);
  const batches = new Map<string, { definition: ItemDefinition; tilt: ItemInstance['tilt']; state: ItemState; color: number | undefined; elevation: number; items: ItemInstance[] }>();
  const ordered = Object.values(project.items).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const item of ordered) {
    const definition = project.catalog[item.definitionId];
    if (!definition || look.hidden?.has(item.id)) continue;
    const state: ItemState = selected.has(item.id) ? 'selected' : (severity.get(item.id) ?? 'normal');
    const color = look.itemColors?.get(item.id);
    // Raised shades draw posts down to the ground, so their height above it is part of the model.
    const elevation = definition.category === 'canopy' ? mt(item.elevation ?? 0) : 0;
    const key = `${definition.id}|${item.tilt ?? ''}|${state}|${color ?? ''}|${elevation}`;
    const batch = batches.get(key);
    if (batch) batch.items.push(item);
    else batches.set(key, { definition, tilt: item.tilt, state, color, elevation, items: [item] });
  }
  const itemMatrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const unit = new THREE.Vector3(1, 1, 1);
  for (const { definition, tilt, state, color, elevation, items } of batches.values()) {
    const { w, d, h } = definition.size;
    const asMaterial = materialOf(definition);
    const pallet = asMaterial ? stockColor(asMaterial, look.stock?.colorBy ?? 'material') : undefined;
    const template = buildModel(shapeOf(definition.category), mt(w), mt(d), mt(h), { definition, rack: rackSpecOf(definition), stocked, pallet, elevation, wallCut });
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
  const bases = new THREE.InstancedMesh(unitBox, M.palletWood(), pallets.length);
  const loads = new THREE.InstancedMesh(unitBox.clone(), new THREE.MeshStandardMaterial({ color: 0xffffff, map: cartonStack(), roughness: 0.6 }), pallets.length);
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const tone = new THREE.Color();
  pallets.forEach((p, k) => {
    quaternion.setFromAxisAngle(up, (p.rotation / 1000) * (Math.PI / 180));
    bases.setMatrixAt(k, matrix.compose(at(p.center, p.elevation + 0.07), quaternion, new THREE.Vector3(p.width, 0.14, p.depth)));
    loads.setMatrixAt(k, matrix.compose(at(p.center, p.elevation + 0.14 + p.loadHeight / 2), quaternion, new THREE.Vector3(p.width * 0.97, p.loadHeight, p.depth * 0.95)));
    loads.setColorAt(k, tone.setHex(p.color));
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

interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  content: THREE.Group | null;
  sun: THREE.DirectionalLight | null;
  outdoor: boolean | null;
  profile: (typeof QUALITY_PROFILES)[Quality];
  still: StillPass | null;
  disposeEnv: () => void;
  /** Ask for a frame; renders stop when nothing moves. */
  invalidate: () => void;
}

/**
 * The same project as a 3D model. Drag empty space to orbit (right button pans, wheel zooms);
 * drag an item to slide it over the floor, Shift+drag to raise or lower it, Alt for precision;
 * click / Shift-click selects. Every drag is one saved change.
 */
export function View3D({ project, saved, issues, selectedIds, controls: settings, dispatch, fitToken, onHeading, look, fullWallsAtStart = false, onSlot, keyboardActive }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const three = useRef<Stage | null>(null);
  const keptView = useRef<{ position: THREE.Vector3; target: THREE.Vector3 } | null>(null);
  const [fullWalls, setFullWalls] = useState(fullWallsAtStart);
  const [topView, setTopView] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The graphics level: what the person picked, else Balanced, lowered by itself while the
  // person has not picked one and moving frames are too slow.
  const [quality, setQuality] = useState<Quality>(() => loadQuality() ?? DEFAULT_QUALITY);
  const chooseQuality = (q: Quality) => {
    saveQuality(q);
    setQuality(q);
  };
  // The event handlers are set up once; they read the latest props through this ref.
  const latest = useRef({ saved, selectedIds, settings, dispatch, onHeading, onSlot, keyboardActive });
  latest.current = { saved, selectedIds, settings, dispatch, onHeading, onSlot, keyboardActive };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const profile = QUALITY_PROFILES[quality];
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: profile.antialias, preserveDrawingBuffer: true, alpha: true, powerPreference: 'high-performance' });
    } catch {
      setError('This browser cannot show the 3D view.');
      return;
    }
    if (quality !== 'fast' && loadQuality() === null && isSoftwareRenderer(renderer)) {
      // No graphics chip at all (a virtual machine, a test browser): start at the lightest level.
      renderer.dispose();
      setQuality('fast');
      return;
    }
    renderer.setPixelRatio(Math.min(profile.pixelRatio, window.devicePixelRatio));
    renderer.shadowMap.enabled = profile.shadows;
    renderer.shadowMap.type = profile.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    // Shadows are redrawn only when the scene changes, not on every camera move.
    renderer.shadowMap.autoUpdate = false;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);
    host.setAttribute('data-quality', quality);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 2000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI / 2 - 0.02;

    // Render on demand: a frame when something changed, more while the camera glides to a stop,
    // then one ambient-occlusion still once it rests (on machines with a GPU).
    // While the person has not picked a level, a view that cannot keep up with the camera
    // (most moving frames under 20 a second) steps down one level by itself.
    let frame = 0;
    let stillTimer = 0;
    const adapt = loadQuality() === null;
    const watch = new FrameWatch();
    let lastMoving = 0;
    const draw = (now: number) => {
      frame = 0;
      const moving = controls.update();
      renderer.render(scene, camera);
      if (moving) {
        const down = lighter(quality);
        if (adapt && down && lastMoving > 0 && watch.record(now - lastMoving)) {
          setQuality(down);
          return;
        }
        lastMoving = now;
        frame = requestAnimationFrame(draw);
        return;
      }
      lastMoving = 0;
      window.clearTimeout(stillTimer);
      const t = three.current;
      if (t?.still) stillTimer = window.setTimeout(() => t.still?.render(), 180);
    };
    const invalidate = () => {
      window.clearTimeout(stillTimer);
      if (!frame) frame = requestAnimationFrame(draw);
    };
    three.current = { renderer, scene, camera, controls, content: null, sun: null, outdoor: null, profile, still: null, disposeEnv: () => undefined, invalidate };

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = host;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      three.current?.still?.setSize(w, h);
      invalidate();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    let lastQuarter = -1;
    const reportHeading = () => {
      const quarter = headingQuarter(controls.target.x - camera.position.x, -(controls.target.z - camera.position.z));
      if (quarter !== lastQuarter) {
        lastQuarter = quarter;
        latest.current.onHeading?.(quarter);
      }
    };
    controls.addEventListener('change', reportHeading);
    controls.addEventListener('change', invalidate);
    controls.addEventListener('start', invalidate);

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
    // Arrows with nothing selected: left and right walk the camera round the room, up and down
    // tilt it between looking across and looking down (Shift: bigger steps).
    const onKey = (e: KeyboardEvent) => {
      const { selectedIds: selection, keyboardActive: active } = latest.current;
      if (selection.length > 0 || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      if (ownsKeys(e.target) || e.ctrlKey || e.metaKey || e.altKey || !(active?.() ?? true)) return;
      e.preventDefault();
      const offset = camera.position.clone().sub(controls.target);
      const spherical = new THREE.Spherical().setFromVector3(offset);
      const turn = THREE.MathUtils.degToRad(e.shiftKey ? 45 : 10);
      if (e.key === 'ArrowLeft') spherical.theta -= turn;
      if (e.key === 'ArrowRight') spherical.theta += turn;
      if (e.key === 'ArrowUp') spherical.phi -= turn / 2;
      if (e.key === 'ArrowDown') spherical.phi += turn / 2;
      spherical.phi = THREE.MathUtils.clamp(spherical.phi, 0.05, controls.maxPolarAngle);
      camera.position.copy(controls.target).add(offset.setFromSpherical(spherical));
      controls.update();
      invalidate();
    };
    window.addEventListener('keydown', onKey);
    canvas.addEventListener('pointerdown', onDown, { capture: true });
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('wheel', invalidate, { passive: true });

    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.clearTimeout(stillTimer);
      controls.removeEventListener('change', reportHeading);
      controls.removeEventListener('change', invalidate);
      controls.removeEventListener('start', invalidate);
      window.removeEventListener('keydown', onKey);
      canvas.removeEventListener('pointerdown', onDown, { capture: true });
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('wheel', invalidate);
      // A change of graphics level builds a new canvas; it opens where this one was looking.
      keptView.current = { position: camera.position.clone(), target: controls.target.clone() };
      controls.dispose();
      const t = three.current;
      if (t?.content) disposeTree(t.content);
      t?.still?.dispose();
      t?.disposeEnv();
      renderer.dispose();
      renderer.domElement.remove();
      three.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quality]);

  // Light and sky follow the kind of place and the graphics level: set up with each new canvas,
  // and again only if the place turns indoor ↔ outdoor.
  const outdoor = isOutdoor(detectPack(project));
  const span = spanOf(project);
  useEffect(() => {
    const t = three.current;
    if (!t || t.outdoor === outdoor) return;
    t.disposeEnv();
    if (t.sun) {
      t.scene.remove(t.sun, t.sun.target);
      t.sun.dispose();
    }
    for (const light of t.scene.children.filter((c) => (c as THREE.Light).isLight)) t.scene.remove(light);
    t.scene.fog = null;
    t.scene.background = null;
    t.sun = addLights(t.scene, outdoor, t.profile);
    t.disposeEnv = addEnvironment(t.renderer, t.scene, outdoor, t.profile.reflections, span);
    t.outdoor = outdoor;
    if (t.profile.ambientOcclusion && !t.still) {
      const host = hostRef.current;
      t.still = new StillPass(t.renderer, t.scene, t.camera, host?.clientWidth || 800, host?.clientHeight || 600);
    }
    t.still?.setScale(span);
    t.invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outdoor, quality]);

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
    t.renderer.shadowMap.needsUpdate = true;
    t.invalidate();
    hostRef.current?.setAttribute('data-items', String(Object.keys(project.items).length - (look?.hidden?.size ?? 0)));
    hostRef.current?.setAttribute('data-selected', selectedIds.join(' '));
  }, [project, issues, selectedIds, fullWalls, look, quality]);

  // Frame the room when asked, and when the room itself changes size.
  const room = boundsOf(project.space.boundary);
  const roomKey = `${room.minX},${room.minY},${room.maxX},${room.maxY}`;
  const aspect = () => {
    const host = hostRef.current;
    return host && host.clientHeight > 0 ? host.clientWidth / host.clientHeight : 1.6;
  };
  const reframe = () => {
    const t = three.current;
    if (!t) return null;
    const centre = frameRoom(t.camera, t.sun, room, aspect(), outdoor);
    t.renderer.shadowMap.needsUpdate = true;
    t.still?.setScale(span);
    return centre;
  };
  useEffect(() => {
    const t = three.current;
    if (!t) return;
    const centre = reframe();
    const kept = keptView.current;
    keptView.current = null;
    if (kept) {
      // A new canvas for another graphics level: carry on from the same view.
      t.camera.position.copy(kept.position);
      t.controls.target.copy(kept.target);
    } else {
      if (centre) t.controls.target.copy(centre);
      setTopView(false);
    }
    t.controls.update();
    t.invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomKey, fitToken, outdoor, quality]);

  const savePicture = () => {
    const t = three.current;
    if (!t) return;
    if (t.still) t.still.render();
    else t.renderer.render(t.scene, t.camera);
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
    if (topView) {
      setTopView(false);
      const centre = reframe();
      if (centre) t.controls.target.copy(centre);
      t.controls.update();
      t.invalidate();
      return;
    }
    const offset = t.camera.position.clone().sub(t.controls.target);
    offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), (degrees * Math.PI) / 180);
    t.camera.position.copy(t.controls.target).add(offset);
    t.controls.update();
    t.invalidate();
  };
  const perspective = () => {
    const t = three.current;
    if (!t) return;
    setTopView(false);
    const centre = reframe();
    if (centre) t.controls.target.copy(centre);
    t.controls.update();
    t.invalidate();
  };
  const fromAbove = () => {
    const t = three.current;
    if (!t) return;
    setTopView(true);
    const centre = reframe();
    if (!centre) return;
    const back = aspect() < 1.2 ? 1.05 / aspect() : 1;
    t.controls.target.copy(centre);
    t.camera.position.set(centre.x, span * 1.3 * back, centre.z + 0.001);
    t.controls.update();
    t.invalidate();
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
    <div className={`view3d${outdoor ? ' outdoor' : ''}`} ref={hostRef} data-testid="view3d" aria-label="3D view">
      <div className="pane-title">
        <div className="serif">{topView ? 'Top view' : 'Perspective'}</div>
        <div className="sub">{outdoor ? 'Site with sky and sun' : fullWalls ? 'Full-height walls' : 'Walls cut at 1.10 m'} · Drag to orbit · Scroll to zoom</div>
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
          <span className="sep" />
          <button
            type="button"
            className="quality"
            data-testid="graphics-quality"
            title={`Graphics: ${QUALITY_LABEL[quality]}. Click for ${QUALITY_LABEL[nextQuality(quality)]}. Fast turns off shadows for slow computers; High adds soft shadows and ambient occlusion.`}
            aria-label={`Graphics quality: ${QUALITY_LABEL[quality]}`}
            onClick={() => chooseQuality(nextQuality(quality))}
          >
            <Gauge size={15} />
            {QUALITY_LABEL[quality]}
          </button>
        </div>
      )}
    </div>
  );
}
