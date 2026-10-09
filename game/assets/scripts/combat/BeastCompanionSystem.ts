import { _decorator, Component, Node, Prefab } from 'cc';

import { ActiveStage } from '../battle/ActiveStage';
import { BattleController } from '../battle/BattleController';
import { INITIAL_GAME_CONFIG } from '../config/GameConfig';
import { ProgressionSystem } from '../progression/ProgressionSystem';
import { PlayerAgent } from '../player/PlayerAgent';
import {
  BeastCompanionTrigger,
  createBeastCompanionPlan,
} from './BeastCompanionTrigger';
import type { BeastCompanionPlan } from './BeastCompanionTrigger';
import { SwordProjectile } from './SwordProjectile';
import type { SwordPoolAccess, SwordRuntimeContext, SwordSpawnData } from './SwordProjectile';
import { NearestTargetQuery } from './TargetQuery';
import type { TargetQuery } from './TargetQuery';
import { TargetRegistryComponent } from './TargetRegistryComponent';
import { PoolService } from '../pooling/PoolService';
import type { InstancePool } from '../pooling/Pools';

const { ccclass, property } = _decorator;

/** 灵兽投射物池 key（独立于剑气池）；灰盒参数复用 projectile_sword_qi 配置。 */
const BEAST_PROJECTILE_POOL_KEY = 'projectile_beast_companion';
const BEAST_PROJECTILE_CONFIG_ID = 'projectile_sword_qi';
const BEAST_PROJECTILE_PREWARM_COUNT = 2;
const BEAST_PROJECTILE_MAX_ACTIVE = 16;
const BEAST_SOURCE_ENTITY_ID = 0;
const BEAST_SPREAD_DEGREES = 10;
const DEGREES_TO_RADIANS = Math.PI / 180;

/**
 * 出战灵兽触发技能（V05-08）：按出战快照（ProgressionSystem.loadout.deployedBeast）
 * 的技能配置周期触发——damageNearest 向最近目标发射投射物（复用 SwordProjectile 池
 * 与命中链路，无目标保持 due 重试），heal 回复玩家生命（PlayerAgent 统一入口）。
 * 未出战灵兽时系统空闲；暂停由 battleDeltaTime=0 + 触发器 running 门控双重冻结；
 * 数值全部来自 BeastConfig，战斗中不回写账号。
 */
@ccclass('BeastCompanionSystem')
export class BeastCompanionSystem extends Component {
  @property({ type: BattleController })
  private battleController: BattleController | null = null;

  @property({ type: Node })
  private playerNode: Node | null = null;

  @property({ type: Prefab })
  private swordPrefab: Prefab | null = null;

  private plan: BeastCompanionPlan | null = null;
  private trigger: BeastCompanionTrigger | null = null;
  private query: TargetQuery | null = null;
  private pool: InstancePool<SwordProjectile, SwordSpawnData> | null = null;
  private playerAgent: PlayerAgent | null = null;
  private attackRadius = 0;

