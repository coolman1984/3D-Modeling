import type { Vec2 } from '../geometry/vec2.js';
import type { Id, ItemDefinition, ItemInstance, Meta, Space, Tilt } from '../model/types.js';
import type { Problem } from '../model/validate.js';
import type { MilliDeg } from '../units/angle.js';
import type { Tick } from '../units/length.js';

/** Every change to a project is one of these. Commands are plain data: easy to send, log and replay. */
export type Command =
  | { readonly type: 'item.add'; readonly item: ItemInstance }
  | { readonly type: 'item.move'; readonly id: Id; readonly to: Vec2 }
  | { readonly type: 'item.rotate'; readonly id: Id; readonly to: MilliDeg }
  /** Raise or lower an item: `to` is the height of its underside above the floor (0 = on the floor). */
  | { readonly type: 'item.elevate'; readonly id: Id; readonly to: Tick }
  | { readonly type: 'item.remove'; readonly id: Id }
  | { readonly type: 'item.lock'; readonly id: Id; readonly locked: boolean }
  /** Lay an item on its side (`to` = the local axis that points up) or stand it upright (null). */
  | { readonly type: 'item.tilt'; readonly id: Id; readonly to: Tilt | null }
  /** Replace an item's pack data; null removes it. Allowed on locked items: it does not move them. */
  | { readonly type: 'item.meta'; readonly id: Id; readonly meta: Meta | null }
  | { readonly type: 'catalog.define'; readonly definition: ItemDefinition }
  | { readonly type: 'catalog.remove'; readonly id: Id }
  | { readonly type: 'space.set'; readonly space: Space }
  | { readonly type: 'project.rename'; readonly name: string }
  | { readonly type: 'batch'; readonly commands: readonly Command[] };

export type RejectCode =
  | 'invalid-payload'
  | 'unknown-command'
  | 'not-found'
  | 'duplicate-id'
  | 'locked'
  | 'in-use'
  | 'broken-reference'
  | 'empty-batch';

/** Why a command was refused. The project is left untouched. */
export interface Rejection {
  readonly code: RejectCode;
  readonly message: string;
  /** For a batch: position of the failing command, outermost first. */
  readonly at?: readonly number[];
  readonly problems?: readonly Problem[];
}
