import type { GongfaConfig } from '../config/ConfigTypes';
import type { PlayerCombatStats } from '../combat/PlayerCombatStats';

export class GongfaError extends Error {
  public constructor(reason: string) {
    super(`Gongfa error: ${reason}`);
    this.name = 'GongfaError';
  }
}

/**
 * 当局功法运行态（纯 TS）：按 option ID 记录层数，派生剑气数量；
 * 接触减伤效果应用到 PlayerCombatStats（不改写配置）。
 * 当局获得、结算清空——实例随战局创建即满足生命周期。
 */
export class GongfaRuntime {
  private readonly gongfas: readonly GongfaConfig[];
  private readonly stacks = new Map<string, number>();
  private swordQiExtraCount = 0;

  constructor(gongfas: readonly GongfaConfig[]) {
    this.gongfas = gongfas;
  }

  /** 获得一层功法并应用其效果；未知 ID 拒绝（候选池保证不会发生）。 */
  public addStack(optionId: string, stats: PlayerCombatStats): void {
    const gongfa = this.gongfas.find((candidate) => candidate.id === optionId);
    if (gongfa === undefined) {
      throw new GongfaError(`unknown gongfa id "${optionId}"`);
    }
    this.stacks.set(optionId, this.getStackCount(optionId) + 1);

    for (const effect of gongfa.effects) {
      switch (effect.kind) {
        case 'addSwordQi':
          this.swordQiExtraCount += effect.value;
          break;
        case 'contactDamageReduction':
          stats.addContactDamageReduction(effect.value);
          break;
        default: {
          const unreachable: never = effect;
          throw new GongfaError(`unsupported gongfa effect kind: ${String(unreachable)}`);
        }
      }
    }
  }

  public getStackCount(optionId: string): number {
    return this.stacks.get(optionId) ?? 0;
  }

  /** 当前每轮剑气数量（层数累计，0 表示未获得剑气冲击）。 */
  public get swordQiCount(): number {
    return this.swordQiExtraCount;
  }
}
