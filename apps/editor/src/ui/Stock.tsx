import { type Id, type ItemInstance, type Project } from '@space-planner/core';
import { materialOf, materialsOf, moveStockCommands, optimizeSlotting, parseSlot, rackSpecOf, rackStock, slotId, stockCommands, stockMetrics, type Candidate, type Material, type Slot } from '@space-planner/starter';
import { MagnifyingGlass, Sparkle, X } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { formatCount, formatMass } from '../logic/format.js';
import type { Action } from '../logic/session.js';
import { toBatch } from '../logic/transform.js';
import { hex } from './Container.js';
import { Segmented } from './Fields.js';

export type StockColorBy = 'material' | 'velocity';

/** How stock is shown: coloured by material or by ABC speed, one material picked out, one location selected. */
export interface StockView {
  readonly colorBy: StockColorBy;
  readonly find: Id | null;
  readonly slot: string | null;
}

const VELOCITY_COLOR = { A: 0x3f8f5a, B: 0xd9a03a, C: 0x98a0ab } as const;
const VELOCITY_WORD = { A: 'Fast (A)', B: 'Medium (B)', C: 'Slow (C)' } as const;
const FALLBACK = 0xb3b9c3;

/** The colour a stored pallet of this material is drawn in. */
export function stockColor(material: Material | undefined, by: StockColorBy): number {
  if (!material) return FALLBACK;
  if (by === 'velocity') return material.velocity ? VELOCITY_COLOR[material.velocity] : FALLBACK;
  return material.color ?? FALLBACK;
}

const run = (dispatch: (a: Action) => void, commands: Parameters<typeof toBatch>[0], select?: readonly Id[]) => {
  const command = toBatch(commands);
  if (command) dispatch({ type: 'command', command, ...(select ? { select } : {}) });
};

/** Stock on hand, the material finder and the slotting optimiser, in the warehouse panel. */
export function StockSection({ project, view, onView, dispatch }: { project: Project; view: StockView; onView: (v: StockView) => void; dispatch: (a: Action) => void }) {
  const metrics = useMemo(() => stockMetrics(project), [project]);
  const [proposal, setProposal] = useState<Candidate | null>(null);
  const [busy, setBusy] = useState(false);
  if (materialsOf(project).length === 0) return null;
  const optimise = () => {
    setBusy(true);
    // Let the button show its busy state before the calculation takes the thread.
    setTimeout(() => {
      setProposal(optimizeSlotting(project));
      setBusy(false);
    }, 20);
  };
  const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
  return (
    <div className="stock-section" data-testid="stock-section">
      <div className="kicker">Stock on hand</div>
      <div className="warehouse-big" data-testid="stock-occupied">{formatCount(metrics.occupied)} <small>of {formatCount(metrics.positions)} locations · {Math.round(metrics.occupancy * 100)}%</small></div>
      <div className="meter" aria-hidden="true"><span style={{ width: `${Math.min(100, metrics.occupancy * 100)}%` }} /></div>
      <div className="facts">
        <div className="fact"><span>Units on hand</span><span>{formatCount(metrics.units)}</span></div>
        {metrics.mass !== undefined && <div className="fact"><span>Weight on racks</span><span>{formatMass(metrics.mass)}</span></div>}
        <div className="fact"><span>Fast · medium · slow pallets</span><span>{metrics.byVelocity.A} · {metrics.byVelocity.B} · {metrics.byVelocity.C}</span></div>
      </div>

      <div className="stock-optimise">
        <button className="btn primary" type="button" onClick={optimise} disabled={busy} data-testid="optimise-slotting">
          <Sparkle size={15} />
          {busy ? 'Working it out…' : 'Optimise slotting'}
        </button>
        {proposal && (
          <div className="stock-proposal" role="status" data-testid="slotting-proposal">
            {proposal.metrics.travelBefore !== undefined && proposal.metrics.travelAfter !== undefined ? (
              <>
                <div className="stock-saving">−{proposal.metrics.saving ?? 0}%<small> forklift travel</small></div>
                <p className="sub">{km(proposal.metrics.travelBefore)} → {km(proposal.metrics.travelAfter)} a week · {formatCount(proposal.metrics.moved ?? 0)} pallets move</p>
              </>
            ) : <p className="sub">Travel cannot be measured: every material needs moves per week, and the shipping dock must reach the racks.</p>}
            <p className="hint">{proposal.explanation}</p>
            <div className="stock-proposal-actions">
              <button className="btn primary" type="button" disabled={proposal.commands.length === 0} onClick={() => { run(dispatch, proposal.commands); setProposal(null); }}>Apply</button>
              <button className="btn ghost" type="button" onClick={() => setProposal(null)}>Discard</button>
            </div>
          </div>
        )}
      </div>

      <div className="stock-head">
        <div className="kicker">Materials</div>
        <Segmented label="Colour stock by" value={view.colorBy} onChange={(colorBy) => onView({ ...view, colorBy })} options={[{ id: 'material', label: 'Material' }, { id: 'velocity', label: 'Speed' }]} />
      </div>
      {view.colorBy === 'velocity' && (
        <div className="legend-row" style={{ margin: '4px 0 8px' }}>{(['A', 'B', 'C'] as const).map((v) => <span key={v}><span className="swatch" style={{ background: hex(VELOCITY_COLOR[v]) }} />{VELOCITY_WORD[v]}</span>)}</div>
      )}
      <ul className="stock-list" aria-label="Materials in stock">
        {[...metrics.byMaterial].sort((a, b) => b.pallets - a.pallets || (a.material.id < b.material.id ? -1 : 1)).map(({ material, pallets, units }) => {
          const on = view.find === material.id;
          return (
            <li key={material.id}>
              <button type="button" className={`stock-row${on ? ' on' : ''}`} aria-pressed={on} title={on ? 'Show all stock' : 'Find this material in the racks'} onClick={() => onView({ ...view, find: on ? null : material.id })}>
                <span className="swatch" style={{ background: hex(stockColor(material, view.colorBy)) }} />
                <span className="stock-name"><span>{material.name}</span><small>{material.line ?? material.sku}{material.velocity ? ` · ${material.velocity}` : ''}</small></span>
                <span className="stock-count">{pallets}<small> plt · {formatCount(units)}</small></span>
                {on ? <X size={13} /> : <MagnifyingGlass size={13} />}
              </button>
            </li>
          );
        })}
      </ul>
      {view.find && <p className="hint">Showing only {project.catalog[view.find]?.name}. Click it again to show all stock.</p>}
    </div>
  );
}