  protected override start(): void {
    if (this.battleController === null) {
      throw new Error('[BeastCompanionSystem] missing reference: battleController ← 把 Systems 节点拖入该属性槽');
    }
    if (this.playerNode === null) {
      throw new Error('[BeastCompanionSystem] missing reference: playerNode ← 把 Player 节点拖入该属性槽');
    }

    const battleController = this.battleController;
    const progression = battleController.getComponent(ProgressionSystem);
    if (progression === null) {
      throw new Error('[BeastCompanionSystem] Systems 节点缺少 ProgressionSystem 组件');
    }
    const deployed = progression.loadout.deployedBeast;
    if (deployed === null) {
      console.log('[BeastCompanionSystem] no deployed beast, system idle');
      return;
    }

    this.plan = createBeastCompanionPlan(deployed.skill);
    this.trigger = new BeastCompanionTrigger(this.plan);

    if (this.plan.kind === 'heal') {
      this.playerAgent = this.playerNode.getComponent(PlayerAgent);
      if (this.playerAgent === null) {
        throw new Error('[BeastCompanionSystem] Player 节点缺少 PlayerAgent 组件（heal 技能需要）');
      }
      console.log(
        `[BeastCompanionSystem] beast ${deployed.beastId} heal skill: every ${this.plan.intervalSeconds}s +${this.plan.healValue}`,
      );
      return;
    }

    if (this.swordPrefab === null) {
      throw new Error('[BeastCompanionSystem] missing reference: swordPrefab ← 把 SwordGray prefab 拖入该属性槽');
    }
    this.playerAgent = this.playerNode.getComponent(PlayerAgent);
    const poolService = battleController.getComponent(PoolService);
    if (poolService === null) {
      throw new Error('[BeastCompanionSystem] Systems 节点缺少 PoolService 组件');
    }
    const registryComponent = battleController.getComponent(TargetRegistryComponent);
    if (registryComponent === null) {
      throw new Error('[BeastCompanionSystem] Systems 节点缺少 TargetRegistryComponent 组件');
    }
    const projectileConfig = INITIAL_GAME_CONFIG.projectiles.find(
      (candidate) => candidate.id === BEAST_PROJECTILE_CONFIG_ID,
    );
    if (projectileConfig === undefined) {
      throw new Error(`[BeastCompanionSystem] Projectile not found: ${BEAST_PROJECTILE_CONFIG_ID}`);
    }
    const weaponConfig = INITIAL_GAME_CONFIG.weapons.find(
      (candidate) => candidate.id === 'weapon_qingxiao_sword',
    );
    if (weaponConfig === undefined) {
      throw new Error('[BeastCompanionSystem] weapon_qingxiao_sword 不存在');
    }
    this.attackRadius = weaponConfig.attackRadius;
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
      BEAST_PROJECTILE_POOL_KEY,
      this.swordPrefab,
      SwordProjectile,
      { prewarmCount: BEAST_PROJECTILE_PREWARM_COUNT, maxCapacity: BEAST_PROJECTILE_MAX_ACTIVE },
      (sword) => sword.initialize(runtimeContext),
    );
    this.query = new NearestTargetQuery(registryComponent.registry);
    console.log(
      `[BeastCompanionSystem] beast ${deployed.beastId} damage skill: every ${this.plan.intervalSeconds}s ` +
        `×${this.plan.projectileCount} (damage ${this.plan.damage})`,
    );
  }

  protected override update(): void {
    if (
      this.battleController === null ||
      this.plan === null ||
      this.trigger === null ||
      this.playerNode === null
    ) {
      return;
    }
    const deltaTime = this.battleController.battleDeltaTime;
    if (deltaTime <= 0) {
      return;
    }
    if (this.trigger.advance(deltaTime, this.battleController.isSimulationRunning) !== 'due') {
      return;
    }

    const plan = this.plan;
    if (plan.kind === 'heal') {
      this.playerAgent?.applyCompanionHeal(plan.healValue);
      this.trigger.markFired();
      return;
    }

    const playerPosition = this.playerNode.position;
    if (this.query === null || this.pool === null) {
      return;
    }
    const hit = this.query.findNearestTarget(playerPosition.x, playerPosition.y, this.attackRadius);
    if (hit === null) {
      return;
    }

    this.fireBurst(hit, plan, playerPosition.x, playerPosition.y);
    this.trigger.markFired();
  }

  private fireBurst(
    hit: { target: { readPosition(out: { x: number; y: number }): void } },
    plan: BeastCompanionPlan,
    originX: number,
    originY: number,
  ): void {
    if (this.pool === null) {
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
      (candidate) => candidate.id === BEAST_PROJECTILE_CONFIG_ID,
    );
    if (projectileConfig === undefined) {
      return;
    }
    const spreadRadians = BEAST_SPREAD_DEGREES * DEGREES_TO_RADIANS;
    for (let index = 0; index < plan.projectileCount; index += 1) {
      const offset = (index - (plan.projectileCount - 1) / 2) * spreadRadians;
      const cosOffset = Math.cos(offset);
      const sinOffset = Math.sin(offset);
      this.pool.acquire({
        originX,
        originY,
        directionX: directionX * cosOffset - directionY * sinOffset,
        directionY: directionX * sinOffset + directionY * cosOffset,
        damage: plan.damage,
        speed: projectileConfig.speed,
        lifetimeSeconds: projectileConfig.lifetime,
        collisionRadius: projectileConfig.collisionRadius,
        sourceEntityId: BEAST_SOURCE_ENTITY_ID,
      });
    }
  }
}
