/** Smallest `${prefix}-${n}` (n ≥ 1) not already taken. Readable, stable ids for people and tests. */
export function nextId(prefix: string, taken: ReadonlySet<string>): string {
  for (let n = 1; ; n++) {
    const id = `${prefix}-${n}`;
    if (!taken.has(id)) return id;
  }
}
