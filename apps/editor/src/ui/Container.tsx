import { type Command, type Id, type ItemInstance, type Project } from '@space-planner/core';
import {
  cargoOf,
  dropHeight,
  containerMetrics,
  containerType,
  extremePointPacker,
  loadsOnTop,
  plannedCounts,
  stepOf,
  stopOf,
  type Candidate,
} from '@space-planner/starter';
import { ArrowLineDown, Pause, Play, Sparkle, Trash } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { formatCentimetres, formatCount, formatMass, formatPercent } from '../logic/format.js';
import type { Action } from '../logic/session.js';
import { CommitField, Segmented } from './Fields.js';
import { sizeLine, TypeArt } from './ItemTypes.js';

export type ColorBy = 'type' | 'stop' | 'weight' | 'step';

/** Calm categorical colours for types and stops; weight and steps use one blue ramp. */
const CATEGORICAL = [0xc8a97e, 0x8fa6c9, 0xa9c29b, 0xd9a28c, 0xb7a6cf, 0x9cc5c1, 0xd4c48a, 0xc9a0b4];
const NONE = 0xd3d7de;
const ramp = (t: number) => {
  // From a pale blue-grey to the accent blue.
  const a = [0xdc, 0xe4, 0xf6];
  const b = [0x2b, 0x54, 0xd0];
  const c = a.map((v, i) => Math.round(v + (b[i]! - v) * Math.max(0, Math.min(1, t))));
  return (c[0]! << 16) | (c[1]! << 8) | c[2]!;
};
export const hex = (color: number) => `#${color.toString(16).padStart(6, '0')}`;

export interface ColorLegend {
  readonly colors: ReadonlyMap<Id, number>;
  readonly legend: ReadonlyArray<{ readonly label: string; readonly color: number }>;
}

/** A colour for every piece by the chosen property, and the legend that explains it. */
export function colorsOf(project: Project, by: ColorBy): ColorLegend {
  const items = Object.values(project.items).sort((a, b) => (a.id < b.id ? -1 : 1));
  const colors = new Map<Id, number>();
  if (by === 'type') {
    const types = [...new Set(items.map((i) => i.definitionId))].sort();
    types.forEach((t, k) => items.filter((i) => i.definitionId === t).forEach((i) => colors.set(i.id, CATEGORICAL[k % CATEGORICAL.length]!)));
    return { colors, legend: types.map((t, k) => ({ label: project.catalog[t]?.name ?? t, color: CATEGORICAL[k % CATEGORICAL.length]! })) };
  }
  if (by === 'stop') {
    const stops = [...new Set(items.map((i) => stopOf(i, project.catalog[i.definitionId]!)).filter((s): s is number => s !== undefined))].sort((a, b) => a - b);
    for (const i of items) {
      const s = stopOf(i, project.catalog[i.definitionId]!);
      colors.set(i.id, s === undefined ? NONE : CATEGORICAL[stops.indexOf(s) % CATEGORICAL.length]!);
    }
    return {
      colors,
      legend: [
        ...stops.map((s, k) => ({ label: `Drop ${s}${k === 0 ? ' · unloaded first' : k === stops.length - 1 && stops.length > 1 ? ' · unloaded last' : ''}`, color: CATEGORICAL[k % CATEGORICAL.length]! })),
        ...(items.some((i) => stopOf(i, project.catalog[i.definitionId]!) === undefined) ? [{ label: 'No drop set', color: NONE }] : []),
      ],
    };
  }
  if (by === 'weight') {
    const masses = items.map((i) => project.catalog[i.definitionId]?.mass);
    const max = Math.max(1, ...masses.filter((m): m is number => m !== undefined));
    items.forEach((i, k) => colors.set(i.id, masses[k] === undefined ? NONE : ramp(masses[k]! / max)));
    return { colors, legend: [{ label: 'Light', color: ramp(0.05) }, { label: `Heaviest · ${formatMass(max)}`, color: ramp(1) }] };
  }
  const max = Math.max(1, ...items.map((i) => stepOf(i) ?? 0));
  for (const i of items) {
    const s = stepOf(i);
    colors.set(i.id, s === undefined ? NONE : ramp(s / max));
  }
  return { colors, legend: [{ label: 'Loaded first', color: ramp(1 / max) }, { label: `Loaded last · step ${max}`, color: ramp(1) }] };
}

