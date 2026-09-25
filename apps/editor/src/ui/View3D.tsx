import { boundsOf, type Id, type Issue, type ItemDefinition, type ItemInstance, type Project, type Vec2 } from '@space-planner/core';
import { shapeOf, type ShapeKey } from '@space-planner/starter';
import { ArrowClockwise, ArrowCounterClockwise, Camera, CornersOut, Cube, Scissors, Square } from '@phosphor-icons/react';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
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
}

export interface SceneLook {
  readonly itemColors?: ReadonlyMap<Id, number>;
  readonly hidden?: ReadonlySet<Id>;
  /** Leave out the south wall (the one nearest the starting camera) to look inside. */
  readonly cutaway?: boolean;
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
  column: 0x3a3834,
  blocked: 0xb93a2e,
  selected: 0x2b54d0,
  error: 0xb93a2e,
  warning: 0x9a6400,
  grid: 0x1a1917,
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
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb8b2a8, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);
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
    const content = buildScene(project, issues, [], fullWalls, look);
    scene.add(content);
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.05, 2000);
    frameRoom(scene, camera, boundsOf(project.space.boundary), width / height);
    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL('image/png');
    disposeTree(content);
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
function buildModel(shape: ShapeKey, w: number, d: number, h: number): THREE.Group {
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
    default:
      g.add(box(w, h, d, COLORS.box));
  }
  return g;
}

/** Give every mesh of a model one colour (colour by stop, weight or loading step). */
function paint(group: THREE.Object3D, color: number): void {
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      const m = (mesh.material as THREE.MeshStandardMaterial).clone();
      m.color = new THREE.Color(color);
      mesh.material = m;
    }
  });
}

function tint(group: THREE.Object3D, color: number, strength: number): void {
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      const m = (mesh.material as THREE.MeshStandardMaterial).clone();
      m.emissive = new THREE.Color(color);
      m.emissiveIntensity = strength;
      mesh.material = m;
    }
  });
}

function disposeTree(object: THREE.Object3D): void {
  object.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh || (o as THREE.LineSegments).isLineSegments) {
      mesh.geometry.dispose();
      (o as THREE.InstancedMesh).isInstancedMesh && (o as THREE.InstancedMesh).dispose();
      (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((m) => m.dispose());
    }
  });
}

/** Wall pieces along one boundary edge, leaving gaps where doors hang on it. */
function wallEdge(project: Project, a: Vec2, b: Vec2, height: number, group: THREE.Group): void {
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
    wall.position.copy(at(mid, (top + bottom) / 2));
    wall.rotation.y = Math.atan2(dy, dx);
    group.add(wall);
  }
}

function buildScene(project: Project, issues: readonly Issue[], selectedIds: readonly Id[], fullWalls: boolean, look: SceneLook = {}): THREE.Group {
  const group = new THREE.Group();
  const ceiling = project.space.ceilingHeight === undefined ? 3 : mt(project.space.ceilingHeight);
  const wallHeight = fullWalls ? ceiling : Math.min(1.1, ceiling);

  const shape = new THREE.Shape(project.space.boundary.map((p) => new THREE.Vector2(mt(p.x), mt(p.y))));
  const floor = new THREE.Mesh(new THREE.ShapeGeometry(shape), material(COLORS.floor));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

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
    wallEdge(project, a, c, wallHeight, group);
  }

  for (const door of project.space.doors) {
    const open = ((door.angle + (door.swing === 'left' ? 90_000 : -90_000)) / 1000) * (Math.PI / 180);
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

  group.add(buildItems(project, severity, selectedIds, look));
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
function buildItems(project: Project, severity: ReadonlyMap<Id, 'error' | 'warning'>, selectedIds: readonly Id[], look: SceneLook): THREE.Group {
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
    const template = buildModel(shapeOf(definition.category), mt(w), mt(d), mt(h));
    // A lying item: turn the upright model about its centre, then stand it on the floor again.
    const placedHeight = tilt === 'x' ? mt(w) : tilt === 'y' ? mt(d) : mt(h);
    const lay = new THREE.Matrix4()
      .makeTranslation(0, placedHeight / 2, 0)
      .multiply(tilt === 'x' ? new THREE.Matrix4().makeRotationZ(Math.PI / 2) : tilt === 'y' ? new THREE.Matrix4().makeRotationX(Math.PI / 2) : new THREE.Matrix4())
      .multiply(new THREE.Matrix4().makeTranslation(0, -mt(h) / 2, 0));
    template.updateMatrixWorld(true);
    if (color !== undefined) paint(template, color);
    if (state !== 'normal') tint(template, ...STATE_TINT[state]);
    const ids = items.map((i) => i.id);
    template.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const local = lay.clone().multiply(mesh.matrixWorld);
      const instanced = new THREE.InstancedMesh(mesh.geometry, mesh.material, items.length);
      items.forEach((item, k) => {
        quaternion.setFromAxisAngle(up, (item.rotation / 1000) * (Math.PI / 180));
        itemMatrix.compose(at(item.position, mt(item.elevation ?? 0)), quaternion, unit).multiply(local);
        instanced.setMatrixAt(k, itemMatrix);
      });
      instanced.instanceMatrix.needsUpdate = true;
      instanced.computeBoundingSphere();
      instanced.castShadow = mesh.castShadow;
      instanced.receiveShadow = mesh.receiveShadow;
      instanced.userData.itemIds = ids;
      instanced.name = 'item';
      group.add(instanced);
    });
  }
  return group;
}

/**
 * The same project as a 3D model. Drag empty space to orbit (right button pans, wheel zooms);
 * drag an item to slide it over the floor, Shift+drag to raise or lower it, Alt for precision;
 * click / Shift-click selects. Every drag is one saved change.
 */
export function View3D({ project, saved, issues, selectedIds, controls: settings, dispatch, fitToken, onHeading, look, fullWallsAtStart = false }: Props) {
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
  const latest = useRef({ saved, selectedIds, settings, dispatch, onHeading });
  latest.current = { saved, selectedIds, settings, dispatch, onHeading };

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
    const itemAt = (e: PointerEvent): Id | null => {
      const content = three.current?.content;
      const hit = content ? rayAt(e).intersectObjects(content.children, true).find((h) => h.object.userData.itemIds && h.instanceId !== undefined) : undefined;
      return hit ? ((hit.object.userData.itemIds as readonly Id[])[hit.instanceId!] ?? null) : null;
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
    let click: { x: number; y: number; id: Id | null; additive: boolean; wasSelected: boolean } | null = null;

    // Runs before the camera controls (capture phase), so grabbing an item never orbits the camera.
    const onDown = (e: PointerEvent) => {
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      const id = e.button === 0 ? itemAt(e) : null;
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
      const { id, additive, wasSelected } = click;
      click = null;
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
