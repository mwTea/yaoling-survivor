/**
 * 关卡进度纯逻辑（V08-03）。
 *
 * 单文件叶子模块（零跨文件值导入，仅类型导入，可被 node 纯逻辑测试直接加载）：
 * - 解锁链判定：章节解锁（requiredChapterId 链 + 前置章节全通关）→ 关卡解锁
 *   （章内前一关通关，任意难度）→ 难度解锁（前一难度档历史最高星达标）。
 * - 星级/通关历史只进不退（recordStageOutcome 取历史最大值，低分重打不回退）。
 * - 首通/星级累计奖励领取状态（firstClearClaimed / claimedStarRewardTiers，
 *   领取事务由 V08-05 走经济模块，本模块只维护存档标志位）。
 * - 选中关卡解析（存档 stageSelection；未选择时默认第一章第一关的普通难度）。
 *
 * 存档键格式与 `AccountSave.buildStageRecordKey` 保持一致
 * （`${stageId}|${difficultyId}`）；此处内联实现以维持叶子模块零值导入约束，
 * 两侧一致性由 node 测试交叉验证。
 */
import type { ChapterConfig, PlayerLevelConfig, StageConfig, StageDifficultyConfig } from '../config/ConfigTypes';
import type { AccountTxEntry, StageRecordEntry, StageSelectionSave } from './AccountSave';
import type { EconomyOpRequest, EconomyOpResult } from '../economy/Economy';
import type { AddAccountXpResult, PlayerLevelState } from './PlayerLeveling';

/** 关卡进度配置表切片（GameConfig 结构兼容，按结构类型传入）。 */
export interface StageProgressTables {
  readonly chapters: readonly ChapterConfig[];
  readonly stages: readonly StageConfig[];
}

/** 关卡进度存档切片（AccountSaveData 结构兼容，覆盖进度域扩展字段）。 */
export interface StageProgressState {
  stageRecords: Record<string, StageRecordEntry>;
  unlockedChapterIds: string[];
}

/** 一次关卡结果对存档的增量（cleared = 本局胜利；stars = 本局评定星级，V08-04 接入）。 */
export interface StageOutcomeInput {
  readonly cleared: boolean;
  readonly stars: number;
}

const RECORD_KEY_SEPARATOR = '|';
const ZERO_RECORD: StageRecordEntry = {
  highestStars: 0,
  cleared: false,
  firstClearClaimed: false,
  claimedStarRewardTiers: 0,
};

/** 与 AccountSave.buildStageRecordKey 同格式（见文件头注释）。 */
export function stageRecordKey(stageId: string, difficultyId: string): string {
  return `${stageId}${RECORD_KEY_SEPARATOR}${difficultyId}`;
}

/** 按 ID 取关卡；未知 ID 快速失败（配置/存档不一致属于开发期错误）。 */
export function findStageOrThrow(tables: StageProgressTables, stageId: string): StageConfig {
  const stage = tables.stages.find((candidate) => candidate.id === stageId);
  if (stage === undefined) {
    throw new Error(`[StageProgress] Unknown stage id "${stageId}"`);
  }
  return stage;
}

/** 按 ID 取关卡难度档；未知 ID 快速失败。 */
export function findDifficultyOrThrow(
  stage: StageConfig,
  difficultyId: string,
): StageDifficultyConfig {
  const difficulty = stage.difficulties.find((candidate) => candidate.id === difficultyId);
  if (difficulty === undefined) {
    throw new Error(`[StageProgress] Unknown difficulty id "${difficultyId}" on stage "${stage.id}"`);
  }
  return difficulty;
}

/** 未选择时的默认目标：第一章第一关 × 其首个难度档。 */
export function getDefaultStageSelection(tables: StageProgressTables): StageSelectionSave {
  const chapter = tables.chapters[0];
  if (chapter === undefined || chapter.stageIds.length === 0) {
    throw new Error('[StageProgress] Config has no chapter with stages');
  }
  const stageId = chapter.stageIds[0];
  if (stageId === undefined) {
    throw new Error('[StageProgress] First chapter has no first stage');
  }
  const stage = findStageOrThrow(tables, stageId);
  const difficulty = stage.difficulties[0];
  if (difficulty === undefined) {
    throw new Error(`[StageProgress] Stage "${stageId}" has no difficulty tier`);
  }
  return { stageId, difficultyId: difficulty.id };
}

