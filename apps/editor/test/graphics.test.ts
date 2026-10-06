import { describe, expect, it } from 'vitest';
import { DEFAULT_QUALITY, FrameWatch, lighter, nextQuality, QUALITIES, QUALITY_PROFILES } from '../src/logic/graphics.js';

describe('graphics levels', () => {
  it('defaults to Balanced, which skips the costliest effects', () => {
    expect(DEFAULT_QUALITY).toBe('balanced');
    const b = QUALITY_PROFILES.balanced;
    expect(b.ambientOcclusion).toBe(false);
    expect(b.softShadows).toBe(false);
    expect(b.pixelRatio).toBe(1);
  });

  it('each level costs no more than the next one up', () => {
    for (let i = 1; i < QUALITIES.length; i++) {
      const lo = QUALITY_PROFILES[QUALITIES[i - 1]!];
      const hi = QUALITY_PROFILES[QUALITIES[i]!];
      expect(lo.pixelRatio).toBeLessThanOrEqual(hi.pixelRatio);
      expect(lo.shadowSize.indoor).toBeLessThanOrEqual(hi.shadowSize.indoor);
      expect(lo.shadowSize.outdoor).toBeLessThanOrEqual(hi.shadowSize.outdoor);
      for (const flag of ['antialias', 'shadows', 'softShadows', 'ambientOcclusion', 'reflections'] as const) {
        expect(!lo[flag] || hi[flag]).toBe(true);
      }
    }
    expect(QUALITY_PROFILES.fast.shadows).toBe(false);
  });

  it('steps down one level at a time and cycles on the button', () => {
    expect(lighter('high')).toBe('balanced');
    expect(lighter('balanced')).toBe('fast');
    expect(lighter('fast')).toBeNull();
    expect(nextQuality('fast')).toBe('balanced');
    expect(nextQuality('high')).toBe('fast');
  });
});

describe('FrameWatch', () => {
  it('asks for a lighter level only after most of a full window of moving frames is slow', () => {
    const watch = new FrameWatch(10, 50, 0.6);
    // 5 slow and 4 fast: not a full window yet.
    for (const ms of [80, 80, 80, 80, 80, 16, 16, 16, 16]) expect(watch.record(ms)).toBe(false);
    expect(watch.record(80)).toBe(true); // 10 frames, 6 slow
  });

  it('keeps a smooth view as it is, and ignores pauses between gestures', () => {
    const watch = new FrameWatch(10, 50, 0.6);
    for (let i = 0; i < 30; i++) expect(watch.record(i % 3 === 0 ? 70 : 16)).toBe(false); // a third slow
    watch.reset();
    for (let i = 0; i < 30; i++) expect(watch.record(5000)).toBe(false); // pauses are not frames
  });
});
