/**
 * 广告奖励发放纯逻辑（V10-11，ECONOMY §6：结算加成与每日有限资源）。
 *
 * 单文件叶子模块（零跨文件值导入，仅类型导入，可被 node 纯逻辑测试直接加载）：
 * - **结算加成**：对本局已结算计划按倍率补差（topUp = floor(基础×倍率) − 本局
 *   已发；defeat 保留比例折算后的"基础×倍率"仍向下取整——补差永不为负）。
 *   发放走经济事务单次幂等；次数每日入 offerClaims 审计（与复活同模式，
 *   键 ad_<placement>_<dayKey>，写入时清理同投放旧日键）。
 * - **每日资源**：观看激励广告领固定资源包（单事务发放），次数/冷却同审计
 *   （冷却锚点 = 当日最近一次成功领取的服务器分钟时间，存审计键的伴生值
 *   lastClaimAt；无独立存档域）。
 * - 广告失败/中途关闭不调用任何写入（凭证判定在 platform/AdAdapter）。
 * - 与任务/成就产消复核：本模块投放计入 CONFIG.md 产消表广告位一节。
 */
import type {
  AdDailyResourceConfig,
  AdSettlementBonusConfig,
  StageRewardConfig,
} from '../config/ConfigTypes';
import type { BattleResult } from '../core/BattleEvents';
import type { AccountSaveData, AccountTxEntry } from './AccountSave';
import type { EconomyOpRequest, EconomyOpResult } from '../economy/Economy';

/** 结算加成依赖（结构兼容 EconomyService.grant 与 SettlementRewards 语义）。 */
export interface AdRewardEconomyOps {
  grant(state: AdRewardSaveSlice, request: EconomyOpRequest): EconomyOpResult;
}

/** 结算加成存档切片（AccountSaveData 结构兼容）。 */
export interface AdRewardSaveSlice {
  balances: Record<string, number>;
  offerClaims: Record<string, { claimCount: number }>;
  recentTransactions: AccountTxEntry[];
}

const AUDIT_KEY_PREFIX = 'ad_';

function auditKey(placementId: string, dayKey: string): string {
  return `${AUDIT_KEY_PREFIX}${placementId}_${dayKey}`;
}

function getDailyUses(save: AdRewardSaveSlice, placementId: string, dayKey: string): number {
  const entry = save.offerClaims[auditKey(placementId, dayKey)];
  return entry !== undefined ? entry.claimCount : 0;
}

/** 当日已用次数（UI 展示与判定共用）。 */
export function getAdDailyUses(save: AccountSaveData, placementId: string, dayKey: string): number {
  return getDailyUses(save, placementId, dayKey);
}

/** 写一次成功使用并清理同投放旧日键（容量有界）；dayClaimMinutes 供冷却锚点。 */
function recordUse(
  save: AdRewardSaveSlice,
  placementId: string,
  dayKey: string,
  lastClaimAtMinutes: number | null,
): void {
  const key = auditKey(placementId, dayKey);
  const current = save.offerClaims[key];
  save.offerClaims[key] = { claimCount: (current !== undefined ? current.claimCount : 0) + 1 };
  if (lastClaimAtMinutes !== null) {
    (save.offerClaims[key] as { claimCount: number; lastClaimAt?: number }).lastClaimAt = lastClaimAtMinutes;
  }
  const keepPrefix = `${AUDIT_KEY_PREFIX}${placementId}_`;
  for (const existing of Object.keys(save.offerClaims)) {
    if (existing !== key && existing.indexOf(keepPrefix) === 0) {
      delete save.offerClaims[existing];
    }
  }
}

/** 当日最近一次成功领取的服务器分钟（冷却锚点）；从未领取为 null。 */
function getLastClaimAtMinutes(
  save: AdRewardSaveSlice,
  placementId: string,
  dayKey: string,
): number | null {
  const entry = save.offerClaims[auditKey(placementId, dayKey)] as { claimCount: number; lastClaimAt?: number } | undefined;
  return entry !== undefined && typeof entry.lastClaimAt === 'number' ? entry.lastClaimAt : null;
}

// —— 结算加成 ——

export type SettlementBonusCheck =
  | { readonly ok: true; readonly remainingToday: number }
  | {
      readonly ok: false;
      readonly reason: 'placement_disabled' | 'result_not_offered' | 'per_day_limit' | 'already_topped_up';
    };

export function canOfferSettlementBonus(
  save: AccountSaveData,
  config: AdSettlementBonusConfig,
  result: BattleResult,
  dayKey: string,
  alreadyToppedUp: boolean,
  isPlacementEnabled: (placementId: string) => boolean,
): SettlementBonusCheck {
  if (!isPlacementEnabled(config.placementId)) {
    return { ok: false, reason: 'placement_disabled' };
  }
  if (config.results.indexOf(result) === -1) {
    return { ok: false, reason: 'result_not_offered' };
  }
  if (alreadyToppedUp) {
    return { ok: false, reason: 'already_topped_up' };
  }
  if (getDailyUses(save, config.placementId, dayKey) >= config.maxPerDay) {
    return { ok: false, reason: 'per_day_limit' };
  }
  return { ok: true, remainingToday: Math.max(0, config.maxPerDay - getDailyUses(save, config.placementId, dayKey)) };
}

