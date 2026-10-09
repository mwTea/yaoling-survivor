import type { BattleResult, BattleResultStats, StarConditionDetail } from '../core/BattleEvents';

export type { BattleResult, BattleResultStats };

/**
 * 战局结算统计（纯 TS）：从战局事件累计击杀/拾取经验，结算时拍快照。
 * 口径与事件流一致：monsterDied 计击杀、experienceCollected 累经验；
 * 用时取战斗时间、等级取进度服务当前值，由宿主在结算瞬间传入。
 * 星级（V08-04）由宿主按关卡条件集评定后随快照一并产出。
 */

export class StageResultRecorder {
  private killCount = 0;
  private xpCollected = 0;
  private readonly killCounts: Record<string, number> = {};

  /** 击杀事实：按配置 ID 累计（V08-11 图鉴写入源）。 */
  public onMonsterDied(monsterId: string): void {
    this.killCount += 1;
    this.killCounts[monsterId] = (this.killCounts[monsterId] ?? 0) + 1;
  }

  public onExperienceCollected(amount: number): void {
    if (amount > 0) {
      this.xpCollected += amount;
    }
  }

  /** 结算快照；多次调用返回等值新对象，统计继续累计不受影响。 */
  public finish(
    result: BattleResult,
    elapsedSeconds: number,
    levelReached: number,
    stars = 0,
    starDetails: readonly StarConditionDetail[] = [],
  ): BattleResultStats {
    return {
      result,
      elapsedSeconds: Math.max(0, Math.floor(elapsedSeconds)),
      killCount: this.killCount,
      xpCollected: this.xpCollected,
      levelReached: levelReached,
      stars,
      starDetails,
      killCounts: { ...this.killCounts },
    };
  }
}
