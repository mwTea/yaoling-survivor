import type { RectangleBoundsConfig } from '../config/ConfigTypes';
import type { MutableVector2 } from '../shared/Vector2Types';

/**
 * 相机跟随的纯数学（World 容器方案）：视口中心跟随玩家，但夹紧在世界
 * 边界内不露黑边；World 容器位置 = 视口中心的反向。
 * 视口小于世界时正常夹紧；视口大于世界（极端配置）时居中。
 */
export function computeWorldOffset(
  playerX: number,
  playerY: number,
  playArea: RectangleBoundsConfig,
  viewWidth: number,
  viewHeight: number,
  out: MutableVector2,
): void {
  const worldWidth = playArea.maxX - playArea.minX;
  const worldHeight = playArea.maxY - playArea.minY;
  const clampRangeX = Math.max(0, (worldWidth - viewWidth) / 2);
  const clampRangeY = Math.max(0, (worldHeight - viewHeight) / 2);
  const centerX = (playArea.minX + playArea.maxX) / 2;
  const centerY = (playArea.minY + playArea.maxY) / 2;

  const targetX = clampRangeX === 0 ? centerX : clamp(playerX, playArea.minX + viewWidth / 2, playArea.maxX - viewWidth / 2);
  const targetY = clampRangeY === 0 ? centerY : clamp(playerY, playArea.minY + viewHeight / 2, playArea.maxY - viewHeight / 2);

  // 0 - x 代替 -x：避免 -0 混入偏移值。
  out.x = 0 - targetX;
  out.y = 0 - targetY;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
