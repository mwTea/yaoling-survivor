import { _decorator, Component, Node, Prefab } from 'cc';

import { ActiveStage } from '../battle/ActiveStage';
import { BattleController } from '../battle/BattleController';
import { INITIAL_GAME_CONFIG } from '../config/GameConfig';
import type { ProjectileConfig, StageConfig, WeaponConfig } from '../config/ConfigTypes';
import { CooldownTimer } from './CooldownTimer';
import { PlayerCombatStats } from './PlayerCombatStats';
import { SwordProjectile } from './SwordProjectile';
import type { SwordPoolAccess, SwordRuntimeContext, SwordSpawnData } from './SwordProjectile';
import { NearestTargetQuery } from './TargetQuery';
import type { TargetQuery, TargetQueryHit } from './TargetQuery';
import { TargetRegistryComponent } from './TargetRegistryComponent';
import { PoolService } from '../pooling/PoolService';
import type { InstancePool } from '../pooling/Pools';
import { ProgressionSystem } from '../progression/ProgressionSystem';

const { ccclass, property } = _decorator;

const WEAPON_ID = 'weapon_qingxiao_sword';
/** 性能调优常量：飞剑池初始预热数量；容量来自配置 maxActiveProjectiles。 */
const SWORD_PREWARM_COUNT = 4;
/** 无实体来源（玩家直发）的保留 sourceEntityId；0 同时是调试夹具来源。 */
const PLAYER_SOURCE_ENTITY_ID = 0;
const DEGREES_TO_RADIANS = Math.PI / 180;

/**
 * 自动飞剑武器：冷却到期且重试窗口允许时查询最近有效目标，命中即发射
 * N 把小角度散射飞剑；无目标按 targetRetryInterval 受控重试，不逐帧扫描。
 * 只在 battleDeltaTime > 0 时推进（冷却与发射随暂停冻结）。
 */
@ccclass('AutoSwordWeapon')
export class AutoSwordWeapon extends Component {
  @property({ type: BattleController })
  private battleController: BattleController | null = null;

  @property({ type: Node })
  private playerNode: Node | null = null;

  @property({ type: Prefab })
  private swordPrefab: Prefab | null = null;

  private weaponConfig: WeaponConfig | null = null;
  private projectileConfig: ProjectileConfig | null = null;
  private combatStats: PlayerCombatStats | null = null;
  private fireCooldown: CooldownTimer | null = null;
  private retryCooldown: CooldownTimer | null = null;
  private query: TargetQuery | null = null;
  private swordPool: InstancePool<SwordProjectile, SwordSpawnData> | null = null;
  private totalFiredCount = 0;

  /** 已发射飞剑累计数（V10-04 引导观察用；只读计数，不改变发射逻辑）。 */
  public get totalFired(): number {
    return this.totalFiredCount;
  }

