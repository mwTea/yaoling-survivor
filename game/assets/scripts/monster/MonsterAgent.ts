import { _decorator, Component, Node, Sprite, Vec3, Color } from 'cc';
import { applyArtSprite } from '../ui/ArtLoader';

import { INITIAL_GAME_CONFIG } from '../config/GameConfig';
import type { MonsterConfig } from '../config/ConfigTypes';
import { INVALID_ENTITY_ID, TargetRegistry } from '../combat/TargetRegistry';
import type { RegisteredTarget } from '../combat/TargetRegistry';
import { MonsterVitals } from '../combat/Combat';
import type { DamageRequest, DamageResult } from '../combat/Combat';
import type { BattleEventBus } from '../core/BattleEventBus';
import type { EntityId } from '../core/BattleEvents';
import type { PoolAcquireContext, PooledObject } from '../pooling/PoolTypes';
import type { MutableVector2 } from '../shared/Vector2Types';
import { moveTowards } from './MonsterMovement';
import { buildMonsterEffectiveStats } from './EliteStats';
import type { DifficultyStatMultipliers, MonsterEffectiveStats } from './EliteStats';

const { ccclass } = _decorator;

/** 怪物出生数据：种类配置 ID、是否精英、世界坐标出生位置。 */
export interface MonsterSpawnData {
  readonly monsterId: string;
  readonly elite: boolean;
  readonly x: number;
  readonly y: number;
}

/** 灰盒精英视觉常量（放大 + 橙红着色）；正式美术替换时调整。 */
const ELITE_SCALE = 1.5;
const ELITE_COLOR = new Color(255, 90, 60, 255);
const NORMAL_COLOR = new Color(255, 255, 255, 255);

/** 战局时间门的最小依赖；`BattleController` 在结构上满足本接口。 */
export interface BattleTimeSource {
  readonly battleDeltaTime: number;
}

/** 回池入口由池所有者（MonsterSpawner）实现；死亡编排完成后调用一次。 */
export interface MonsterPoolAccess {
  releaseAgent(agent: MonsterAgent): void;
}

/** Boss 径向弹幕的发射出口；由 MonsterSpawner 装配（仅 Boss 池注入）。 */
export interface BossBulletAccess {
  fire(data: { originX: number; originY: number; directionX: number; directionY: number; damage: number; sourceEntityId: number }): void;
}

/** 怪物运行期依赖的显式初始化参数；由 MonsterSpawner 装配后注入。 */
export interface MonsterRuntimeContext {
  readonly battle: BattleTimeSource;
  readonly registry: TargetRegistry;
  readonly playerNode: Node;
  readonly events: BattleEventBus;
  readonly pool: MonsterPoolAccess;
  /** 仅 Boss 池注入；普通怪为 undefined。 */
  readonly bossBullets?: BossBulletAccess;
  /** 难度档数值乘数（V08-03 装配注入；缺省 = 普通难度，行为与旧版一致）。 */
  readonly difficultyMultipliers?: DifficultyStatMultipliers;
}

function isMonsterSpawnData(value: unknown): value is MonsterSpawnData {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as { monsterId?: unknown; elite?: unknown; x?: unknown; y?: unknown };
  return (
    typeof candidate.monsterId === 'string' &&
    typeof candidate.elite === 'boolean' &&
    typeof candidate.x === 'number' &&
    typeof candidate.y === 'number'
  );
}

/**
 * 单个怪物的运行态：池化生命周期（分配 entityId、注入配置、重置表现）、
 * 目标注册、向玩家追踪与受击/死亡入口。数值全部来自冻结配置。
 */
@ccclass('MonsterAgent')
export class MonsterAgent extends Component implements PooledObject<MonsterSpawnData>, RegisteredTarget {
  protected context: MonsterRuntimeContext | null = null;
  private vitals: MonsterVitals | null = null;

  public entityId: EntityId = INVALID_ENTITY_ID;
  public monsterId: string | null = null;
  private config: MonsterConfig | null = null;
  private effectiveStats: MonsterEffectiveStats | null = null;
  protected sprite: Sprite | null = null;

  private readonly currentPosition: MutableVector2 = { x: 0, y: 0 };
  private readonly playerPosition: MutableVector2 = { x: 0, y: 0 };
  private readonly nextPosition: MutableVector2 = { x: 0, y: 0 };
  private readonly cocosPosition = new Vec3();

  /** 池工厂创建实例后立即注入运行期依赖；必须在池 acquire 该实例之前调用。 */
  public initialize(context: MonsterRuntimeContext): void {
    this.context = context;
  }

  /** 数值来源钩子；BossAgent 覆写为 Boss 配置。 */
  protected resolveMonsterConfig(monsterId: string): MonsterConfig {
    const monsterConfig = INITIAL_GAME_CONFIG.monsters.find((candidate) => candidate.id === monsterId);
    if (monsterConfig === undefined) {
      throw new Error(`[MonsterAgent] Unknown monsterId "${monsterId}"`);
    }
    return monsterConfig;
  }

