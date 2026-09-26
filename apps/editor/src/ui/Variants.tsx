import type { Project } from '@space-planner/core';
import { ArrowSquareOut, Check, GitFork, Plus, X } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { api, type VariantRow } from '../api.js';
import { formatCount, formatLength, formatMass, formatPercent, formatSquareMetres } from '../logic/format.js';
import { Dialog } from './Fields.js';

type Figure = VariantRow['figures'][number];

function figureText(f: Figure): string {
  if (f.value === undefined) return '—';
  switch (f.unit) {
    case 'percent':
      return formatPercent(f.value);
    case 'square-metres':
      return formatSquareMetres(f.value);
    case 'grams':
      return formatMass(f.value);
    case 'ticks':
      return formatLength(f.value);
    default:
      return formatCount(f.value);
  }
}

/** The index of the best value in a row, when the row has a better direction and a clear winner. */
function bestOf(values: ReadonlyArray<number | undefined>, better: 'higher' | 'lower' | undefined): number {
  if (!better) return -1;
  let best = -1;
  values.forEach((v, i) => {
    if (v === undefined) return;
    if (best < 0 || (better === 'higher' ? v > values[best]! : v < values[best]!)) best = i;
  });
  return best >= 0 && values.filter((v) => v === values[best]).length === 1 ? best : -1;
}

/**
 * The project and its variants side by side: issues, rules and the figures that matter for this
 * kind of space. A variant is adopted into the base as one revision of the base; nothing is lost.
 */
export function VariantsDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const [rows, setRows] = useState<VariantRow[] | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void api.variants(project.id).then(setRows).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [project.id, project.revision]);

  const create = async () => {
    setBusy(true);
    try {
      const made = await api.createVariant(project.id, name.trim() || `${project.name} · variant ${rows ? rows.length : 1}`);
      window.location.hash = `#/p/${made.id}`;
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  const adopt = async (row: VariantRow) => {
    const base = rows?.find((r) => r.base);
    if (!window.confirm(`Make “${base?.project.name ?? 'the base'}” look like “${row.project.name}”? It becomes a new revision of the base, so it can be undone from its history.`)) return;
    setBusy(true);
    try {
      const adopted = await api.adopt(row.project.id);
      window.location.hash = `#/p/${adopted.id}`;
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const figureRows = rows?.[0]?.figures.map((f, k) => ({ label: f.label, better: f.better, cells: rows.map((r) => r.figures[k]) })) ?? [];
  const counts: Array<{ label: string; key: 'errors' | 'warnings' | 'rulesFailed' | 'rulesUnknown' }> = [
    { label: 'Errors', key: 'errors' },
    { label: 'Warnings', key: 'warnings' },
    { label: 'Rules not met', key: 'rulesFailed' },
    { label: 'Rules unknown', key: 'rulesUnknown' },
  ];
  return (
    <Dialog label="Variants" onClose={onClose} className="dialog variants-dialog">
      <div className="variants-head">
        <GitFork size={18} />
        <h2 className="serif">Variants</h2>
        <span className="spacer" />
        <button type="button" className="btn ghost icon" aria-label="Close" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      <p className="muted" style={{ margin: '0 0 12px' }}>
        Try ideas in variants without touching the approved plan. Compare them here and adopt the one you choose.
      </p>
      {error && <p className="error-text">{error}</p>}
      {!rows ? (
        <p className="muted">Measuring…</p>
      ) : (
        <div className="variants-scroll">
          <table className="variants-table" data-testid="variants-table">
            <thead>
              <tr>
                <th />
                {rows.map((r) => (
                  <th key={r.project.id} data-variant={r.project.id} className={r.project.id === project.id ? 'current' : ''}>
                    <span className="kicker">{r.base ? 'Approved plan' : 'Variant'}</span>
                    <span className="name">{r.project.name}</span>
                    <span className="faint">Revision {r.project.revision}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {figureRows.map((row) => {
                const best = bestOf(row.cells.map((c) => c?.value), row.better);
                return (
                  <tr key={row.label}>
                    <th>{row.label}</th>
                    {row.cells.map((c, i) => (
                      <td key={i} className={`num${i === best ? ' best' : ''}`}>
                        {c ? figureText(c) : '—'}
                        {i === best && <Check size={12} />}
                      </td>
                    ))}
                  </tr>
                );
              })}
              {counts.map(({ label, key }) => (
                <tr key={key} className="count-row">
                  <th>{label}</th>
                  {rows.map((r) => (
                    <td key={r.project.id} className={`num${r[key] > 0 && key !== 'rulesUnknown' ? ' bad' : ''}`}>
                      {formatCount(r[key])}
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <th />
                {rows.map((r) => (
                  <td key={r.project.id}>
                    <div className="actions">
                      {r.project.id !== project.id && (
                        <a className="btn small" href={`#/p/${r.project.id}`} onClick={onClose}>
                          <ArrowSquareOut size={13} />
                          Open
                        </a>
                      )}
                      {!r.base && (
                        <button type="button" className="btn small primary" disabled={busy} onClick={() => void adopt(r)} data-testid={`adopt-${r.project.id}`}>
                          Adopt
                        </button>
                      )}
                    </div>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <form
        className="variant-new"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <input className="input" name="variant-name" aria-label="Variant name" placeholder="Name the idea, e.g. Reach truck, 3 m aisles" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit" className="btn" disabled={busy} data-testid="new-variant">
          <Plus size={14} />
          New variant from this plan
        </button>
      </form>
    </Dialog>
  );
}
