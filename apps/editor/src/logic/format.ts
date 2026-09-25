import { toSquareMetres, toUnit, type Tick } from '@space-planner/core';

const number = (digits: number) =>
  new Intl.NumberFormat('ar-EG', { maximumFractionDigits: digits, minimumFractionDigits: 0 });

/** Lengths under one metre in centimetres, longer ones in metres. */
export function formatLength(ticks: Tick): string {
  const abs = Math.abs(ticks);
  if (abs < 10_000) return `${number(1).format(toUnit(ticks, 'cm'))} سم`;
  return `${number(2).format(toUnit(ticks, 'm'))} م`;
}

export function formatArea(squareTicks: number): string {
  return `${number(2).format(toSquareMetres(squareTicks))} م²`;
}

export function formatPercent(ratio: number): string {
  return new Intl.NumberFormat('ar-EG', { style: 'percent', maximumFractionDigits: 1 }).format(ratio);
}

export function formatCount(n: number): string {
  return number(0).format(n);
}

export function formatDegrees(millidegrees: number): string {
  return `${number(1).format(millidegrees / 1000)}°`;
}
