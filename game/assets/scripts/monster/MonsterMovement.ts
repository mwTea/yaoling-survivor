import type { MutableVector2 } from '../shared/Vector2Types';

/**
 * 朝目标以恒定速度移动一步，结果写入调用方持有的输出向量；
 * 单步超过剩余距离时停在目标点，不会越过或抖动。
 */
export function moveTowards(
  current: Readonly<MutableVector2>,
  target: Readonly<MutableVector2>,
  moveSpeed: number,
  deltaTime: number,
  out: MutableVector2,
): void {
  const deltaX = target.x - current.x;
  const deltaY = target.y - current.y;
  const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
  const maxStep = moveSpeed * deltaTime;
  if (distance <= maxStep || distance === 0) {
    out.x = target.x;
    out.y = target.y;
    return;
  }

  const scale = maxStep / distance;
  out.x = current.x + deltaX * scale;
  out.y = current.y + deltaY * scale;
}
