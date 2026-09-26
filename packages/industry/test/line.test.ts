import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { simulateLine, type StationSpec } from '../src/index.js';

const s = (v: number) => v * 1000;
const HOUR = s(3600);
const ok = (r: ReturnType<typeof simulateLine>) => {
  if (!r.ok) throw new Error(`${r.problem}: ${r.ids.join(', ')}`);
  return r;
};

describe('line simulation', () => {
  it('source every 30 s into a 60 s machine: 59 parts in the first hour, machine busy from 30 s on', () => {
    // Finishes at 90, 150, … 90 + 60k ≤ 3600 → k = 0…58 → 59 parts. Busy 3570 of 3600 s.
    const r = ok(simulateLine([
      { id: 'in', kind: 'source', cycle: s(30), next: ['m'] },
      { id: 'm', kind: 'machine', cycle: s(60), next: ['out'] },
      { id: 'out', kind: 'sink', next: [] },
    ], HOUR));
    expect(r.produced).toBe(59);
    expect(r.stations.get('m')).toMatchObject({ busy: 3570 / 3600, starved: 30 / 3600, blocked: 0, out: 59 });
    expect(r.wipAverage).toBeCloseTo(3570 / 3600, 12);
    expect(r.wipEnd).toBe(1);
    expect(r.bottleneck).toBe('m');
  });

  it('60 s then 90 s machines with no buffer: the 90 s one sets the pace, 39 parts', () => {
    // A: 10–70; B: 70–160, 160–250, … B finishes at 160 + 90k ≤ 3600 → k = 0…38 → 39 parts.
    // A waits (blocked) 30 s of every 90 once B is the pace-setter.
    const line: StationSpec[] = [
      { id: 'in', kind: 'source', cycle: s(10), next: ['a'] },
      { id: 'a', kind: 'machine', cycle: s(60), next: ['b'] },
      { id: 'b', kind: 'machine', cycle: s(90), next: ['out'] },
      { id: 'out', kind: 'sink', next: [] },
    ];
    const r = ok(simulateLine(line, HOUR));
    expect(r.produced).toBe(39);
    expect(r.bottleneck).toBe('b');
    expect(r.stations.get('b')!.busy).toBeCloseTo(3530 / 3600, 12);
    expect(r.stations.get('a')!.blocked).toBeGreaterThan(0.3);
    // A buffer between them lets A run ahead but cannot beat the 90 s machine.
    const buffered = ok(simulateLine([line[0]!, { ...line[1]!, next: ['buf'] }, { id: 'buf', kind: 'buffer', capacity: 5, next: ['b'] }, line[2]!, line[3]!], HOUR));
    expect(buffered.produced).toBe(39);
    expect(buffered.stations.get('a')!.blocked).toBeLessThan(r.stations.get('a')!.blocked);
    expect(buffered.stations.get('buf')!.averageContent).toBeGreaterThan(0);
  });

  it('two 60 s machines in parallel share the work: 118 parts in the hour', () => {
    // M1 gets parts at 10, 70, …: finishes 70 + 60k ≤ 3600 → 59. M2 at 20, 80, …: 80 + 60k → 59.
    const r = ok(simulateLine([
      { id: 'in', kind: 'source', cycle: s(10), next: ['buf'] },
      { id: 'buf', kind: 'buffer', capacity: 10, next: ['m1', 'm2'] },
      { id: 'm1', kind: 'machine', cycle: s(60), next: ['out'] },
      { id: 'm2', kind: 'machine', cycle: s(60), next: ['out'] },
      { id: 'out', kind: 'sink', next: [] },
    ], HOUR));
    expect(r.produced).toBe(118);
    expect(r.stations.get('m1')!.out).toBe(59);
    expect(r.stations.get('m2')!.out).toBe(59);
  });

  it('two feeders into one machine take turns: the one waiting longest goes first', () => {
    // Both release every 30 s into one 60 s machine: at each free moment the longer-waiting
    // feeder goes, so they alternate: 59 parts in the hour, 30 from one and 29 from the other.
    const r = ok(simulateLine([
      { id: 'a', kind: 'source', cycle: s(30), next: ['m'] },
      { id: 'b', kind: 'source', cycle: s(30), next: ['m'] },
      { id: 'm', kind: 'machine', cycle: s(60), next: ['out'] },
      { id: 'out', kind: 'sink', next: [] },
    ], HOUR));
    expect(r.produced).toBe(59);
    expect(Math.abs(r.stations.get('a')!.out - r.stations.get('b')!.out)).toBeLessThanOrEqual(1);
  });

  it('a conveyor delays parts by its transit time and holds only its capacity', () => {
    // Source every 20 s, conveyor 45 s long: first part out at 20 + 45 = 65, then every 20 s.
    // 65 + 20k ≤ 600 → k = 0…26 → 27 parts in 10 minutes.
    const r = ok(simulateLine([
      { id: 'in', kind: 'source', cycle: s(20), next: ['belt'] },
      { id: 'belt', kind: 'conveyor', cycle: s(45), capacity: 3, next: ['out'] },
      { id: 'out', kind: 'sink', next: [] },
    ], s(600)));
    expect(r.produced).toBe(27);
    expect(r.stations.get('belt')!.averageContent).toBeLessThanOrEqual(3);
  });

  it('refuses to guess: missing cycle times or capacities, unknown links, no source or sink', () => {
    expect(simulateLine([{ id: 'in', kind: 'source', next: ['out'] }, { id: 'out', kind: 'sink', next: [] }], HOUR)).toEqual({ ok: false, problem: 'missing-cycle', ids: ['in'] });
    expect(simulateLine([{ id: 'in', kind: 'source', cycle: 1, next: ['b'] }, { id: 'b', kind: 'buffer', next: ['out'] }, { id: 'out', kind: 'sink', next: [] }], HOUR)).toMatchObject({ ok: false, problem: 'missing-capacity' });
    expect(simulateLine([{ id: 'in', kind: 'source', cycle: 1, next: ['gone'] }, { id: 'out', kind: 'sink', next: [] }], HOUR)).toMatchObject({ ok: false, problem: 'unknown-next', ids: ['in'] });
    // A sink consumes finished parts. Sending them onward would make reported throughput misleading.
    expect(simulateLine([{ id: 'in', kind: 'source', cycle: 1, next: ['out'] }, { id: 'out', kind: 'sink', next: ['m'] }, { id: 'm', kind: 'machine', cycle: 1, next: [] }], HOUR)).toMatchObject({ ok: false, problem: 'unknown-next', ids: ['out'] }); // sink may not feed another station
    expect(simulateLine([{ id: 'out', kind: 'sink', next: [] }], HOUR)).toMatchObject({ ok: false, problem: 'no-source' });
  });

  it('a serial line runs at its slowest machine, conserves parts and repeats exactly', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 120 }), { minLength: 1, maxLength: 6 }), fc.array(fc.integer({ min: 0, max: 4 }), { minLength: 6, maxLength: 6 }), (cycles, buffers) => {
        const line: StationSpec[] = [{ id: 'in', kind: 'source', cycle: s(1), next: ['m0'] }];
        cycles.forEach((c, i) => {
          const next = i + 1 < cycles.length ? `m${i + 1}` : 'out';
          if (buffers[i]! > 0) {
            line.push({ id: `m${i}`, kind: 'machine', cycle: s(c), next: [`b${i}`] });
            line.push({ id: `b${i}`, kind: 'buffer', capacity: buffers[i]!, next: [next] });
          } else line.push({ id: `m${i}`, kind: 'machine', cycle: s(c), next: [next] });
        });
        line.push({ id: 'out', kind: 'sink', next: [] });
        const horizon = s(8 * 3600);
        const r = ok(simulateLine(line, horizon));
        const slowest = s(Math.max(...cycles));
        const total = s(cycles.reduce((a, b) => a + b, 0)) + s(1);
        expect(r.produced).toBeLessThanOrEqual(Math.floor(horizon / slowest));
        expect(r.produced).toBeGreaterThanOrEqual(Math.floor((horizon - total) / slowest));
        expect(r.stations.get('in')!.out).toBe(r.produced + r.wipEnd);
        expect(simulateLine(line, horizon)).toEqual(r);
      }),
      { numRuns: 80 },
    );
  });
});
