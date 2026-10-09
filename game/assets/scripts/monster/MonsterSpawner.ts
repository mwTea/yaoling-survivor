import { _decorator, Component, Node, Prefab } from 'cc';

import { BattleController } from '../battle/BattleController';
import { ActiveStage } from '../battle/ActiveStage';
import { INITIAL_GAME_CONFIG } from '../config/GameConfig';
import type { BossConfig, SpawnWaveConfig, StageConfig } from '../config/ConfigTypes';
import { TargetRegistryComponent } from '../combat/TargetRegistryComponent';
import type { TargetRegistry } from '../combat/TargetRegistry';
import { BossBullet } from '../combat/BossBullet';
import type { BossBulletContext, BossBulletPoolAccess, BossBulletSpawnData } from '../combat/BossBullet';
import { createSystemRandomSource } from '../core/RandomSource';
import { BossAgent } from './BossAgent';
import { MonsterAgent } from './MonsterAgent';
import type { BossBulletAccess, MonsterPoolAccess, MonsterRuntimeContext, MonsterSpawnData } from './MonsterAgent';
import { buildDifficultyStatMultipliers } from './EliteStats';
import type { InstancePool } from '../pooling/Pools';
import { PoolService } from '../pooling/PoolService';
import { SpawnPlanner } from './SpawnPlanner';

const { ccclass, property } = _decorator;

/** 性能调优常量：每池初始预热数量；运行中按硬上限需要时再扩。 */
const PREWARM_COUNT = 8;
const BOSS_BULLET_PREWARM_COUNT = 6;
const BOSS_BULLET_MAX_ACTIVE = 40;
/** 出生点与玩家的额外安全余量，叠在双方碰撞半径之和上。 */
const SAFE_DISTANCE_MARGIN = 24;
/** 诊断日志节奏（战斗秒）；仅验收/观察用，不在热路径逐帧输出。 */
const STATS_LOG_INTERVAL = 30;

/**
 * 按关卡与 wave 配置持续生成怪物：注册 monsterId 池、推进 SpawnPlanner、
 * 借出 MonsterAgent；Boss 池与弹幕子弹池在此装配，战斗时间到达
 * bossConfig.spawnTime 时在玩家上方环带位置召唤 Boss（一次）。
 */
@ccclass('MonsterSpawner')
export class MonsterSpawner extends Component {
  @property({ type: BattleController })
  private battleController: BattleController | null = null;

  @property({ type: Node })
  private playerNode: Node | null = null;

  @property({ type: Prefab })
  private monsterPrefab: Prefab | null = null;

  @property({ type: Prefab, tooltip: 'Boss prefab（BossGray，挂 BossAgent）；配置含 bosses 时必填' })
  private bossPrefab: Prefab | null = null;

  @property({ type: Prefab, tooltip: 'Boss 弹幕子弹 prefab（BulletGray，挂 BossBullet）；配置含 bosses 时必填' })
  private bulletPrefab: Prefab | null = null;

  private planner: SpawnPlanner | null = null;
  private registry: TargetRegistry | null = null;
  private stageConfig: StageConfig | null = null;
  private bossConfig: BossConfig | null = null;
  private readonly pools = new Map<string, InstancePool<MonsterAgent, MonsterSpawnData>>();
  private bossPool: InstancePool<BossAgent, MonsterSpawnData> | null = null;
  private bulletPool: InstancePool<BossBullet, BossBulletSpawnData> | null = null;
  private bossSpawned = false;
  private readonly poolAccess: MonsterPoolAccess = {
    releaseAgent: (agent: MonsterAgent): void => {
      this.releaseAgent(agent);
    },
  };
  private readonly bulletPoolAccess: BossBulletPoolAccess = {
    releaseBullet: (bullet: BossBullet): void => {
      this.bulletPool?.release(bullet);
    },
  };
  private statsLogTimer = 0;
  private totalSpawnedCount = 0;

