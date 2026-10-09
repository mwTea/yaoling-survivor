import type { EntityId } from '../core/BattleEvents';
import type { MutableVector2 } from '../shared/Vector2Types';
import type { RegisteredTarget } from './TargetRegistry';

/** 可枚举的当前有效目标集合；`TargetRegistry` 在结构上满足本接口。 */
export interface TargetEnumerable {
  forEachTarget(action: (target: RegisteredTarget, entityId: EntityId) => void): void;
}

export interface TargetQueryHit {
  readonly entityId: EntityId;
  readonly target: RegisteredTarget;
}

/** 目标查询接口：实现可替换为空间分区，武器组件不得感知查询细节。 */
export interface TargetQuery {
  /**
   * 返回与原点距离不超过 maxRadius 的最近有效目标；相同距离取 entityId
   * 较小者保证可复现；无目标返回 null。返回对象在下次查询前有效。
   */
  findNearestTarget(originX: number, originY: number, maxRadius: number): TargetQueryHit | null;
}

/** MVP 目标查询：对注册表做一次有界线性扫描。 */
export class NearestTargetQuery implements TargetQuery {
  private readonly enumerable: TargetEnumerable;
  private readonly scratchPosition: MutableVector2 = { x: 0, y: 0 };

  constructor(enumerable: TargetEnumerable) {
    this.enumerable = enumerable;
  }

  public findNearestTarget(originX: number, originY: number, maxRadius: number): TargetQueryHit | null {
    let bestDistanceSquared = maxRadius * maxRadius;
    let bestEntityId: EntityId = 0;
    let bestTarget: RegisteredTarget | null = null;

    this.enumerable.forEachTarget((target, entityId) => {
      target.readPosition(this.scratchPosition);
      const deltaX = this.scratchPosition.x - originX;
      const deltaY = this.scratchPosition.y - originY;
      const distanceSquared = deltaX * deltaX + deltaY * deltaY;
      const beatsCurrent =
        bestTarget === null
          ? distanceSquared <= bestDistanceSquared
          : distanceSquared < bestDistanceSquared ||
            (distanceSquared === bestDistanceSquared && entityId < bestEntityId);
      if (beatsCurrent) {
        bestDistanceSquared = distanceSquared;
        bestEntityId = entityId;
        bestTarget = target;
      }
    });

    if (bestTarget === null) {
      return null;
    }
    return { entityId: bestEntityId, target: bestTarget };
  }
}