/**
 * 解析本次开战的选中关卡：null/缺省 → 默认第一关；
 * 指向未知关卡/难度时快速失败（不静默回退，避免"选了 A 打了 B"）。
 */
export function resolveStageSelection(
  tables: StageProgressTables,
  selection: StageSelectionSave | null,
): StageSelectionSave {
  if (selection === null) {
    return getDefaultStageSelection(tables);
  }
  const stage = findStageOrThrow(tables, selection.stageId);
  findDifficultyOrThrow(stage, selection.difficultyId);
  return { stageId: stage.id, difficultyId: selection.difficultyId };
}

export function getStageRecord(
  state: StageProgressState,
  stageId: string,
  difficultyId: string,
): StageRecordEntry {
  return state.stageRecords[stageRecordKey(stageId, difficultyId)] ?? ZERO_RECORD;
}

export function getHighestStars(state: StageProgressState, stageId: string, difficultyId: string): number {
  return getStageRecord(state, stageId, difficultyId).highestStars;
}

/** 该关是否通关过（任意难度）。 */
export function isStageCleared(state: StageProgressState, stageId: string): boolean {
  for (const key of Object.keys(state.stageRecords)) {
    const record = state.stageRecords[key];
    if (record !== undefined && record.cleared && key.split(RECORD_KEY_SEPARATOR)[0] === stageId) {
      return true;
    }
  }
  return false;
}

/** 章节是否已完成：其收录的全部关卡（任意难度）均通关。未知章节快速失败。 */
export function isChapterCompleted(
  tables: StageProgressTables,
  state: StageProgressState,
  chapterId: string,
): boolean {
  const chapter = tables.chapters.find((candidate) => candidate.id === chapterId);
  if (chapter === undefined) {
    throw new Error(`[StageProgress] Unknown chapter id "${chapterId}"`);
  }
  for (const stageId of chapter.stageIds) {
    findStageOrThrow(tables, stageId);
    if (!isStageCleared(state, stageId)) {
      return false;
    }
  }
  return chapter.stageIds.length > 0;
}

/** 章节是否已解锁：沿 requiredChapterId 链检查每个前置章节已完成；未知章节快速失败。 */
export function isChapterUnlocked(
  tables: StageProgressTables,
  state: StageProgressState,
  chapterId: string,
): boolean {
  const chapter = tables.chapters.find((candidate) => candidate.id === chapterId);
  if (chapter === undefined) {
    throw new Error(`[StageProgress] Unknown chapter id "${chapterId}"`);
  }
  let cursor = chapter.requiredChapterId;
  const visited = new Set<string>([chapter.id]);
  while (cursor !== null) {
    if (visited.has(cursor)) {
      throw new Error(`[StageProgress] Chapter unlock chain cycle at "${cursor}"`);
    }
    visited.add(cursor);
    if (!isChapterCompleted(tables, state, cursor)) {
      return false;
    }
    const required = tables.chapters.find((candidate) => candidate.id === cursor);
    cursor = required?.requiredChapterId ?? null;
  }
  return true;
}

/** 关卡是否已解锁：所属章节已解锁，且章内前一关已通关（首关只看章节）。未知关卡快速失败。 */
export function isStageUnlocked(
  tables: StageProgressTables,
  state: StageProgressState,
  stageId: string,
): boolean {
  const stage = findStageOrThrow(tables, stageId);
  if (!isChapterUnlocked(tables, state, stage.chapterId)) {
    return false;
  }
  const chapter = tables.chapters.find((candidate) => candidate.id === stage.chapterId);
  if (chapter === undefined) {
    return false;
  }
  const index = chapter.stageIds.indexOf(stageId);
  for (let before = 0; before < index; before += 1) {
    const previousId = chapter.stageIds[before];
    if (previousId !== undefined && !isStageCleared(state, previousId)) {
      return false;
    }
  }
  return true;
}

