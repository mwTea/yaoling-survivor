import type { MutableVector2 } from '../shared/Vector2Types';

export type { MutableVector2 };

/** Input adapters write a normalized movement intent without allocating. */
export interface MovementInput {
  writeDirection(out: MutableVector2): void;
}
