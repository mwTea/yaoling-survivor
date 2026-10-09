/**
 * 统一礼包模型（免费子集）数据层（V08-15）。
 *
 * 单文件叶子模块（零跨文件值导入，仅类型导入，可被 node 纯逻辑测试直接加载）：
 * - 条件解锁判定：playerLevel / chapterClear（章节全部关卡通关，任意难度）/
 *   realmIndex（达到大境界）；前置礼包未领取不可领后继（prerequisiteOfferId 链）。
 * - 领取事务：条件未达拒绝 → 资源单事务（kind=offer_reward）→ 账号经验 →
 *   claimCount 最后写入（失败路径零修改；重复领取被 purchaseLimit=1 拦截）。
 * - priceType 恒 'free'（ECONOMY §5 免费子集；付费/广告 V0.8 不做）。
 * - 章节通关判定内联实现（与 StageProgress.isStageCleared 同语义同键格式
 *   `stageId|difficultyId`，叶子模块零值导入约束；一致性由 node 测试交叉验证）。
 */
import type { ChapterConfig, OfferConfig, PlayerLevelConfig } from '../config/ConfigTypes';
import type { AccountTxEntry, OfferClaimSaveEntry } from './AccountSave';
import type { EconomyOpRequest, EconomyOpResult } from '../economy/Economy';
import type { AddAccountXpResult, PlayerLevelState } from './PlayerLeveling';

const RECORD_KEY_SEPARATOR = '|';

/** 礼包配置表切片（GameConfig 结构兼容）。 */
export interface OfferTables {
  readonly offers: readonly OfferConfig[];
  readonly chapters: readonly ChapterConfig[];
  readonly playerLevel: PlayerLevelConfig;
}

/** 礼包系统存档切片（AccountSaveData 结构兼容）。 */
export interface OfferState extends PlayerLevelState {
  /** 大境界下标（realmIndex 解锁条件）。 */
  realmIndex: number;
  offerClaims: Record<string, OfferClaimSaveEntry>;
  balances: Record<string, number>;
  recentTransactions: AccountTxEntry[];
  /** chapterClear 条件读取关卡通关记录（进度域切片）。 */
  stageRecords: Record<string, { cleared: boolean }>;
}

export interface OfferEconomyOps {
  grant(state: OfferState, request: EconomyOpRequest): EconomyOpResult;
}

export interface OfferLevelOps {
  addAccountXp(state: PlayerLevelState, config: PlayerLevelConfig, amount: number): AddAccountXpResult;
}

export type OfferClaimResult =
  | { readonly ok: true; readonly accountXp: number; readonly resources: Readonly<Record<string, number>> }
  | {
    readonly ok: false;
    readonly reason: 'unknown_offer' | 'prerequisite_locked' | 'condition_unmet' | 'already_claimed' | 'grant_rejected' | 'xp_rejected';
    readonly detail: string | null;
  };

export interface OfferClaimRequest {
  readonly txId: string;
  readonly at: number;
}

function isStageClearedAnyDifficulty(state: OfferState, stageId: string): boolean {
  for (const key of Object.keys(state.stageRecords)) {
    const record = state.stageRecords[key];
    if (record !== undefined && record.cleared && key.split(RECORD_KEY_SEPARATOR)[0] === stageId) {
      return true;
    }
  }
  return false;
}

function isConditionMet(state: OfferState, tables: OfferTables, offer: OfferConfig): boolean {
  const condition = offer.unlockCondition;
  if (condition.kind === 'playerLevel') {
    return state.playerLevel >= condition.level;
  }
  if (condition.kind === 'realmIndex') {
    return state.realmIndex >= condition.realmIndex;
  }
  // chapterClear：章节收录的全部关卡（任意难度）均通关。
  const chapter = tables.chapters.find((candidate) => candidate.id === condition.chapterId);
  if (chapter === undefined) {
    return false;
  }
  return chapter.stageIds.every((stageId) => isStageClearedAnyDifficulty(state, stageId));
}

