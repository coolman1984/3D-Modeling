import * as THREE from 'three';

/**
 * Small textures drawn on a canvas once and shared by every scene: printed cartons, stretch-wrapped
 * carton stacks, corrugated container steel and floor planks. White bases, so an item's colour
 * (per instance or per material) tints them.
 */

const cache = new Map<string, THREE.Texture | null>();

function canvasTexture(key: string, width: number, height: number, draw: (g: CanvasRenderingContext2D) => void, repeat = false): THREE.Texture | null {
  if (cache.has(key)) return cache.get(key)!;
  let texture: THREE.Texture | null = null;
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const g = canvas.getContext('2d');
    if (g) {
      draw(g);
      texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      if (repeat) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    }
  }
  cache.set(key, texture);
  return texture;
}

/** A retail carton face: product line, size and a TV outline, with handling marks. */
export function printedCarton(print: string): THREE.Texture | null {
  return canvasTexture(`print:${print}`, 512, 320, (g) => {
    g.fillStyle = '#f7f6f2';
    g.fillRect(0, 0, 512, 320);
    g.fillStyle = '#10151c';
    g.fillRect(0, 250, 512, 70);
    g.fillStyle = '#2b54d0';
    g.fillRect(0, 244, 512, 6);
    // Screen outline with a soft picture.
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
    g.fillText(line ?? print, 22, 92);
    g.font = '300 64px Geist, Arial, sans-serif';
    if (size) g.fillText(size, 22, 170);
    g.fillStyle = '#f7f6f2';
    g.font = '500 26px Geist, Arial, sans-serif';
    g.fillText('FRAGILE · HANDLE WITH CARE', 22, 294);
    // "This way up" arrows.
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
    // Stretch-wrap sheen.
    const sheen = g.createLinearGradient(0, 0, 256, 256);
    sheen.addColorStop(0, 'rgba(255,255,255,0.35)');
    sheen.addColorStop(0.5, 'rgba(255,255,255,0)');
    sheen.addColorStop(1, 'rgba(255,255,255,0.25)');
    g.fillStyle = sheen;
    g.fillRect(0, 0, 256, 256);
    // Shipping label.
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

/** Hardwood planks of a container floor. */
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
