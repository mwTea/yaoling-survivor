import type { LevelCurveEntry } from '../config/ConfigTypes';
import type { RandomSource } from '../core/RandomSource';

/** 一次待处理的升级选择：目标等级与三个不重复的可用 option ID。 */
export interface LevelUpChoice {
  readonly level: number;
  readonly optionIds: readonly string[];
}

export type LevelUpChoiceListener = (choice: LevelUpChoice) => void;

/** 三选一候选池条目的最小契约；UpgradeOptionConfig 与 GongfaConfig 均满足。 */
export interface RunOptionSeed {
  readonly id: string;
  readonly maxStacks: number;
  readonly weight: number;
}

/** 三选一的标准候选数量；可用项不足时降级返回更少，满层时可能为空。 */
export const CHOICE_COUNT = 3;

export class ProgressionError extends Error {
  public constructor(reason: string) {
    super(`Progression error: ${reason}`);
    this.name = 'ProgressionError';
  }
}

/**
 * 纯 TS 进度服务：经验累加与等级曲线换算、跨级队列、可复现三选一候选。
 *
 * - 经验恰好达到阈值即升级；一次大额经验允许跨多级，等级进入队列。
 * - 同一时刻至多一个待处理选择（`currentChoice`）；处理完当前选择才服务下一个，
 *   期间 `hasPendingLevelUp` 保持 true（战局应维持暂停意图）。
 * - 候选按权重不放回抽取，固定随机序列完全可复现；每成功抽一项消耗一个随机数。
 * - 堆叠达上限的选项被过滤；某级无可用选项时直接完成该级、不产生选择。
 * - 效果应用（UpgradeService）与 UI/暂停接线属 T12。
 */
export class ProgressionService {
  private readonly levelCurve: readonly LevelCurveEntry[];
  private readonly options: readonly RunOptionSeed[];
  private readonly random: RandomSource;
  private readonly stacks = new Map<string, number>();
  private readonly choiceListeners = new Set<LevelUpChoiceListener>();

  private currentLevel: number;
  private experienceInLevel = 0;
  private readonly pendingLevels: number[] = [];
  private activeChoice: LevelUpChoice | null = null;

  constructor(
    levelCurve: readonly LevelCurveEntry[],
    options: readonly RunOptionSeed[],
    random: RandomSource,
  ) {
    if (levelCurve.length === 0) {
      throw new ProgressionError('levelCurve must not be empty');
    }
    this.levelCurve = levelCurve;
    this.options = options;
    this.random = random;
    this.currentLevel = levelCurve[0]?.level ?? 1;
  }

  public get level(): number {
    return this.currentLevel;
  }

  public get maxLevel(): number {
    const lastEntry = this.levelCurve[this.levelCurve.length - 1];
    return lastEntry?.level ?? this.currentLevel;
  }

  public get experience(): number {
    return this.experienceInLevel;
  }

  /** 当前等级区间内的进度 [0, 1]；满级恒为 1。 */
  public get progressRatio(): number {
    if (this.currentLevel >= this.maxLevel) {
      return 1;
    }
    const required = this.requiredXpFor(this.currentLevel);
    if (required <= 0) {
      return 1;
    }
    return Math.min(1, this.experienceInLevel / required);
  }

  /** 是否存在待处理升级（含队列中未服务的等级）；处理完所有请求前应保持暂停。 */
  public get hasPendingLevelUp(): boolean {
    return this.activeChoice !== null || this.pendingLevels.length > 0;
  }

  /** 当前待处理的升级选择；同一时刻至多一个。 */
  public get currentChoice(): LevelUpChoice | null {
    return this.activeChoice;
  }

  /** 已应用次数（含已服务选择的堆叠），用于满层过滤与诊断。 */
  public getStackCount(optionId: string): number {
    return this.stacks.get(optionId) ?? 0;
  }