  protected override start(): void {
    if (this.battleController === null) {
      throw new Error('[MonsterSpawner] missing reference: battleController ← 把 Systems 节点拖入该属性槽');
    }
    if (this.playerNode === null) {
      throw new Error('[MonsterSpawner] missing reference: playerNode ← 把 Player 节点拖入该属性槽');
    }
    if (this.monsterPrefab === null) {
      throw new Error('[MonsterSpawner] missing reference: monsterPrefab ← 把 MonsterGray prefab 拖入该属性槽');
    }

    const battleController = this.battleController;
    const playerNode = this.playerNode;
    const poolService = battleController.getComponent(PoolService);
    if (poolService === null) {
      throw new Error('[MonsterSpawner] Systems 节点缺少 PoolService 组件');
    }
    const registryComponent = battleController.getComponent(TargetRegistryComponent);
    if (registryComponent === null) {
      throw new Error('[MonsterSpawner] Systems 节点缺少 TargetRegistryComponent 组件');
    }
    this.registry = registryComponent.registry;

    // V08-03：读取当局选中关卡（AccountBattleLink.onLoad 已按账号存档装配；
    // 直接预览无账号服务时回退 initialStageId 默认关）。
    const { stage, difficulty } = ActiveStage.current;
    this.stageConfig = stage;
    const waves = stage.waveIds.map((waveId) => {
      const wave = INITIAL_GAME_CONFIG.spawnWaves.find((candidate) => candidate.id === waveId);
      if (wave === undefined) {
        throw new Error(`[MonsterSpawner] Wave not found: ${waveId}`);
      }
      return wave;
    });

    this.planner = new SpawnPlanner(
      stage,
      waves,
      createSystemRandomSource(),
      this.resolveMinSafeDistance(stage, waves),
    );

    const monsterIds = new Set<string>();
    for (const wave of waves) {
      for (const entry of wave.monsters) {
        monsterIds.add(entry.monsterId);
      }
    }
    const runtimeContext: MonsterRuntimeContext = {
      battle: battleController,
      registry: registryComponent.registry,
      playerNode,
      events: battleController.events,
      pool: this.poolAccess,
      difficultyMultipliers: buildDifficultyStatMultipliers(difficulty),
    };
    for (const monsterId of monsterIds) {
      this.pools.set(
        monsterId,
        poolService.registerNodePool(
          monsterId,
          this.monsterPrefab,
          MonsterAgent,
          { prewarmCount: PREWARM_COUNT, maxCapacity: stage.activeMonsterHardCap },
          (agent) => agent.initialize(runtimeContext),
        ),
      );
    }
    this.setupBoss(poolService, stage, runtimeContext);
    console.log(
      `[MonsterSpawner] stage ${stage.id}: ${waves.length} waves, pools=[${Array.from(monsterIds).join(',')}], ` +
        `softCap=${stage.activeMonsterSoftCap}, hardCap=${stage.activeMonsterHardCap}` +
        `${this.bossPool !== null ? ', boss registered' : ''}`,
    );
  }

  private setupBoss(poolService: PoolService, stage: StageConfig, runtimeContext: MonsterRuntimeContext): void {
    // V08-03：Boss 关联来自选中关卡的 bossId；无 Boss 关（null）不装配 Boss/弹幕池。
    if (stage.bossId === null) {
      return;
    }
    const bossConfig = INITIAL_GAME_CONFIG.bosses.find((candidate) => candidate.id === stage.bossId);
    if (bossConfig === undefined) {
      throw new Error(`[MonsterSpawner] Boss config not found: ${stage.bossId}`);
    }
    this.bossConfig = bossConfig;
    if (this.bossPrefab === null) {
      throw new Error('[MonsterSpawner] missing reference: bossPrefab ← 配置含 bosses 时必须拖入 Boss prefab');
    }
    if (this.bulletPrefab === null) {
      throw new Error('[MonsterSpawner] missing reference: bulletPrefab ← 配置含 bosses 时必须拖入子弹 prefab');
    }
    const bulletProjectile = INITIAL_GAME_CONFIG.projectiles.find(
      (candidate) => candidate.id === 'projectile_boss_bullet',
    );
    if (bulletProjectile === undefined) {
      throw new Error('[MonsterSpawner] projectile_boss_bullet config missing');
    }

    const bulletContext: BossBulletContext = {
      battle: runtimeContext.battle,
      playerNode: runtimeContext.playerNode,
      playArea: stage.playArea,
      pool: this.bulletPoolAccess,
    };
    this.bulletPool = poolService.registerNodePool(
      'projectile_boss_bullet',
      this.bulletPrefab,
      BossBullet,
      { prewarmCount: BOSS_BULLET_PREWARM_COUNT, maxCapacity: BOSS_BULLET_MAX_ACTIVE },
      (bullet) => bullet.initialize(bulletContext),
    );
    const bossBulletAccess: BossBulletAccess = {
      fire: (data: BossBulletSpawnData): void => {
        this.bulletPool?.acquire(data);
      },
    };
    const bossContext: MonsterRuntimeContext = { ...runtimeContext, bossBullets: bossBulletAccess };
    this.bossPool = poolService.registerNodePool(
      bossConfig.id,
      this.bossPrefab,
      BossAgent,
      { prewarmCount: 0, maxCapacity: 1 },
      (agent) => agent.initialize(bossContext),
    );
  }

