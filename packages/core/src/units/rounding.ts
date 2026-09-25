/**
 * Round half away from zero, never returning -0.
 * `Math.round` rounds -2.5 to -2 but 2.5 to 3; we want the grid to be symmetric around the origin.
 */
export function roundHalfAwayFromZero(value: number): number {
  const rounded = Math.sign(value) * Math.round(Math.abs(value));
  return rounded === 0 ? 0 : rounded;
}
