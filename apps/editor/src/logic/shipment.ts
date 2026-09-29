/** One part row of the shipment form, sizes in millimetres as a production plan lists them. */
export interface PartRow {
  readonly name: string;
  readonly length: number;
  readonly width: number;
  readonly height: number;
  readonly quantity: number;
  readonly mayTilt: boolean;
  /** Every plan column after the sizes (one per day), 0 where the cell is empty. */
  readonly plan?: readonly number[];
}

/** A pasted production plan: its part rows and the headings of its plan columns (days). */
export interface PastedPlan {
  readonly columns: readonly string[];
  readonly rows: readonly PartRow[];
}

const NUMBER = /^-?\d+(?:[.,]\d+)?$/;
const isNumber = (cell: string) => NUMBER.test(cell.replace(/,/g, ''));
const toNumber = (cell: string) => Number(cell.replace(/,/g, ''));

/**
 * The cells of one pasted line, empty cells kept in place: a plan's quantities are known by their
 * column. Spreadsheets copy tab-separated; where tabs became spaces (a chat or an e-mail), every
 * four spaces are one cell border and a run of two or three is one.
 */
function cellsOf(line: string): string[] {
  if (line.includes('\t')) return line.split('\t').map((c) => c.trim());
  const cells: string[] = [];
  let cell = '';
  let spaces = 0;
  const border = () => {
    cells.push(cell.trim());
    for (let k = 1; k < Math.max(1, Math.round(spaces / 4)); k++) cells.push('');
    cell = '';
  };
  for (const ch of line) {
    if (ch === ' ') {
      spaces++;
      continue;
    }
    if (spaces >= 2) border();
    else if (spaces === 1) cell += ' ';
    spaces = 0;
    cell += ch;
  }
  if (spaces >= 2) border();
  cells.push(cell.trim());
  return cells;
}

/**
 * A production plan copied out of a spreadsheet. In each row the words before the first number
 * are the name, the next three numbers are L, W and H in mm, and every cell after them is a plan
 * column (0 when empty). A row that starts with an empty cell inherits the model of the row above,
 * as merged cells do. The heading row with an H column names the plan columns. Rows without
 * three sizes (headings, totals) are skipped.
 */
export function parsePastedPlan(text: string): PastedPlan {
  const rows: PartRow[] = [];
  let columns: string[] = [];
  let model = '';
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells = cellsOf(line);
    const first = cells.findIndex(isNumber);
    const sizes = first < 0 ? [] : cells.slice(first, first + 3);
    if (sizes.length < 3 || !sizes.every((c) => isNumber(c) && toNumber(c) > 0)) {
      const h = cells.findIndex((c) => /^h\b|^h\s*\(|^height/i.test(c));
      if (h >= 0) columns = cells.slice(h + 1);
      continue;
    }
    const words = cells.slice(0, first);
    // A leading empty cell means the model column was merged with the row above.
    if (words.length > 1 && words[0] !== '') model = words[0]!;
    const own = words.filter((w) => w !== '');
    const name = words[0] === '' && model ? [model, ...own].join(' ') : own.join(' ');
    const plan = cells.slice(first + 3).map((c) => (isNumber(c) ? Math.max(0, Math.round(toNumber(c))) : 0));
    rows.push({ name: name || `Part ${rows.length + 1}`, length: toNumber(sizes[0]!), width: toNumber(sizes[1]!), height: toNumber(sizes[2]!), quantity: plan[0] ?? 0, mayTilt: true, plan });
  }
  // As many plan columns as the widest row, named by the heading row where it has a name.
  const count = Math.max(0, ...rows.map((r) => r.plan!.length));
  const trimmed = rows.map((r) => ({ ...r, plan: Array.from({ length: count }, (_, k) => r.plan![k] ?? 0) }));
  return { columns: Array.from({ length: count }, (_, k) => columns[k] || `Column ${k + 1}`), rows: trimmed };
}

/** The rows with their quantities taken from plan column `column` (a day). */
export function rowsForColumn(rows: readonly PartRow[], column: number): PartRow[] {
  return rows.map((r) => (r.plan ? { ...r, quantity: r.plan[column] ?? 0 } : r));
}

/** Part rows of a pasted plan, quantities from its first plan column. */
export function parsePastedParts(text: string): PartRow[] {
  return parsePastedPlan(text).rows.map(({ plan: _plan, ...r }) => r);
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
