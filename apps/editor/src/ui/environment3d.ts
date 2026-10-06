import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import type { QualityProfile } from '../logic/graphics.js';

/**
 * Light, sky and image quality for the 3D view. Outdoors (site plans, parking yards) gets a
 * physical sky, a low sun and haze; indoors keeps the soft studio light that keeps design colours
 * true. How much of this is drawn follows the graphics level (`logic/graphics.ts`): a laptop's
 * built-in graphics chip gets fewer shadow pixels, no ambient occlusion and no reflections.
 */

/** True when the browser draws WebGL in software (SwiftShader, llvmpipe, Microsoft Basic Render). */
export function isSoftwareRenderer(renderer: THREE.WebGLRenderer): boolean {
  try {
    const gl = renderer.getContext();
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)).toLowerCase();
    return /swiftshader|llvmpipe|software|basic render/.test(name);
  } catch {
    return true;
  }
}

/** Direction the sunlight comes from: late morning from the south-west, 42° high. */
export const SUN_DIRECTION = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 42), THREE.MathUtils.degToRad(215));

export interface Lighting {
  readonly sun: THREE.DirectionalLight;
  dispose(): void;
}

/**
 * Hemisphere fill and one sun, added to the scene; the sun casts shadows when the level has them.
 * Without reflections the fill is brighter, so materials do not turn dull.
 */
export function addLights(scene: THREE.Scene, outdoor: boolean, profile: QualityProfile): THREE.DirectionalLight {
  const fill = (outdoor ? 0.45 : 1.2) * (profile.reflections ? 1 : outdoor ? 2.2 : 1.35);
  scene.add(new THREE.HemisphereLight(outdoor ? 0xdfe9f5 : 0xffffff, outdoor ? 0x8a7a62 : 0xb8b2a8, fill));
  const sun = new THREE.DirectionalLight(outdoor ? 0xffeccc : 0xfff8ee, outdoor ? 3.4 : 1.8);
  sun.castShadow = profile.shadows;
  const size = outdoor ? profile.shadowSize.outdoor : profile.shadowSize.indoor;
  if (size > 0) sun.shadow.mapSize.set(size, size);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = outdoor ? 0.08 : 0.02;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);
  return sun;
}

/**
 * Reflections and background. Outdoors a physical sky is rendered once into a reflection map
 * that also serves as the background; indoors a neutral studio room. `reflections: false` skips
 * the one-off cost for report pictures.
 */
export function addEnvironment(renderer: THREE.WebGLRenderer, scene: THREE.Scene, outdoor: boolean, reflections: boolean, size: number): () => void {
  renderer.toneMapping = outdoor ? THREE.ACESFilmicToneMapping : THREE.NeutralToneMapping;
  renderer.toneMappingExposure = outdoor ? 0.7 : 1;
  const horizon = new THREE.Color(0xd9e2ea);
  if (outdoor) {
    scene.fog = new THREE.Fog(horizon, Math.max(200, size * 1.6), Math.max(900, size * 7));
    scene.background = horizon;
  }
  if (!reflections) return () => undefined;
  const pmrem = new THREE.PMREMGenerator(renderer);
  let env: THREE.Texture;
  if (outdoor) {
    const sky = new Sky();
    sky.scale.setScalar(1000);
    const u = sky.material.uniforms;
    u.turbidity!.value = 6;
    u.rayleigh!.value = 1.4;
    u.mieCoefficient!.value = 0.004;
    u.mieDirectionalG!.value = 0.82;
    u.sunPosition!.value.copy(SUN_DIRECTION);
    const skyScene = new THREE.Scene();
    skyScene.add(sky);
    env = pmrem.fromScene(skyScene, 0).texture;
    scene.background = env;
    scene.backgroundBlurriness = 0.02;
    scene.environment = env;
    scene.environmentIntensity = 0.5;
    sky.geometry.dispose();
    sky.material.dispose();
  } else {
    const room = new RoomEnvironment();
    env = pmrem.fromScene(room, 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = 0.5;
    room.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  }
  pmrem.dispose();
  return () => env.dispose();
}

/** Aim the sun at the plan and fit its shadow camera tightly around it. */
export function aimSun(sun: THREE.DirectionalLight, centre: THREE.Vector3, size: number): void {
  const reach = size * 0.75 + 5;
  sun.position.copy(centre).addScaledVector(SUN_DIRECTION, reach * 2);
  sun.target.position.copy(centre);
  sun.target.updateMatrixWorld();
  const cam = sun.shadow.camera;
  cam.left = cam.bottom = -reach;
  cam.right = cam.top = reach;
  cam.near = 0.5;
  cam.far = reach * 4;
  cam.updateProjectionMatrix();
  sun.shadow.needsUpdate = true;
}

/**
 * High-quality still frames: the scene with ground-truth ambient occlusion, used when the camera
 * rests. Moving frames use the plain renderer, so orbiting stays smooth on any machine.
 */
export class StillPass {
  private readonly composer: EffectComposer;
  private readonly ao: GTAOPass;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, width: number, height: number) {
    const target = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.ao = new GTAOPass(scene, camera, width, height);
    this.ao.blendIntensity = 0.85;
    this.composer.addPass(this.ao);
    this.composer.addPass(new OutputPass());
  }

  /** AO radius follows the size of what is in view: a desk's shadow and a building's are not alike. */
  setScale(size: number): void {
    const radius = THREE.MathUtils.clamp(size / 60, 0.25, 4);
    this.ao.updateGtaoMaterial({ radius, distanceExponent: 1.4, thickness: radius, scale: 1 });
  }

  setSize(width: number, height: number): void {
    this.composer.setSize(width, height);
  }

  render(): void {
    this.composer.render();
  }

  dispose(): void {
    this.ao.dispose();
    this.composer.dispose();
  }
}