  protected override start(): void {
    if (this.battleController === null) {
      throw new Error('[AutoSwordWeapon] missing reference: battleController ← 把 Systems 节点拖入该属性槽');
    }
    if (this.playerNode === null) {
      throw new Error('[AutoSwordWeapon] missing reference: playerNode ← 把 Player 节点拖入该属性槽');
    }
    if (this.swordPrefab === null) {
      throw new Error('[AutoSwordWeapon] missing reference: swordPrefab ← 把 SwordGray prefab 拖入该属性槽');
    }

    const battleController = this.battleController;
    const poolService = battleController.getComponent(PoolService);
    if (poolService === null) {
      throw new Error('[AutoSwordWeapon] Systems 节点缺少 PoolService 组件');
    }
    const registryComponent = battleController.getComponent(TargetRegistryComponent);
    if (registryComponent === null) {
      throw new Error('[AutoSwordWeapon] Systems 节点缺少 TargetRegistryComponent 组件');
    }
    const progression = battleController.getComponent(ProgressionSystem);
    if (progression === null) {
      throw new Error('[AutoSwordWeapon] Systems 节点缺少 ProgressionSystem 组件');
    }
    if (progression.stats === null) {
      throw new Error('[AutoSwordWeapon] ProgressionSystem 尚未初始化战斗运行态');
    }
    this.combatStats = progression.stats;

    const weaponConfig = INITIAL_GAME_CONFIG.weapons.find((candidate) => candidate.id === WEAPON_ID);
    if (weaponConfig === undefined) {
      throw new Error(`[AutoSwordWeapon] Weapon not found: ${WEAPON_ID}`);
    }
    const projectileConfig = INITIAL_GAME_CONFIG.projectiles.find(
      (candidate) => candidate.id === weaponConfig.projectileId,
    );
    if (projectileConfig === undefined) {
      throw new Error(`[AutoSwordWeapon] Projectile not found: ${weaponConfig.projectileId}`);
    }
    const stage = ActiveStage.current.stage;

    this.weaponConfig = weaponConfig;
    this.projectileConfig = projectileConfig;
    this.fireCooldown = new CooldownTimer(weaponConfig.cooldown);
    this.retryCooldown = new CooldownTimer(weaponConfig.targetRetryInterval);
    this.query = new NearestTargetQuery(registryComponent.registry);

    const poolAccess: SwordPoolAccess = {
      releaseSword: (sword: SwordProjectile): void => {
        this.swordPool?.release(sword);
      },
    };
    const runtimeContext: SwordRuntimeContext = {
      battle: battleController,
      registry: registryComponent.registry,
      playArea: stage.playArea,
      pool: poolAccess,
    };
    this.swordPool = poolService.registerNodePool(
      weaponConfig.projectileId,
      this.swordPrefab,
      SwordProjectile,
      { prewarmCount: SWORD_PREWARM_COUNT, maxCapacity: weaponConfig.maxActiveProjectiles },
      (sword) => sword.initialize(runtimeContext),
    );
    console.log(
      `[AutoSwordWeapon] ${weaponConfig.displayName}(${WEAPON_ID}): damage=${weaponConfig.baseDamage} ` +
        `cooldown=${weaponConfig.cooldown}s count=${weaponConfig.projectileCount} ` +
        `radius=${weaponConfig.attackRadius} poolCap=${weaponConfig.maxActiveProjectiles}`,
    );
  }

  protected override update(): void {
    if (
      this.battleController === null ||
      this.playerNode === null ||
      this.weaponConfig === null ||
      this.projectileConfig === null ||
      this.combatStats === null ||
      this.fireCooldown === null ||
      this.retryCooldown === null ||
      this.query === null
    ) {
      return;
    }
    const deltaTime = this.battleController.battleDeltaTime;
    if (deltaTime <= 0) {
      return;
    }

    this.fireCooldown.advance(deltaTime);
    this.retryCooldown.advance(deltaTime);
    if (!this.fireCooldown.isReady || !this.retryCooldown.isReady) {
      return;
    }

    const playerPosition = this.playerNode.position;
    const hit = this.query.findNearestTarget(
      playerPosition.x,
      playerPosition.y,
      this.weaponConfig.attackRadius,
    );
    if (hit === null) {
      this.retryCooldown.trigger();
      return;
    }

    this.fireAt(hit, playerPosition.x, playerPosition.y);
    this.fireCooldown.setDuration(this.combatStats.swordCooldown);
    this.fireCooldown.trigger();
  }

  private fireAt(hit: TargetQueryHit, originX: number, originY: number): void {
    if (this.swordPool === null || this.weaponConfig === null || this.projectileConfig === null || this.combatStats === null) {
      return;
    }
    const damage = this.combatStats.swordDamage;
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

    const count = this.combatStats.swordProjectileCount;
    const spreadRadians = this.weaponConfig.projectileSpreadDegrees * DEGREES_TO_RADIANS;
    for (let index = 0; index < count; index += 1) {
      const offset = (index - (count - 1) / 2) * spreadRadians;
      const cosOffset = Math.cos(offset);
      const sinOffset = Math.sin(offset);
      this.swordPool.acquire({
        originX,
        originY,
        directionX: directionX * cosOffset - directionY * sinOffset,
        directionY: directionX * sinOffset + directionY * cosOffset,
        damage,
        speed: this.projectileConfig.speed,
        lifetimeSeconds: this.projectileConfig.lifetime,
        collisionRadius: this.projectileConfig.collisionRadius,
        sourceEntityId: PLAYER_SOURCE_ENTITY_ID,
      });
      this.totalFiredCount += 1;
    }
  }
}
