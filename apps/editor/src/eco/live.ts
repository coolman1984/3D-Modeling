import type { Project } from '@space-planner/core';
import { ecoTagOf, type PlantTree } from '@space-planner/starter';

/**
 * The live plant view (plan 40-SPACE-PLANNER WP-S3): the BROWSER opens GMES's event stream, so no plant data passes through
 * or is stored by the planner's server; the state lives in this page only and is gone when it closes. This file is the pure
 * part: what the events mean and how a station is coloured. An unknown state from GMES is ignored, never invented as "running".
 */

export type StationState = 'running' | 'stopped' | 'held' | 'starved';
export const STATION_STATES: readonly StationState[] = ['running', 'stopped', 'held', 'starved'];

export interface StationLive { readonly state: StationState; readonly since?: string; readonly reason?: string }
export interface LineOutput { readonly good: number; readonly scrap: number; readonly day: string }

export interface LiveView {
  /** off: not asked for; connecting: opening; live: events are arriving; lost: the connection dropped (the last figures stay, marked old). */
  readonly status: 'off' | 'connecting' | 'live' | 'lost';
  /** By station code. */
  readonly stations: Readonly<Record<string, StationLive>>;
  /** By line code. */
  readonly output: Readonly<Record<string, LineOutput>>;
  /** ISO time of the last event that changed something, or null. */
  readonly lastUpdate: string | null;
}

export const OFF: LiveView = { status: 'off', stations: {}, output: {}, lastUpdate: null };

/** What a person reads: the word and a colour class. */
export const STATE_WORD: Readonly<Record<StationState, string>> = { running: 'Running', stopped: 'Stopped', held: 'Held', starved: 'Starved (no work order)' };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The view after one server-sent event (`station.state` or `line.output`); anything malformed changes nothing. */
export function applyLiveEvent(view: LiveView, name: string, data: unknown, at: string): LiveView {
  if (!isRecord(data)) return view;
  if (name === 'station.state') {
    const { station, state, since, reason } = data;
    if (typeof station !== 'string' || typeof state !== 'string' || !(STATION_STATES as readonly string[]).includes(state)) return view;
    const entry: StationLive = { state: state as StationState, ...(typeof since === 'string' ? { since } : {}), ...(typeof reason === 'string' ? { reason } : {}) };
    return { ...view, status: 'live', stations: { ...view.stations, [station]: entry }, lastUpdate: at };
  }
  if (name === 'line.output') {
    const { line, good, scrap, day } = data;
    if (typeof line !== 'string' || typeof good !== 'number' || typeof scrap !== 'number' || typeof day !== 'string' || !Number.isFinite(good) || !Number.isFinite(scrap)) return view;
    return { ...view, status: 'live', output: { ...view.output, [line]: { good, scrap, day } }, lastUpdate: at };
  }
  return view;
}

export const connecting = (view: LiveView): LiveView => ({ ...view, status: 'connecting' });
export const lost = (view: LiveView): LiveView => (view.status === 'off' ? view : { ...view, status: 'lost' });

/** The event stream address for the lines of a plan. The key is a read-only one made for this: it travels in the address because an EventSource cannot send headers. */
export function liveUrl(gmesUrl: string, key: string, lines: readonly string[]): string {
  return `${gmesUrl.replace(/\/+$/, '')}/eco/v1/live?lines=${encodeURIComponent(lines.join(','))}&k=${encodeURIComponent(key)}`;
}

/** Codes of the lines of the plant tree that the plan is tagged with (an item or a zone), in code order. */
export function linkedLineCodes(project: Project, tree: PlantTree): string[] {
  const lines = new Map(tree.filter((n) => n.type === 'line').map((n) => [n.id, n.code]));
  const found = new Set<string>();
  const consider = (meta: Parameters<typeof ecoTagOf>[0]) => {
    const tag = ecoTagOf(meta);
    const code = tag?.kind === 'plant_node' ? lines.get(tag.id) : undefined;
    if (code) found.add(code);
  };
  for (const item of Object.values(project.items)) consider(item.meta);
  for (const zone of project.space.zones ?? []) consider(zone.meta);
  return [...found].sort();
}

/** "14:05" from an ISO time, in the person's local time; "—" when there is none. */
export function clockOf(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** The line about the connection, as shown over the plan. */
export function liveCaption(view: LiveView): string {
  switch (view.status) {
    case 'off': return 'Live view is off';
    case 'connecting': return 'Connecting to GMES…';
    case 'live': return `Live · last update ${clockOf(view.lastUpdate)}`;
    case 'lost': return `Disconnected · last update ${clockOf(view.lastUpdate)}`;
  }
}
