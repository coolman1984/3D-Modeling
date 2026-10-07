import { describe, expect, it } from 'vitest';
import { DEFAULT_APPEARANCE, isDark, readAppearance, rootStyle } from '../src/logic/appearance.js';

describe('appearance', () => {
  it('reads back what was saved, and puts anything unknown back to its default', () => {
    expect(readAppearance(null)).toEqual(DEFAULT_APPEARANCE);
    expect(readAppearance('not json')).toEqual(DEFAULT_APPEARANCE);
    expect(readAppearance('[1,2]')).toEqual(DEFAULT_APPEARANCE);
    expect(readAppearance(JSON.stringify({ textSize: 'large', font: 'comic', theme: 'dark', accent: 'bronze', headings: 'sans' }))).toEqual({ textSize: 'large', font: 'geist', headings: 'sans', theme: 'dark', accent: 'bronze' });
  });

  it('follows the computer only when asked to', () => {
    expect(isDark({ ...DEFAULT_APPEARANCE, theme: 'system' }, true)).toBe(true);
    expect(isDark({ ...DEFAULT_APPEARANCE, theme: 'system' }, false)).toBe(false);
    expect(isDark({ ...DEFAULT_APPEARANCE, theme: 'light' }, true)).toBe(false);
  });

  it('sets the text scale, fonts and a lighter accent on dark pages', () => {
    const light = rootStyle({ ...DEFAULT_APPEARANCE, textSize: 'larger', accent: 'forest' }, false);
    expect(light.theme).toBe('light');
    expect(light.vars['--ts']).toBe('1.22');
    expect(light.vars['--accent']).toBe('#2f6b4f');
    expect(light.vars['--heading']).toBe('var(--serif-face)');
    const dark = rootStyle({ ...DEFAULT_APPEARANCE, theme: 'dark', headings: 'sans', font: 'system' }, false);
    expect(dark.theme).toBe('dark');
    expect(dark.vars['--accent']).toBe('#6f83ff');
    expect(dark.vars['--heading']).toBe(dark.vars['--sans']);
    expect(dark.vars['--sans']).toContain('system-ui');
  });
});
