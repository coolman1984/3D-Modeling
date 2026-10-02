import { fromUnit } from '@space-planner/core';
import { CONTAINER_TYPES, planShipment, type ShipmentPart } from '@space-planner/starter';
import { ClipboardText, Plus, SpinnerGap, Trash, XCircle } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { api } from '../api.js';
import { formatCount } from '../logic/format.js';
import { parsePastedPlan, rowsForColumn, type PartRow } from '../logic/shipment.js';
import { Dialog } from './Fields.js';

const EMPTY: PartRow = { name: '', length: 0, width: 0, height: 0, quantity: 0, mayTilt: true };
const mm = (v: number) => fromUnit(v / 10, 'cm');
const sound = (r: PartRow) => r.length > 0 && r.width > 0 && r.height > 0 && r.quantity >= 0 && r.length <= 20_000 && r.width <= 20_000 && r.height <= 20_000;

/**
 * Plan a shipment: parts with their sizes and quantities (typed, or pasted from the production
 * plan) and a container type. The answer (how many containers) shows while typing; creating
 * stores one loaded container per container and opens them side by side.
 */
export function ShipmentDialog({ onClose, opened }: { onClose: () => void; opened: (shipment: string) => void }) {
  const [name, setName] = useState('');
  const [typeId, setTypeId] = useState('40hc');
  const [rows, setRows] = useState<PartRow[]>([{ ...EMPTY }]);
  const [paste, setPaste] = useState('');
  // The plan columns (days) of a pasted production plan, and the one the quantities come from.
  const [columns, setColumns] = useState<readonly string[]>([]);
  const [column, setColumn] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const used = useMemo(() => rows.filter((r) => r.name.trim() || r.length || r.width || r.height || r.quantity), [rows]);
  const valid = used.length > 0 && used.every(sound) && used.some((r) => r.quantity > 0);
  // The same loader the server runs, so the answer here is the one that gets created.
  const preview = useMemo(() => {
    if (!valid) return null;
    const parts: ShipmentPart[] = used.map((r, i) => ({ id: `p${i}`, name: r.name, length: mm(r.length), width: mm(r.width), height: mm(r.height), quantity: Math.round(r.quantity), allowTilt: r.mayTilt, ...(r.model ? { model: r.model } : {}), ...(r.massKg ? { mass: Math.round(r.massKg * 1000) } : {}), ...(r.maxLayers ? { maxLayers: r.maxLayers } : {}) }));
    return planShipment({ name: 'preview', containerType: typeId, parts });
  }, [valid, used, typeId]);

  const set = (i: number, patch: Partial<PartRow>) => setRows((all) => all.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const readPaste = () => {
    const parsed = parsePastedPlan(paste);
    if (parsed.rows.length === 0) {
      setError('No rows with three sizes were found in the pasted text.');
      return;
    }
    setError(null);
    // Start from the first day that has anything to ship.
    const first = Math.max(0, parsed.columns.findIndex((_, k) => parsed.rows.some((r) => (r.plan?.[k] ?? 0) > 0)));
    setColumns(parsed.columns);
    setColumn(first);
    setRows(rowsForColumn(parsed.rows, first));
    setPaste('');
  };
  const create = async () => {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.createShipment({
        name: name.trim() || defaultName,
        container_type: typeId,
        parts: used.map((r, i) => ({ name: r.name.trim() || `Part ${i + 1}`, length_mm: r.length, width_mm: r.width, height_mm: r.height, quantity: Math.round(r.quantity), may_tilt: r.mayTilt, ...(r.model ? { model: r.model } : {}), ...(r.massKg ? { mass_kg: r.massKg } : {}), ...(r.maxLayers ? { max_layers: r.maxLayers } : {}) })),
      });
      opened(created.shipment);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  const num = (v: number) => (v ? String(v) : '');
  const type = CONTAINER_TYPES.find((t) => t.id === typeId)!;
  const defaultName = columns.length > 1 ? `Shipment ${columns[column]}` : 'Shipment';

  return (
    <Dialog label="Plan a shipment" onClose={onClose} className="dialog shipment-dialog">
      <div className="dialog-head">
        <div className="kicker">New shipment</div>
        <h3>How many containers?</h3>
        <p className="muted" style={{ marginTop: 6, fontSize: 13 }}>
          List the parts with their sizes and quantities. Each container is loaded wall by wall, from the front wall to the doors; pieces stand at most 3 on each other unless you say more, so nothing at the bottom is crushed.
        </p>
      </div>
      <div className="dialog-body">
        <div className="grid-2">
          <label className="stack">
            Shipment name
            <input className="input" name="shipment-name" autoFocus placeholder={columns.length > 1 ? defaultName : 'Cushions 05/Oct'} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="stack">
            Container type
            <select className="input" name="shipment-container" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
              {CONTAINER_TYPES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label} · {(c.length / 100).toFixed(0)} × {(c.width / 100).toFixed(0)} × {(c.height / 100).toFixed(0)} cm
                </option>
              ))}
            </select>
          </label>
        </div>

        <details className="paste-box">
          <summary>
            <ClipboardText size={15} />
            Paste rows from a spreadsheet
          </summary>
          <textarea className="input" name="shipment-paste" rows={4} placeholder={'Name    L    W    H    Quantity\nTV55B Cushion Top    1335    110    400    1750'} value={paste} onChange={(e) => setPaste(e.target.value)} />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span className="spacer faint" style={{ fontSize: 12 }}>
              The words before the first number are the name; then L, W, H in mm and the quantity.
            </span>
            <button type="button" className="btn small" disabled={!paste.trim()} onClick={readPaste} data-testid="read-paste">
              Use these rows
            </button>
          </div>
        </details>

        {columns.length > 1 && (
          <label className="stack" style={{ maxWidth: 260 }}>
            Quantities from
            <select
              className="input"
              name="shipment-column"
              value={column}
              onChange={(e) => {
                const k = Number(e.target.value);
                setColumn(k);
                setRows((all) => rowsForColumn(all, k));
              }}
            >
              {columns.map((c, k) => (
                <option key={k} value={k}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        )}

        <table className="parts-table">
          <thead>
            <tr>
              <th>Part</th>
              <th className="num">L mm</th>
              <th className="num">W mm</th>
              <th className="num">H mm</th>
              <th className="num">Quantity</th>
              <th className="num" title="Weight of one piece: heavy cargo fills a container by weight before space">kg each</th>
              <th className="num" title="Most pieces standing on each other, the bottom one included. Empty = 3, so nothing at the foot is crushed">Layers</th>
              <th title="May lie on its side">On side</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} data-part-row={i}>
                <td>
                  <input className="input" aria-label={`Part ${i + 1} name`} value={r.name} placeholder="Part name" onChange={(e) => set(i, { name: e.target.value })} />
                </td>
                {(['length', 'width', 'height', 'quantity'] as const).map((key) => (
                  <td key={key}>
                    <input
                      className={`input num${used.includes(r) && !sound(r) && key !== 'quantity' && !(r[key] > 0) ? ' invalid' : ''}`}
                      inputMode="numeric"
                      aria-label={`Part ${i + 1} ${key}`}
                      value={num(r[key])}
                      onChange={(e) => set(i, { [key]: Math.max(0, Number(e.target.value.replace(/[^\d.]/g, '')) || 0) })}
                    />
                  </td>
                ))}
                <td>
                  <input className="input num" inputMode="decimal" aria-label={`Part ${i + 1} kg each`} placeholder="—" value={r.massKg ? String(r.massKg) : ''} onChange={(e) => set(i, { massKg: Math.max(0, Number(e.target.value.replace(/[^\d.]/g, '')) || 0) || undefined })} />
                </td>
                <td>
                  <input className="input num" inputMode="numeric" aria-label={`Part ${i + 1} layers`} placeholder="3" value={r.maxLayers ? String(r.maxLayers) : ''} onChange={(e) => set(i, { maxLayers: Math.min(50, Math.max(0, Math.floor(Number(e.target.value.replace(/[^\d]/g, '')) || 0))) || undefined })} />
                </td>
                <td style={{ textAlign: 'center' }}>
                  <input type="checkbox" aria-label={`Part ${i + 1} may lie on its side`} checked={r.mayTilt} onChange={(e) => set(i, { mayTilt: e.target.checked })} />
                </td>
                <td>
                  <button type="button" className="btn ghost icon" aria-label={`Remove part ${i + 1}`} disabled={rows.length === 1} onClick={() => setRows((all) => all.filter((_, k) => k !== i))}>
                    <Trash size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div>
          <button type="button" className="btn small" onClick={() => setRows((all) => [...all, { ...EMPTY }])}>
            <Plus size={13} />
            Add part
          </button>
        </div>

        <div className="shipment-answer" data-testid="shipment-answer" aria-live="polite">
          {preview && preview.containers.length > 0 ? (
            <>
              <div className="shipment-answer-count">
                <span className="big">{preview.containers.length}</span>
                <span>
                  × {type.label}
                  <span className="faint" style={{ display: 'block', fontSize: 12 }}>
                    {formatCount(preview.containers.reduce((s, c) => s + Object.values(c.pieces).reduce((a, b) => a + b, 0), 0))} pieces · last container {Math.round((preview.containers.at(-1)!.usedLength / type.length) * 100)}% full along its length
                  </span>
                </span>
              </div>
              {preview.tooBig.length > 0 && (
                <p className="error-text" style={{ fontSize: 12 }}>
                  <XCircle size={13} /> Too big for this container: {preview.tooBig.map((id) => used[Number(id.slice(1))]?.name || id).join(', ')}
                </p>
              )}
            </>
          ) : (
            <span className="faint">Enter sizes and at least one quantity to see how many containers are needed.</span>
          )}
        </div>
        {error && (
          <p className="error-text" role="alert" style={{ fontSize: 12 }}>
            {error}
          </p>
        )}
      </div>
      <div className="dialog-foot">
        <span className="spacer faint" style={{ fontSize: 12 }}>
          Creates one loaded container project per container
        </span>
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn primary" disabled={!valid || busy || (preview?.containers.length ?? 0) === 0} onClick={() => void create()} data-testid="create-shipment">
          {busy && <SpinnerGap size={16} />}
          {busy ? 'Loading containers…' : 'Create and view side by side'}
        </button>
      </div>
    </Dialog>
  );
}
