/**
 * How much the 3D view draws. Kept per browser, like the control settings: a laptop with a
 * built-in graphics chip and a desktop with a graphics card want different trade-offs, and the
 * project looks the same either way.
 */
export type Quality = 'fast' | 'balanced' | 'high';

export const QUALITIES: readonly Quality[] = ['fast', 'balanced', 'high'];

export const QUALITY_LABEL: Readonly<Record<Quality, string>> = { fast: 'Fast', balanced: 'Balanced', high: 'High' };

/** What one level turns on. Every item is a real cost on a weak graphics chip. */
export interface QualityProfile {
  /** Screen pixels per CSS pixel, capped by the display's own ratio. */
  readonly pixelRatio: number;
  /** Smoothed edges; needs a new 3D canvas to change. */
  readonly antialias: boolean;
  readonly shadows: boolean;
  /** Shadow map size in pixels, indoors and outdoors (a whole campus needs more to stay sharp). */
  readonly shadowSize: { readonly indoor: number; readonly outdoor: number };
  /** Blurred shadow edges: several shadow lookups per pixel instead of a few. */
  readonly softShadows: boolean;
  /** Ambient occlusion on the resting frame: a full extra render of the scene. */
  readonly ambientOcclusion: boolean;
  /** Sky and studio reflections, built once per view. */
  readonly reflections: boolean;
}

export const QUALITY_PROFILES: Readonly<Record<Quality, QualityProfile>> = {
  fast: { pixelRatio: 1, antialias: false, shadows: false, shadowSize: { indoor: 0, outdoor: 0 }, softShadows: false, ambientOcclusion: false, reflections: false },
  balanced: { pixelRatio: 1, antialias: true, shadows: true, shadowSize: { indoor: 1024, outdoor: 2048 }, softShadows: false, ambientOcclusion: false, reflections: true },
  high: { pixelRatio: 2, antialias: true, shadows: true, shadowSize: { indoor: 2048, outdoor: 4096 }, softShadows: true, ambientOcclusion: true, reflections: true },
};

export const DEFAULT_QUALITY: Quality = 'balanced';

/** One level lighter, or null at the lightest. */
export function lighter(quality: Quality): Quality | null {
  const i = QUALITIES.indexOf(quality);
  return i > 0 ? QUALITIES[i - 1]! : null;
}

/** The next level for the toolbar button: Fast → Balanced → High → Fast. */
export function nextQuality(quality: Quality): Quality {
  return QUALITIES[(QUALITIES.indexOf(quality) + 1) % QUALITIES.length]!;
}

/**
 * Watches frame times while the camera moves and says when the view is too slow to keep up:
 * at least `slowShare` of the last `window` moving frames took longer than `budgetMs`
 * (50 ms = under 20 frames a second). Pauses between gestures are not frames and are skipped.
 */
export class FrameWatch {
  private readonly times: number[] = [];

  constructor(
    private readonly window = 40,
    private readonly budgetMs = 50,
    private readonly slowShare = 0.6,
  ) {}

  /** Record the time since the previous moving frame; true when the view should get lighter. */
  record(ms: number): boolean {
    if (!(ms > 0) || ms > 1000) return false; // a pause, not a frame
    this.times.push(ms);
    if (this.times.length > this.window) this.times.shift();
    if (this.times.length < this.window) return false;
    const slow = this.times.filter((t) => t > this.budgetMs).length;
    return slow >= this.window * this.slowShare;
  }

  reset(): void {
    this.times.length = 0;
  }
}

const STORAGE_KEY = 'space-planner.graphics';

/** The level the person picked, or null if they never picked one (then the view may adapt). */
export function loadQuality(): Quality | null {
  try {
    const value = globalThis.localStorage?.getItem(STORAGE_KEY);
    return QUALITIES.includes(value as Quality) ? (value as Quality) : null;
  } catch {
    return null;
  }
}

export function saveQuality(quality: Quality): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, quality);
  } catch {
    // Private windows may refuse storage; the level still holds for this visit.
  }
}
