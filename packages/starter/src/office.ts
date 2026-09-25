import { fromUnit, itemPolygon, type Id, type ItemDefinition, type Project, type Tick } from '@space-planner/core';
import { areaRule, distanceToOutline, exitRules, walkwayRule, type RuleResult } from './rules.js';

/**
 * Office pack: a small office catalog and office rules. Built only on the core's public
 * entry point and the shared rules, to show a new activity needs no change to the core.
 */

const m = (v: number) => fromUnit(v, 'm');
const cm = (v: number) => fromUnit(v, 'cm');
const none = { front: 0, back: 0, left: 0, right: 0 };

/**
 * Office catalog. Desks keep no clearance in front: that is where the chair goes, and the
 * chair carries the room to push back. Some items are shared with the hall pack (same id,
 * same definition), so a project can hold both.
 */
export const OFFICE_CATALOG: readonly ItemDefinition[] = [
  // Work
  { id: 'desk-140', name: 'Desk 140 × 70', category: 'desk', size: { w: cm(140), d: cm(70), h: cm(75) }, clearance: none },
  { id: 'desk-160', name: 'Desk 160 × 80', category: 'desk', size: { w: cm(160), d: cm(80), h: cm(75) }, clearance: none },
  { id: 'manager-desk', name: 'Manager desk 180 × 90', category: 'desk', size: { w: cm(180), d: cm(90), h: cm(75) }, clearance: none },
  { id: 'office-chair', name: 'Office chair', category: 'chair', size: { w: cm(60), d: cm(60), h: cm(100) }, clearance: { ...none, back: cm(60) }, seats: 1 },
  { id: 'reception', name: 'Reception desk', category: 'desk', size: { w: cm(150), d: cm(60), h: cm(75) }, clearance: { ...none, front: cm(100), back: cm(80) } },
  // Meetings
  { id: 'meeting-table-240', name: 'Meeting table 240 × 120', category: 'table', size: { w: cm(240), d: cm(120), h: cm(75) }, clearance: none },
  { id: 'meeting-round-120', name: 'Round meeting table 120', category: 'round-table', size: { w: cm(120), d: cm(120), h: cm(75) }, clearance: none, footprint: 'round' },
  { id: 'meeting-chair', name: 'Meeting chair', category: 'chair', size: { w: cm(50), d: cm(55), h: cm(90) }, clearance: { ...none, back: cm(50) }, seats: 1 },
  { id: 'whiteboard', name: 'Whiteboard 180', category: 'box', size: { w: cm(180), d: cm(10), h: m(2) }, clearance: { ...none, front: cm(120) } },
  { id: 'phone-booth', name: 'Phone booth', category: 'box', size: { w: m(1), d: m(1), h: cm(220) }, clearance: { ...none, front: cm(90) }, seats: 1 },
  // Storage and equipment
  { id: 'cabinet', name: 'File cabinet 80 × 45', category: 'shelf', size: { w: cm(80), d: cm(45), h: cm(180) }, clearance: { ...none, front: cm(80) } },
  { id: 'drawer-unit', name: 'Drawer unit', category: 'box', size: { w: cm(40), d: cm(60), h: cm(70) }, clearance: { ...none, front: cm(70) } },
  { id: 'bookcase', name: 'Bookcase 90 × 35', category: 'shelf', size: { w: cm(90), d: cm(35), h: m(2) }, clearance: { ...none, front: cm(70) } },
  { id: 'locker', name: 'Staff lockers 90 × 50', category: 'shelf', size: { w: cm(90), d: cm(50), h: cm(180) }, clearance: { ...none, front: cm(80) } },
  { id: 'printer', name: 'Large printer', category: 'box', size: { w: cm(60), d: cm(55), h: cm(110) }, clearance: { ...none, front: cm(90) } },
  // Breaks and waiting
  { id: 'kitchenette', name: 'Kitchenette 180 × 60', category: 'counter', size: { w: cm(180), d: cm(60), h: cm(90) }, clearance: { ...none, front: cm(100) } },
  { id: 'coffee-table', name: 'Coffee table 100 × 50', category: 'table', size: { w: cm(100), d: cm(50), h: cm(45) }, clearance: none },
  { id: 'sofa', name: 'Sofa · 3 seats', category: 'sofa', size: { w: cm(210), d: cm(90), h: cm(85) }, clearance: { ...none, front: cm(60) }, seats: 3 },
  { id: 'armchair', name: 'Armchair', category: 'sofa', size: { w: cm(80), d: cm(80), h: cm(85) }, clearance: { ...none, front: cm(50) }, seats: 1 },
  { id: 'plant', name: 'Plant', category: 'plant', size: { w: cm(50), d: cm(50), h: cm(150) }, clearance: none, footprint: 'round' },
];

export type OfficeStyle = 'open-plan' | 'meeting';

export interface OfficeStyleSpec {
  readonly id: OfficeStyle;
  readonly label: string;
  /** Floor area each person needs, in square metres. */
  readonly areaPerPerson: number;
  readonly walkway: Tick;
}

export const OFFICE_STYLES: readonly OfficeStyleSpec[] = [
  { id: 'open-plan', label: 'Open-plan office', areaPerPerson: 6, walkway: cm(90) },
  { id: 'meeting', label: 'Meeting room', areaPerPerson: 2, walkway: cm(90) },
];

export function officeStyle(id: string | null | undefined): OfficeStyleSpec {
  return OFFICE_STYLES.find((s) => s.id === id) ?? OFFICE_STYLES[0]!;
}

/** A chair counts for a desk when its centre is this close to the desk's outline. */
export const DESK_CHAIR_REACH = cm(60);

/**
 * Every desk (items of category "desk") has its own chair: a seat whose centre is within
 * DESK_CHAIR_REACH of the desk. Desks are served in id order, each by its nearest free seat.
 */
export function workstationRule(project: Project): RuleResult {
  const items = Object.values(project.items).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const desks = items.filter((i) => project.catalog[i.definitionId]?.category === 'desk');
  if (desks.length === 0) return { code: 'workstations', unit: 'desks', status: 'unknown', reason: 'no-desks', entityIds: [] };
  const seats = items.filter((i) => (project.catalog[i.definitionId]?.seats ?? 0) > 0);
  const used = new Set<Id>();
  const without: Id[] = [];
  for (const desk of desks) {
    const outline = itemPolygon(desk, project.catalog[desk.definitionId]!);
    let best: { id: Id; distance: number } | null = null;
    for (const seat of seats) {
      if (used.has(seat.id)) continue;
      const distance = distanceToOutline(outline, seat.position);
      if (distance <= DESK_CHAIR_REACH && (!best || distance < best.distance)) best = { id: seat.id, distance };
    }
    if (best) used.add(best.id);
    else without.push(desk.id);
  }
  return { code: 'workstations', unit: 'desks', required: desks.length, measured: desks.length - without.length, status: without.length === 0 ? 'pass' : 'fail', entityIds: without };
}

/** Office rules for the style, always in the same order. */
export function checkOffice(project: Project, styleId: OfficeStyle = 'open-plan'): RuleResult[] {
  const style = officeStyle(styleId);
  return [walkwayRule(project, style.walkway), areaRule('area-per-person', project, style.areaPerPerson), workstationRule(project), ...exitRules(project)];
}
