import { _decorator, Component, Node, Vec3 } from 'cc';
import { applyArtSprite } from '../ui/ArtLoader';

import { INITIAL_GAME_CONFIG } from '../config/GameConfig';
import { PlayerAgent } from '../player/PlayerAgent';
import type { BattleTimeSource } from '../monster/MonsterAgent';
import type { EntityId } from '../core/BattleEvents';
import type { PoolAcquireContext, PooledObject } from '../pooling/PoolTypes';
import type { RectangleBoundsConfig } from '../config/ConfigTypes';

const { ccclass } = _decorator;

/** Boss 子弹出生数据：直线方向与数值快照。 */
export interface BossBulletSpawnData {
  readonly originX: number;
  readonly originY: number;
  readonly directionX: number;
  readonly directionY: number;
  readonly damage: number;
  readonly sourceEntityId: EntityId;
}

/** 回池入口由 MonsterSpawner（池所有者）实现。 */
export interface BossBulletPoolAccess {
  releaseBullet(bullet: BossBullet): void;
}

/** Boss 子弹运行期依赖；由 MonsterSpawner 装配后注入。 */
export interface BossBulletContext {
  readonly battle: BattleTimeSource;
  readonly playerNode: Node;
  readonly playArea: RectangleBoundsConfig;
  readonly pool: BossBulletPoolAccess;
}

/**
 * Boss 径向弹幕子弹：直线飞行，命中玩家结算一次接触伤害（走
 * PlayerAgent.applyExternalDamage 的减免/无敌帧统一路径），超时或越界回池。
 * 每次激活至多命中一次；仅在 battleDeltaTime > 0 时推进（暂停冻结）。
 */
@ccclass('BossBullet')
export class BossBullet extends Component implements PooledObject<BossBulletSpawnData> {
  private context: BossBulletContext | null = null;

  private directionX = 0;
  private directionY = 0;
  private remainingLifetime = 0;
  private damage = 0;
  private sourceEntityId: EntityId = 0;
  private hasHit = false;
  private readonly cocosPosition = new Vec3();

  /** 池工厂创建实例后立即注入依赖；必须在池 acquire 该实例之前调用。 */
  public initialize(context: BossBulletContext): void {
    this.context = context;
  }

  public onAcquire(context: PoolAcquireContext<BossBulletSpawnData>): void {
    // 正式美术（V10-14）：切图应用；缺图回退灰盒。
    applyArtSprite(this.node, 'proj_boss_bullet');
    if (this.context === null) {
      throw new Error(`[BossBullet] initialize(context) must run before pool "${context.poolKey}" acquires an instance`);
    }
    const data = context.data;
    if (
      typeof data?.originX !== 'number' ||
      typeof data?.originY !== 'number' ||
      typeof data?.directionX !== 'number' ||
      typeof data?.directionY !== 'number' ||
      typeof data?.damage !== 'number' ||
      typeof data?.sourceEntityId !== 'number'
    ) {
      throw new Error(`[BossBullet] Pool "${context.poolKey}" acquire data is incomplete`);
    }

    this.directionX = data.directionX;
    this.directionY = data.directionY;
    this.damage = data.damage;
    this.sourceEntityId = data.sourceEntityId;
    this.hasHit = false;
    const projectile = INITIAL_GAME_CONFIG.projectiles.find((candidate) => candidate.id === 'projectile_boss_bullet');
    if (projectile === undefined) {
      throw new Error('[BossBullet] projectile_boss_bullet config missing');
    }
    this.remainingLifetime = projectile.lifetime;
    this.node.setPosition(data.originX, data.originY, 0);
    this.node.active = true;
  }

  public onRelease(): void {
    this.directionX = 0;
    this.directionY = 0;
    this.remainingLifetime = 0;
    this.damage = 0;
    this.sourceEntityId = 0;
    // 场景销毁路径（releaseAll）中节点引用可能已失效：判空防护，仅对有效节点执行重置。
    this.hasHit = false;
    if (this.node !== null && this.node.isValid) {
      this.node.setPosition(0, 0, 0);
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
      this.context.pool.releaseBullet(this);
      return;
    }

    const projectile = INITIAL_GAME_CONFIG.projectiles.find((candidate) => candidate.id === 'projectile_boss_bullet');
    if (projectile === undefined) {
      return;
    }
    const step = projectile.speed * deltaTime;
    const position = this.node.position;
    const nextX = position.x + this.directionX * step;
    const nextY = position.y + this.directionY * step;
    this.cocosPosition.set(nextX, nextY, position.z);
    this.node.setPosition(this.cocosPosition);

    const playArea = this.context.playArea;
    if (nextX < playArea.minX || nextX > playArea.maxX || nextY < playArea.minY || nextY > playArea.maxY) {
      this.context.pool.releaseBullet(this);
      return;
    }

    if (this.hasHit) {
      return;
    }
    const playerPosition = this.context.playerNode.position;
    const hitRange = projectile.collisionRadius + INITIAL_GAME_CONFIG.player.collisionRadius;
    const deltaX = playerPosition.x - nextX;
    const deltaY = playerPosition.y - nextY;
    if (deltaX * deltaX + deltaY * deltaY <= hitRange * hitRange) {
      this.hasHit = true;
      const playerAgent = this.context.playerNode.getComponent(PlayerAgent);
      if (playerAgent !== null) {
        playerAgent.applyExternalDamage(this.damage, this.sourceEntityId);
      }
      this.context.pool.releaseBullet(this);
    }
  }
}
