/** One part row of the shipment form, sizes in millimetres as a production plan lists them. */
export interface PartRow {
  readonly name: string;
  readonly length: number;
  readonly width: number;
  readonly height: number;
  readonly quantity: number;
  readonly mayTilt: boolean;
}

const NUMBER = /^-?\d+(?:[.,]\d+)?$/;
const toNumber = (cell: string) => Number(cell.replace(/,/g, ''));

/**
 * Part rows from cells copied out of a spreadsheet (tab-separated; runs of spaces also split).
 * The words before the first number are the name; the next three numbers are L, W and H in mm,
 * the one after them the quantity (0 when the plan cell is empty). A row whose name starts
 * without a model inherits the model of the row above, as merged cells in a plan do.
 * Rows without three sizes (headings, totals) are skipped.
 */
export function parsePastedParts(text: string): PartRow[] {
  const rows: PartRow[] = [];
  let model = '';
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells = line.split(/\t| {2,}/).map((c) => c.trim());
    const first = cells.findIndex((c) => NUMBER.test(c.replace(/,/g, '')));
    if (first < 0) continue;
    const numbers = cells.slice(first).filter((c) => c !== '').map(toNumber);
    if (numbers.length < 3 || numbers.slice(0, 3).some((n) => !(n > 0))) continue;
    const words = cells.slice(0, first);
    // A leading empty cell means the model column was merged with the row above.
    if (words.length > 1 && words[0] !== '') model = words[0]!;
    const own = words.filter((w) => w !== '');
    const name = words[0] === '' && model ? [model, ...own].join(' ') : own.join(' ');
    rows.push({ name: name || `Part ${rows.length + 1}`, length: numbers[0]!, width: numbers[1]!, height: numbers[2]!, quantity: Math.max(0, Math.round(numbers[3] ?? 0)), mayTilt: true });
  }
  return rows;
}

export type PlayMode = 'together' | 'in-turn';

/**
 * The loading step each container shows at playback frame `frame` (0 = all empty), or null
 * when that container is shown fully loaded. Together: every container loads at once. In turn:
 * container 2 starts when container 1 is full, and so on; the ones not started yet are empty.
 */
export function stepsAt(steps: readonly number[], frame: number | null, mode: PlayMode): Array<number | null> {
  if (frame === null) return steps.map(() => null);
  if (mode === 'together') return steps.map((s) => (frame >= s ? null : frame));
  let before = 0;
  return steps.map((s) => {
    const local = frame - before;
    before += s;
    return local >= s ? null : Math.max(0, local);
  });
}

/** Frames in a full playback: the longest container together, all of them added up in turn. */
export function frameCount(steps: readonly number[], mode: PlayMode): number {
  return mode === 'together' ? Math.max(0, ...steps) : steps.reduce((s, n) => s + n, 0);
}