/**
 * 结算加成补差计划：topUp = floor(基础 × 难度乘数 × 倍率) − 本局已发。
 * 翻倍基线含保留比例语义（defeat 基础 = victory 值 × defeatRatio），
 * 与 computeStageRewards 同公式单一所有者；补差为负（倍率不足）不发放。
 */
export function computeSettlementTopUp(
  reward: StageRewardConfig,
  result: BattleResult,
  rewardMultiplier: number,
  config: AdSettlementBonusConfig,
): { readonly accountXp: number; readonly resources: Record<string, number> } {
  const ratio = result === 'victory' ? 1 : result === 'defeat' ? reward.defeatRatio : reward.abortRatio;
  const bonusMultiplier = config.rewardMultiplier * rewardMultiplier * ratio;
  const resources: Record<string, number> = {};
  for (const resourceId of Object.keys(reward.resources)) {
    const base = reward.resources[resourceId];
    if (typeof base === 'number' && base > 0) {
      const granted = Math.floor(base * rewardMultiplier * ratio);
      const topped = Math.floor(base * bonusMultiplier);
      const topUp = topped - granted;
      if (topUp > 0) {
        resources[resourceId] = topUp;
      }
    }
  }
  const xpGranted = Math.floor(reward.accountXp * rewardMultiplier * ratio);
  const xpTopped = Math.floor(reward.accountXp * bonusMultiplier);
  return { accountXp: Math.max(0, xpTopped - xpGranted), resources };
}

export interface SettlementBonusApplyResult {
  readonly ok: boolean;
  readonly accountXp: number;
  readonly appliedResources: Record<string, number>;
  readonly failureDetail: string | null;
}

/**
 * 应用结算加成（广告已发奖后调用一次）：资源单事务（kind=ad_settlement_bonus）
 * → 账号经验（addXp 注入）→ 审计次数 +1。资源为零且经验为零时为幂等 no-op。
 */
export function applySettlementBonus(
  save: AccountSaveData,
  config: AdSettlementBonusConfig,
  topUp: { readonly accountXp: number; readonly resources: Record<string, number> },
  economy: AdRewardEconomyOps,
  addXp: (
    state: { playerLevel: number; playerXp: number },
    amount: number,
  ) => { ok: true; levelsGained: number; newLevel: number; newXp: number } | { ok: false; reason: string; detail: string | null },
  request: { readonly txId: string; readonly at: number },
  dayKey: string,
): SettlementBonusApplyResult {
  const resourceIds = Object.keys(topUp.resources);
  if (resourceIds.length > 0) {
    const grant = economy.grant(save, {
      txId: request.txId,
      kind: 'ad_settlement_bonus',
      deltas: topUp.resources,
      at: request.at,
    });
    if (!grant.ok) {
      return { ok: false, accountXp: 0, appliedResources: {}, failureDetail: grant.detail };
    }
  }
  if (topUp.accountXp > 0) {
    const xp = addXp(save, topUp.accountXp);
    if (!xp.ok) {
      return { ok: false, accountXp: 0, appliedResources: {}, failureDetail: xp.detail };
    }
  }
  recordUse(save, config.placementId, dayKey, null);
  return { ok: true, accountXp: topUp.accountXp, appliedResources: topUp.resources, failureDetail: null };
}

// —— 每日资源 ——

export type DailyResourceCheck =
  | { readonly ok: true; readonly remainingToday: number }
  | {
      readonly ok: false;
      readonly reason: 'placement_disabled' | 'per_day_limit' | 'cooldown';
    };

export function canClaimDailyResource(
  save: AccountSaveData,
  config: AdDailyResourceConfig,
  dayKey: string,
  nowMinutes: number,
  isPlacementEnabled: (placementId: string) => boolean,
): DailyResourceCheck {
  if (!isPlacementEnabled(config.placementId)) {
    return { ok: false, reason: 'placement_disabled' };
  }
  const used = getDailyUses(save, config.placementId, dayKey);
  if (used >= config.maxPerDay) {
    return { ok: false, reason: 'per_day_limit' };
  }
  if (config.cooldownMinutes > 0 && used > 0) {
    const last = getLastClaimAtMinutes(save, config.placementId, dayKey);
    if (last !== null && nowMinutes - last < config.cooldownMinutes) {
      return { ok: false, reason: 'cooldown' };
    }
  }
  return { ok: true, remainingToday: config.maxPerDay - used };
}

export interface DailyResourceApplyResult {
  readonly ok: boolean;
  readonly appliedResources: Record<string, number>;
  readonly failureDetail: string | null;
}

/**
 * 领取每日资源（广告已发奖后调用一次）：资源单事务（kind=ad_daily_resource）
 * → 审计次数 +1 并记录冷却锚点（当日服务器分钟）。配置包数值为正由校验保证。
 */
export function claimDailyResource(
  save: AccountSaveData,
  config: AdDailyResourceConfig,
  economy: AdRewardEconomyOps,
  request: { readonly txId: string; readonly at: number },
  dayKey: string,
  nowMinutes: number,
): DailyResourceApplyResult {
  const grant = economy.grant(save, {
    txId: request.txId,
    kind: 'ad_daily_resource',
    deltas: { ...config.resources },
    at: request.at,
  });
  if (!grant.ok) {
    return { ok: false, appliedResources: {}, failureDetail: grant.detail };
  }
  recordUse(save, config.placementId, dayKey, nowMinutes);
  return { ok: true, appliedResources: grant.appliedDeltas, failureDetail: null };
}
