/**
 * 成就系统数据层（V08-10）。
 *
 * 单文件叶子模块（零跨文件值导入，仅类型导入，可被 node 纯逻辑测试直接加载）：
 * - 与任务追踪器同语义的条件匹配（killCount/clearCount/collectXp/levelUpCount/
 *   spendResource，V08-09 同一套事件接线调用方复用），但成就为永久累计：
 *   进度只进不退、无周期重置、无前置链。
 * - 分级阶段（tiers 升序）：进度达某档目标即可领取该档奖励（领取与完成分离，
 *   每档一次）；"当前阶段"= 下一未领取档（UI 只显示当前阶段）。
 * - 完成后不因配置回退：进度与 claimedTier 只增不减；配置缩短（档位变少）时
 *   视图钳制显示，已领取状态不回收。
 * - 隐藏成就（hidden）：累计进度未达第一阶目标前不在列表与红点出现。
 * - 领取事务：资源单事务（含灵玉 res_lingyu 首次投放）→ 账号经验 → claimedTier
 *   最后写入（失败路径零修改）。
 */
import type { AchievementConfig, PlayerLevelConfig } from '../config/ConfigTypes';
import type { AccountTxEntry, AchievementSaveEntry } from './AccountSave';
import type { EconomyOpRequest, EconomyOpResult } from '../economy/Economy';
import type { AddAccountXpResult, PlayerLevelState } from './PlayerLeveling';

/** 成就配置表切片（GameConfig 结构兼容）。 */
export interface AchievementTables {
  readonly achievements: readonly AchievementConfig[];
  readonly playerLevel: PlayerLevelConfig;
}

/** 成就系统存档切片（AccountSaveData 结构兼容）。 */
export interface AchievementState extends PlayerLevelState {
  achievements: Record<string, AchievementSaveEntry>;
  balances: Record<string, number>;
  recentTransactions: AccountTxEntry[];
}

export interface AchievementEconomyOps {
  grant(state: AchievementState, request: EconomyOpRequest): EconomyOpResult;
}

export interface AchievementLevelOps {
  addAccountXp(state: PlayerLevelState, config: PlayerLevelConfig, amount: number): AddAccountXpResult;
}

export type AchievementClaimResult =
  | { readonly ok: true; readonly tierIndex: number; readonly accountXp: number; readonly resources: Readonly<Record<string, number>> }
  | {
    readonly ok: false;
    readonly reason: 'unknown_achievement' | 'hidden' | 'no_progress' | 'tier_not_reached' | 'all_claimed' | 'grant_rejected' | 'xp_rejected';
    readonly detail: string | null;
  };

export interface AchievementClaimRequest {
  readonly txId: string;
  readonly at: number;
}

const ZERO_ENTRY: AchievementSaveEntry = { progress: 0, claimedTier: 0 };

function entryFor(state: AchievementState, achievementId: string): AchievementSaveEntry {
  const entry = state.achievements[achievementId];
  if (entry !== undefined) {
    // 已领取档位不得因任何原因回退（完成状态不因配置回退）。
    return { progress: entry.progress, claimedTier: entry.claimedTier };
  }
  return ZERO_ENTRY;
}

function isConditionMatch(
  condition: AchievementConfig['condition'],
  kind: 'killCount' | 'clearCount' | 'collectXp' | 'levelUpCount' | 'spendResource',
  resourceId: string | null,
): boolean {
  if (condition.kind !== kind) {
    return false;
  }
  if (condition.kind === 'spendResource') {
    return resourceId === condition.resourceId;
  }
  return true;
}

/** 最终档目标（进度累计上限）；配置缺失档位时按 0 处理。 */
export function getFinalTarget(achievement: AchievementConfig): number {
  const last = achievement.tiers[achievement.tiers.length - 1];
  return last !== undefined ? last.target : 0;
}

/**
 * 应用一次领域事件增量：匹配成就按目标累计（封顶最终档目标），进度只进不退。
 * 返回进度发生变化的成就 ID。
 */
