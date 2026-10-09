import { _decorator, Component, Node } from 'cc';
import { applyArtSprite } from '../ui/ArtLoader';

import type { BattleTimeSource } from '../monster/MonsterAgent';
import type { BattleEventBus } from '../core/BattleEventBus';
import type { PoolAcquireContext, PooledObject } from '../pooling/PoolTypes';

const { ccclass } = _decorator;

/** 经验物出生数据：掉落位置与初始经验值。 */
export interface ExperienceGemSpawnData {
  readonly x: number;
  readonly y: number;
  readonly amount: number;
}

/** 回池入口由掉落服务（池所有者）实现。 */
export interface GemPoolAccess {
  releaseGem(gem: ExperienceGem): void;
}

/** 经验物运行期依赖；由 ExperienceDropService 装配后注入。 */
export interface ExperienceGemContext {
  readonly battle: BattleTimeSource;
  readonly playerNode: Node;
  readonly events: BattleEventBus;
  readonly pool: GemPoolAccess;
  readonly pickupRadius: number;
}

/**
 * 池化经验物：静止在掉落位置，玩家进入拾取半径即收集。
 * 收集顺序固定：先标记已收集（幂等，重复接触只结算一次）→ 发布一次
 * experienceCollected → 回池。仅在 battleDeltaTime > 0 时检测拾取（暂停不拾取）。
 */
@ccclass('ExperienceGem')
export class ExperienceGem extends Component implements PooledObject<ExperienceGemSpawnData> {
  private context: ExperienceGemContext | null = null;

  public amount = 0;
  private collected = false;

  /** 池工厂创建实例后立即注入依赖；必须在池 acquire 该实例之前调用。 */
  public initialize(context: ExperienceGemContext): void {
    this.context = context;
  }

  /** 预算合并：把新掉落的经验叠加到现存经验物上，总量守恒。 */
  public addAmount(value: number): void {
    if (this.collected || value <= 0) {
      return;
    }
    this.amount += value;
  }

  public onAcquire(context: PoolAcquireContext<ExperienceGemSpawnData>): void {
    // 正式美术（V10-14）：切图应用；用户定案小光点尺寸（20×20），拾取判定与显示无关。
    applyArtSprite(this.node, 'xp_gem', { width: 20, height: 20 });
    if (this.context === null) {
      throw new Error(`[ExperienceGem] initialize(context) must run before pool "${context.poolKey}" acquires an instance`);
    }
    const data = context.data;
    if (typeof data?.x !== 'number' || typeof data?.y !== 'number' || typeof data?.amount !== 'number') {
      throw new Error(`[ExperienceGem] Pool "${context.poolKey}" acquire data must contain x, y, amount`);
    }

    this.amount = data.amount;
    this.collected = false;
    this.node.setPosition(data.x, data.y, 0);
    this.node.active = true;
  }

  public onRelease(): void {
    this.amount = 0;
    // 场景销毁路径（releaseAll）中节点引用可能已失效：判空防护，仅对有效节点执行重置。
    this.collected = false;
    if (this.node !== null && this.node.isValid) {
      this.node.setPosition(0, 0, 0);
      this.node.active = false;
    }
  }

  protected override update(): void {
    if (this.context === null || this.collected) {
      return;
    }
    const deltaTime = this.context.battle.battleDeltaTime;
    if (deltaTime <= 0) {
      return;
    }

    const playerPosition = this.context.playerNode.position;
    const position = this.node.position;
    const deltaX = playerPosition.x - position.x;
    const deltaY = playerPosition.y - position.y;
    const pickupRange = this.context.pickupRadius;
    if (deltaX * deltaX + deltaY * deltaY > pickupRange * pickupRange) {
      return;
    }

    this.collected = true;
    this.context.events.emit('experienceCollected', { amount: this.amount });
    this.context.pool.releaseGem(this);
  }
}
