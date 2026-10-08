import { FABRICS, furnishOptions, type FurnishOption } from '@space-planner/starter';
import type { Project } from '@space-planner/core';
import { Armchair, CaretDown, CaretRight, Check, Eye, SpinnerGap, Warning } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { formatCount, plural } from '../logic/format.js';
import type { Action } from '../logic/session.js';

const WOOD: Readonly<Record<string, string>> = { oak: '#c8a27a', walnut: '#6b4a33', white: '#f2efe9', black: '#2b2b2b' };
const RULE_WORDS: Readonly<Record<string, string>> = { walkway: 'a walkway', 'bed-access': 'bed access' };
const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/**
 * "Furnish" without any AI (decision 0029): the program's own layout engine proposes three
 * options, each a different arrangement in a different palette, with its reasons and its check
 * result. Preview shows one on the plan and in 3D; Apply makes it one step in the history.
 */
/** The last proposal per project, kept while the plan has not changed: leaving the panel and coming back does not lose it. */
const kept = new Map<string, { revision: number; list: FurnishOption[] }>();

export function FurnishOptions({ project, dispatch }: { project: Project; dispatch: (a: Action) => void }) {
  const [options, setOptionsState] = useState<{ revision: number; list: FurnishOption[] } | null>(() => {
    const hit = kept.get(project.id);
    return hit && hit.revision === project.revision ? hit : null;
  });
  const setOptions = (next: { revision: number; list: FurnishOption[] } | null) => {
    if (next) kept.set(project.id, next);
    else kept.delete(project.id);
    setOptionsState(next);
  };
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState<number | null>(null);
  const [open, setOpen] = useState<number | null>(0);
  const stale = options !== null && options.revision !== project.revision;

  // A preview never outlives the panel.
  useEffect(() => () => dispatch({ type: 'preview', command: null }), [dispatch]);

  const propose = () => {
    setBusy(true);
    setPreviewing(null);
    dispatch({ type: 'preview', command: null });
    // Let the button show that it is working before the engine runs.
    setTimeout(() => {
      setOptions({ revision: project.revision, list: furnishOptions(project) });
      setBusy(false);
      setOpen(0);
    }, 30);
  };

  const preview = (o: FurnishOption) => {
    if (previewing === o.index) {
      setPreviewing(null);
      dispatch({ type: 'preview', command: null });
    } else {
      setPreviewing(o.index);
      dispatch({ type: 'preview', command: o.command });
    }
  };

  const applyOption = (o: FurnishOption) => {
    dispatch({ type: 'preview', command: null });
    setPreviewing(null);
    dispatch({ type: 'command', command: o.command });
    setOptions(null);
  };

  return (
    <div className="furnish" aria-label="Furnish">
      <div className="section-title">
        <span className="kicker">Furnish</span>
      </div>
      <p className="muted">Three ways to furnish the flat, as a designer would propose them: different arrangements, different finishes, each checked.</p>
      <button type="button" className="btn primary furnish-go" disabled={busy} onClick={propose} data-testid="furnish-propose">
        {busy ? <SpinnerGap size={15} /> : <Armchair size={15} />}
        {busy ? 'Working out the options…' : options && !stale ? 'Propose again' : 'Propose three options'}
      </button>
      {stale && <p className="muted">The plan changed since these options were made; propose again to see fresh ones.</p>}
      {options && !stale && (
        <ul className="furnish-list">
          {options.list.map((o) => {
            const clean = o.errors === 0 && o.failedRules.length === 0 && o.unknownRules.length === 0;
            const expanded = open === o.index;
            return (
              <li key={o.index} className={`furnish-card${previewing === o.index ? ' on' : ''}`} data-option={o.index}>
                <button type="button" className="furnish-head" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : o.index)}>
                  <span className="swatches" aria-hidden="true">
                    <span style={{ background: hex(FABRICS[o.palette.fabric]) }} />
                    <span style={{ background: WOOD[o.palette.wood] ?? '#ccc' }} />
                    <span style={{ background: hex(FABRICS[o.palette.accent]) }} />
                  </span>
                  <span className="furnish-title">{o.title}</span>
                  {expanded ? <CaretDown size={13} /> : <CaretRight size={13} />}
                </button>
                <div className="furnish-facts">
                  {plural(o.pieces, 'piece')} · {plural(o.seats, 'seat')}
                  <span className={`chip ${clean ? 'ok' : 'warning'}`}>
                    {clean ? <Check size={11} /> : <Warning size={11} />}
                    {clean ? (o.warnings ? `Passes · ${formatCount(o.warnings)} tight` : 'Passes every check') : o.errors ? `${plural(o.errors, 'error')} to fix` : o.failedRules.length ? `Check: ${o.failedRules.map((r) => RULE_WORDS[r] ?? r).join(', ')}` : `${formatCount(o.unknownRules.length)} not checked`}
                  </span>
                </div>
                {expanded && (
                  <ul className="furnish-rooms">
                    {o.unknownRules.length > 0 && <li className="muted">Missing information to check: {o.unknownRules.map((r) => RULE_WORDS[r] ?? r).join(', ')}.</li>}
                    {o.rooms.map((r) => (
                      <li key={r.area}>
                        <strong>{r.area}</strong> · {r.arrangement}
                        <span className="muted">{r.reasons.slice(0, 2).join(' ')}</span>
                      </li>
                    ))}
                    {o.unfurnished.map((note) => (
                      <li key={note} className="muted">
                        Left empty · {note}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="furnish-actions">
                  <button type="button" className="btn small" aria-pressed={previewing === o.index} onClick={() => preview(o)} data-testid={`furnish-preview-${o.index}`}>
                    <Eye size={13} />
                    {previewing === o.index ? 'Hide' : 'Preview'}
                  </button>
                  <button type="button" className="btn small primary" onClick={() => applyOption(o)} data-testid={`furnish-apply-${o.index}`}>
                    Apply
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