/** The loading-plan panel: the container, the cargo plan, and packing candidates to compare and apply. */
export function LoadPanel({ project, dispatch }: { project: Project; dispatch: (a: Action) => void }) {
  const meta = project.space.meta ?? {};
  const type = containerType(typeof meta.containerType === 'string' ? meta.containerType : null);
  const m = containerMetrics(project);
  const plan = new Map(plannedCounts(project).map((c) => [c.definition.id, c]));
  const placed = new Map<Id, number>();
  for (const item of Object.values(project.items)) placed.set(item.definitionId, (placed.get(item.definitionId) ?? 0) + 1);
  const [candidates, setCandidates] = useState<readonly Candidate[] | null>(null);
  // A plan made for an older state of the load is not offered any more.
  useEffect(() => setCandidates(null), [project.revision]);
  const setQuantity = (id: Id, quantity: number) => {
    const d = project.catalog[id]!;
    const { quantity: _old, ...rest } = d.meta ?? {};
    const next = quantity > 0 ? { ...rest, quantity: Math.round(quantity) } : rest;
    const { meta: _m, ...base } = d;
    dispatch({ type: 'command', command: { type: 'catalog.define', definition: Object.keys(next).length > 0 ? { ...base, meta: next } : base } });
  };
  const removable = Object.values(project.items).filter((i) => !i.locked);
  const size = (v: number) => formatCentimetres(v);
  return (
    <>
      <div className="panel-scroll panel-pad">
        <div className="section-title">
          <span className="kicker">Container</span>
        </div>
        <div className="load-head">
          <div className="serif">{type?.label ?? 'Custom container'}</div>
          <div className="muted">
            Inside {size(project.space.boundary[2]!.x)} × {size(project.space.boundary[2]!.y)} × {size(project.space.ceilingHeight ?? 0)} cm · doors at the east end
          </div>
        </div>
        <div className="load-stats">
          <Stat label="Volume" value={formatPercent(m.volumeUse)} bar={m.volumeUse} testId="volume-use" />
          <Stat label="Payload" value={m.payloadUse === undefined ? '—' : formatPercent(m.payloadUse)} bar={m.payloadUse ?? 0} warn={(m.payloadUse ?? 0) > 1} testId="payload-use" />
          <Stat label="Floor" value={formatPercent(m.floorUse)} bar={m.floorUse} />
        </div>
        <div className="fact">
          <span>Payload limit</span>
          <span style={{ width: 110 }}>
            <CommitField
              label="t"
              ariaLabel="Payload limit in tonnes"
              unit=""
              digits={2}
              limit={1000}
              value={typeof meta.maxPayload === 'number' ? meta.maxPayload / 1_000_000 : 0}
              onCommit={(t) => {
                const { maxPayload: _old, ...rest } = project.space.meta ?? {};
                const next = t > 0 ? { ...rest, maxPayload: Math.round(t * 1_000_000) } : rest;
                const { meta: _m, ...space } = project.space;
                dispatch({ type: 'command', command: { type: 'space.set', space: Object.keys(next).length > 0 ? { ...space, meta: next } : space } });
              }}
            />
          </span>
        </div>
        <div className="fact">
          <span>Pieces loaded</span>
          <span data-testid="pieces">{formatCount(m.pieces)}</span>
        </div>
        <div className="fact">
          <span>Load mass</span>
          <span>{m.mass === undefined ? 'Unknown' : formatMass(m.mass)}</span>
        </div>
        <div className="fact">
          <span>Planned, not placed</span>
          <span data-testid="unpacked">{formatCount(m.unpacked)}</span>
        </div>

        <div className="section-gap" />
        <div className="section-title">
          <span className="kicker">Cargo plan</span>
        </div>
        <p className="muted" style={{ margin: '-4px 0 8px', fontSize: 12 }}>
          Set how many of each type to load, then find a plan.
        </p>
        {Object.values(project.catalog).map((d) => {
          const c = plan.get(d.id);
          return (
            <div key={d.id} className="cargo-row" data-cargo={d.id}>
              <span className="cargo-art">
                <TypeArt definition={d} box={34} />
              </span>
              <span className="cargo-text">
                <span className="cargo-name">{d.name}</span>
                <span className="faint">
                  {d.mass === undefined ? 'mass unknown' : formatMass(d.mass)} · {sizeLine(d).split(' · ')[0]}
                  {c ? ` · ${placed.get(d.id) ?? 0} of ${c.planned} placed` : placed.get(d.id) ? ` · ${placed.get(d.id)} placed` : ''}
                </span>
              </span>
              <span className="cargo-qty">
                <CommitField label="#" ariaLabel={`Quantity of ${d.name}`} unit="" digits={0} limit={10_000} value={cargoOf(d).quantity ?? 0} onCommit={(q) => setQuantity(d.id, Math.max(0, q))} />
              </span>
            </div>
          );
        })}

        <div className="section-gap" />
        <div className="section-title">
          <span className="kicker">Loading plans</span>
        </div>
        <button type="button" className="btn primary" style={{ width: '100%' }} onClick={() => setCandidates(extremePointPacker.propose(project, {}))} disabled={m.unpacked === 0} data-testid="find-plans">
          <Sparkle size={15} />
          {m.unpacked === 0 ? 'Nothing left to place' : `Find plans for ${formatCount(m.unpacked)} pieces`}
        </button>
        <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
          Deterministic heuristics propose candidates; you choose. Pieces already placed stay where they are.
        </p>
        {candidates?.map((c, i) => (
          <div key={c.label} className="candidate" data-candidate={i}>
            <div className="candidate-head">
              <span className="serif">{c.label}</span>
              {i === 0 && <span className="kicker" style={{ color: 'var(--accent)' }}>Fits most</span>}
            </div>
            <div className="candidate-stats">
              <span>
                <strong>{formatCount(c.metrics.placed ?? 0)}</strong> placed
              </span>
              <span>
                <strong>{formatCount(c.metrics.leftOver ?? 0)}</strong> left
              </span>
              <span>
                <strong>{formatPercent(c.metrics.volumeUse ?? 0)}</strong> volume
              </span>
              {c.metrics.balanceAlong !== undefined && (
                <span>
                  <strong>{Math.round(Math.max(c.metrics.balanceAlong, c.metrics.balanceAcross ?? 0))}%</strong> off centre
                </span>
              )}
            </div>
            <p className="muted" style={{ fontSize: 12 }}>
              {c.explanation}
            </p>
            <button
              type="button"
              className="btn small"
              disabled={c.commands.length === 0}
              onClick={() => {
                dispatch({ type: 'command', command: { type: 'batch', commands: c.commands } });
                setCandidates(null);
              }}
            >
              Apply this plan
            </button>
          </div>
        ))}
      </div>
      <div className="panel-foot nowrap">
        <span className="spacer faint" style={{ fontSize: 12 }}>
          {formatCount(Object.keys(project.items).length)} pieces loaded
        </span>
        <button
          type="button"
          className="btn danger"
          disabled={removable.length === 0}
          onClick={() => {
            if (window.confirm(`Take all ${removable.length} unlocked pieces out of the container? You can undo this.`)) {
              dispatch({ type: 'command', command: { type: 'batch', commands: removable.map((i): Command => ({ type: 'item.remove', id: i.id })) }, select: [] });
            }
          }}
        >
          <Trash size={14} />
          Unload all
        </button>
      </div>
    </>
  );
}

