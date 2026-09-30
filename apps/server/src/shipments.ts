import { randomUUID } from 'node:crypto';
import { fromUnit } from '@space-planner/core';
import { containerType, planShipment, type ShipmentPart } from '@space-planner/starter';
import type { Store } from './store.js';

/** Projects of one shipment share this collection prefix in the store; the page groups them by it. */
export const SHIPMENT_COLLECTION = 'shipment:';

/** A shipment request that does not make sense; the message says what to correct. */
export class ShipmentInputError extends Error {}

export interface ShipmentInput {
  readonly name: string;
  readonly containerType: string;
  readonly parts: readonly ShipmentPart[];
}

const MAX_PARTS = 50;
const MAX_QUANTITY = 200_000;

function positive(value: unknown, what: string, max: number, allowZero = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (!allowZero && value === 0) || value > max) {
    throw new ShipmentInputError(`${what} must be a number ${allowZero ? 'from 0' : 'above 0'} up to ${max}`);
  }
  return value;
}

/**
 * Read a shipment request (HTTP body or agent tool input): a name, a container type and parts with
 * sizes in millimetres. Checked here, at the boundary, so the loader only sees sound numbers.
 */
export function readShipmentInput(body: Record<string, unknown>): ShipmentInput {
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 200) : 'Shipment';
  const type = typeof body.container_type === 'string' ? body.container_type : '40hc';
  if (!containerType(type)) throw new ShipmentInputError(`unknown container_type "${type}"`);
  if (!Array.isArray(body.parts) || body.parts.length === 0 || body.parts.length > MAX_PARTS) throw new ShipmentInputError(`parts must list 1 to ${MAX_PARTS} parts`);
  const ids = new Set<string>();
  const parts = body.parts.map((raw, i): ShipmentPart => {
    if (typeof raw !== 'object' || raw === null) throw new ShipmentInputError(`parts[${i}] must be an object`);
    const p = raw as Record<string, unknown>;
    const label = typeof p.name === 'string' && p.name.trim() ? p.name.trim().slice(0, 120) : `Part ${i + 1}`;
    // Readable, unique cargo-type ids: "tv55b-cushion-top", then "-2" for a repeat.
    const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'part';
    let id = base;
    for (let n = 2; ids.has(id); n++) id = `${base}-${n}`;
    ids.add(id);
    const mm = (key: string) => fromUnit(positive(p[key], `parts[${i}].${key}`, 20_000) / 10, 'cm');
    const massKg = p.mass_kg === undefined || p.mass_kg === null ? undefined : positive(p.mass_kg, `parts[${i}].mass_kg`, 50_000);
    return {
      id,
      name: label,
      length: mm('length_mm'),
      width: mm('width_mm'),
      height: mm('height_mm'),
      quantity: Math.round(positive(p.quantity, `parts[${i}].quantity`, MAX_QUANTITY, true)),
      ...(massKg === undefined ? {} : { mass: Math.round(massKg * 1000) }),
      allowTilt: p.may_tilt !== false,
    };
  });
  // One request makes at most a few dozen containers' worth; far more is a typing mistake, not a shipment.
  const total = parts.reduce((s, p) => s + p.quantity, 0);
  if (total > MAX_QUANTITY) throw new ShipmentInputError(`the parts add up to ${total} pieces; one shipment takes at most ${MAX_QUANTITY}`);
  return { name, containerType: type, parts };
}

export interface CreatedShipment {
  readonly shipment: string;
  readonly containers: ReadonlyArray<{ readonly id: string; readonly name: string; readonly pieces: Readonly<Record<string, number>> }>;
  readonly tooBig: readonly string[];
  readonly explanation: string;
}

/** Plan the shipment and store one container project per container, grouped as one shipment. */
export function createShipment(store: Store, input: ShipmentInput, actor: string): CreatedShipment {
  const shipment = `s-${randomUUID().slice(0, 8)}`;
  const plan = planShipment({ ...input, shipmentId: shipment });
  // Stored last-first so container 1 lists on top, as sample companies do.
  const stored = [...plan.containers]
    .reverse()
    .map((c) => ({ project: store.createProject(c.project, actor, `Loaded ${Object.values(c.pieces).reduce((s, n) => s + n, 0)} pieces for shipment "${input.name}"`, SHIPMENT_COLLECTION + shipment), pieces: c.pieces }))
    .reverse();
  return { shipment, containers: stored.map((s) => ({ id: s.project.id, name: s.project.name, pieces: s.pieces })), tooBig: plan.tooBig, explanation: plan.explanation };
}