  /** 显现钩子（颜色/缩放）；BossAgent 覆写为 Boss 视觉。 */
  protected onAcquireVisual(elite: boolean): void {
    if (this.sprite !== null) {
      this.sprite.color = elite ? ELITE_COLOR : NORMAL_COLOR;
    }
    const eliteScale = elite ? ELITE_SCALE : 1;
    this.node.setScale(eliteScale, eliteScale, 1);
  }

  /** 有效数值快照（含精英强化）；子类只读。 */
  protected get stats(): MonsterEffectiveStats | null {
    return this.effectiveStats;
  }

  public onAcquire(context: PoolAcquireContext<MonsterSpawnData>): void {
    if (this.context === null) {
      throw new Error(`[MonsterAgent] initialize(context) must run before pool "${context.poolKey}" acquires an instance`);
    }
    const data: unknown = context.data;
    if (!isMonsterSpawnData(data)) {
      throw new Error(`[MonsterAgent] Pool "${context.poolKey}" acquire data must contain monsterId, x, y`);
    }
    const monsterConfig = this.resolveMonsterConfig(data.monsterId);

    this.config = monsterConfig;
    this.monsterId = data.monsterId;
    this.effectiveStats = buildMonsterEffectiveStats(
      monsterConfig,
      INITIAL_GAME_CONFIG.eliteModifier,
      data.elite,
      this.context.difficultyMultipliers,
    );
    this.entityId = this.context.registry.register(this);
    if (this.sprite === null) {
      this.sprite = this.node.getComponent(Sprite);
    }
    // 正式美术（V10-14）：按 monsterId 应用切图（Boss 子类同路径，artId=bossId）；
    // 缺图回退灰盒；池按 monsterId 注册，节点与图一一对应。
    applyArtSprite(this.node, data.monsterId);
    this.onAcquireVisual(data.elite);
    this.vitals = new MonsterVitals(data.monsterId, this.effectiveStats.maxHp, this.effectiveStats.xpValue, {
      unregisterTarget: (entityId: EntityId): void => {
        this.context?.registry.unregister(entityId);
        this.entityId = INVALID_ENTITY_ID;
      },
      publishMonsterDied: (payload): void => {
        this.context?.events.emit('monsterDied', payload);
      },
      returnToPool: (): void => {
        this.context?.pool.releaseAgent(this);
      },
    });
    this.node.setPosition(data.x, data.y, 0);
    this.node.active = true;
  }

  public onRelease(): void {
    if (this.entityId !== INVALID_ENTITY_ID && this.context !== null) {
      if (!this.context.registry.unregister(this.entityId)) {
        console.warn(`[MonsterAgent] entityId ${this.entityId} was not registered at release`);
      }
    }
    this.entityId = INVALID_ENTITY_ID;
    this.monsterId = null;
    this.config = null;
    this.effectiveStats = null;
    this.vitals = null;
    // 场景销毁路径（releaseAll）中节点引用可能已失效：判空防护，仅对有效节点执行重置。
    if (this.sprite !== null) {
      this.sprite.color = NORMAL_COLOR;
    }
    if (this.node !== null && this.node.isValid) {
      this.node.setScale(1, 1, 1);
      this.node.setPosition(0, 0, 0);
      this.node.active = false;
    }
  }

  public get currentHp(): number {
    return this.vitals?.currentHp ?? 0;
  }

  /** 伤害结算入口：委托本次激活的 MonsterVitals；空闲/死亡实例拒绝伤害。 */
  public takeDamage(request: DamageRequest): DamageResult {
    if (this.vitals === null || this.context === null) {
      return { status: 'rejected', died: false, reason: 'target_inactive' };
    }
    return this.vitals.takeDamage(request, this.entityId, {
      x: this.node.position.x,
      y: this.node.position.y,
    });
  }

  public readPosition(out: MutableVector2): void {
    out.x = this.node.position.x;
    out.y = this.node.position.y;
  }

  public get collisionRadius(): number {
    return this.effectiveStats?.collisionRadius ?? 0;
  }

  /** 有效接触伤害（含精英强化）；玩家接触检测直接读取。 */
  public get contactDamage(): number {
    return this.effectiveStats?.contactDamage ?? 0;
  }

  public get isElite(): boolean {
    return this.effectiveStats?.isElite ?? false;
  }

  protected override update(): void {
    if (this.config === null || this.context === null) {
      return;
    }
    const deltaTime = this.context.battle.battleDeltaTime;
    if (deltaTime <= 0) {
      return;
    }

    const playerPosition3 = this.context.playerNode.position;
    this.playerPosition.x = playerPosition3.x;
    this.playerPosition.y = playerPosition3.y;
    const ownPosition3 = this.node.position;
    this.currentPosition.x = ownPosition3.x;
    this.currentPosition.y = ownPosition3.y;
    const moveSpeed = this.effectiveStats?.moveSpeed ?? 0;
    moveTowards(this.currentPosition, this.playerPosition, moveSpeed, deltaTime, this.nextPosition);
    this.cocosPosition.set(this.nextPosition.x, this.nextPosition.y, ownPosition3.z);
    this.node.setPosition(this.cocosPosition);
  }
}
