/**
 * A small deterministic discrete-event simulation of a production line: sources release parts,
 * machines process one part at a time, buffers and conveyors hold parts, sinks take them. Times
 * are integer milliseconds; there is no randomness, so the same line always gives the same result.
 *
 * It answers operational questions (throughput, work in progress, where parts wait) from cycle
 * times people entered. It knows nothing about the floor: spatial feasibility is checked apart.
 */

export type StationKind = 'source' | 'machine' | 'buffer' | 'conveyor' | 'sink';

export interface StationSpec {
  readonly id: string;
  readonly kind: StationKind;
  /**
   * Milliseconds: a source's release interval, a machine's cycle, a conveyor's transit time.
   * Buffers and sinks take no time.
   */
  readonly cycle?: number;
  /** Parts a buffer or conveyor holds (machines hold one). */
  readonly capacity?: number;
  /** Where finished parts go, in order of preference when several can take one. */
  readonly next: readonly string[];
}

export interface StationStats {
  /** Share of the horizon spent working (0..1). */
  readonly busy: number;
  /** Share spent holding a finished part nobody could take. */
  readonly blocked: number;
  /** Share spent empty, waiting for a part (machines only). */
  readonly starved: number;
  /** Parts that left this station. */
  readonly out: number;
  /** Average parts inside (buffers and conveyors: time-weighted). */
  readonly averageContent: number;
}

export type LineResult =
  | {
      readonly ok: true;
      readonly horizon: number;
      /** Parts that reached a sink. */
      readonly produced: number;
      readonly perHour: number;
      /** Time-weighted average of parts between the sources and the sinks. */
      readonly wipAverage: number;
      /** Parts still inside at the end. */
      readonly wipEnd: number;
      readonly stations: ReadonlyMap<string, StationStats>;
      /** The machine busiest over the run: the one that limits output. */
      readonly bottleneck: string | undefined;
    }
  | {
      readonly ok: false;
      readonly problem: 'missing-cycle' | 'missing-capacity' | 'unknown-next' | 'no-source' | 'no-sink';
      readonly ids: readonly string[];
    };

type State = 'idle' | 'busy' | 'blocked';

interface Station {
  readonly spec: StationSpec;
  readonly index: number;
  readonly next: Station[];
  state: State;
  since: number;
  /** Queue of parts (entry times for conveyors; buffers only count). */
  readonly parts: number[];
  busyTime: number;
  blockedTime: number;
  idleTime: number;
  out: number;
  contentArea: number;
  contentSince: number;
  /** When the finished part started waiting (for fair merges). */
  readySince: number;
}

