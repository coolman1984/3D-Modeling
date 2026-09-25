import { area, fromUnit, toSquareMetres, type Project, type Space, type Zone } from '@space-planner/core';
import { rectZone } from '@space-planner/starter';
import { Plus, Trash } from '@phosphor-icons/react';
import { useState } from 'react';
import { formatSquareMetres } from '../logic/format.js';
import { nextId } from '../logic/ids.js';
import type { Action } from '../logic/session.js';
import { takenIds } from '../logic/transform.js';
import { NumberField, Segmented } from './Fields.js';

const m = (v: number) => fromUnit(v, 'm');

export function spaceWithZones(space: Space, zones: readonly Zone[]): Space {
  const { zones: _old, ...rest } = space;
  return zones.length > 0 ? { ...rest, zones } : rest;
}

/**
 * The zones of a space with the kinds a pack gives meaning to: list, remove, and add rectangles.
 * Each change is one `space.set`, one step in the history. Zones of other kinds are listed too.
 */
export function ZonesSection({
  project,
  dispatch,
  kinds,
  initialKind,
  hint,
  initial = { x: 2, y: 2, w: 6, d: 4 },
}: {
  project: Project;
  dispatch: (a: Action) => void;
  kinds: ReadonlyArray<{ readonly id: string; readonly label: string }>;
  initialKind: string;
  hint?: string;
  initial?: { x: number; y: number; w: number; d: number };
}) {
  const [kind, setKind] = useState(initialKind);
  const [zone, setZone] = useState<{ x: number | undefined; y: number | undefined; w: number | undefined; d: number | undefined }>(initial);
  const zones = project.space.zones ?? [];
  const label = (k: string) => kinds.find((x) => x.id === k)?.label ?? k;
  const ready = zone.x !== undefined && zone.y !== undefined && zone.w !== undefined && zone.d !== undefined && zone.w > 0 && zone.d > 0;
  const add = () => {
    if (!ready) return;
    const id = nextId(kind, takenIds(project));
    const count = zones.filter((z) => z.kind === kind).length + 1;
    const added = rectZone(id, kind, `${label(kind)} ${count}`, m(zone.x!), m(zone.y!), m(zone.w!), m(zone.d!));
    dispatch({ type: 'command', command: { type: 'space.set', space: spaceWithZones(project.space, [...zones, added]) } });
  };
  return (
    <>
      <div className="section-title">
        <span className="kicker">Zones</span>
      </div>
      {zones.length === 0 && <p className="muted">No zones yet.</p>}
      {zones.map((z) => (
        <div key={z.id} className="zone-row" data-zone-row={z.id}>
          <span className={`swatch ${z.kind}`} />
          <span>
            {z.name ?? z.id}
            <span className="faint"> · {label(z.kind)}</span>
          </span>
          <span className="faint num">{formatSquareMetres(toSquareMetres(area(z.polygon)))}</span>
          <button
            type="button"
            className="btn ghost icon"
            style={{ width: 26, height: 26 }}
            title={`Remove ${z.name ?? z.id}`}
            aria-label={`Remove ${z.name ?? z.id}`}
            onClick={() => dispatch({ type: 'command', command: { type: 'space.set', space: spaceWithZones(project.space, zones.filter((o) => o.id !== z.id)) } })}
          >
            <Trash size={14} />
          </button>
        </div>
      ))}
      <div style={{ marginTop: 10 }}>
        <Segmented label="Zone kind" value={kind} onChange={setKind} options={kinds.map((k) => ({ id: k.id, label: k.label }))} />
      </div>
      <div className="form-grid" style={{ marginTop: 8 }}>
        <NumberField label="X" ariaLabel="Zone x" value={zone.x} unit="m" min={-1000} max={1000} onChange={(v) => setZone({ ...zone, x: v })} />
        <NumberField label="Y" ariaLabel="Zone y" value={zone.y} unit="m" min={-1000} max={1000} onChange={(v) => setZone({ ...zone, y: v })} />
        <NumberField label="W" ariaLabel="Zone width" value={zone.w} unit="m" min={0.1} max={1000} onChange={(v) => setZone({ ...zone, w: v })} />
        <NumberField label="D" ariaLabel="Zone depth" value={zone.d} unit="m" min={0.1} max={1000} onChange={(v) => setZone({ ...zone, d: v })} />
      </div>
      <button type="button" className="btn" style={{ width: '100%' }} disabled={!ready} onClick={add} data-testid="add-zone">
        <Plus size={15} />
        Add {label(kind).toLowerCase()} zone
      </button>
      {hint && (
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          {hint}
        </p>
      )}
    </>
  );
}
