import { Check } from '@phosphor-icons/react';
import { useState } from 'react';
import {
  ACCENTS,
  applyAppearance,
  DEFAULT_APPEARANCE,
  loadAppearance,
  saveAppearance,
  TEXT_SIZES,
  UI_FONTS,
  type Appearance,
  type Theme,
} from '../logic/appearance.js';
import { Segmented } from './Fields.js';

const THEMES: ReadonlyArray<{ id: Theme; label: string; hint: string }> = [
  { id: 'light', label: 'Light', hint: 'Cool white studio' },
  { id: 'dark', label: 'Dark', hint: 'Low light, plan in focus' },
  { id: 'system', label: 'Match computer', hint: 'Follows this computer' },
];

/** Settings → Appearance: every choice applies at once and is kept in this browser. */
export function AppearancePanel() {
  const [look, setLook] = useState<Appearance>(loadAppearance);
  const change = (next: Partial<Appearance>) => {
    const value = { ...look, ...next };
    setLook(value);
    saveAppearance(value);
    applyAppearance(value);
  };
  return (
    <section aria-label="Appearance">
      <h2>Appearance</h2>
      <p className="intro">How Atrium looks on this computer. Changes apply at once and are kept for every project.</p>

      <div className="look-preview" aria-hidden="true">
        <div className="kicker">Living room · 27.9 m²</div>
        <div className="look-title">A calm room, measured.</div>
        <p>Sofa Lena, 220 × 95 cm, sits 45 cm from the coffee table. Every walkway is clear.</p>
        <div className="look-row">
          <span className="btn primary small">Open project →</span>
          <span className="chip ok">
            <Check size={12} /> Every check passes
          </span>
          <span className="look-link">Client report</span>
        </div>
      </div>

      <div className="set-row">
        <div>
          <div className="label">Theme</div>
          <div className="hint">Light or dark, or as the computer is set</div>
        </div>
        <div className="look-themes" role="radiogroup" aria-label="Theme">
          {THEMES.map((t) => (
            <button key={t.id} type="button" role="radio" aria-checked={look.theme === t.id} className={`look-theme${look.theme === t.id ? ' active' : ''}`} onClick={() => change({ theme: t.id })} data-theme-choice={t.id}>
              <span className={`look-mini ${t.id}`}>
                <i />
                <b />
                <b />
              </span>
              <span className="look-name">{t.label}</span>
              <span className="look-hint">{t.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="set-row">
        <div>
          <div className="label">Accent colour</div>
          <div className="hint">Selection, focus and links</div>
        </div>
        <div className="look-accents" role="radiogroup" aria-label="Accent colour">
          {ACCENTS.map((a) => (
            <button key={a.id} type="button" role="radio" aria-checked={look.accent === a.id} className={`look-accent${look.accent === a.id ? ' active' : ''}`} onClick={() => change({ accent: a.id })} title={a.label}>
              <span style={{ background: a.colour }}>{look.accent === a.id && <Check size={13} weight="bold" color="#fff" />}</span>
              {a.label}
            </button>
          ))}
        </div>
      </div>

      <div className="set-row">
        <div>
          <div className="label">Text size</div>
          <div className="hint">Every label, field and table</div>
        </div>
        <Segmented label="Text size" className="auto-width" value={look.textSize} onChange={(textSize) => change({ textSize })} options={TEXT_SIZES.map((t) => ({ id: t.id, label: t.label }))} />
      </div>

      <div className="set-row">
        <div>
          <div className="label">Interface font</div>
          <div className="hint">Menus, panels and numbers</div>
        </div>
        <div className="look-fonts" role="radiogroup" aria-label="Interface font">
          {UI_FONTS.map((f) => (
            <button key={f.id} type="button" role="radio" aria-checked={look.font === f.id} className={`look-font${look.font === f.id ? ' active' : ''}`} onClick={() => change({ font: f.id })}>
              <span className="look-aa" style={{ fontFamily: f.stack }}>
                Aa
              </span>
              <span className="look-name">{f.label}</span>
              <span className="look-hint">{f.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="set-row">
        <div>
          <div className="label">Headings</div>
          <div className="hint">Page and panel titles</div>
        </div>
        <Segmented
          label="Headings"
          className="auto-width"
          value={look.headings}
          onChange={(headings) => change({ headings })}
          options={[
            { id: 'serif', label: 'Serif' },
            { id: 'sans', label: 'Same as interface' },
          ]}
        />
      </div>

      <div className="set-row">
        <div>
          <div className="label">Defaults</div>
          <div className="hint">Light, electric blue, Geist, default size</div>
        </div>
        <div>
          <button type="button" className="btn" onClick={() => change(DEFAULT_APPEARANCE)}>
            Reset appearance
          </button>
        </div>
      </div>
    </section>
  );
}
