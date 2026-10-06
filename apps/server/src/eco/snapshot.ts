import type { Project } from '@space-planner/core';
import { ecoTagOf } from '@space-planner/starter';
import { validate } from './contract.js';
import { uuidV5 } from './ids.js';
import { SCHEMAS } from './schemas.js';

/**
 * A plan as `eco.layout.snapshot.v1` (plan 40-SPACE-PLANNER WP-S2): items with position, rotation and size in ticks (0.1 mm,
 * nothing converted or rounded) and the node each is tagged with, zones with their polygon and tag. Pure: the same plan and
 * options always give the same bytes, so a resend of an unchanged revision is recognised by GMES as a duplicate.
 *
 * `version` is the plan's revision + 1: the contract needs a version above zero and a new plan starts at revision 0, and +1
 * keeps it strictly increasing with every accepted command. `revision` carries the plan's own number.
 */

export interface RefData { readonly type: 'plant_node' | 'warehouse' | 'storage_location'; readonly id: string; readonly code: string }

export interface LayoutSnapshotData {
  id: string;
  code: string;
  version: number;
  origin: { app: 'space-planner'; type: 'layout'; key: string };
  name: string;
  revision: number;
  length_unit: '0.1mm';
  items: Array<{ item_id: string; name: string; category: string; x: number; y: number; rotation_mdeg: number; w: number; d: number; h: number; eco_ref?: RefData }>;
  zones: Array<{ id: string; kind: string; polygon: Array<[number, number]>; eco_ref?: RefData }>;
}

export interface Envelope {
  specversion: '1.0';
  id: string;
  source: string;
  type: 'eco.layout.snapshot.v1';
  subject: string;
  time: string;
  datacontenttype: 'application/json';
  ecoseq: number;
  ecocorrelation: string;
  data: LayoutSnapshotData;
}

export interface SnapshotOptions {
  /** The company id pasted from pairing (owned by Mizan). */
  readonly companyId: string;
  /** This planner's node name in the envelope source (`eco://<company>/space/<node>`). */
  readonly node: string;
  /** ISO time of sending (the caller reads the clock; this file never does). */
  readonly now: string;
  /** The sender's sequence number, above zero. */
  readonly seq: number;
}

export const layoutIdOf = (companyId: string, projectId: string): string => uuidV5(companyId, `space:layout:${projectId}`);

const ordinal = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** A short recognisable code from the plan's name: capitals, digits and dashes, at most 64 characters. */
export function layoutCode(name: string): string {
  const code = name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64).replace(/-+$/g, '');
  return code || 'PLAN';
}

function refOf(meta: Parameters<typeof ecoTagOf>[0]): { eco_ref: RefData } | Record<string, never> {
  const tag = ecoTagOf(meta);
  return tag ? { eco_ref: { type: tag.kind, id: tag.id, code: tag.code } } : {};
}

export function buildLayoutData(project: Project, companyId: string): LayoutSnapshotData {
  const items = Object.values(project.items)
    .sort((a, b) => ordinal(a.id, b.id))
    .flatMap((item) => {
      const definition = project.catalog[item.definitionId];
      if (!definition) return []; // a broken reference is refused when the plan is saved; nothing to describe here
      return [{
        item_id: item.id, name: definition.name, category: definition.category,
        x: item.position.x, y: item.position.y, rotation_mdeg: item.rotation,
        w: definition.size.w, d: definition.size.d, h: definition.size.h,
        ...refOf(item.meta),
      }];
    });
  const zones = (project.space.zones ?? []).map((zone) => ({
    id: zone.id, kind: zone.kind, polygon: zone.polygon.map((p): [number, number] => [p.x, p.y]), ...refOf(zone.meta),
  }));
  return {
    id: layoutIdOf(companyId, project.id), code: layoutCode(project.name), version: project.revision + 1,
    origin: { app: 'space-planner', type: 'layout', key: project.id },
    name: project.name || 'Plan', revision: project.revision, length_unit: '0.1mm', items, zones,
  };
}

export function buildEnvelope(project: Project, options: SnapshotOptions): Envelope {
  const data = buildLayoutData(project, options.companyId);
  return {
    specversion: '1.0',
    // One id per plan revision: sending the same revision twice is a duplicate to GMES, not a second change.
    id: uuidV5(options.companyId, `space:layout:${project.id}:${project.revision}`),
    source: `eco://${options.companyId}/space/${options.node}`,
    type: 'eco.layout.snapshot.v1',
    subject: `layout/${data.id}`,
    time: options.now,
    datacontenttype: 'application/json',
    ecoseq: options.seq,
    ecocorrelation: `layout/${project.id}`,
    data,
  };
}

export type CheckedEnvelope = { readonly ok: true; readonly envelope: Envelope } | { readonly ok: false; readonly problems: string[] };

/** The envelope, only when both the envelope and its data satisfy the vendored contracts; otherwise every problem found. */
export function checkedEnvelope(project: Project, options: SnapshotOptions): CheckedEnvelope {
  const envelope = buildEnvelope(project, options);
  const problems = [
    ...validate(SCHEMAS['eco.envelope.v1'], envelope).map((p) => `envelope ${p}`),
    ...validate(SCHEMAS['eco.layout.snapshot.v1'], envelope.data).map((p) => `layout ${p}`),
  ];
  return problems.length ? { ok: false, problems } : { ok: true, envelope };
}
