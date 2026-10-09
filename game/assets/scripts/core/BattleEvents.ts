import type { BattleState } from './BattleState';

export type EntityId = number;

export interface WorldPosition2D {
  readonly x: number;
  readonly y: number;
}

export interface BattleEventMap {
  readonly monsterDied: {
    readonly entityId: EntityId;
    readonly monsterId: string;
    readonly position: WorldPosition2D;
    readonly xpValue: number;
  };
  /** 玩家生命变化事实（V08-04）：受击结算或任意治疗后发出；星级受击计数/剩余生命条件使用。 */
  readonly playerHpChanged: {
    /** 变化后的生命。 */
    readonly hp: number;
    readonly maxHp: number;
    readonly cause: 'damage' | 'heal';
  };
  /** 玩家死亡事实；复用死亡事件结构，monsterId 固定 'player'、xpValue 恒 0。 */
  readonly playerDied: {
    readonly entityId: EntityId;
    readonly monsterId: string;
    readonly position: WorldPosition2D;
    readonly xpValue: number;
  };
  readonly experienceCollected: {
    readonly amount: number;
  };
  /** 战局终局事实：胜利（计时达标）或失败（玩家死亡）；发布时模拟已冻结。 */
  readonly battleFinished: {
    readonly result: 'victory' | 'defeat';
    readonly stats: BattleResultStats;
  };
  readonly levelUpRequested: {
    readonly level: number;
    readonly optionIds: readonly string[];
  };
  readonly levelUpResolved: {
    readonly level: number;
    readonly optionId: string;
  };
  readonly battleStateChanged: {
    readonly previous: BattleState;
    readonly current: BattleState;
  };
  /** Boss 出场事实（V10-05 音效接线）：Boss 首次召唤时发布一次。 */
  readonly bossSpawned: {
    readonly bossId: string;
  };
}

/** 战局终局统计快照；数值口径见 StageResultRecorder。 */
export type BattleResult = 'victory' | 'defeat';

export interface BattleResultStats {
  readonly result: BattleResult;
  readonly elapsedSeconds: number;
  readonly killCount: number;
  readonly xpCollected: number;
  readonly levelReached: number;
  /** 三星评定（V08-04）：0～3，失败恒 0。 */
  readonly stars: number;
  /** 逐条星级条件达成明细（第一星恒为通关），供结算 UI 展示。 */
  readonly starDetails: readonly StarConditionDetail[];
  /** 按配置 ID 的击杀分布（V08-11 图鉴写入源；含 Boss）。 */
  readonly killCounts: Readonly<Record<string, number>>;
}

/** 星级条件达成明细（V08-04；结构见 battle/StarEvaluator）。 */
export interface StarConditionDetail {
  readonly star: number;
  readonly kind: string;
  readonly met: boolean;
  readonly text: string;
}

export type BattleEventName = keyof BattleEventMap;