  protected override update(): void {
    if (this.planner === null || this.registry === null || this.battleController === null || this.playerNode === null) {
      return;
    }
    const deltaTime = this.battleController.battleDeltaTime;
    if (deltaTime <= 0) {
      return;
    }

    const playerPosition = this.playerNode.position;
    const requests = this.planner.advance(deltaTime, this.registry.count, playerPosition.x, playerPosition.y);
    for (const request of requests) {
      const pool = this.pools.get(request.monsterId);
      if (pool === undefined) {
        throw new Error(`[MonsterSpawner] No pool registered for monsterId "${request.monsterId}"`);
      }
      pool.acquire({ monsterId: request.monsterId, elite: request.elite, x: request.x, y: request.y });
      this.totalSpawnedCount += 1;
    }

    this.trySpawnBoss(playerPosition.x, playerPosition.y);

    this.statsLogTimer += deltaTime;
    if (this.statsLogTimer >= STATS_LOG_INTERVAL) {
      this.statsLogTimer -= STATS_LOG_INTERVAL;
      console.log(
        `[MonsterSpawner] battle t=${this.planner.elapsedTime.toFixed(0)}s active=${this.registry.count} ` +
          `totalSpawned=${this.totalSpawnedCount}`,
      );
    }
  }

  private trySpawnBoss(playerX: number, playerY: number): void {
    if (this.bossSpawned || this.bossPool === null || this.battleController === null) {
      return;
    }
    const bossConfig = this.bossConfig;
    const stage = this.stageConfig;
    if (bossConfig === undefined || bossConfig === null || stage === null) {
      return;
    }
    if (this.battleController.battleElapsedTime < bossConfig.spawnTime) {
      return;
    }
    this.bossSpawned = true;

    const spawnX = Math.min(stage.playArea.maxX, Math.max(stage.playArea.minX, playerX));
    const spawnY = Math.min(
      stage.playArea.maxY,
      Math.max(stage.playArea.minY, playerY + stage.spawnMaxRadius),
    );
    this.bossPool.acquire({ monsterId: bossConfig.id, elite: false, x: spawnX, y: spawnY });
    this.totalSpawnedCount += 1;
    this.battleController.events.emit('bossSpawned', { bossId: bossConfig.id });
    console.log(`[MonsterSpawner] boss ${bossConfig.displayName}(${bossConfig.id}) spawned at (${spawnX.toFixed(0)}, ${spawnY.toFixed(0)})`);
  }

  private releaseAgent(agent: MonsterAgent): void {
    const monsterId = agent.monsterId;
    const pool = monsterId === null ? undefined : this.pools.get(monsterId);
    if (pool !== undefined) {
      pool.release(agent);
      return;
    }
    if (this.bossPool !== null && this.bossPool.key === monsterId) {
      this.bossPool.release(agent as BossAgent);
      return;
    }
    throw new Error(`[MonsterSpawner] Cannot release agent for unknown monsterId "${monsterId ?? 'null'}"`);
  }

  private resolveMinSafeDistance(stage: StageConfig, waves: readonly SpawnWaveConfig[]): number {
    let maxCollisionRadius = 0;
    for (const wave of waves) {
      for (const entry of wave.monsters) {
        const monster = INITIAL_GAME_CONFIG.monsters.find((candidate) => candidate.id === entry.monsterId);
        if (monster === undefined) {
          throw new Error(`[MonsterSpawner] Monster not found: ${entry.monsterId}`);
        }
        maxCollisionRadius = Math.max(maxCollisionRadius, monster.collisionRadius);
      }
    }
    for (const boss of INITIAL_GAME_CONFIG.bosses) {
      maxCollisionRadius = Math.max(maxCollisionRadius, boss.collisionRadius);
    }
    return INITIAL_GAME_CONFIG.player.collisionRadius + maxCollisionRadius + SAFE_DISTANCE_MARGIN;
  }
}
