import type { Vec2 } from '../geometry/vec2.js';
import type { MilliDeg } from '../units/angle.js';
import type { Tick } from '../units/length.js';

/** Identifiers are created outside the core (the core never generates randomness). Unique across a project. */
export type Id = string;

export const SCHEMA_VERSION = 1;

export interface Project {
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly id: Id;
  readonly name: string;
  /** Increases by one with every accepted command. */
  readonly revision: number;
  readonly space: Space;
  readonly catalog: Readonly<Record<Id, ItemDefinition>>;
  readonly items: Readonly<Record<Id, ItemInstance>>;
}

export interface Space {
  /** Simple polygon, counter-clockwise, integer ticks. */
  readonly boundary: readonly Vec2[];
  readonly obstacles: readonly Obstacle[];
  readonly doors: readonly Door[];
  /** Missing means height checks report "unknown", never "pass". */
  readonly ceilingHeight?: Tick;
}

export type ObstacleKind = 'column' | 'blocked-zone';

export interface Obstacle {
  readonly id: Id;
  readonly kind: ObstacleKind;
  /** Simple polygon, counter-clockwise, integer ticks. */
  readonly polygon: readonly Vec2[];
}

export interface Door {
  readonly id: Id;
  /** Hinge point; must lie on the space boundary. */
  readonly hinge: Vec2;
  readonly width: Tick;
  /** Direction of the closed leaf from the hinge. */
  readonly angle: MilliDeg;
  /** 'left' opens counter-clockwise from the closed leaf, 'right' clockwise. */
  readonly swing: 'left' | 'right';
}

/**
 * Data an activity pack keeps on an item type or a placed item (stackable, maximum load on top,
 * destination, loading step, cycle time…). The core checks only its shape and never reads it.
 */
export type MetaValue = string | number | boolean;
export type Meta = Readonly<Record<string, MetaValue>>;

/** Which local axis points up when an item lies on its side; missing means upright (Z up). */
export type Tilt = 'x' | 'y';

export interface Size3 {
  /** Along the item's local X (its left-right). */
  readonly w: Tick;
  /** Along the item's local Y (its back-front). */
  readonly d: Tick;
  readonly h: Tick;
}

export interface ItemClearance {
  readonly front: Tick;
  readonly back: Tick;
  readonly left: Tick;
  readonly right: Tick;
}

/** What an item is. Shared by every placed copy. */
export interface ItemDefinition {
  readonly id: Id;
  readonly name: string;
  /** Free tag; its meaning belongs to activity packs, not the core. */
  readonly category: string;
  readonly size: Size3;
  readonly clearance: ItemClearance;
  /** Seats this item contributes to capacity. */
  readonly seats?: number;
  /** Floor outline: a rectangle (default) or an ellipse inscribed in width × depth (round tables, pots). */
  readonly footprint?: 'rect' | 'round';
  /** Mass of one piece in grams. Missing means unknown, so weight checks report "unknown". */
  readonly mass?: number;
  /** Pack-owned data about the type; stored only when not empty. */
  readonly meta?: Meta;
}

/** Where one copy of an item stands. */
export interface ItemInstance {
  readonly id: Id;
  readonly definitionId: Id;
  /** Centre of the footprint. */
  readonly position: Vec2;
  readonly rotation: MilliDeg;
  readonly locked: boolean;
  /**
   * Height of the item's underside above the floor (a shelf on a wall, a lamp over a table).
   * Missing means on the floor; stored only when above zero so floor items keep their old form.
   */
  readonly elevation?: Tick;
  /**
   * The item lies on its side: 'x' puts its local X axis (width) up, 'y' its local Y axis (depth).
   * Missing means upright. Together with `rotation` this covers every orientation of a box.
   */
  readonly tilt?: Tilt;
  /** Pack-owned data about this copy (destination, loading step…); stored only when not empty. */
  readonly meta?: Meta;
}