function Stat({ label, value, bar, warn = false, testId }: { label: string; value: string; bar: number; warn?: boolean; testId?: string }) {
  return (
    <div className="stat">
      <div className="stat-value" data-testid={testId}>
        {value}
      </div>
      <div className="stat-bar">
        <span style={{ width: `${Math.min(100, bar * 100)}%`, background: warn ? 'var(--error)' : 'var(--accent)' }} />
      </div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

/** The cargo section of the inspector for one piece: stop, loading step, orientation and loads. */
export function CargoGroup({ project, item, dispatch }: { project: Project; item: ItemInstance; dispatch: (a: Action) => void }) {
  const definition = project.catalog[item.definitionId]!;
  const spec = cargoOf(definition);
  const loads = useMemo(() => loadsOnTop(project), [project]);
  const load = loads?.get(item.id);
  const setMeta = (key: 'stop' | 'step', value: number) => {
    const { [key]: _old, ...rest } = item.meta ?? {};
    const next = value > 0 ? { ...rest, [key]: Math.round(value) } : rest;
    dispatch({ type: 'command', command: { type: 'item.meta', id: item.id, meta: Object.keys(next).length > 0 ? next : null } });
  };
  const tiltAllowed = spec.allowTilt !== false;
  return (
    <div className="insp-group" aria-label="Cargo">
      <div className="kicker">Cargo</div>
      <div className="grid-2">
        <CommitField label="Drop" wideKey ariaLabel="Unloading stop" unit="" digits={0} limit={999} value={stopOf(item, definition) ?? 0} onCommit={(v) => setMeta('stop', v)} />
        <CommitField label="Step" wideKey ariaLabel="Loading step" unit="" digits={0} limit={100_000} value={stepOf(item) ?? 0} onCommit={(v) => setMeta('step', v)} />
      </div>
      <div style={{ marginTop: 8 }}>
        <Segmented
          label="Orientation"
          value={item.tilt ?? 'up'}
          onChange={(v) => v !== (item.tilt ?? 'up') && dispatch({ type: 'command', command: { type: 'item.tilt', id: item.id, to: v === 'up' ? null : v } })}
          options={[
            { id: 'up', label: 'Upright' },
            { id: 'x', label: 'Width up', title: tiltAllowed ? 'Lay it on its side with its width standing up' : 'This type must stay upright' },
            { id: 'y', label: 'Depth up', title: tiltAllowed ? 'Lay it on its side with its depth standing up' : 'This type must stay upright' },
          ]}
        />
      </div>
      <button
        type="button"
        className="btn small"
        style={{ marginTop: 8 }}
        disabled={item.locked || dropHeight(project, item.id) === (item.elevation ?? 0)}
        onClick={() => dispatch({ type: 'command', command: { type: 'item.elevate', id: item.id, to: dropHeight(project, item.id) } })}
        title="Let it down onto the piece below, or onto the floor"
      >
        <ArrowLineDown size={14} />
        Settle onto the stack
      </button>
      <div className="facts" style={{ padding: '8px 0 0' }}>
        <div className="fact">
          <span>Mass</span>
          <span>{definition.mass === undefined ? 'Unknown' : formatMass(definition.mass)}</span>
        </div>
        <div className="fact">
          <span>Resting on it</span>
          <span data-testid="load-on-piece">{load === undefined ? 'Unknown' : formatMass(load)}</span>
        </div>
        <div className="fact">
          <span>Allowed on top</span>
          <span>{spec.stackable === false ? 'Nothing' : spec.maxLoadOnTop === undefined ? 'Not stated' : formatMass(spec.maxLoadOnTop)}</span>
        </div>
        <div className="fact">
          <span>May lie on its side</span>
          <span>{spec.allowTilt === undefined ? 'Not stated' : spec.allowTilt ? 'Yes' : 'No · this way up'}</span>
        </div>
        {spec.stackGroup && (
          <div className="fact">
            <span>Stacking group</span>
            <span>{spec.stackGroup}</span>
          </div>
        )}
      </div>
      <p className="hint">Drop = the customer delivery this piece belongs to; drop 1 is unloaded first. Step = the order it is loaded in. Height above the floor is set under Rotation & elevation.</p>
    </div>
  );
}

/** Facts about a container load for the inspector when nothing is selected. */
export function containerFacts(project: Project): Array<[string, string]> {
  const m = containerMetrics(project);
  const meta = project.space.meta ?? {};
  const type = containerType(typeof meta.containerType === 'string' ? meta.containerType : null);
  return [
    ['Container', type?.label ?? 'Custom'],
    ['Inside', `${formatCentimetres(project.space.boundary[2]!.x)} × ${formatCentimetres(project.space.boundary[2]!.y)} × ${formatCentimetres(project.space.ceilingHeight ?? 0)} cm`],
    ['Volume used', `${formatPercent(m.volumeUse)} of ${(m.volume / 1e12).toFixed(1)} m³`],
    ['Load mass', m.mass === undefined ? 'Unknown' : `${formatMass(m.mass)}${m.maxPayload ? ` of ${formatMass(m.maxPayload)}` : ''}`],
    ['Floor used', formatPercent(m.floorUse)],
    ['Centre of mass', m.balance ? `${m.balance.along.toFixed(1)}% along · ${m.balance.across.toFixed(1)}% across` : 'Unknown'],
    ['Pieces', `${formatCount(m.pieces)}${m.unpacked ? ` · ${formatCount(m.unpacked)} not placed` : ''}`],
    ['Delivery drops', m.stops.length ? m.stops.join(', ') : 'One drop'],
    ['Loading steps', m.steps ? formatCount(m.steps) : '—'],
  ];
}

/** One line under the colour choice: what the colours say and why it matters. */
const COLOR_BY_HINT: Readonly<Record<ColorBy, string>> = {
  type: 'Each kind of cargo has its own colour.',
  stop: 'Each customer drop has its own colour. Drop 1 is unloaded first, so it should sit nearest the doors.',
  weight: 'Darker blue is heavier. Heavy pieces belong low and near the middle.',
  step: 'The order pieces go in: pale first, dark last. Press play to watch the load.',
};

/** Colour-by, cutaway and load-sequence playback over the 3D view of a container. */
export function ContainerViewTools({
  project,
  colorBy,
  onColorBy,
  cutaway,
  onCutaway,
  step,
  onStep,
  legend,
}: {
  project: Project;
  colorBy: ColorBy;
  onColorBy: (c: ColorBy) => void;
  cutaway: boolean;
  onCutaway: (on: boolean) => void;
  /** Show pieces up to this loading step; null shows everything. */
  step: number | null;
  onStep: (step: number | null) => void;
  legend: ColorLegend['legend'];
}) {
  const steps = Object.values(project.items).reduce((m, i) => Math.max(m, stepOf(i) ?? 0), 0);
  // "Delivery drop" only means something on a multi-drop load; a single-drop container hides it.
  const hasDrops = Object.values(project.items).some((i) => project.catalog[i.definitionId] && stopOf(i, project.catalog[i.definitionId]!) !== undefined);
  const shown: ColorBy = colorBy === 'stop' && !hasDrops ? 'type' : colorBy;
  useEffect(() => {
    if (shown !== colorBy) onColorBy(shown);
  }, [shown, colorBy, onColorBy]);
  const [playing, setPlaying] = useState(false);
  // Playback: from empty, one loading step at a time, to fully loaded.
  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(
      () => {
        if (step === null) onStep(0);
        else if (step >= steps) {
          onStep(null);
          setPlaying(false);
        } else onStep(step + 1);
      },
      step === null ? 0 : 450,
    );
    return () => clearTimeout(timer);
  }, [playing, step, steps, onStep]);
  return (
    <div className="container-tools" aria-label="Container view">
      <Segmented
        label="Colour pieces by"
        className="compact"
        value={shown}
        onChange={onColorBy}
        options={[
          { id: 'type', label: 'Cargo type' },
          ...(hasDrops ? [{ id: 'stop' as const, label: 'Delivery drop' }] : []),
          { id: 'weight', label: 'Weight' },
          { id: 'step', label: 'Load order' },
        ]}
      />
      <p className="container-tools-hint" data-testid="color-by-hint">{COLOR_BY_HINT[shown]}</p>
      <label className="check-inline">
        <input type="checkbox" checked={cutaway} onChange={(e) => onCutaway(e.target.checked)} />
        Cut away side wall
      </label>
      {steps > 0 && (
        <div className="sequence">
          <button type="button" className="btn ghost icon" style={{ width: 28, height: 28 }} aria-label={playing ? 'Pause loading sequence' : 'Play loading sequence'} onClick={() => setPlaying((p) => !p)}>
            {playing ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <input type="range" min={0} max={steps} value={step ?? steps} aria-label="Loading step" onChange={(e) => onStep(Number(e.target.value) >= steps ? null : Number(e.target.value))} />
          <span className="num" data-testid="sequence-label">
            {step === null ? 'Fully loaded' : step === 0 ? 'Empty' : `Loading step ${step} of ${steps}`}
          </span>
        </div>
      )}
      <div className="legend-row">
        {legend.slice(0, 8).map((l) => (
          <span key={l.label}>
            <span className="swatch" style={{ background: hex(l.color) }} />
            {l.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Pieces hidden when the playback shows the load up to `step`; pieces without a step always show. */
export function hiddenAfter(project: Project, step: number | null): ReadonlySet<Id> {
  if (step === null) return new Set();
  return new Set(Object.values(project.items).filter((i) => (stepOf(i) ?? 0) > step).map((i) => i.id));
}
