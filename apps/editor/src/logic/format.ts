import { toSquareMetres, toUnit, type Tick } from '@space-planner/core';

const number = (digits: number, min = 0) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: digits, minimumFractionDigits: min });

/** Lengths under one metre in centimetres, longer ones in metres (two decimals, as on drawings). */
export function formatLength(ticks: Tick): string {
  const abs = Math.abs(ticks);
  if (abs < 10_000) return `${number(1).format(toUnit(ticks, 'cm'))} cm`;
  return `${number(2, 2).format(toUnit(ticks, 'm'))} m`;
}

/** Always in centimetres, for sizes of things ("180 × 80 cm"). */
export function formatCentimetres(ticks: Tick): string {
  return number(1).format(toUnit(ticks, 'cm'));
}

/** Always in metres with two decimals, for room sizes ("24.00 × 16.00 m"). */
export function formatMetres(ticks: Tick): string {
  return number(2, 2).format(toUnit(ticks, 'm'));
}

export function formatArea(squareTicks: number): string {
  return formatSquareMetres(toSquareMetres(squareTicks));
}

export function formatSquareMetres(value: number): string {
  return `${number(2).format(value)} m²`;
}

/** Grams as kilograms or tonnes: "12 kg", "1,250 kg", "28.2 t". */
export function formatMass(grams: number): string {
  const kgs = grams / 1000;
  if (Math.abs(kgs) >= 10_000) return `${number(1).format(kgs / 1000)} t`;
  return `${number(kgs < 10 ? 1 : 0).format(kgs)} kg`;
}

export function formatPercent(ratio: number): string {
  return new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 }).format(ratio);
}

export function formatCount(n: number): string {
  return number(0).format(n);
}

export function formatDegrees(millidegrees: number): string {
  return `${number(1).format(millidegrees / 1000)}°`;
}

/** "1 item", "3 items". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}

/** "Today, 08:02", "Yesterday, 18:20", "Sep 22, 10:30" — history and project lists. */
export function formatWhen(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(date);
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(now) - day(date)) / 86_400_000);
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Yesterday, ${time}`;
  const sameYear = date.getFullYear() === now.getFullYear();
  const dayText = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) }).format(date);
  return `${dayText}, ${time}`;
}

/** "2 min ago", "Yesterday", "Sep 21" — how long since a project was edited. */
export function formatAgo(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60 && date.getDate() === now.getDate()) return `${Math.floor(minutes / 60)} h ago`;
  const text = formatWhen(iso, now);
  return text.startsWith('Yesterday') ? 'Yesterday' : text.split(',')[0]!;
}