export function applyAchievementEvent(
  state: AchievementState,
  tables: AchievementTables,
  kind: 'killCount' | 'clearCount' | 'collectXp' | 'levelUpCount' | 'spendResource',
  amount: number,
  resourceId: string | null,
): string[] {
  if (!(amount > 0)) {
    return [];
  }
  const changed: string[] = [];
  for (const achievement of tables.achievements) {
    if (!isConditionMatch(achievement.condition, kind, resourceId)) {
      continue;
    }
    const entry = entryFor(state, achievement.id);
    const finalTarget = getFinalTarget(achievement);
    const next = Math.min(finalTarget, entry.progress + Math.floor(amount));
    if (next !== entry.progress) {
      state.achievements[achievement.id] = { progress: next, claimedTier: entry.claimedTier };
      changed.push(achievement.id);
    }
  }
  return changed;
}

/** 成就视图（UI/红点查询源）：进度、当前阶段（下一未领取档）、可见性。 */
export interface AchievementView {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly hidden: boolean;
  /** 是否在列表/红点出现（隐藏成就达第一阶目标后可见）。 */
  readonly visible: boolean;
  readonly progress: number;
  /** 下一未领取档下标（0 基）；全部领取后为 tiers.length。 */
  readonly currentTierIndex: number;
  /** 当前阶段目标（全部领取后为 null）。 */
  readonly currentTarget: number | null;
  readonly claimedTier: number;
  readonly tierCount: number;
  /** 当前阶段已达成且未领取。 */
  readonly claimable: boolean;
}

export function getAchievementView(
  state: AchievementState,
  tables: AchievementTables,
  achievementId: string,
): AchievementView | null {
  const achievement = tables.achievements.find((candidate) => candidate.id === achievementId);
  if (achievement === undefined) {
    return null;
  }
  const entry = entryFor(state, achievement.id);
  const claimedTier = entry.claimedTier;
  const tier = achievement.tiers[claimedTier];
  const firstTarget = achievement.tiers[0]?.target ?? Number.MAX_SAFE_INTEGER;
  const visible = !achievement.hidden || entry.progress >= firstTarget;
  const currentTierIndex = Math.min(claimedTier, achievement.tiers.length);
  const currentTarget = tier !== undefined ? tier.target : null;
  return {
    id: achievement.id,
    displayName: achievement.displayName,
    description: achievement.description,
    hidden: achievement.hidden,
    visible,
    progress: entry.progress,
    currentTierIndex,
    currentTarget,
    claimedTier,
    tierCount: achievement.tiers.length,
    claimable: visible && tier !== undefined && entry.progress >= tier.target,
  };
}

/** 全部可见成就的视图列表（隐藏且未解锁的不出现——红点/列表共用）。 */
export function listAchievementViews(
  state: AchievementState,
  tables: AchievementTables,
): AchievementView[] {
  const views: AchievementView[] = [];
  for (const achievement of tables.achievements) {
    const view = getAchievementView(state, tables, achievement.id);
    if (view !== null && view.visible) {
      views.push(view);
    }
  }
  return views;
}

/**
 * 领取当前阶段奖励（每档一次）：校验可见 + 目标达成 + 未全部领取 →
 * 资源单事务（灵玉投放）→ 账号经验 → claimedTier 推进（最后写入）。
 */
export function claimAchievementTier(
  state: AchievementState,
  tables: AchievementTables,
  economy: AchievementEconomyOps,
  levelOps: AchievementLevelOps,
  achievementId: string,
  request: AchievementClaimRequest,
): AchievementClaimResult {
  const achievement = tables.achievements.find((candidate) => candidate.id === achievementId);
  if (achievement === undefined) {
    return { ok: false, reason: 'unknown_achievement', detail: `achievement "${achievementId}" not found` };
  }
  const entry = entryFor(state, achievement.id);
  const tier = achievement.tiers[entry.claimedTier];
  const firstTarget = achievement.tiers[0]?.target ?? Number.MAX_SAFE_INTEGER;
  if (achievement.hidden && entry.progress < firstTarget) {
    return { ok: false, reason: 'hidden', detail: null };
  }
  if (tier === undefined) {
    return { ok: false, reason: 'all_claimed', detail: null };
  }
  if (entry.progress < tier.target) {
    return { ok: false, reason: 'tier_not_reached', detail: null };
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
      kind: 'achievement_reward',
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
  state.achievements[achievementId] = { progress: entry.progress, claimedTier: entry.claimedTier + 1 };
  return { ok: true, tierIndex: entry.claimedTier, accountXp: tier.reward.accountXp, resources };
}
