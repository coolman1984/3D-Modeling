import { fromUnit } from '@space-planner/core';

/**
 * How precise and how fast the mouse and keyboard move things. Kept per browser, like the
 * preferences of a drawing app; never part of the project.
 */
export interface ControlSettings {
  /** Grid step for dragging, in ticks (1 = no grid). */
  readonly grid: number;
  /**
   * Arrow steps follow the zoom (see `arrowSteps`): a press always moves a visible amount, in a
   * 12 m hall and on a 600 m campus alike. Typing a step in the Precision panel turns it off.
   */
  readonly autoStep: boolean;
  /** Arrow key step; Shift uses `bigStep`, Alt uses `fineStep`. */
  readonly step: number;
  readonly bigStep: number;
  readonly fineStep: number;
  /** [ and ] turn by `angleStep` (Alt: `fineAngle`); the rotation handle snaps to `angleStep`. */
  readonly angleStep: number;
  readonly fineAngle: number;
  /** PageUp / PageDown raise and lower by this much. */
  readonly raiseStep: number;
  /** How far an item travels for a given mouse movement (1 = follows the cursor exactly). */
  readonly dragSpeed: number;
  /** Speed while Alt is held, for precise placement. */
  readonly fineDragSpeed: number;
  /** How quickly a held arrow key speeds up (0 = steady). */
  readonly keyAcceleration: number;
  /** Jump to edges and centres of other items and walls, and show guide lines. */
  readonly guides: boolean;
  /** How close, in screen pixels, an edge must come before it jumps to a guide. */
  readonly guideDistance: number;
}

const cm = (v: number) => fromUnit(v, 'cm');

export const DEFAULT_CONTROLS: ControlSettings = {
  grid: cm(5),
  autoStep: true,
  step: cm(1),
  bigStep: cm(10),
  fineStep: fromUnit(1, 'mm'),
  angleStep: 15_000,
  fineAngle: 1_000,
  raiseStep: cm(5),
  dragSpeed: 1,
  fineDragSpeed: 0.2,
  keyAcceleration: 1,
  guides: true,
  guideDistance: 8,
};

/** Limits for each number, so a bad saved value can never make the editor unusable. */
export const CONTROL_LIMITS: Readonly<Record<Exclude<keyof ControlSettings, 'guides' | 'autoStep'>, readonly [number, number]>> = {
  grid: [1, cm(100)],
  step: [1, cm(100)],
  bigStep: [1, cm(500)],
  fineStep: [1, cm(10)],
  angleStep: [100, 90_000],
  fineAngle: [10, 45_000],
  raiseStep: [1, cm(100)],
  dragSpeed: [0.1, 3],
  fineDragSpeed: [0.02, 1],
  keyAcceleration: [0, 5],
  guideDistance: [0, 40],
};

/** Keep what is valid, fall back to the default for anything missing or out of range. */
export function sanitizeControls(value: unknown): ControlSettings {
  const source = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const out: Record<string, unknown> = { ...DEFAULT_CONTROLS };
  for (const [key, [min, max]] of Object.entries(CONTROL_LIMITS)) {
    const v = source[key];
    if (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max) {
      out[key] = key === 'dragSpeed' || key === 'fineDragSpeed' || key === 'keyAcceleration' ? v : Math.round(v);
    }
  }
  if (typeof source.guides === 'boolean') out.guides = source.guides;
  if (typeof source.autoStep === 'boolean') out.autoStep = source.autoStep;
  return out as unknown as ControlSettings;
}

/** The smallest 1, 2 or 5 × a power of ten (in ticks, at least 1) that is not below `ticks`. */
export function niceStep(ticks: number): number {
  if (!(ticks > 1)) return 1;
  const power = 10 ** Math.floor(Math.log10(ticks));
  for (const m of [1, 2, 5, 10]) if (m * power >= ticks - 1e-9) return m * power;
  return 10 * power;
}

/** On screen, one arrow press moves about this many pixels when the step follows the zoom. */
export const ARROW_PIXELS = 4;

/**
 * The arrow and Shift+arrow steps actually used. With `autoStep` on, a press moves about four
 * screen pixels, rounded to a round length (1, 2, 5, 10 cm…), and Shift ten times that; a
 * 1 cm step on a whole campus was far too small to see. `ticksPerPixel` comes from the plan's
 * zoom, or from the room's size in the 3D view. Alt (fine) and the typed steps are never changed.
 */
export function arrowSteps(s: ControlSettings, ticksPerPixel: number): { step: number; bigStep: number } {
  if (!s.autoStep || !(ticksPerPixel > 0)) return { step: s.step, bigStep: s.bigStep };
  const step = Math.min(CONTROL_LIMITS.step[1] * 100, niceStep(ticksPerPixel * ARROW_PIXELS));
  return { step, bigStep: step * 10 };
}

const STORAGE_KEY = 'space-planner.controls';

export function loadControls(): ControlSettings {
  try {
    const text = globalThis.localStorage?.getItem(STORAGE_KEY);
    return sanitizeControls(text ? JSON.parse(text) : {});
  } catch {
    return DEFAULT_CONTROLS;
  }
}

export function saveControls(settings: ControlSettings): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private windows may refuse storage; the settings still work for this visit.
  }
}

