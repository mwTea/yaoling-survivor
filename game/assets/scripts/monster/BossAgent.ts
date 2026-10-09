import { _decorator, Color } from 'cc';

import { INITIAL_GAME_CONFIG } from '../config/GameConfig';
import type { BossRadialBurstConfig, MonsterConfig } from '../config/ConfigTypes';
import { MonsterAgent } from './MonsterAgent';
import { resolveBossPhase, resolveBurstInterval } from './BossPhase';

const { ccclass } = _decorator;

/** Boss 灰盒视觉常量；正式美术替换时调整。 */
const BOSS_SCALE = 2.5;
const BOSS_COLOR = new Color(170, 80, 255, 255);

/**
 * BossAgent：复用 MonsterAgent 全部运行态（注册/受击/死亡/追踪），仅覆写
 * 数值来源（BossConfig 直读，不走精英乘数）与视觉；额外驱动径向弹幕——
 * 按阶段间隔向四周发射 BossBullet（来源标记 boss entityId，命中玩家）。
 * 击杀 Boss 经 monsterDied 事件触发胜利（StageResultService）。
 */
@ccclass('BossAgent')
export class BossAgent extends MonsterAgent {
  private burstTimer = 0;
  private burstConfig: BossRadialBurstConfig | null = null;

  protected override resolveMonsterConfig(monsterId: string): MonsterConfig {
    const bossConfig = INITIAL_GAME_CONFIG.bosses.find((candidate) => candidate.id === monsterId);
    if (bossConfig === undefined) {
      throw new Error(`[BossAgent] Unknown boss id "${monsterId}"`);
    }
    this.burstTimer = bossConfig.radialBurst.burstIntervalSeconds;
    // 难度乘数作用于运行态快照（不改写配置）；Boss 不走精英乘数（CONFIG.md），
    // 难度档为关卡级数值口径，与普通怪同规则。
    const difficulty = this.context?.difficultyMultipliers;
    return {
      id: bossConfig.id,
      displayName: bossConfig.displayName,
      prefabId: 'prefab_boss',
      maxHp: Math.max(1, Math.round(bossConfig.maxHp * (difficulty?.hp ?? 1))),
      moveSpeed: bossConfig.moveSpeed * (difficulty?.speed ?? 1),
      contactDamage: Math.round(bossConfig.contactDamage * (difficulty?.contactDamage ?? 1)),
      xpValue: Math.max(1, Math.round(bossConfig.xpValue * (difficulty?.xp ?? 1))),
      collisionRadius: bossConfig.collisionRadius,
    };
  }

  protected override onAcquireVisual(elite: boolean): void {
    super.onAcquireVisual(elite);
    this.node.setScale(BOSS_SCALE, BOSS_SCALE, 1);
    if (this.sprite !== null) {
      this.sprite.color = BOSS_COLOR;
    }
  }

  protected override update(): void {
    super.update();
    this.updateBurst();
  }

  private updateBurst(): void {
    const context = this.context;
    const bossConfig = INITIAL_GAME_CONFIG.bosses.find((candidate) => candidate.id === this.monsterId);
    if (context === null || bossConfig === undefined || this.currentHp <= 0) {
      return;
    }
    const deltaTime = context.battle.battleDeltaTime;
    if (deltaTime <= 0 || context.bossBullets === undefined) {
      return;
    }

    const hpRatio = this.currentHp / (this.stats?.maxHp ?? 1);
    const phase = resolveBossPhase(hpRatio);
    this.burstTimer -= deltaTime;
    if (this.burstTimer > 0) {
      return;
    }
    this.burstTimer = resolveBurstInterval(
      phase,
      bossConfig.radialBurst.burstIntervalSeconds,
      bossConfig.radialBurst.enragedIntervalSeconds,
    );

    const bullets = context.bossBullets;
    const position = this.node.position;
    const entityId = this.entityId;
    const count = bossConfig.radialBurst.count;
    // 弹幕伤害随难度 contactDamage 乘数取整（关卡级数值口径）。
    const damage = Math.round(bossConfig.radialBurst.damage * (context.difficultyMultipliers?.contactDamage ?? 1));
    for (let index = 0; index < count; index += 1) {
      const angle = (Math.PI * 2 * index) / count;
      bullets.fire({
        originX: position.x,
        originY: position.y,
        directionX: Math.cos(angle),
        directionY: Math.sin(angle),
        damage,
        sourceEntityId: entityId,
      });
    }
  }
}
