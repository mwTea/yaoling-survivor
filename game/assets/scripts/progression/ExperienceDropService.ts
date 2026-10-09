import { _decorator, Component, Node, Prefab } from 'cc';

import { BattleController } from '../battle/BattleController';
import { INITIAL_GAME_CONFIG } from '../config/GameConfig';
import { decideExperienceDrop } from './ExperienceDrop';
import { ExperienceGem } from './ExperienceGem';
import type { ExperienceGemContext, ExperienceGemSpawnData, GemPoolAccess } from './ExperienceGem';
import { PoolService } from '../pooling/PoolService';
import type { InstancePool } from '../pooling/Pools';

const { ccclass, property } = _decorator;

const PICKUP_ID = 'xp_gem_basic';
/** 性能调优常量：经验物池初始预热数量；容量来自配置 maxActiveCount。 */
const GEM_PREWARM_COUNT = 8;
/** 守恒诊断日志节奏（战斗秒）。 */
const CONSERVATION_LOG_INTERVAL = 30;
/** 多枚掉落时的散布半径（世界单位）。 */
const DROP_RING_RADIUS = 36;

/**
 * 经验掉落服务：订阅 monsterDied，按死亡位置与 xpValue 生成池化经验物；
 * 达到在场预算时合并进最近的现存经验物（decideExperienceDrop 保证总量守恒）。
 * 事件订阅在 onEnable/onDisable 成对解除。
 */
@ccclass('ExperienceDropService')
export class ExperienceDropService extends Component {
  @property({ type: BattleController })
  private battleController: BattleController | null = null;

  @property({ type: Node })
  private playerNode: Node | null = null;

  @property({ type: Prefab })
  private gemPrefab: Prefab | null = null;

  private gemPool: InstancePool<ExperienceGem, ExperienceGemSpawnData> | null = null;
  private maxActiveGems = 0;
  private readonly activeGems = new Set<ExperienceGem>();
  private unsubscribeDied: (() => void) | null = null;
  private unsubscribeCollected: (() => void) | null = null;
  private totalDroppedXp = 0;
  private totalCollectedXp = 0;
  private totalMergedXp = 0;
  private conservationLogTimer = 0;

  protected override start(): void {
    if (this.battleController === null) {
      throw new Error('[ExperienceDropService] missing reference: battleController ← 把 Systems 节点拖入该属性槽');
    }
    if (this.playerNode === null) {
      throw new Error('[ExperienceDropService] missing reference: playerNode ← 把 Player 节点拖入该属性槽');
    }
    if (this.gemPrefab === null) {
      throw new Error('[ExperienceDropService] missing reference: gemPrefab ← 把 XpGem prefab 拖入该属性槽');
    }

    const battleController = this.battleController;
    const playerNode = this.playerNode;
    const poolService = battleController.getComponent(PoolService);
    if (poolService === null) {
      throw new Error('[ExperienceDropService] Systems 节点缺少 PoolService 组件');
    }
    const pickupConfig = INITIAL_GAME_CONFIG.pickups.find((candidate) => candidate.id === PICKUP_ID);
    if (pickupConfig === undefined) {
      throw new Error(`[ExperienceDropService] Pickup config not found: ${PICKUP_ID}`);
    }
    this.maxActiveGems = pickupConfig.maxActiveCount;

    const poolAccess: GemPoolAccess = {
      releaseGem: (gem: ExperienceGem): void => {
        this.activeGems.delete(gem);
        this.gemPool?.release(gem);
      },
    };
    const gemContext: ExperienceGemContext = {
      battle: battleController,
      playerNode,
      events: battleController.events,
      pool: poolAccess,
      pickupRadius: pickupConfig.pickupRadius,
    };
    this.gemPool = poolService.registerNodePool(
      pickupConfig.id,
      this.gemPrefab,
      ExperienceGem,
      { prewarmCount: GEM_PREWARM_COUNT, maxCapacity: pickupConfig.maxActiveCount },
      (gem) => gem.initialize(gemContext),
    );
    console.log(
      `[ExperienceDropService] ${PICKUP_ID}: pickupRadius=${pickupConfig.pickupRadius} ` +
        `maxActive=${pickupConfig.maxActiveCount}`,
    );
  }

  protected override onEnable(): void {
    if (this.battleController === null) {
      return;
    }
    this.unsubscribeDied = this.battleController.events.on('monsterDied', (payload) => {
      this.handleMonsterDied(payload.xpValue, payload.position.x, payload.position.y);
    });
    this.unsubscribeCollected = this.battleController.events.on('experienceCollected', (payload) => {
      this.totalCollectedXp += payload.amount;
    });
  }

  protected override onDisable(): void {
    this.unsubscribeDied?.();
    this.unsubscribeDied = null;
    this.unsubscribeCollected?.();
    this.unsubscribeCollected = null;
  }

  protected override update(): void {
    if (this.battleController === null) {
      return;
    }
    const deltaTime = this.battleController.battleDeltaTime;
    if (deltaTime <= 0) {
      return;
    }
    this.conservationLogTimer += deltaTime;
    if (this.conservationLogTimer >= CONSERVATION_LOG_INTERVAL) {
      this.conservationLogTimer -= CONSERVATION_LOG_INTERVAL;
      const onFieldXp = this.sumActiveGemAmounts();
      console.log(
        `[ExperienceDropService] xp dropped=${this.totalDroppedXp} collected=${this.totalCollectedXp} ` +
          `merged=${this.totalMergedXp} onField=${onFieldXp} gems=${this.activeGems.size}`,
      );
    }
  }

  private handleMonsterDied(xpValue: number, deathX: number, deathY: number): void {
    if (this.gemPool === null) {
      return;
    }
    this.totalDroppedXp += xpValue;

    // 掉落粒度 = 1：精英（xpValue>1）按数值拆成多枚环形散布，总量守恒。
    const gemCount = Math.max(1, Math.round(xpValue));
    for (let index = 0; index < gemCount; index += 1) {
      const angle = (Math.PI * 2 * index) / gemCount;
      const offsetX = gemCount === 1 ? 0 : Math.cos(angle) * DROP_RING_RADIUS;
      const offsetY = gemCount === 1 ? 0 : Math.sin(angle) * DROP_RING_RADIUS;
      this.dropSingleGem(1, deathX + offsetX, deathY + offsetY);
    }
  }

  private dropSingleGem(amount: number, dropX: number, dropY: number): void {
    if (this.gemPool === null) {
      return;
    }
    const nearest = this.findNearestActiveGem(dropX, dropY);
    const decision = decideExperienceDrop(this.activeGems.size, this.maxActiveGems, nearest !== null);
    if (decision === 'merge' && nearest !== null) {
      nearest.addAmount(amount);
      this.totalMergedXp += amount;
      return;
    }

    const gem = this.gemPool.acquire({ x: dropX, y: dropY, amount });
    this.activeGems.add(gem);
  }

  private findNearestActiveGem(x: number, y: number): ExperienceGem | null {
    let nearest: ExperienceGem | null = null;
    let bestDistanceSquared = Number.POSITIVE_INFINITY;
    for (const gem of this.activeGems) {
      const position = gem.node.position;
      const deltaX = position.x - x;
      const deltaY = position.y - y;
      const distanceSquared = deltaX * deltaX + deltaY * deltaY;
      if (distanceSquared < bestDistanceSquared) {
        bestDistanceSquared = distanceSquared;
        nearest = gem;
      }
    }
    return nearest;
  }

  private sumActiveGemAmounts(): number {
    let total = 0;
    for (const gem of this.activeGems) {
      total += gem.amount;
    }
    return total;
  }
}