/** 难度档是否已解锁：关卡已解锁，且前一难度档历史最高星达标（首档恒解锁）。 */
export function isDifficultyUnlocked(
  tables: StageProgressTables,
  state: StageProgressState,
  stageId: string,
  difficultyId: string,
): boolean {
  const stage = findStageOrThrow(tables, stageId);
  const index = stage.difficulties.findIndex((candidate) => candidate.id === difficultyId);
  if (index < 0) {
    throw new Error(`[StageProgress] Unknown difficulty id "${difficultyId}" on stage "${stageId}"`);
  }
  if (!isStageUnlocked(tables, state, stageId)) {
    return false;
  }
  if (index === 0) {
    return true;
  }
  const previous = stage.difficulties[index - 1];
  const currentTier = stage.difficulties[index];
  const required = currentTier?.requiredStarsOnPrevious ?? Number.MAX_SAFE_INTEGER;
  return previous !== undefined && getHighestStars(state, stageId, previous.id) >= required;
}

/**
 * 记录一次关卡结果：cleared 只置真不撤销；星级取历史最大值（只进不退）。
 * 直接改写传入存档切片（事务由调用方落盘）。
 */
export function recordStageOutcome(
  state: StageProgressState,
  stageId: string,
  difficultyId: string,
  outcome: StageOutcomeInput,
): void {
  const key = stageRecordKey(stageId, difficultyId);
  const current = state.stageRecords[key] ?? ZERO_RECORD;
  const stars = Number.isFinite(outcome.stars)
    ? Math.min(3, Math.max(0, Math.floor(outcome.stars)))
    : 0;
  state.stageRecords[key] = {
    highestStars: Math.max(current.highestStars, stars),
    cleared: current.cleared || outcome.cleared,
    firstClearClaimed: current.firstClearClaimed,
    claimedStarRewardTiers: current.claimedStarRewardTiers,
  };
}

/**
 * 重算章节解锁并增量写入存档（只增不减，不回收已拥有状态）；
 * 返回本次新解锁的章节 ID 列表。
 */
export function syncUnlockedChapters(
  tables: StageProgressTables,
  state: StageProgressState,
): string[] {
  const newlyUnlocked: string[] = [];
  for (const chapter of tables.chapters) {
    if (state.unlockedChapterIds.indexOf(chapter.id) !== -1) {
      continue;
    }
    if (isChapterUnlocked(tables, state, chapter.id)) {
      state.unlockedChapterIds.push(chapter.id);
      newlyUnlocked.push(chapter.id);
    }
  }
  return newlyUnlocked;
}

// —— 首通/星级累计奖励领取状态（金额与发放见 StageConfig.milestoneRewards；事务在 V08-05） ——

export function isFirstClearClaimed(
  state: StageProgressState,
  stageId: string,
  difficultyId: string,
): boolean {
  return getStageRecord(state, stageId, difficultyId).firstClearClaimed;
}

export function getClaimedStarTiers(
  state: StageProgressState,
  stageId: string,
  difficultyId: string,
): number {
  return getStageRecord(state, stageId, difficultyId).claimedStarRewardTiers;
}

/** 当前可领取的星级累计档数（历史最高星 − 已领取档数，下限 0）。 */
export function getClaimableStarTiers(
  state: StageProgressState,
  stageId: string,
  difficultyId: string,
): number {
  return Math.max(0, getHighestStars(state, stageId, difficultyId) - getClaimedStarTiers(state, stageId, difficultyId));
}

/** 标记首通奖励已领取（幂等；是否可领由调用方依据 highestStars/cleared 校验）。 */
export function markFirstClearClaimed(
  state: StageProgressState,
  stageId: string,
  difficultyId: string,
): void {
  const key = stageRecordKey(stageId, difficultyId);
  const current = state.stageRecords[key] ?? ZERO_RECORD;
  state.stageRecords[key] = { ...current, firstClearClaimed: true };
}

