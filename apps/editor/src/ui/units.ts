import { fromUnit } from '@space-planner/core';

/** Centimetres typed by a person → ticks. */
export const toTicks = (centimetres: number) => fromUnit(centimetres, 'cm');
