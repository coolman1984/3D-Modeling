import { type ItemDefinition, type Project } from '@space-planner/core';
import { checkHall, HALL_STYLES, type HallStyle } from './hall.js';
import { STARTER_CATALOG } from './hallCatalog.js';
import { checkOffice, OFFICE_CATALOG, OFFICE_STYLES, type OfficeStyle } from './office.js';
import type { RuleResult } from './rules.js';

export type PackId = 'hall' | 'office';

/**
 * An activity pack: what a kind of space is furnished with and which rules it is checked
 * against. Adding a pack means adding an entry here, never changing the core.
 */
export interface Pack {
  readonly id: PackId;
  readonly label: string;
  readonly catalog: readonly ItemDefinition[];
  readonly styles: readonly { readonly id: string; readonly label: string }[];
  readonly check: (project: Project, style: string) => RuleResult[];
}

export const PACKS: readonly Pack[] = [
  { id: 'hall', label: 'قاعة مناسبات', catalog: STARTER_CATALOG, styles: HALL_STYLES, check: (p, s) => checkHall(p, s as HallStyle) },
  { id: 'office', label: 'مكتب', catalog: OFFICE_CATALOG, styles: OFFICE_STYLES, check: (p, s) => checkOffice(p, s as OfficeStyle) },
];

export function packOf(id: string | null | undefined): Pack {
  return PACKS.find((p) => p.id === id) ?? PACKS[0]!;
}

/**
 * Which pack a project belongs to, read from its catalog: the pack with the most of its item
 * types in the project. Ties go to the first pack (the hall).
 */
export function detectPack(project: Project): PackId {
  const present = (pack: Pack) => pack.catalog.filter((d) => project.catalog[d.id] !== undefined).length;
  let best = PACKS[0]!;
  for (const pack of PACKS) if (present(pack) > present(best)) best = pack;
  return best.id;
}

/** The pack's item types the project does not have yet. */
export function missingPackItems(project: Project, packId: PackId): ItemDefinition[] {
  return packOf(packId).catalog.filter((d) => !project.catalog[d.id]);
}

/** Rules of the pack for the style (the pack's first style when the style is not one of its own). */
export function checkPack(project: Project, packId: PackId, style?: string | null): RuleResult[] {
  const pack = packOf(packId);
  const known = pack.styles.some((s) => s.id === style);
  return pack.check(project, known ? style! : pack.styles[0]!.id);
}