/** 领取一档星级累计奖励（调用方负责校验 getClaimableStarTiers > 0）。 */
export function claimStarTier(
  state: StageProgressState,
  stageId: string,
  difficultyId: string,
): void {
  const key = stageRecordKey(stageId, difficultyId);
  const current = state.stageRecords[key] ?? ZERO_RECORD;
  state.stageRecords[key] = { ...current, claimedStarRewardTiers: current.claimedStarRewardTiers + 1 };
}

// —— 首通/星级累计奖励领取事务（V08-05；金额 = milestoneRewards 基础值 × 难度奖励乘数逐项向下取整） ——

/** 里程碑领取配置表切片（GameConfig 结构兼容）。 */
export interface MilestoneClaimTables {
  readonly stages: readonly StageConfig[];
  readonly playerLevel: PlayerLevelConfig;
}

/** 里程碑领取存档切片（AccountSaveData 结构兼容：进度域 + 库存 + 审计 + 玩家等级）。 */
export interface MilestoneClaimSaveState extends StageProgressState, PlayerLevelState {
  balances: Record<string, number>;
  recentTransactions: AccountTxEntry[];
}

/** 里程碑经济依赖（结构兼容 EconomyService.grant）。 */
export interface MilestoneEconomyOps {
  grant(state: MilestoneClaimSaveState, request: EconomyOpRequest): EconomyOpResult;
}

/** 里程碑账号经验依赖（结构兼容 PlayerLeveling.addAccountXp）。 */
export interface MilestoneLevelOps {
  addAccountXp(state: PlayerLevelState, config: PlayerLevelConfig, amount: number): AddAccountXpResult;
}

export type MilestoneClaimResult =
  | { readonly ok: true; readonly accountXp: number; readonly resources: Readonly<Record<string, number>> }
  | { readonly ok: false; readonly reason: MilestoneClaimFailReason; readonly detail: string | null };

export type MilestoneClaimFailReason =
  | 'unknown_stage'
  | 'unknown_difficulty'
  | 'not_cleared'
  | 'already_claimed'
  | 'no_reward_config'
  | 'grant_rejected'
  | 'xp_rejected';

export interface MilestoneClaimRequest {
  readonly txId: string;
  readonly at: number;
}

function resolveMilestoneContext(
  save: MilestoneClaimSaveState,
  tables: MilestoneClaimTables,
  stageId: string,
  difficultyId: string,
): { stage: StageConfig; multiplier: number; record: StageRecordEntry } | MilestoneClaimResult {
  const stage = tables.stages.find((candidate) => candidate.id === stageId);
  if (stage === undefined) {
    return { ok: false, reason: 'unknown_stage', detail: `stage "${stageId}" not found` };
  }
  const difficulty = stage.difficulties.find((candidate) => candidate.id === difficultyId);
  if (difficulty === undefined) {
    return { ok: false, reason: 'unknown_difficulty', detail: `difficulty "${difficultyId}" not found on "${stageId}"` };
  }
  const record = getStageRecord(save, stageId, difficultyId);
  return { stage, multiplier: difficulty.rewardMultiplier, record };
}

/** 按难度乘数折算里程碑发放：经验与资源逐项向下取整（取整到 0 的资源不发放）。 */
export function scaleMilestoneGrant(
  grant: { readonly accountXp: number; readonly resources: Readonly<Record<string, number>> },
  rewardMultiplier: number,
): { accountXp: number; resources: Record<string, number> } {
  const resources: Record<string, number> = {};
  for (const resourceId of Object.keys(grant.resources)) {
    const amount = grant.resources[resourceId];
    const scaled = typeof amount === 'number' && amount > 0 ? Math.floor(amount * rewardMultiplier) : 0;
    if (scaled > 0) {
      resources[resourceId] = scaled;
    }
  }
  return { accountXp: Math.floor(grant.accountXp * rewardMultiplier), resources };
}