/**
 * The rack row seen from the front: one cell per pallet location, top level first. Click a cell
 * to select it, drag it onto another to move (or swap) the pallet, pick a material to fill it.
 */
export function RackLocations({ project, item, view, onView, dispatch }: { project: Project; item: ItemInstance; view: StockView; onView: (v: StockView) => void; dispatch: (a: Action) => void }) {
  const spec = rackSpecOf(project.catalog[item.definitionId]);
  const stock = useMemo(() => rackStock(project, item.id), [project, item.id]);
  const materials = useMemo(() => materialsOf(project), [project]);
  const [dragFrom, setDragFrom] = useState<Slot | null>(null);
  const [problem, setProblem] = useState('');
  if (!spec || !stock || materials.length === 0) return null;
  const blocked = new Set(typeof item.meta?.blockedPositions === 'string' ? item.meta.blockedPositions.split(',').map((s) => `${item.id}-${s.trim()}`) : []);
  const selected = view.slot && view.slot.startsWith(`${item.id}-B`) ? parseSlot(view.slot) : null;
  const selectedMaterial = selected ? stock[selected.bay - 1]?.[selected.level - 1]?.[selected.position - 1] ?? '' : '';
  const apply = (result: ReturnType<typeof stockCommands>) => {
    if (!result.ok) {
      setProblem(result.problem === 'too-long' ? 'This bay holds too many different materials to store; use shorter material ids.' : 'That location cannot hold this material.');
      return;
    }
    setProblem('');
    run(dispatch, result.commands, [item.id]);
  };
  const occupied = stock.flat(2).filter(Boolean).length;
  const total = spec.bays * spec.levels * spec.positionsPerLevel;
  const levels = Array.from({ length: spec.levels }, (_, k) => spec.levels - k);
  return (
    <div className="insp-group" data-testid="rack-locations">
      <div className="kicker">Pallet locations · {occupied} of {total} full</div>
      <div className="rack-grid" style={{ gridTemplateColumns: `22px repeat(${spec.bays}, minmax(0, 1fr))` }}>
        {levels.map((level) => (
          <div key={level} style={{ display: 'contents' }}>
            <span className="rack-level">L{level}</span>
            {Array.from({ length: spec.bays }, (_, b) => (
              <span key={b} className="rack-bay">
                {Array.from({ length: spec.positionsPerLevel }, (_, p) => {
                  const slot = { rackId: item.id, bay: b + 1, level, position: p + 1 };
                  const id = slotId(slot);
                  const material = stock[b]![level - 1]![p]!;
                  const info = material ? materialOf(project.catalog[material]) : undefined;
                  const isBlocked = blocked.has(id);
                  const dim = view.find !== null && material !== view.find;
                  return (
                    <button
                      key={p}
                      type="button"
                      className={`rack-cell${material ? ' full' : ''}${isBlocked ? ' blocked' : ''}${view.slot === id ? ' selected' : ''}${dim ? ' dim' : ''}`}
                      style={material ? { background: hex(stockColor(info, view.colorBy)) } : undefined}
                      title={`${id}${material ? ` · ${info?.name ?? material}` : isBlocked ? ' · blocked' : ' · empty'}`}
                      aria-label={`Location ${id}${material ? `, ${info?.name ?? material}` : ', empty'}`}
                      draggable={!!material}
                      onClick={() => onView({ ...view, slot: view.slot === id ? null : id })}
                      onDragStart={(e) => { setDragFrom(slot); e.dataTransfer.effectAllowed = 'move'; }}
                      onDragOver={(e) => { if (dragFrom && !isBlocked) e.preventDefault(); }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (dragFrom && slotId(dragFrom) !== id) {
                          apply(moveStockCommands(project, dragFrom, slot));
                          onView({ ...view, slot: id });
                        }
                        setDragFrom(null);
                      }}
                      onDragEnd={() => setDragFrom(null)}
                    />
                  );
                })}
              </span>
            ))}
          </div>
        ))}
        <span />
        {Array.from({ length: spec.bays }, (_, b) => <span key={b} className="rack-bay-label">B{b + 1}</span>)}
      </div>
      {selected ? (
        <div className="rack-slot">
          <div className="fact"><span>Location</span><span data-testid="selected-slot">{view.slot}</span></div>
          <label className="stack" style={{ marginTop: 8 }}>Material
            <select className="input" aria-label="Material in this location" value={selectedMaterial} disabled={blocked.has(view.slot!) && !selectedMaterial}
              onChange={(e) => apply(stockCommands(project, [{ ...selected, material: e.target.value || null }]))}>
              <option value="">Empty</option>
              {materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          {blocked.has(view.slot!) && <p className="hint">This location is marked blocked (for example a damaged beam).</p>}
        </div>
      ) : <p className="hint">Click a location to see or change what it holds; drag a pallet onto another location to move it.</p>}
      {problem && <p className="error-text" role="alert">{problem}</p>}
    </div>
  );
}
