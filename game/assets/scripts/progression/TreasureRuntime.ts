import type { TreasureConfig } from '../config/ConfigTypes';

export class TreasureError extends Error {
  public constructor(reason: string) {
    super(`Treasure error: ${reason}`);
    this.name = 'TreasureError';
  }
}

/**
 * 当局法宝运行态（纯 TS）：按 option ID 记录层数，派生触发数值。
 * 触发本身由事件监听方调用（如 monsterDied → healOnKillAmount），
 * 法宝不直接持有生命引用；当局获得、结算清空。
 */
export class TreasureRuntime {
  private readonly treasures: readonly TreasureConfig[];
  private readonly stacks = new Map<string, number>();
  private healOnKillExtra = 0;

  constructor(treasures: readonly TreasureConfig[]) {
    this.treasures = treasures;
  }

  /** 获得一层法宝并累计触发数值；未知 ID 拒绝。 */
  public addStack(optionId: string): void {
    const treasure = this.treasures.find((candidate) => candidate.id === optionId);
    if (treasure === undefined) {
      throw new TreasureError(`unknown treasure id "${optionId}"`);
    }
    this.stacks.set(optionId, this.getStackCount(optionId) + 1);

    for (const effect of treasure.effects) {
      // 当前唯一效果种类；新增种类时需先扩 TreasureEffect 联合并补此分支。
      if (effect.kind === 'healOnKill') {
        this.healOnKillExtra += effect.value;
      }
    }
  }

  public getStackCount(optionId: string): number {
    return this.stacks.get(optionId) ?? 0;
  }

  /** 当前每次击杀的回复量（0 表示未获得噬妖幡）。 */
  public get healOnKillAmount(): number {
    return this.healOnKillExtra;
  }
}
