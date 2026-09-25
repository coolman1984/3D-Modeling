/** Area in square ticks (0.01 mm²). The whole world range (2 km square) stays well below 2^53. */
export type SquareTicks = number;

const SQUARE_TICKS_PER_SQUARE_METRE = 10_000 * 10_000;

export function toSquareMetres(area: SquareTicks): number {
  return area / SQUARE_TICKS_PER_SQUARE_METRE;
}

/** Volume in cubic ticks (10^12 per m³); a 40-foot container holds about 7 × 10^13, well below 2^53. */
export type CubicTicks = number;

export function toCubicMetres(volume: CubicTicks): number {
  return volume / (SQUARE_TICKS_PER_SQUARE_METRE * 10_000);
}
