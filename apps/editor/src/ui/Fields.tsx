import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
/** Accepts "1,5" and Arabic-Indic digits as well as "1.5". */
export function parseNumber(text: string): number {
  return Number(text.trim().replace(',', '.').replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d))));
}

interface NumberFieldProps {
  /** The visible label: a short key inside the field ("W"), or a label above it (`stack`). */
  label: string;
  value: number | undefined;
  unit: string;
  onChange: (value: number | undefined) => void;
  min?: number;
  max?: number;
  name?: string;
  allowEmpty?: boolean;
  /** Spoken name when the visible label is only a short key. */
  ariaLabel?: string;
  /** 'inset' puts the label inside the field on the left; 'stack' puts it above. */
  variant?: 'inset' | 'stack';
  /** Wider left padding for longer inset keys such as "Ceiling". */
  wideKey?: boolean;
  placeholder?: string;
}

/** A number input that keeps what the person typed until it is a valid number, then reports it. */
export function NumberField({ label, value, unit, onChange, min, max, name, allowEmpty = false, ariaLabel, variant = 'inset', wideKey, placeholder }: NumberFieldProps) {
  const shown = value === undefined ? '' : String(+value.toFixed(3));
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  const okay = (t: string) => {
    const n = parseNumber(t);
    return (t.trim() === '' && allowEmpty) || (t.trim() !== '' && Number.isFinite(n) && (min === undefined || n >= min) && (max === undefined || n <= max));
  };
  const input = (
    <span className={`fld${variant === 'inset' && wideKey ? ' wide-key' : ''}`}>
      {variant === 'inset' && <span className="fld-k">{label}</span>}
      <input
        className={`input${okay(text) ? '' : ' invalid'}`}
        style={variant === 'stack' ? { paddingLeft: 10 } : undefined}
        name={name}
        inputMode="decimal"
        aria-label={ariaLabel ?? label}
        placeholder={placeholder}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const t = e.target.value;
          if (!okay(t)) return;
          onChange(t.trim() === '' ? undefined : parseNumber(t));
        }}
      />
      {unit && <span className="fld-u">{unit}</span>}
    </span>
  );
  if (variant === 'stack') {
    return (
      <label className="stack">
        {label}
        {input}
      </label>
    );
  }
  return input;
}

/**
 * A number field that commits on Enter or when it loses focus: for values that change the
 * project, so typing "120" is one step in the history and not three.
 */
export function CommitField({
  label,
  value,
  unit,
  onCommit,
  ariaLabel,
  digits = 1,
  limit = 100_000,
  readOnly = false,
  wideKey,
}: {
  label: string;
  value: number;
  unit: string;
  onCommit?: (value: number) => void;
  ariaLabel: string;
  digits?: number;
  limit?: number;
  readOnly?: boolean;
  wideKey?: boolean;
}) {
  const shown = String(+value.toFixed(digits));
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  const commit = () => {
    const n = parseNumber(text);
    if (onCommit && text.trim() !== '' && Number.isFinite(n) && Math.abs(n) <= limit) {
      if (n !== value) onCommit(n);
    } else setText(shown);
  };
  return (
    <span className={`fld${readOnly ? ' readonly' : ''}${wideKey ? ' wide-key' : ''}`}>
      <span className="fld-k">{label}</span>
      <input
        className="input"
        inputMode="decimal"
        aria-label={ariaLabel}
        value={text}
        readOnly={readOnly}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setText(shown);
        }}
      />
      <span className="fld-u">{unit}</span>
    </span>
  );
}

/** A row of mutually exclusive options. */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
  className = '',
}: {
  options: ReadonlyArray<{ id: T; label: ReactNode; title?: string }>;
  value: T;
  onChange: (id: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div className={`segmented ${className}`} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.id)} type="button" title={o.title} className={o.id === value ? 'active' : ''} aria-pressed={o.id === value} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** An on/off setting with a hint under its label. */
export function SwitchRow({ label, hint, on, onChange, name }: { label: string; hint?: string; on: boolean; onChange: (on: boolean) => void; name?: string }) {
  return (
    <button type="button" className="switch-row" role="switch" aria-checked={on} data-name={name} onClick={() => onChange(!on)}>
      <span style={{ flex: 1 }}>
        <span>{label}</span>
        {hint && <span className="hint">{hint}</span>}
      </span>
      <span className={`switch${on ? ' on' : ''}`} />
    </button>
  );
}

/** Underlined tabs, as in the library categories and the inspector. */
export function LineTabs<T extends string>({ tabs, value, onChange, className = '' }: { tabs: ReadonlyArray<{ id: T; label: ReactNode; count?: number }>; value: T; onChange: (id: T) => void; className?: string }) {
  return (
    <div className={`tabs-line ${className}`} role="tablist">
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={t.id === value} className={t.id === value ? 'active' : ''} onClick={() => onChange(t.id)}>
          {t.label}
          {t.count !== undefined && <span className="count"> {t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** A drop-down menu that closes on an outside click or Escape. */
export function Menu({ button, children, label }: { button: (open: boolean, toggle: () => void) => ReactNode; children: (close: () => void) => ReactNode; label: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className="menu-anchor" ref={box}>
      {button(open, () => setOpen((o) => !o))}
      {open && (
        <div className="menu" role="menu" aria-label={label}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

/** A modal dialog; clicking the backdrop or pressing Escape closes it. */
export function Dialog({ label, onClose, children, className = 'dialog' }: { label: string; onClose: () => void; children: ReactNode; className?: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={className} role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </div>
  );
}

/** The Atrium mark and name. */
export function Brand({ href = '#/' }: { href?: string }) {
  return (
    <a href={href} className="brand" title="All projects">
      <span className="brand-mark" />
      <span className="brand-name">Atrium</span>
    </a>
  );
}

/** A short message that disappears by itself. */
export function useToast(ms = 4000): [string | null, (text: string) => void] {
  const [text, setText] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const show = useCallback(
    (next: string) => {
      clearTimeout(timer.current);
      setText(next);
      timer.current = setTimeout(() => setText(null), ms);
    },
    [ms],
  );
  return [text, show];
}
