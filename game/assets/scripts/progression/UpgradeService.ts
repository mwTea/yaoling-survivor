import type { UpgradeEffect, UpgradeOptionConfig } from '../config/ConfigTypes';
import type { PlayerCombatStats } from '../combat/PlayerCombatStats';

export class UpgradeServiceError extends Error {
  public constructor(reason: string) {
    super(`UpgradeService error: ${reason}`);
    this.name = 'UpgradeServiceError';
  }
}

/**
 * 纯 TS 升级效果应用：按 option ID 把配置效果叠加到玩家战斗运行态。
 * UI/系统层只传 option ID，绝不直接修改武器组件字段。
 */
export class UpgradeService {
  private readonly upgrades: readonly UpgradeOptionConfig[];

  constructor(upgrades: readonly UpgradeOptionConfig[]) {
    this.upgrades = upgrades;
  }

  /** 应用一个选项的全部效果到 stats；返回应用的效果列表（诊断/日志用）。 */
  public applyEffects(stats: PlayerCombatStats, optionId: string): readonly UpgradeEffect[] {
    const option = this.upgrades.find((candidate) => candidate.id === optionId);
    if (option === undefined) {
      throw new UpgradeServiceError(`unknown optionId "${optionId}"`);
    }
    for (const effect of option.effects) {
      switch (effect.kind) {
        case 'addSwordDamage':
          stats.addSwordDamage(effect.value);
          break;
        case 'multiplySwordCooldown':
          stats.multiplySwordCooldown(effect.value);
          break;
        case 'addSwordCount':
          stats.addSwordCount(effect.value);
          break;
        default: {
          const unreachable: never = effect;
          throw new UpgradeServiceError(`unsupported effect kind: ${String(unreachable)}`);
        }
      }
    }
    return option.effects;
  }
}
