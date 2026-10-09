import { _decorator, Component, Vec3 } from 'cc';
import { applyArtSprite } from '../ui/ArtLoader';

import type { RectangleBoundsConfig } from '../config/ConfigTypes';
import { MonsterAgent } from '../monster/MonsterAgent';
import type { BattleTimeSource } from '../monster/MonsterAgent';
import type { EntityId } from '../core/BattleEvents';
import type { PoolAcquireContext, PooledObject } from '../pooling/PoolTypes';
import type { MutableVector2 } from '../shared/Vector2Types';
import type { RegisteredTarget, TargetRegistry } from './TargetRegistry';

const { ccclass } = _decorator;

/** 飞剑出生数据：直线方向（已归一化）与本次激活的全部数值快照。 */
export interface SwordSpawnData {
  readonly originX: number;
  readonly originY: number;
  readonly directionX: number;
  readonly directionY: number;
  readonly damage: number;
  readonly speed: number;
  readonly lifetimeSeconds: number;
  readonly collisionRadius: number;
  readonly sourceEntityId: EntityId;
}

/** 回池入口由武器（池所有者）实现。 */
export interface SwordPoolAccess {
  releaseSword(sword: SwordProjectile): void;
}

/** 飞剑运行期依赖；由 AutoSwordWeapon 装配后注入。 */
export interface SwordRuntimeContext {
  readonly battle: BattleTimeSource;
  readonly registry: TargetRegistry;
  readonly playArea: RectangleBoundsConfig;
  readonly pool: SwordPoolAccess;
}

function isSwordSpawnData(value: unknown): value is SwordSpawnData {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.originX === 'number' &&
    typeof candidate.originY === 'number' &&
    typeof candidate.directionX === 'number' &&
    typeof candidate.directionY === 'number' &&
    typeof candidate.damage === 'number' &&
    typeof candidate.speed === 'number' &&
    typeof candidate.lifetimeSeconds === 'number' &&
    typeof candidate.collisionRadius === 'number' &&
    typeof candidate.sourceEntityId === 'number'
  );
}

const DEGREES_TO_RADIANS = Math.PI / 180;

/**
 * 池化飞剑：直线飞行，穿透命中（同一激活对同一 entityId 只结算一次），
 * 超时或飞出关卡边界后回池。命中判定为半径和的圆形重叠，全场线性扫描
 * 一次（MVP 规模可接受，后续可换空间分区）。仅在 battleDeltaTime > 0 推进。
 */
@ccclass('SwordProjectile')
export class SwordProjectile extends Component implements PooledObject<SwordSpawnData> {
  private context: SwordRuntimeContext | null = null;

  private directionX = 0;
  private directionY = 0;
  private travelSpeed = 0;
  private remainingLifetime = 0;
  private damageAmount = 0;
  private swordCollisionRadius = 0;
  private sourceEntityId: EntityId = 0;
  private readonly hitEntityIds = new Set<EntityId>();
  private readonly hitCheckScratch: MutableVector2 = { x: 0, y: 0 };
  private readonly cocosPosition = new Vec3();

  /** 池工厂创建实例后立即注入依赖；必须在池 acquire 该实例之前调用。 */
  public initialize(context: SwordRuntimeContext): void {
    this.context = context;
  }

  public onAcquire(context: PoolAcquireContext<SwordSpawnData>): void {
    // 正式美术（V10-14）：切图应用；缺图回退灰盒。
    applyArtSprite(this.node, 'proj_qingxiao_sword');
    if (this.context === null) {
      throw new Error(`[SwordProjectile] initialize(context) must run before pool "${context.poolKey}" acquires an instance`);
    }
    const data: unknown = context.data;
    if (!isSwordSpawnData(data)) {
      throw new Error(`[SwordProjectile] Pool "${context.poolKey}" acquire data is incomplete`);
    }

    this.directionX = data.directionX;
    this.directionY = data.directionY;
    this.travelSpeed = data.speed;
    this.remainingLifetime = data.lifetimeSeconds;
    this.damageAmount = data.damage;
    this.swordCollisionRadius = data.collisionRadius;
    this.sourceEntityId = data.sourceEntityId;
    this.hitEntityIds.clear();
    this.node.setPosition(data.originX, data.originY, 0);
    this.node.angle = -Math.atan2(data.directionY, data.directionX) / DEGREES_TO_RADIANS;
    this.node.active = true;
  }

  public onRelease(): void {
    this.directionX = 0;
    this.directionY = 0;
    this.travelSpeed = 0;
    this.remainingLifetime = 0;
    this.damageAmount = 0;
    this.swordCollisionRadius = 0;
    this.sourceEntityId = 0;
    // 热重载混合产物下字段初始化器可能缺失：防御性判空（正常实例恒非空）。
    this.hitEntityIds?.clear();
    // 场景销毁路径（releaseAll）中节点引用可能已失效：判空防护，仅对有效节点执行重置。
    if (this.node !== null && this.node.isValid) {
      this.node.setPosition(0, 0, 0);
      this.node.angle = 0;
      this.node.active = false;
    }
  }

  protected override update(): void {
    if (this.context === null) {
      return;
    }
    const deltaTime = this.context.battle.battleDeltaTime;
    if (deltaTime <= 0) {
      return;
    }

    this.remainingLifetime -= deltaTime;
    if (this.remainingLifetime <= 0) {
      this.context.pool.releaseSword(this);
      return;
    }

    const step = this.travelSpeed * deltaTime;
    const position = this.node.position;
    const nextX = position.x + this.directionX * step;
    const nextY = position.y + this.directionY * step;
    this.cocosPosition.set(nextX, nextY, position.z);
    this.node.setPosition(this.cocosPosition);

    const playArea = this.context.playArea;
    if (nextX < playArea.minX || nextX > playArea.maxX || nextY < playArea.minY || nextY > playArea.maxY) {
      this.context.pool.releaseSword(this);
      return;
    }

    this.context.registry.forEachTarget(this.checkHit);
  }

  private readonly checkHit = (target: RegisteredTarget, entityId: EntityId): void => {
    if (this.context === null || !(target instanceof MonsterAgent)) {
      return;
    }
    if (this.hitEntityIds.has(entityId)) {
      return;
    }

    target.readPosition(this.hitCheckScratch);
    const hitRange = this.swordCollisionRadius + target.collisionRadius;
    const position = this.node.position;
    const deltaX = this.hitCheckScratch.x - position.x;
    const deltaY = this.hitCheckScratch.y - position.y;
    if (deltaX * deltaX + deltaY * deltaY > hitRange * hitRange) {
      return;
    }

    this.hitEntityIds.add(entityId);
    target.takeDamage({
      sourceEntityId: this.sourceEntityId,
      targetEntityId: entityId,
      amount: this.damageAmount,
      damageType: 'sword',
    });
  };
}
