import { toUnit, wallFrame, type Command, type Id, type Project } from '@space-planner/core';
import { ArrowsLeftRight, Door, FrameCorners, Trash } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { formatCentimetres, formatMetres } from '../logic/format.js';
import type { Action } from '../logic/session.js';
import { addOpening, removeWallsAndOpenings, setWallLength, updateOpening, updateWall } from '../logic/walls.js';
import { CommitField, Segmented } from './Fields.js';
import { toTicks } from './units.js';

/**
 * Properties of a drawn wall, door or window (decision 0028): the numbers a designer reads off
 * the client's plan, typed straight in. Each change is one step in the history.
 */

const run = (dispatch: (a: Action) => void, command: Command | undefined, select?: readonly Id[]) => command && dispatch({ type: 'command', command, ...(select ? { select } : {}) });
const cm = (t: number) => toUnit(t, 'cm');

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="insp-group">
      <div className="kicker">{title}</div>
      {children}
      {hint ? <p className="hint">{hint}</p> : <div style={{ height: 14 }} />}
    </div>
  );
}

export function WallInspector({ project, id, dispatch }: { project: Project; id: Id; dispatch: (a: Action) => void }) {
  const wall = project.space.walls?.find((w) => w.id === id);
  if (!wall) return null;
  const length = wallFrame(wall).length;
  const openings = (project.space.openings ?? []).filter((o) => o.wall === id);
  // A new door or window goes in the middle of the wall.
  const middle = { x: (wall.a.x + wall.b.x) / 2, y: (wall.a.y + wall.b.y) / 2 };
  const add = (kind: 'door' | 'window') => {
    const added = addOpening(project, id, kind, middle);
    if (added) run(dispatch, added.command, [added.id]);
  };
  return (
    <div aria-label="Selected wall">
      <div className="insp-head">
        <div className="kicker">
          <span>Wall · {id}</span>
        </div>
        <h3>{formatMetres(Math.round(length))} m wall</h3>
        <p className="sub">
          {formatCentimetres(wall.thickness)} cm thick{openings.length ? ` · ${openings.length} ${openings.length === 1 ? 'opening' : 'openings'}` : ''}
        </p>
        <div className="icon-actions">
          <button type="button" title="Add a door" aria-label="Add a door" onClick={() => add('door')}>
            <Door size={16} />
          </button>
          <button type="button" title="Add a window" aria-label="Add a window" onClick={() => add('window')}>
            <FrameCorners size={16} />
          </button>
          <button type="button" title="Remove · Delete" aria-label="Remove wall" className="danger" onClick={() => run(dispatch, removeWallsAndOpenings(project, [id]), [])}>
            <Trash size={16} />
          </button>
        </div>
      </div>
      <Group title="Size" hint="Length along the centre line; the far end moves, and walls joined there follow.">
        <div className="grid-2">
          <CommitField label="L" ariaLabel="Wall length" unit="cm" value={cm(length)} onCommit={(v) => run(dispatch, setWallLength(project, id, toTicks(v)))} />
          <CommitField label="T" ariaLabel="Wall thickness" unit="cm" value={cm(wall.thickness)} onCommit={(v) => v > 0 && run(dispatch, updateWall(project, id, { thickness: toTicks(v) }))} />
        </div>
        <div className="grid-2" style={{ marginTop: 8 }}>
          <CommitField label="H" ariaLabel="Wall height" unit="cm" value={cm(wall.height ?? project.space.ceilingHeight ?? 0)} onCommit={(v) => run(dispatch, updateWall(project, id, { height: v > 0 ? toTicks(v) : null }))} />
        </div>
      </Group>
      {openings.length > 0 && (
        <Group title="In this wall">
          <ul className="opening-list">
            {openings.map((o) => (
              <li key={o.id}>
                <button type="button" className="link-btn" onClick={() => dispatch({ type: 'select', ids: [o.id] })}>
                  {o.kind === 'door' ? 'Door' : 'Window'} · {formatCentimetres(o.width)} cm, {formatMetres(o.offset)} m from the start
                </button>
              </li>
            ))}
          </ul>
        </Group>
      )}
    </div>
  );
}

