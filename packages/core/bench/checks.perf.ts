import { expect, it } from 'vitest';
import { checkProject } from '../src/index.js';
import { palletFloor } from '../test/industrial.js';

/** Median of a few runs in milliseconds. */
function time(run: () => void, repeats: number): number {
  const samples: number[] = [];
  for (let i = 0; i < repeats; i++) {
    const start = performance.now();
    run();
    samples.push(performance.now() - start);
  }
  return samples.sort((a, b) => a - b)[Math.floor(samples.length / 2)]!;
}

for (const count of [1_000, 5_000, 20_000]) {
  it(`checkProject on ${count} pallets, grid index vs all pairs`, () => {
    const project = palletFloor(count);
    const repeats = count >= 20_000 ? 3 : 5;
    let issues = 0;
    const grid = time(() => (issues = checkProject(project).length), repeats);
    let pairIssues = 0;
    const pairs = time(() => (pairIssues = checkProject(project, { spatialIndex: false }).length), count >= 20_000 ? 1 : repeats);
    process.stderr.write(`${String(count).padStart(6)} pallets: grid ${grid.toFixed(1).padStart(8)} ms · all pairs ${pairs.toFixed(1).padStart(9)} ms · ${issues} issues\n`);
    expect(issues).toBe(pairIssues);
    // Regression guard with a wide margin for slow machines: the grid must stay near-linear.
    expect(grid).toBeLessThan(pairs);
  });
}
