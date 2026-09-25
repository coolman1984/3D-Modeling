/** Area in square ticks (0.01 mm²). The whole world range (2 km square) stays well below 2^53. */
export type SquareTicks = number;

const SQUARE_TICKS_PER_SQUARE_METRE = 10_000 * 10_000;

export function toSquareMetres(area: SquareTicks): number {
  return area / SQUARE_TICKS_PER_SQUARE_METRE;
}
