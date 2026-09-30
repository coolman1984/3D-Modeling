import { apply, type Project } from '@space-planner/core';
import { referenceProductionLine, tagItemCommand, tagZoneCommand, type PlantNode } from '@space-planner/starter';
import { describe, expect, it } from 'vitest';
import { applyLiveEvent, clockOf, connecting, linkedLineCodes, liveCaption, liveUrl, lost, OFF, type LiveView } from '../src/eco/live.js';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const node = (n: number, code: string, type: PlantNode['type']): PlantNode => ({ id: uuid(n), code, type, name: { en: code, ar: code }, active: true });
const line1 = node(3, 'FA-1', 'line');
const line2 = node(4, 'FA-2', 'line');
const tree = [line1, line2, node(10, 'FA-1-10', 'station')];
const AT = '2026-10-01T11:05:00.000Z';

describe('live events', () => {
  it('a station state and a line output are kept by code, with the time of the last update', () => {
    let view: LiveView = connecting(OFF);
    expect(view.status).toBe('connecting');
    view = applyLiveEvent(view, 'station.state', { station: 'FA-1-10', line: 'FA-1', state: 'stopped', since: '2026-10-01T10:00:00Z', reason: 'Feeder jam' }, AT);
    view = applyLiveEvent(view, 'line.output', { line: 'FA-1', good: 120, scrap: 3, day: '2026-10-01' }, AT);
    expect(view).toEqual({
      status: 'live', lastUpdate: AT,
      stations: { 'FA-1-10': { state: 'stopped', since: '2026-10-01T10:00:00Z', reason: 'Feeder jam' } },
      output: { 'FA-1': { good: 120, scrap: 3, day: '2026-10-01' } },
    });
    const later = applyLiveEvent(view, 'station.state', { station: 'FA-1-10', line: 'FA-1', state: 'running' }, '2026-10-01T11:06:00.000Z');
    expect(later.stations['FA-1-10']).toEqual({ state: 'running' });
    expect(view.stations['FA-1-10']!.state).toBe('stopped'); // the earlier view is never changed
  });

  it('ignores what it does not understand, never inventing a state', () => {
    const start = applyLiveEvent(OFF, 'station.state', { station: 'A', line: 'L', state: 'running' }, AT);
    for (const [name, data] of [
      ['station.state', { station: 'A', line: 'L', state: 'exploding' }],
      ['station.state', { station: 3, state: 'running' }],
      ['station.state', 'running'],
      ['line.output', { line: 'L', good: 'many', scrap: 0, day: 'x' }],
      ['line.output', { line: 'L', good: Infinity, scrap: 0, day: 'x' }],
      ['heartbeat', {}],
    ] as const) expect(applyLiveEvent(start, name, data, '2027-01-01T00:00:00Z')).toBe(start);
  });

  it('a lost connection keeps the last figures and their time; an off view stays off', () => {
    const view = applyLiveEvent(OFF, 'station.state', { station: 'A', line: 'L', state: 'held' }, AT);
    const dropped = lost(view);
    expect(dropped).toMatchObject({ status: 'lost', lastUpdate: AT, stations: { A: { state: 'held' } } });
    expect(lost(OFF)).toBe(OFF);
  });

  it('says what the connection is doing, with the last update as a clock time', () => {
    expect(liveCaption(OFF)).toBe('Live view is off');
    expect(liveCaption(connecting(OFF))).toBe('Connecting to GMES…');
    const view = applyLiveEvent(OFF, 'line.output', { line: 'L', good: 1, scrap: 0, day: 'd' }, AT);
    const clock = clockOf(AT);
    expect(clock).toMatch(/^\d\d:\d\d$/);
    expect(liveCaption(view)).toBe(`Live · last update ${clock}`);
    expect(liveCaption(lost(view))).toBe(`Disconnected · last update ${clock}`);
    expect(clockOf(null)).toBe('—');
    expect(clockOf('not a date')).toBe('—');
  });
});

describe('the address of the stream', () => {
  it('carries the lines and the read key encoded, on the address without a trailing slash', () => {
    expect(liveUrl('http://gmes.local:4300/', 'k e/y', ['FA-1', 'FA-2'])).toBe('http://gmes.local:4300/eco/v1/live?lines=FA-1%2CFA-2&k=k%20e%2Fy');
  });
});

describe('the lines a plan follows', () => {
  const run = (project: Project, command: ReturnType<typeof tagItemCommand>): Project => {
    const result = apply(project, command!);
    if (!result.ok) throw new Error('refused');
    return result.project;
  };

  it('are the lines of the tree that a zone or an item is tagged with, once each, in code order', () => {
    let plan = referenceProductionLine();
    const zone = (id: string) => ({ id, kind: 'line', polygon: [{ x: 0, y: 0 }, { x: 10_000, y: 0 }, { x: 10_000, y: 10_000 }] });
    plan = run(plan, { type: 'space.set', space: { ...plan.space, zones: [zone('Z1'), zone('Z2')] } });
    expect(linkedLineCodes(plan, tree)).toEqual([]);
    plan = run(plan, tagZoneCommand(plan, 'Z2', line2));
    plan = run(plan, tagZoneCommand(plan, 'Z1', line1));
    plan = run(plan, tagItemCommand(plan, 'S01', line1));
    plan = run(plan, tagItemCommand(plan, 'S02', tree[2]!));
    expect(linkedLineCodes(plan, tree)).toEqual(['FA-1', 'FA-2']);
    expect(linkedLineCodes(plan, [])).toEqual([]);
  });
});
