/**
 * 结算奖励发放（V05-09，V0.5 产消闭环数据面）。
 *
 * 单文件叶子模块（零跨文件值导入，仅类型导入，可被 node 纯逻辑测试直接加载）：
 * - `computeStageRewards`：按结果选择保留比例（victory 全额 / defeat / abort），
 *   账号经验与资源逐项向下取整，产出纯值发放计划（UI 展示与实际发放共用同一计划，
 *   数字天然一致；库存上限钳制差异由 lostToCap 单独呈现）。
 * - `applyStageRewards`：资源单事务原子发放（kind = stage_reward_<result>，审计含来源）→
 *   账号经验结算（只进不退、溢出保留）→ 修为到账后自动推进小境界（V05-04 事务语义）。
 *   任何一步失败即停止并返回部分结果，调用方不再重试（battleFinished 单局仅发布一次）。
 * - 账号经验/自动推进/经济事务经 ops 注入（结构兼容 PlayerLeveling/EconomyService/
 *   RealmProgress），保持叶子可测。
 */
import type { PlayerLevelConfig, RealmConfig, StageRewardConfig } from '../config/ConfigTypes';
import type { BattleResult } from '../core/BattleEvents';
import type { AccountTxEntry } from '../account/AccountSave';
import type { AddAccountXpResult, PlayerLevelState } from './PlayerLeveling';
import type { EconomyOpRequest, EconomyOpResult } from '../economy/Economy';
import type { RealmOpFailureReason, RealmOpRequest, RealmState } from './RealmProgress';

/** 结算奖励计划（纯值，UI 与发放共用）。 */
export interface StageRewardPlan {
  readonly result: BattleResult;
  readonly ratio: number;
  /** 向下取整后的账号经验（0 表示本结果不发放经验）。 */
  readonly accountXp: number;
  /** 向下取整后的资源发放（全部为正整数；取整到 0 的项不出现）。 */
  readonly resourceDeltas: Record<string, number>;
}

/** 结算配置表切片（GameConfig 结构兼容，按结构类型传入）。 */
export interface SettlementTables {
  readonly playerLevel: PlayerLevelConfig;
  readonly realms: readonly RealmConfig[];
}

/** 账号存档切片（AccountSaveData 结构兼容，覆盖结算触及的域）。 */
export interface SettlementSaveState extends PlayerLevelState, RealmState {
  balances: Record<string, number>;
  recentTransactions: AccountTxEntry[];
}

/** 结算经济依赖（结构兼容 EconomyService；grant 原子发放 + spend 供小境界推进）。 */
export interface SettlementEconomyOps {
  getBalance(state: SettlementSaveState, resourceId: string): number;
  grant(state: SettlementSaveState, request: EconomyOpRequest): EconomyOpResult;
  spend(state: SettlementSaveState, request: EconomyOpRequest): EconomyOpResult;
}

/** 结算依赖（结构兼容 PlayerLeveling.addAccountXp / RealmProgress.autoPromoteSubRealms）。 */
export interface SettlementOps {
  addAccountXp(state: PlayerLevelState, config: PlayerLevelConfig, amount: number): AddAccountXpResult;
  autoPromoteSubRealms(
    realmState: RealmState,
    economyState: SettlementSaveState,
    realms: readonly RealmConfig[],
    economy: SettlementEconomyOps,
    request: RealmOpRequest,
  ): { promoted: number; stoppedReason: RealmOpFailureReason | null };
  economy: SettlementEconomyOps;
}

export interface SettlementApplyResult {
  readonly ok: boolean;
  readonly accountXpGranted: number;
  readonly levelsGained: number;
  readonly newLevel: number;
  /** 实际发放的资源（上限钳制后）。 */
  readonly appliedResources: Record<string, number>;
  /** 因库存上限被钳制丢失的资源。 */
  readonly lostToCap: Record<string, number>;
  readonly subRealmPromotions: number;
  /** 首个失败步骤的人类可读详情；成功为 null。 */
  readonly failureDetail: string | null;
}

/**
 * 按结果计算发放计划：victory 全额，defeat/abort 按配置比例逐项向下取整。
 * rewardMultiplier 为选中难度档的奖励乘数（V08-03）：发放 = floor(基础值 × 难度乘数 × 保留比例)，
 * 乘数与比例合并一次取整；缺省 1 = 普通难度，行为与 V0.5 完全一致。
 */
export function computeStageRewards(
  reward: StageRewardConfig,
  result: BattleResult,
  rewardMultiplier = 1,
): StageRewardPlan {
  const ratio = result === 'victory' ? 1 : result === 'defeat' ? reward.defeatRatio : reward.abortRatio;
  const resourceDeltas: Record<string, number> = {};
  for (const resourceId of Object.keys(reward.resources)) {
    const base = reward.resources[resourceId];
    if (typeof base === 'number' && base > 0) {
      const granted = Math.floor(base * rewardMultiplier * ratio);
      if (granted > 0) {
        resourceDeltas[resourceId] = granted;
      }
    }
  }
  return {
    result,
    ratio,
    accountXp: Math.floor(reward.accountXp * rewardMultiplier * ratio),
    resourceDeltas,
  };
}

/**
 * 执行发放：资源单事务（失败即整体拒绝、零修改）→ 账号经验 → 自动推进小境界。
 * 失败返回 ok=false 与失败详情，不抛错；调用方负责日志与落盘决策。
 */
export function applyStageRewards(
  save: SettlementSaveState,
  tables: SettlementTables,
  plan: StageRewardPlan,
  ops: SettlementOps,
  request: RealmOpRequest,
): SettlementApplyResult {
  const appliedResources: Record<string, number> = {};
  const lostToCap: Record<string, number> = {};
  const failureBase = {
    accountXpGranted: 0,
    levelsGained: 0,
    newLevel: save.playerLevel,
    appliedResources,
    lostToCap,
    subRealmPromotions: 0,
  };

  const resourceIds = Object.keys(plan.resourceDeltas);
  if (resourceIds.length > 0) {
    const grant = ops.economy.grant(save, {
      txId: request.txId,
      kind: `stage_reward_${plan.result}`,
      deltas: plan.resourceDeltas,
      at: request.at,
    });
    if (!grant.ok) {
      return { ...failureBase, ok: false, failureDetail: grant.detail };
    }
    Object.assign(appliedResources, grant.appliedDeltas);
    Object.assign(lostToCap, grant.lostToCap);
  }

  let accountXpGranted = 0;
  let levelsGained = 0;
  let newLevel = save.playerLevel;
  if (plan.accountXp > 0) {
    const xp = ops.addAccountXp(save, tables.playerLevel, plan.accountXp);
    if (!xp.ok) {
      return { ...failureBase, ok: false, failureDetail: xp.detail, appliedResources, lostToCap };
    }
    accountXpGranted = plan.accountXp;
    levelsGained = xp.levelsGained;
    newLevel = xp.newLevel;
  }

  const promotion = ops.autoPromoteSubRealms(save, save, tables.realms, ops.economy, {
    txId: `${request.txId}#promote`,
    at: request.at,
  });

  return {
    ok: true,
    accountXpGranted,
    levelsGained,
    newLevel,
    appliedResources,
    lostToCap,
    subRealmPromotions: promotion.promoted,
    failureDetail: null,
  };
}
