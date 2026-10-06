import { describe, expect, it } from 'vitest';
import { arrowSteps, DEFAULT_CONTROLS, niceStep, sanitizeControls } from '../src/logic/controls.js';

describe('arrow steps that can be seen', () => {
  it('rounds up to 1, 2 or 5 × a power of ten', () => {
    expect([0, 1, 3, 12, 20, 21, 480, 600, 5000, 7300].map(niceStep)).toEqual([1, 1, 5, 20, 20, 50, 500, 1000, 5000, 10000]);
  });

  it('follows the zoom: four screen pixels, rounded; Shift is ten times that', () => {
    // A 12 m hall across 800 px: 150 ticks per pixel, 600 ticks for 4 px → 10 cm.
    expect(arrowSteps(DEFAULT_CONTROLS, 150)).toEqual({ step: 1000, bigStep: 10000 });
    // A 600 m campus across 800 px: 7 500 ticks per pixel, 30 000 for 4 px → 5 m.
    expect(arrowSteps(DEFAULT_CONTROLS, 7500)).toEqual({ step: 50000, bigStep: 500000 });
    // Zoomed right in: never below one tick.
    expect(arrowSteps(DEFAULT_CONTROLS, 0.1).step).toBe(1);
  });

  it('a typed step is used exactly, and old saved settings keep following the zoom', () => {
    const typed = { ...DEFAULT_CONTROLS, autoStep: false, step: 500, bigStep: 1000 };
    expect(arrowSteps(typed, 7500)).toEqual({ step: 500, bigStep: 1000 });
    expect(sanitizeControls({ step: 500 }).autoStep).toBe(true);
    expect(sanitizeControls({ autoStep: false }).autoStep).toBe(false);
  });
});
