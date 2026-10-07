/**
 * How the program looks for this person (decision 0027): text size, fonts, light or dark, and the
 * accent colour. Kept in this browser like the editor's precision settings; applied to the page's
 * root as data attributes and CSS variables, so the whole interface follows at once.
 */

export type TextSize = 'small' | 'default' | 'large' | 'larger';
export type UiFont = 'geist' | 'system' | 'serif';
export type HeadingFont = 'serif' | 'sans';
export type Theme = 'light' | 'dark' | 'system';
export type Accent = 'blue' | 'bronze' | 'forest' | 'graphite';

export interface Appearance {
  readonly textSize: TextSize;
  readonly font: UiFont;
  readonly headings: HeadingFont;
  readonly theme: Theme;
  readonly accent: Accent;
}

export const DEFAULT_APPEARANCE: Appearance = { textSize: 'default', font: 'geist', headings: 'serif', theme: 'light', accent: 'blue' };

export const TEXT_SIZES: ReadonlyArray<{ id: TextSize; label: string; scale: number }> = [
  { id: 'small', label: 'Small', scale: 0.92 },
  { id: 'default', label: 'Default', scale: 1 },
  { id: 'large', label: 'Large', scale: 1.1 },
  { id: 'larger', label: 'Larger', scale: 1.22 },
];

export const UI_FONTS: ReadonlyArray<{ id: UiFont; label: string; hint: string; stack: string }> = [
  { id: 'geist', label: 'Geist', hint: 'Crisp and technical (default)', stack: "'Geist Variable', Geist, 'Helvetica Neue', Helvetica, Arial, sans-serif" },
  { id: 'system', label: 'System', hint: 'The font of this computer', stack: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" },
  { id: 'serif', label: 'Editorial', hint: 'Newsreader serif throughout', stack: "'Newsreader Variable', Newsreader, Georgia, serif" },
];

export const ACCENTS: ReadonlyArray<{ id: Accent; label: string; colour: string; hover: string; dark: string }> = [
  { id: 'blue', label: 'Electric blue', colour: '#1f3bf5', hover: '#1629c4', dark: '#6f83ff' },
  { id: 'bronze', label: 'Bronze', colour: '#9a6634', hover: '#7d5227', dark: '#d1a06d' },
  { id: 'forest', label: 'Forest', colour: '#2f6b4f', hover: '#24553e', dark: '#6fbf97' },
  { id: 'graphite', label: 'Graphite', colour: '#2b2f36', hover: '#16191d', dark: '#c9ced7' },
];

const KEY = 'atrium.appearance';

function one<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** What was chosen before, with anything unknown or missing put back to its default. */
export function readAppearance(text: string | null | undefined): Appearance {
  let raw: Record<string, unknown> = {};
  try {
    const parsed: unknown = text ? JSON.parse(text) : {};
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) raw = parsed as Record<string, unknown>;
  } catch {
    raw = {};
  }
  const d = DEFAULT_APPEARANCE;
  return {
    textSize: one(raw.textSize, TEXT_SIZES.map((t) => t.id), d.textSize),
    font: one(raw.font, UI_FONTS.map((f) => f.id), d.font),
    headings: one(raw.headings, ['serif', 'sans'] as const, d.headings),
    theme: one(raw.theme, ['light', 'dark', 'system'] as const, d.theme),
    accent: one(raw.accent, ACCENTS.map((a) => a.id), d.accent),
  };
}

export function loadAppearance(): Appearance {
  try {
    return readAppearance(globalThis.localStorage?.getItem(KEY));
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export function saveAppearance(appearance: Appearance): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(appearance));
  } catch {
    // Private windows may refuse storage; the choice still applies to this visit.
  }
}

/** Whether the page should be dark: chosen, or following the computer. */
export function isDark(appearance: Appearance, systemDark: boolean): boolean {
  return appearance.theme === 'dark' || (appearance.theme === 'system' && systemDark);
}

/** The CSS variables and attributes an appearance sets on the page's root. */
export function rootStyle(appearance: Appearance, systemDark: boolean): { theme: 'light' | 'dark'; vars: Record<string, string> } {
  const dark = isDark(appearance, systemDark);
  const accent = ACCENTS.find((a) => a.id === appearance.accent)!;
  const font = UI_FONTS.find((f) => f.id === appearance.font)!;
  const scale = TEXT_SIZES.find((t) => t.id === appearance.textSize)!.scale;
  return {
    theme: dark ? 'dark' : 'light',
    vars: {
      '--ts': String(scale),
      '--sans': font.stack,
      '--heading': appearance.headings === 'serif' ? 'var(--serif-face)' : font.stack,
      '--accent': dark ? accent.dark : accent.colour,
      '--accent-hover': dark ? accent.colour : accent.hover,
    },
  };
}

/** Apply to the document now, and follow the computer's light or dark setting while "system". */
export function applyAppearance(appearance: Appearance): void {
  if (typeof document === 'undefined') return;
  const media = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
  const { theme, vars } = rootStyle(appearance, media?.matches ?? false);
  const root = document.documentElement;
  root.dataset.theme = theme;
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
}
