import type { Vec2 } from '../geometry/vec2.js';
import type { Id, ItemDefinition, ItemInstance, Space } from '../model/types.js';
import type { Problem } from '../model/validate.js';
import type { MilliDeg } from '../units/angle.js';

/** Every change to a project is one of these. Commands are plain data: easy to send, log and replay. */
export type Command =
  | { readonly type: 'item.add'; readonly item: ItemInstance }
  | { readonly type: 'item.move'; readonly id: Id; readonly to: Vec2 }
  | { readonly type: 'item.rotate'; readonly id: Id; readonly to: MilliDeg }
  | { readonly type: 'item.remove'; readonly id: Id }
  | { readonly type: 'item.lock'; readonly id: Id; readonly locked: boolean }
  | { readonly type: 'catalog.define'; readonly definition: ItemDefinition }
  | { readonly type: 'catalog.remove'; readonly id: Id }
  | { readonly type: 'space.set'; readonly space: Space }
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