/**
 * The step for the n-th repeat of a held arrow key: steady at first, then faster, so a long
 * press crosses a hall quickly while a tap stays precise. Capped at 20 steps per repeat.
 */
export function acceleratedStep(step: number, repeat: number, acceleration: number): number {
  const factor = Math.min(20, 1 + acceleration * Math.max(0, repeat - 4) * 0.15);
  return step * factor;
}

/** Inputs that never use the arrow keys themselves: a tick box or button keeps focus after a click. */
const ARROW_FREE_INPUTS = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file', 'image']);

/**
 * True when a key belongs to the focused control rather than to the editor: text and number
 * fields, lists, sliders (their arrows move the slider) and editable text. A tick box that was
 * just clicked must not switch the arrow keys off everywhere, as it did before.
 */
export function ownsKeys(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return true;
  if (target.tagName === 'INPUT') return !ARROW_FREE_INPUTS.has((target as HTMLInputElement).type);
  return false;
}

/** What a key press means in the editor, independent of the browser event. */
export type KeyIntent =
  | { readonly kind: 'nudge'; readonly dx: number; readonly dy: number }
  | { readonly kind: 'raise'; readonly dz: number }
  | { readonly kind: 'rotate'; readonly by: number }
  | { readonly kind: 'undo' | 'redo' | 'select-all' | 'duplicate' | 'copy' | 'paste' | 'cut' | 'delete' | 'escape' | 'lock' | 'frame' }  | null;

export interface KeyPress {
  readonly key: string;
  readonly ctrl: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
}

/**
 * The keyboard map. Arrows move on the plan (up = north); Shift = big step, Alt = fine step.
 * Arabic keyboard letters are accepted next to the Latin ones (ق = R, ئ = D, ؤ = C …).
 */
export function keyIntent(press: KeyPress, s: ControlSettings): KeyIntent {
  const key = press.key.length === 1 ? press.key.toLowerCase() : press.key;
  const is = (...keys: string[]) => keys.includes(key);
  if (press.ctrl) {
    if (is('z', 'ئ')) return { kind: press.shift ? 'redo' : 'undo' };
    if (is('y', 'غ')) return { kind: 'redo' };
    if (is('a', 'ش')) return { kind: 'select-all' };
    if (is('d', 'ي')) return { kind: 'duplicate' };
    if (is('c', 'ؤ')) return { kind: 'copy' };
    if (is('v', 'ر')) return { kind: 'paste' };
    if (is('x', 'ء')) return { kind: 'cut' };
    return null;
  }
  const step = press.alt ? s.fineStep : press.shift ? s.bigStep : s.step;
  switch (key) {
    case 'ArrowUp':
      return { kind: 'nudge', dx: 0, dy: step };
    case 'ArrowDown':
      return { kind: 'nudge', dx: 0, dy: -step };
    case 'ArrowLeft':
      return { kind: 'nudge', dx: -step, dy: 0 };
    case 'ArrowRight':
      return { kind: 'nudge', dx: step, dy: 0 };
    case 'PageUp':
      return { kind: 'raise', dz: press.alt ? s.fineStep : press.shift ? s.raiseStep * 10 : s.raiseStep };
    case 'PageDown':
      return { kind: 'raise', dz: -(press.alt ? s.fineStep : press.shift ? s.raiseStep * 10 : s.raiseStep) };
    case 'Delete':
    case 'Backspace':
      return { kind: 'delete' };
    case 'Escape':
      return { kind: 'escape' };
  }
  // R turns a quarter clockwise, Shift+R back; ] and [ turn by the angle step (Alt: fine angle).
  if (is('r', 'ق')) return { kind: 'rotate', by: press.shift ? 90_000 : -90_000 };
  if (is(']', 'د')) return { kind: 'rotate', by: -(press.alt ? s.fineAngle : s.angleStep) };
  if (is('[', 'ج')) return { kind: 'rotate', by: press.alt ? s.fineAngle : s.angleStep };
  if (is('l', 'م')) return { kind: 'lock' };
  if (is('f', 'ب')) return { kind: 'frame' };
  return null;
}

/** Where copies land: half a metre (at the default big step) east and south of the originals. */
export function copyOffset(s: ControlSettings): { x: number; y: number } {
  return { x: s.bigStep * 5, y: -s.bigStep * 5 };
}

/**
 * Which quarter-turn the 3D camera faces, from its viewing direction on the plan:
 * 0 looking north (the starting view), 1 west, 2 south, 3 east.
 */
export function headingQuarter(forwardX: number, forwardY: number): 0 | 1 | 2 | 3 {
  if (forwardX === 0 && forwardY === 0) return 0;
  const degrees = (Math.atan2(forwardY, forwardX) * 180) / Math.PI - 90;
  return ((((Math.round(degrees / 90) % 4) + 4) % 4) as 0 | 1 | 2 | 3);
}

/** Turn an arrow-key move so "up" means away from the viewer in the 3D view. */
export function turnNudge(dx: number, dy: number, quarter: 0 | 1 | 2 | 3): { dx: number; dy: number } {
  switch (quarter) {
    case 0:
      return { dx, dy };
    case 1:
      return { dx: -dy, dy: dx };
    case 2:
      return { dx: -dx, dy: -dy };
    case 3:
      return { dx: dy, dy: -dx };
  }
}
