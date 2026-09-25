import { useEffect, useState } from 'react';

/** A number input that keeps what the person typed until it is a valid number. */
export function NumberField({
  label,
  value,
  unit,
  onChange,
  min,
  max,
  name,
  allowEmpty = false,
}: {
  label: string;
  value: number | undefined;
  unit: string;
  onChange: (value: number | undefined) => void;
  min?: number;
  max?: number;
  name?: string;
  allowEmpty?: boolean;
}) {
  const shown = value === undefined ? '' : String(+value.toFixed(3));
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  const parsed = Number(text.replace(',', '.').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))));
  const valid = (text.trim() === '' && allowEmpty) || (text.trim() !== '' && Number.isFinite(parsed) && (min === undefined || parsed >= min) && (max === undefined || parsed <= max));
  return (
    <label className={`field${valid ? '' : ' invalid'}`}>
      <span>{label}</span>
      <input
        name={name}
        inputMode="decimal"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const t = e.target.value.trim();
          const n = Number(t.replace(',', '.').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))));
          if (t === '' && allowEmpty) onChange(undefined);
          else if (t !== '' && Number.isFinite(n) && (min === undefined || n >= min) && (max === undefined || n <= max)) onChange(n);
        }}
      />
      <span className="muted">{unit}</span>
    </label>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: ReadonlyArray<{ id: T; label: string }>; value: T; onChange: (id: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={t.id === value} className={t.id === value ? 'active' : ''} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}
