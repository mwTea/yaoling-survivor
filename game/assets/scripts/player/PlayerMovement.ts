import type { MutableVector2 } from './MovementInput';

export interface RectangleBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

/** Calculates one bounded movement step into a caller-owned output object. */
export function moveWithinBounds(
  current: Readonly<MutableVector2>,
  direction: Readonly<MutableVector2>,
  moveSpeed: number,
  deltaTime: number,
  bounds: RectangleBounds,
  out: MutableVector2,
): void {
  let directionX = direction.x;
  let directionY = direction.y;
  const lengthSquared = directionX * directionX + directionY * directionY;
  if (lengthSquared > 1) {
    const inverseLength = 1 / Math.sqrt(lengthSquared);
    directionX *= inverseLength;
    directionY *= inverseLength;
  }

  out.x = clamp(current.x + directionX * moveSpeed * deltaTime, bounds.minX, bounds.maxX);
  out.y = clamp(current.y + directionY * moveSpeed * deltaTime, bounds.minY, bounds.maxY);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