export function OpeningInspector({ project, id, dispatch }: { project: Project; id: Id; dispatch: (a: Action) => void }) {
  const opening = project.space.openings?.find((o) => o.id === id);
  const wall = opening && project.space.walls?.find((w) => w.id === opening.wall);
  if (!opening || !wall) return null;
  const door = opening.kind === 'door';
  const length = wallFrame(wall).length;
  const set = (patch: Parameters<typeof updateOpening>[2]) => run(dispatch, updateOpening(project, id, patch));
  return (
    <div aria-label={door ? 'Selected door' : 'Selected window'}>
      <div className="insp-head">
        <div className="kicker">
          <span>
            {door ? 'Door' : 'Window'} · {id}
          </span>
        </div>
        <h3>
          {door ? 'Door' : 'Window'} · {formatCentimetres(opening.width)} cm
        </h3>
        <p className="sub">
          In wall {wall.id} · {formatMetres(Math.round(length))} m long
        </p>
        <div className="icon-actions">
          {door && (
            <button type="button" title="Flip the swing" aria-label="Flip the swing" onClick={() => set(opening.hinge ? { side: opening.side === 'left' ? 'right' : 'left' } : { hinge: 'start', side: 'left' })}>
              <ArrowsLeftRight size={16} />
            </button>
          )}
          <button type="button" title="Select its wall" aria-label="Select its wall" onClick={() => dispatch({ type: 'select', ids: [wall.id] })}>
            <FrameCorners size={16} />
          </button>
          <button type="button" title="Remove · Delete" aria-label={door ? 'Remove door' : 'Remove window'} className="danger" onClick={() => run(dispatch, removeWallsAndOpenings(project, [id]), [wall.id])}>
            <Trash size={16} />
          </button>
        </div>
      </div>
      <Group title="Place and size" hint="From the wall's start to the near edge of the opening.">
        <div className="grid-2">
          <CommitField label="W" ariaLabel="Opening width" unit="cm" value={cm(opening.width)} onCommit={(v) => v > 0 && set({ width: toTicks(v) })} />
          <CommitField label="⟷" ariaLabel="Distance from the wall start" unit="cm" value={cm(opening.offset)} onCommit={(v) => set({ offset: toTicks(v) })} />
        </div>
        <div className="grid-2" style={{ marginTop: 8 }}>
          <CommitField label="H" ariaLabel="Opening height" unit="cm" value={cm(opening.height ?? (door ? 21_000 : 12_000))} onCommit={(v) => v > 0 && set({ height: toTicks(v) })} />
          {!door && <CommitField label="S" ariaLabel="Sill height" unit="cm" value={cm(opening.sill ?? 9_000)} onCommit={(v) => v >= 0 && set({ sill: toTicks(v) })} />}
        </div>
      </Group>
      {door && (
        <Group title="Swing">
          <Segmented
            label="Hinge"
            value={opening.hinge ?? 'none'}
            options={[
              { id: 'start', label: 'At start', title: 'Hinged at the jamb nearer the wall start' },
              { id: 'end', label: 'At end', title: 'Hinged at the jamb nearer the wall end' },
              { id: 'none', label: 'Sliding', title: 'No swing: a sliding door or a plain opening' },
            ]}
            onChange={(hinge) => {
              if (hinge === 'none') {
                const { hinge: _h, side: _s, ...rest } = opening;
                const command: Command = { type: 'space.set', space: { ...project.space, openings: project.space.openings!.map((o) => (o.id === id ? rest : o)) } };
                run(dispatch, command);
              } else set({ hinge, side: opening.side ?? 'left' });
            }}
          />
        </Group>
      )}
    </div>
  );
}