/** Check the line and simulate it for `horizon` milliseconds. */
export function simulateLine(specs: readonly StationSpec[], horizon: number): LineResult {
  const byId = new Map(specs.map((s) => [s.id, s]));
  const missingCycle = specs.filter((s) => (s.kind === 'source' || s.kind === 'machine' || s.kind === 'conveyor') && !(Number.isInteger(s.cycle) && s.cycle! > 0)).map((s) => s.id);
  if (missingCycle.length) return { ok: false, problem: 'missing-cycle', ids: missingCycle };
  const missingCapacity = specs.filter((s) => (s.kind === 'buffer' || s.kind === 'conveyor') && !(Number.isInteger(s.capacity) && s.capacity! > 0)).map((s) => s.id);
  if (missingCapacity.length) return { ok: false, problem: 'missing-capacity', ids: missingCapacity };
  const unknown = specs.filter((s) => s.next.some((n) => !byId.has(n) || byId.get(n)!.kind === 'source')).map((s) => s.id);
  if (unknown.length) return { ok: false, problem: 'unknown-next', ids: unknown };
  if (!specs.some((s) => s.kind === 'source')) return { ok: false, problem: 'no-source', ids: [] };
  if (!specs.some((s) => s.kind === 'sink')) return { ok: false, problem: 'no-sink', ids: [] };

  const stations: Station[] = specs.map((spec, index) => ({ spec, index, next: [], state: 'idle', since: 0, parts: [], busyTime: 0, blockedTime: 0, idleTime: 0, out: 0, contentArea: 0, contentSince: 0, readySince: 0 }));
  const find = new Map(stations.map((s) => [s.spec.id, s]));
  for (const s of stations) s.next.push(...s.spec.next.filter((n) => n !== s.spec.id).map((n) => find.get(n)!));

  // Events: (time, sequence) ordered; sequence keeps equal times in the order they were made.
  const events = new EventQueue();
  let now = 0;
  let produced = 0;
  let wip = 0;
  let wipArea = 0;
  let wipSince = 0;
  const setWip = (delta: number) => {
    wipArea += wip * (now - wipSince);
    wipSince = now;
    wip += delta;
  };
  const setState = (s: Station, state: State) => {
    const span = now - s.since;
    if (s.state === 'busy') s.busyTime += span;
    else if (s.state === 'blocked') s.blockedTime += span;
    else s.idleTime += span;
    s.state = state;
    s.since = now;
    if (state === 'blocked') s.readySince = now;
  };
  const setContent = (s: Station, add: number) => {
    s.contentArea += s.parts.length * (now - s.contentSince);
    s.contentSince = now;
    if (add > 0) s.parts.push(now);
    else s.parts.shift();
  };

  /** Can `s` take a part now? */
  const accepts = (s: Station) => {
    switch (s.spec.kind) {
      case 'sink':
        return true;
      case 'machine':
        return s.state === 'idle';
      case 'buffer':
      case 'conveyor':
        return s.parts.length < s.spec.capacity!;
      default:
        return false;
    }
  };
  /** Hand a part to `to`. */
  const receive = (to: Station) => {
    switch (to.spec.kind) {
      case 'sink':
        produced++;
        to.out++;
        setWip(-1);
        break;
      case 'machine':
        setState(to, 'busy');
        events.push(now + to.spec.cycle!, to.index);
        break;
      case 'buffer':
        setContent(to, 1);
        break;
      case 'conveyor':
        setContent(to, 1);
        events.push(now + to.spec.cycle!, to.index);
        break;
    }
  };
  /** Does `s` hold a part ready to leave? */
  const ready = (s: Station) => {
    switch (s.spec.kind) {
      case 'source':
      case 'machine':
        return s.state === 'blocked';
      case 'buffer':
        return s.parts.length > 0;
      case 'conveyor':
        return s.parts.length > 0 && s.parts[0]! + s.spec.cycle! <= now;
      default:
        return false;
    }
  };
  /** The successor a finished part goes to: the one that has taken the fewest parts, then list order. */
  const target = (s: Station) => {
    let best: Station | undefined;
    for (const n of s.next) if (accepts(n) && (!best || received(n) < received(best))) best = n;
    return best;
  };
  const taken = new Map<Station, number>();
  const received = (s: Station) => taken.get(s) ?? 0;
  const release = (s: Station) => {
    if (s.spec.kind === 'source' || s.spec.kind === 'machine') {
      if (s.spec.kind === 'source') {
        setState(s, 'busy');
        events.push(now + s.spec.cycle!, s.index);
      } else setState(s, 'idle');
    } else setContent(s, -1);
    s.out++;
  };

  /**
   * Move every part that can move now, longest-waiting holder first, until nothing moves. A move
   * frees room upstream, so this repeats; each pass moves at least one part or stops.
   */
  const waitingSince = (s: Station) => (s.spec.kind === 'buffer' ? s.parts[0]! : s.spec.kind === 'conveyor' ? s.parts[0]! + s.spec.cycle! : s.readySince);
  // A loop of buffers could pass parts round forever at one instant; stop after a generous bound.
  const maxPasses = 1000 + 10 * stations.length;
  const settle = () => {
    for (let pass = 0; pass < maxPasses; pass++) {
      const holders = stations.filter(ready).sort((a, b) => waitingSince(a) - waitingSince(b) || a.index - b.index);
      let moved = false;
      for (const h of holders) {
        if (!ready(h)) continue;
        const to = target(h);
        if (!to) continue;
        if (h.spec.kind === 'source') setWip(1);
        release(h);
        taken.set(to, received(to) + 1);
        receive(to);
        moved = true;
      }
      if (!moved) return;
    }
  };

  // Sources start working at time zero.
  for (const s of stations) {
    if (s.spec.kind === 'source') {
      s.state = 'busy';
      events.push(s.spec.cycle!, s.index);
    }
  }
  while (events.size > 0 && events.peekTime() <= horizon) {
    const [time, index] = events.pop();
    now = time;
    const s = stations[index]!;
    if (s.spec.kind === 'source' || s.spec.kind === 'machine') setState(s, 'blocked');
    // All events at this instant first, then parts move.
    while (events.size > 0 && events.peekTime() === now) {
      const [, other] = events.pop();
      const o = stations[other]!;
      if (o.spec.kind === 'source' || o.spec.kind === 'machine') setState(o, 'blocked');
    }
    settle();
  }
  now = horizon;
  setWip(0);
  const stats = new Map<string, StationStats>();
  for (const s of stations) {
    setState(s, s.state);
    s.contentArea += s.parts.length * (now - s.contentSince);
    const share = (t: number) => (horizon > 0 ? t / horizon : 0);
    const machineLike = s.spec.kind === 'machine' || s.spec.kind === 'source';
    stats.set(s.spec.id, {
      busy: machineLike ? share(s.busyTime) : 0,
      blocked: machineLike ? share(s.blockedTime) : 0,
      starved: s.spec.kind === 'machine' ? share(s.idleTime) : 0,
      out: s.out,
      averageContent: s.spec.kind === 'buffer' || s.spec.kind === 'conveyor' ? share(s.contentArea) : 0,
    });
  }
  let bottleneck: string | undefined;
  for (const s of stations) {
    if (s.spec.kind !== 'machine') continue;
    if (bottleneck === undefined || stats.get(s.spec.id)!.busy > stats.get(bottleneck)!.busy) bottleneck = s.spec.id;
  }
  return {
    ok: true,
    horizon,
    produced,
    perHour: horizon > 0 ? (produced * 3_600_000) / horizon : 0,
    wipAverage: horizon > 0 ? wipArea / horizon : 0,
    wipEnd: wip,
    stations: stats,
    bottleneck,
  };
}

/** Binary min-heap of (time, sequence, station index). */
class EventQueue {
  private readonly items: Array<[number, number, number]> = [];
  private sequence = 0;
  get size(): number {
    return this.items.length;
  }
  peekTime(): number {
    return this.items[0]![0];
  }
  push(time: number, station: number): void {
    const items = this.items;
    items.push([time, this.sequence++, station]);
    let i = items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!before(items[i]!, items[p]!)) break;
      [items[i], items[p]] = [items[p]!, items[i]!];
      i = p;
    }
  }
  pop(): [number, number] {
    const items = this.items;
    const top = items[0]!;
    const last = items.pop()!;
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < items.length && before(items[l]!, items[m]!)) m = l;
        if (r < items.length && before(items[r]!, items[m]!)) m = r;
        if (m === i) break;
        [items[i], items[m]] = [items[m]!, items[i]!];
        i = m;
      }
    }
    return [top[0], top[2]];
  }
}

function before(a: readonly [number, number, number], b: readonly [number, number, number]): boolean {
  return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
}