/**
 * 领取首通奖励（每 stageId|difficultyId 一次）：校验通关与未领取 → 资源单事务 →
 * 账号经验 → 标记已领取。失败路径零修改（标志位最后写入）。
 */
export function claimFirstClearMilestone(
  save: MilestoneClaimSaveState,
  tables: MilestoneClaimTables,
  economy: MilestoneEconomyOps,
  levelOps: MilestoneLevelOps,
  stageId: string,
  difficultyId: string,
  request: MilestoneClaimRequest,
): MilestoneClaimResult {
  const resolved = resolveMilestoneContext(save, tables, stageId, difficultyId);
  if (!('stage' in resolved)) {
    return resolved;
  }
  if (!resolved.record.cleared) {
    return { ok: false, reason: 'not_cleared', detail: null };
  }
  if (resolved.record.firstClearClaimed) {
    return { ok: false, reason: 'already_claimed', detail: null };
  }
  const grant = resolved.stage.milestoneRewards?.firstClear;
  if (grant === undefined) {
    return { ok: false, reason: 'no_reward_config', detail: `stage "${stageId}" has no firstClear milestone` };
  }
  return applyMilestoneGrant(save, tables, economy, levelOps, grant, resolved.multiplier, request, () => {
    markFirstClearClaimed(save, stageId, difficultyId);
  });
}

/**
 * 领取下一档星级累计奖励：可领档数 > 0 时按已领取档数取 perStar 配置，
 * 经同一事务路径发放并推进 claimedStarRewardTiers（重复领取自然被可领数拦截）。
 */
export function claimStarTierMilestone(
  save: MilestoneClaimSaveState,
  tables: MilestoneClaimTables,
  economy: MilestoneEconomyOps,
  levelOps: MilestoneLevelOps,
  stageId: string,
  difficultyId: string,
  request: MilestoneClaimRequest,
): MilestoneClaimResult {
  const resolved = resolveMilestoneContext(save, tables, stageId, difficultyId);
  if (!('stage' in resolved)) {
    return resolved;
  }
  const claimable = getClaimableStarTiers(save, stageId, difficultyId);
  if (claimable <= 0) {
    return {
      ok: false,
      reason: resolved.record.highestStars <= 0 ? 'not_cleared' : 'already_claimed',
      detail: null,
    };
  }
  const tiers = resolved.stage.milestoneRewards?.perStar ?? [];
  const grant = tiers[resolved.record.claimedStarRewardTiers];
  if (grant === undefined) {
    return { ok: false, reason: 'no_reward_config', detail: `stage "${stageId}" perStar tier missing` };
  }
  return applyMilestoneGrant(save, tables, economy, levelOps, grant, resolved.multiplier, request, () => {
    claimStarTier(save, stageId, difficultyId);
  });
}

function applyMilestoneGrant(
  save: MilestoneClaimSaveState,
  tables: MilestoneClaimTables,
  economy: MilestoneEconomyOps,
  levelOps: MilestoneLevelOps,
  grant: { readonly accountXp: number; readonly resources: Readonly<Record<string, number>> },
  rewardMultiplier: number,
  request: MilestoneClaimRequest,
  markClaimed: () => void,
): MilestoneClaimResult {
  const scaled = scaleMilestoneGrant(grant, rewardMultiplier);
  const resourceIds = Object.keys(scaled.resources);
  if (resourceIds.length > 0) {
    const grantResult = economy.grant(save, {
      txId: request.txId,
      kind: 'milestone_reward',
      deltas: scaled.resources,
      at: request.at,
    });
    if (!grantResult.ok) {
      return { ok: false, reason: 'grant_rejected', detail: grantResult.detail };
    }
  }
  if (scaled.accountXp > 0) {
    const xp = levelOps.addAccountXp(save, tables.playerLevel, scaled.accountXp);
    if (!xp.ok) {
      return { ok: false, reason: 'xp_rejected', detail: xp.detail };
    }
  }
  markClaimed();
  return { ok: true, accountXp: scaled.accountXp, resources: scaled.resources };
}
