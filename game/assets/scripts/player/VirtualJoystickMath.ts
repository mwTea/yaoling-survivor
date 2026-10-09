import type { MutableVector2 } from './MovementInput';

/** Resolves clamped handle position and normalized movement without allocation. */
export function resolveVirtualJoystick(
  displacementX: number,
  displacementY: number,
  radius: number,
  deadZoneRatio: number,
  outHandle: MutableVector2,
  outDirection: MutableVector2,
): void {
  const distance = Math.hypot(displacementX, displacementY);
  const scale = distance > radius && distance > 0 ? radius / distance : 1;
  outHandle.x = displacementX * scale;
  outHandle.y = displacementY * scale;

  const normalizedDistance = Math.min(distance / radius, 1);
  if (normalizedDistance <= deadZoneRatio || distance === 0) {
    outDirection.x = 0;
    outDirection.y = 0;
    return;
  }

  outDirection.x = outHandle.x / radius;
  outDirection.y = outHandle.y / radius;
}

