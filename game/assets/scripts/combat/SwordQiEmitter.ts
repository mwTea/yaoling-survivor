import { _decorator, Component, Node, Prefab } from 'cc';

import { ActiveStage } from '../battle/ActiveStage';
import { BattleController } from '../battle/BattleController';
import { INITIAL_GAME_CONFIG } from '../config/GameConfig';
import { ProgressionSystem } from '../progression/ProgressionSystem';
import { CooldownTimer } from './CooldownTimer';
import { SwordProjectile } from './SwordProjectile';
import type { SwordPoolAccess, SwordRuntimeContext, SwordSpawnData } from './SwordProjectile';
import { NearestTargetQuery } from './TargetQuery';
import type { TargetQuery } from './TargetQuery';
import { TargetRegistryComponent } from './TargetRegistryComponent';
import { PoolService } from '../pooling/PoolService';
import type { InstancePool } from '../pooling/Pools';

const { ccclass, property } = _decorator;

const SWORD_QI_PROJECTILE_ID = 'projectile_sword_qi';
const SWORD_QI_PREWARM_COUNT = 2;
const SWORD_QI_MAX_ACTIVE = 16;
const SWORD_QI_SOURCE_ENTITY_ID = 0;
const SWORD_QI_SPREAD_DEGREES = 10;
const DEGREES_TO_RADIANS = Math.PI / 180;

/**
 * 功法"剑气冲击"发射器：按 addSwordQi 效果的 intervalSeconds 周期，向最近
 * 目标方向发射 swordQiCount 道穿透剑气（伤害 = 主武器伤害 × damageFactor）。
 * 剑气独立池（容量/参数来自 projectile_sword_qi 配置），复用 SwordProjectile
 * 组件与 prefab；未获得功法（count=0）时不发射也不冷却触发。
 */
@ccclass('SwordQiEmitter')
export class SwordQiEmitter extends Component {
  @property({ type: BattleController })
  private battleController: BattleController | null = null;

  @property({ type: Node })
  private playerNode: Node | null = null;

  @property({ type: Prefab })
  private swordPrefab: Prefab | null = null;

  private stats: ProgressionSystem['stats'] | null = null;
  private gongfa: ProgressionSystem['gongfa'] | null = null;
  private intervalSeconds = 3;
  private damageFactor = 0.6;
  private attackRadius = 0;
  private burstTimer: CooldownTimer | null = null;
  private query: TargetQuery | null = null;
  private pool: InstancePool<SwordProjectile, SwordSpawnData> | null = null;
  private totalFiredCount = 0;

  protected override start(): void {
    if (this.battleController === null) {
      throw new Error('[SwordQiEmitter] missing reference: battleController ← 把 Systems 节点拖入该属性槽');
    }
    if (this.playerNode === null) {
      throw new Error('[SwordQiEmitter] missing reference: playerNode ← 把 Player 节点拖入该属性槽');
    }
    if (this.swordPrefab === null) {
      throw new Error('[SwordQiEmitter] missing reference: swordPrefab ← 把 SwordGray prefab 拖入该属性槽');
    }

    const battleController = this.battleController;
    const progression = battleController.getComponent(ProgressionSystem);
    if (progression === null) {
      throw new Error('[SwordQiEmitter] Systems 节点缺少 ProgressionSystem 组件');
    }
    if (progression.stats === null) {
      throw new Error('[SwordQiEmitter] ProgressionSystem 尚未初始化战斗运行态');
    }
    this.stats = progression.stats;
    this.gongfa = progression.gongfa;

    const effect = INITIAL_GAME_CONFIG.gongfas
      .find((candidate) => candidate.id === 'gongfa_sword_qi')
      ?.effects.find((candidate): candidate is Extract<typeof candidate, { kind: 'addSwordQi' }> => candidate.kind === 'addSwordQi');
    if (effect === undefined) {
      throw new Error('[SwordQiEmitter] gongfa_sword_qi缺少 addSwordQi 效果配置');
    }
    this.intervalSeconds = effect.intervalSeconds;
    this.damageFactor = effect.damageFactor;

    const weaponConfig = INITIAL_GAME_CONFIG.weapons.find(
      (candidate) => candidate.id === 'weapon_qingxiao_sword',
    );
    if (weaponConfig === undefined) {
      throw new Error('[SwordQiEmitter] weapon_qingxiao_sword 不存在');
    }
    this.attackRadius = weaponConfig.attackRadius;

    const poolService = battleController.getComponent(PoolService);
    if (poolService === null) {
      throw new Error('[SwordQiEmitter] Systems 节点缺少 PoolService 组件');
    }
    const registryComponent = battleController.getComponent(TargetRegistryComponent);
    if (registryComponent === null) {
      throw new Error('[SwordQiEmitter] Systems 节点缺少 TargetRegistryComponent 组件');
    }
    const projectileConfig = INITIAL_GAME_CONFIG.projectiles.find(
      (candidate) => candidate.id === SWORD_QI_PROJECTILE_ID,
    );
    if (projectileConfig === undefined) {
      throw new Error(`[SwordQiEmitter] Projectile not found: ${SWORD_QI_PROJECTILE_ID}`);
    }
    const stage = ActiveStage.current.stage;

    const poolAccess: SwordPoolAccess = {
      releaseSword: (sword: SwordProjectile): void => {
        this.pool?.release(sword);
      },
    };
    const runtimeContext: SwordRuntimeContext = {
      battle: battleController,
      registry: registryComponent.registry,
      playArea: stage.playArea,
      pool: poolAccess,
    };
    this.pool = poolService.registerNodePool(
      SWORD_QI_PROJECTILE_ID,
      this.swordPrefab,
      SwordProjectile,
      { prewarmCount: SWORD_QI_PREWARM_COUNT, maxCapacity: SWORD_QI_MAX_ACTIVE },
      (sword) => sword.initialize(runtimeContext),
    );
    this.query = new NearestTargetQuery(registryComponent.registry);
    this.burstTimer = new CooldownTimer(this.intervalSeconds);
  }