/** 前置礼包是否已领取（claimCount > 0）；无前置恒 true。 */
function isPrerequisiteClaimed(state: OfferState, tables: OfferTables, offer: OfferConfig): boolean {
  if (offer.prerequisiteOfferId === null) {
    return true;
  }
  if (tables.offers.find((candidate) => candidate.id === offer.prerequisiteOfferId) === undefined) {
    return false;
  }
  const claim = state.offerClaims[offer.prerequisiteOfferId];
  return claim !== undefined && claim.claimCount > 0;
}

export type OfferUnlockStatus =
  | { readonly unlocked: true }
  | { readonly unlocked: false; readonly reason: 'unknown_offer' | 'prerequisite_locked' | 'condition_unmet' };

/** 条件解锁判定（奖励中心/红点查询源）。 */
export function getOfferUnlockStatus(state: OfferState, tables: OfferTables, offerId: string): OfferUnlockStatus {
  const offer = tables.offers.find((candidate) => candidate.id === offerId);
  if (offer === undefined) {
    return { unlocked: false, reason: 'unknown_offer' };
  }
  if (!isPrerequisiteClaimed(state, tables, offer)) {
    return { unlocked: false, reason: 'prerequisite_locked' };
  }
  if (!isConditionMet(state, tables, offer)) {
    return { unlocked: false, reason: 'condition_unmet' };
  }
  return { unlocked: true };
}

/** 是否可领取（已解锁且未达限购）。 */
export function isOfferClaimable(state: OfferState, tables: OfferTables, offerId: string): boolean {
  const status = getOfferUnlockStatus(state, tables, offerId);
  if (!status.unlocked) {
    return false;
  }
  const claim = state.offerClaims[offerId];
  const offer = tables.offers.find((candidate) => candidate.id === offerId);
  const limit = offer?.purchaseLimit ?? 1;
  return (claim?.claimCount ?? 0) < limit;
}

/** 领取礼包（免费子集）：条件校验 → 资源单事务 → 账号经验 → claimCount 推进。 */
export function claimOffer(
  state: OfferState,
  tables: OfferTables,
  economy: OfferEconomyOps,
  levelOps: OfferLevelOps,
  offerId: string,
  request: OfferClaimRequest,
): OfferClaimResult {
  const offer = tables.offers.find((candidate) => candidate.id === offerId);
  if (offer === undefined) {
    return { ok: false, reason: 'unknown_offer', detail: `offer "${offerId}" not found` };
  }
  const status = getOfferUnlockStatus(state, tables, offerId);
  if (!status.unlocked) {
    return { ok: false, reason: status.reason, detail: null };
  }
  const claim = state.offerClaims[offerId];
  const claimCount = claim?.claimCount ?? 0;
  if (claimCount >= offer.purchaseLimit) {
    return { ok: false, reason: 'already_claimed', detail: null };
  }
  const resources: Record<string, number> = {};
  for (const resourceId of Object.keys(offer.contents.resources)) {
    const amount = offer.contents.resources[resourceId];
    if (typeof amount === 'number' && amount > 0) {
      resources[resourceId] = Math.floor(amount);
    }
  }
  if (Object.keys(resources).length > 0) {
    const grant = economy.grant(state, {
      txId: request.txId,
      kind: 'offer_reward',
      deltas: resources,
      at: request.at,
    });
    if (!grant.ok) {
      return { ok: false, reason: 'grant_rejected', detail: grant.detail };
    }
  }
  if (offer.contents.accountXp > 0) {
    const xp = levelOps.addAccountXp(state, tables.playerLevel, offer.contents.accountXp);
    if (!xp.ok) {
      return { ok: false, reason: 'xp_rejected', detail: xp.detail };
    }
  }
  state.offerClaims[offerId] = { claimCount: claimCount + 1 };
  return { ok: true, accountXp: offer.contents.accountXp, resources };
}
