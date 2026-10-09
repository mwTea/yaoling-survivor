/**
 * 30 日累计登录（V08-14）。
 *
 * 单文件叶子模块（零跨文件值导入，仅类型导入，可被 node 纯逻辑测试直接加载）：
 * - 会话启动时按 dayKey（TimeService）推进累计有效登录天数：每自然日最多 +1、
 *   不要求连续、不补签、漏登不清零；lastCountedDayKey 幂等防同日重复推进。
 * - 逐档领取事务：累计天数达到下一档 day 即可领（领取与推进分离），奖励经
 *   经济事务入账 + 账号经验；claimedTier 最后写入（失败路径零修改，重复领取拒绝）。
 * - 第 totalDays 档领完本轮结束（completed），首发一次性不循环。
 * - 灵玉不在登录奖励投放（唯一产出 = 成就，V08-10 口径）。
 */
import type { LoginRewardConfig, PlayerLevelConfig } from '../config/ConfigTypes';
import type { AccountTxEntry, LoginRewardSaveState } from './AccountSave';
import type { EconomyOpRequest, EconomyOpResult } from '../economy/Economy';
import type { AddAccountXpResult, PlayerLevelState } from './PlayerLeveling';

/** 累计登录配置表切片（GameConfig 结构兼容）。 */
export interface LoginRewardTables {
  readonly loginRewards: LoginRewardConfig;
  readonly playerLevel: PlayerLevelConfig;
}

/** 累计登录存档切片（AccountSaveData 结构兼容）。 */
export interface LoginRewardState extends PlayerLevelState {
  loginReward: LoginRewardSaveState;
  balances: Record<string, number>;
  recentTransactions: AccountTxEntry[];
}

export interface LoginRewardEconomyOps {
  grant(state: LoginRewardState, request: EconomyOpRequest): EconomyOpResult;
}

export interface LoginRewardLevelOps {
  addAccountXp(state: PlayerLevelState, config: PlayerLevelConfig, amount: number): AddAccountXpResult;
}

export type LoginClaimResult =
  | {
    readonly ok: true;
    readonly tierDay: number;
    readonly accountXp: number;
    readonly resources: Readonly<Record<string, number>>;
    /** 本轮是否已全部领完（第 totalDays 档领取后为 true）。 */
    readonly completed: boolean;
  }
  | {
    readonly ok: false;
    readonly reason: 'not_reached' | 'already_claimed' | 'round_completed' | 'no_tier' | 'grant_rejected' | 'xp_rejected';
    readonly detail: string | null;
  };

export interface LoginClaimRequest {
  readonly txId: string;
  readonly at: number;
}

/**
 * 会话启动推进（幂等）：lastCountedDayKey ≠ 当前 dayKey 时 totalDays +1 并记录
 * 该日 key；同日多次登录只推进一次；漏登不清零（totalDays 只增不减）。
 * 返回是否发生了推进（装配层据此决定是否落盘）。
 */
export function advanceLoginDay(state: LoginRewardState, dayKey: string): boolean {
  if (state.loginReward.lastCountedDayKey === dayKey) {
    return false;
  }
  state.loginReward.totalDays += 1;
  state.loginReward.lastCountedDayKey = dayKey;
  return true;
}

/** 当前可领取的档位（day 升序中第一个"已达天数且未领取"的档）；无可领为 null。 */
export function getClaimableTierIndex(
  state: LoginRewardState,
  tables: LoginRewardTables,
): number | null {
  const tiers = tables.loginRewards.tiers;
  const claimed = state.loginReward.claimedTier;
  if (claimed >= tiers.length) {
    return null;
  }
  const tier = tiers[claimed];
  if (tier === undefined || state.loginReward.totalDays < tier.day) {
    return null;
  }
  return claimed;
}

/** 本轮是否已全部领完（第 totalDays 档领取后完结，首发一次性不循环）。 */
export function isLoginRoundCompleted(state: LoginRewardState, tables: LoginRewardTables): boolean {
  return state.loginReward.claimedTier >= tables.loginRewards.totalDays;
}

/**
 * 领取下一档奖励：校验（本轮完结 → 天数达标 → 未领完）→ 资源单事务 →
 * 账号经验 → claimedTier 推进（最后写入）。
 */
export function claimLoginReward(
  state: LoginRewardState,
  tables: LoginRewardTables,
  economy: LoginRewardEconomyOps,
  levelOps: LoginRewardLevelOps,
  request: LoginClaimRequest,
): LoginClaimResult {
  if (isLoginRoundCompleted(state, tables)) {
    return { ok: false, reason: 'round_completed', detail: null };
  }
  const tierIndex = state.loginReward.claimedTier;
  const tier = tables.loginRewards.tiers[tierIndex];
  if (tier === undefined) {
    return { ok: false, reason: 'no_tier', detail: `login tier ${tierIndex} missing` };
  }
  if (state.loginReward.totalDays < tier.day) {
    return { ok: false, reason: 'not_reached', detail: null };
  }
  const resources: Record<string, number> = {};
  for (const resourceId of Object.keys(tier.reward.resources)) {
    const amount = tier.reward.resources[resourceId];
    if (typeof amount === 'number' && amount > 0) {
      resources[resourceId] = Math.floor(amount);
    }
  }
  if (Object.keys(resources).length > 0) {
    const grant = economy.grant(state, {
      txId: request.txId,
      kind: 'login_reward',
      deltas: resources,
      at: request.at,
    });
    if (!grant.ok) {
      return { ok: false, reason: 'grant_rejected', detail: grant.detail };
    }
  }
  if (tier.reward.accountXp > 0) {
    const xp = levelOps.addAccountXp(state, tables.playerLevel, tier.reward.accountXp);
    if (!xp.ok) {
      return { ok: false, reason: 'xp_rejected', detail: xp.detail };
    }
  }
  state.loginReward.claimedTier = tierIndex + 1;
  return {
    ok: true,
    tierDay: tier.day,
    accountXp: tier.reward.accountXp,
    resources,
    completed: state.loginReward.claimedTier >= tables.loginRewards.totalDays,
  };
}