  protected override update(): void {
    if (
      this.battleController === null ||
      this.playerNode === null ||
      this.stats === null ||
      this.gongfa === null ||
      this.burstTimer === null ||
      this.query === null ||
      this.pool === null
    ) {
      return;
    }
    const deltaTime = this.battleController.battleDeltaTime;
    if (deltaTime <= 0) {
      return;
    }

    const swordQiCount = this.gongfa.swordQiCount;
    if (swordQiCount <= 0) {
      return;
    }

    this.burstTimer.advance(deltaTime);
    if (!this.burstTimer.isReady) {
      return;
    }

    const playerPosition = this.playerNode.position;
    const hit = this.query.findNearestTarget(playerPosition.x, playerPosition.y, this.attackRadius);
    if (hit === null) {
      return;
    }

    this.fireBurst(hit, swordQiCount, playerPosition.x, playerPosition.y);
    this.burstTimer.trigger();
  }

  private fireBurst(hit: { target: { readPosition(out: { x: number; y: number }): void } }, count: number, originX: number, originY: number): void {
    if (this.pool === null || this.stats === null) {
      return;
    }
    const targetPosition = { x: 0, y: 0 };
    hit.target.readPosition(targetPosition);
    let directionX = targetPosition.x - originX;
    let directionY = targetPosition.y - originY;
    const length = Math.hypot(directionX, directionY);
    if (length === 0) {
      directionX = 1;
      directionY = 0;
    } else {
      directionX /= length;
      directionY /= length;
    }

    const projectileConfig = INITIAL_GAME_CONFIG.projectiles.find(
      (candidate) => candidate.id === SWORD_QI_PROJECTILE_ID,
    );
    if (projectileConfig === undefined) {
      return;
    }
    const damage = Math.floor(this.stats.swordDamage * this.damageFactor);
    const spreadRadians = SWORD_QI_SPREAD_DEGREES * DEGREES_TO_RADIANS;
    for (let index = 0; index < count; index += 1) {
      const offset = (index - (count - 1) / 2) * spreadRadians;
      const cosOffset = Math.cos(offset);
      const sinOffset = Math.sin(offset);
      this.pool.acquire({
        originX,
        originY,
        directionX: directionX * cosOffset - directionY * sinOffset,
        directionY: directionX * sinOffset + directionY * cosOffset,
        damage,
        speed: projectileConfig.speed,
        lifetimeSeconds: projectileConfig.lifetime,
        collisionRadius: projectileConfig.collisionRadius,
        sourceEntityId: SWORD_QI_SOURCE_ENTITY_ID,
      });
      this.totalFiredCount += 1;
    }
  }
}
