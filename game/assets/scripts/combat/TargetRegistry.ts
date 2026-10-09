import type { EntityId } from '../core/BattleEvents';
import type { MutableVector2 } from '../shared/Vector2Types';

/** 保留给"未分配/已回收"状态的实体 ID；有效 ID 从 1 递增。 */
export const INVALID_ENTITY_ID: EntityId = 0;

/** 注册进目标注册表的最小目标契约：能写出自身位置并暴露碰撞半径。 */
export interface RegisteredTarget {
  readPosition(out: MutableVector2): void;
  readonly collisionRadius: number;
}

/**
 * 有效目标注册表：一次激活对应一个唯一 entityId，回池注销后旧 ID 立即失效。
 *
 * entityId 由注册表统一分配，保证同一注册表内不重复；过期引用（旧 ID、已回池
 * 实例）查询 `isValid` 为 false，武器/目标查询（T09）只读取当前有效集合。
 * MVP 使用 Map 全量集合，接口不暴露内部结构，后续可替换为空间分区实现。
 */
export class TargetRegistry {
  private nextEntityId: EntityId = 1;
  private readonly targets = new Map<EntityId, RegisteredTarget>();

  public get count(): number {
    return this.targets.size;
  }

  /** 注册一个新激活的目标，返回本次激活专属的 entityId。 */
  public register(target: RegisteredTarget): EntityId {
    const entityId = this.nextEntityId;
    this.nextEntityId += 1;
    this.targets.set(entityId, target);
    return entityId;
  }

  /** 注销一个激活；返回 false 表示该 ID 本就不在注册表中（状态不一致，开发期应报警）。 */
  public unregister(entityId: EntityId): boolean {
    return this.targets.delete(entityId);
  }

  public isValid(entityId: EntityId): boolean {
    return this.targets.has(entityId);
  }

  /** 遍历当前有效目标（快照迭代，回调内注销安全）；武器目标查询与验收夹具复用。 */
  public forEachTarget(action: (target: RegisteredTarget, entityId: EntityId) => void): void {
    for (const [entityId, target] of Array.from(this.targets)) {
      action(target, entityId);
    }
  }
}