  /** 累加经验并处理等级跨越；返回本次新升的等级个数。 */
  public addExperience(amount: number): number {
    if (!Number.isInteger(amount) || amount < 0) {
      throw new ProgressionError(`experience amount must be a non-negative integer, got ${amount}`);
    }
    this.experienceInLevel += amount;

    let levelUps = 0;
    while (this.currentLevel < this.maxLevel) {
      const required = this.requiredXpFor(this.currentLevel);
      if (this.experienceInLevel < required) {
        break;
      }
      this.experienceInLevel -= required;
      this.currentLevel += 1;
      this.pendingLevels.push(this.currentLevel);
      levelUps += 1;
    }
    if (this.currentLevel >= this.maxLevel) {
      this.experienceInLevel = 0;
    }

    this.serveNextChoice();
    return levelUps;
  }

  /** 选定当前升级的一个选项；随后自动服务队列中的下一个等级（若有）。 */
  public resolveLevelUp(optionId: string): void {
    const choice = this.activeChoice;
    if (choice === null) {
      throw new ProgressionError('resolveLevelUp called without a pending choice');
    }
    if (choice.optionIds.indexOf(optionId) < 0) {
      throw new ProgressionError(`optionId "${optionId}" is not among the offered choices`);
    }

    this.stacks.set(optionId, this.getStackCount(optionId) + 1);
    this.activeChoice = null;
    this.serveNextChoice();
  }

  /**
   * 换一批（V10-11 追加广告位）：重抽当前候选（同规则：maxStacks 过滤 +
   * 权重不放回 + 消耗随机序列）。无待处理选择时 no-op 返回 null；
   * 重抽后经同一 choiceListeners 通知（面板刷新）。
   */
  public rerollCurrentChoice(): LevelUpChoice | null {
    if (this.activeChoice === null) {
      return null;
    }
    const optionIds = this.generateOptionIds();
    if (optionIds.length === 0) {
      return this.activeChoice;
    }
    this.activeChoice = { level: this.activeChoice.level, optionIds };
    for (const listener of Array.from(this.choiceListeners)) {
      listener(this.activeChoice);
    }
    return this.activeChoice;
  }

  public onLevelUpChoice(listener: LevelUpChoiceListener): () => void {
    this.choiceListeners.add(listener);
    return (): void => {
      this.choiceListeners.delete(listener);
    };
  }

  private requiredXpFor(level: number): number {
    const entry = this.levelCurve.find((candidate) => candidate.level === level);
    if (entry === undefined) {
      throw new ProgressionError(`level ${level} missing from levelCurve`);
    }
    return entry.requiredXp;
  }

  /** 服务队列：满层无候选的等级直接跳过；否则生成一个选择并通知监听者。 */
  private serveNextChoice(): void {
    while (this.activeChoice === null && this.pendingLevels.length > 0) {
      const nextLevel = this.pendingLevels.shift();
      if (nextLevel === undefined) {
        break;
      }
      const optionIds = this.generateOptionIds();
      if (optionIds.length === 0) {
        continue;
      }
      this.activeChoice = { level: nextLevel, optionIds };
      for (const listener of Array.from(this.choiceListeners)) {
        listener(this.activeChoice);
      }
    }
  }

  private generateOptionIds(): string[] {
    const available = this.options.filter(
      (option) => this.getStackCount(option.id) < option.maxStacks,
    );
    const optionIds: string[] = [];
    while (optionIds.length < CHOICE_COUNT && available.length > 0) {
      let totalWeight = 0;
      for (const option of available) {
        totalWeight += option.weight;
      }
      let roll = this.random.next() * totalWeight;
      let pickedIndex = available.length - 1;
      for (let index = 0; index < available.length; index += 1) {
        const option = available[index];
        if (option === undefined) {
          break;
        }
        roll -= option.weight;
        if (roll < 0) {
          pickedIndex = index;
          break;
        }
      }
      const picked = available.splice(pickedIndex, 1)[0];
      if (picked !== undefined) {
        optionIds.push(picked.id);
      }
    }
    return optionIds;
  }
}
