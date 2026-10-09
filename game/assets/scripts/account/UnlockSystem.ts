/**
 * 功能解锁判定纯逻辑（V10-02）。
 *
 * 单文件叶子模块（零跨文件值导入，仅类型导入，可被 node 纯逻辑测试直接加载）：
 * - 解锁条件判定（always/playerLevel/stageClear/chapterClear/realmIndex/accountAgeDays），
 *   stageClear/chapterClear 复用 StageProgress 的"关卡通关/章节完成"语义
 *   （此处内联实现以维持叶子模块零值导入约束，两侧一致性由 node 测试交叉验证）。
 * - 入口三态解析（normal / locked_visible / hidden）：解锁表条件 × FeatureFlags 交集，
 *   开关关闭恒隐藏；未解锁按 lockedBehavior 隐藏或显示条件文案（GAME_LOOP §4）。
 * - 未知 featureId 返回 null（安全隐藏语义，调用方记录告警），不抛错——UI 查询入口；
 *   条件引用未知关卡/章节仍快速失败（配置不一致属开发期错误，启动校验先行拦截）。
 *
 * 账号创建天数经调用方注入 now（TimeService 语义）计算，本模块零 Date 直读。
 */
import type { UnlockConfig } from '../config/ConfigTypes';
import type { AccountSaveData } from './AccountSave';

/** 一天的毫秒数（账号创建天数按自然 24h 折算，服务器时间语义由调用方保证）。 */
export const ACCOUNT_AGE_DAY_MS = 86_400_000;

/** 关卡记录复合键分隔符（与 AccountSave.buildStageRecordKey 同格式，测试交叉验证）。 */
const RECORD_KEY_SEPARATOR = '|';

/** 解锁判定配置表切片（GameConfig 结构兼容，按结构类型传入）。 */
export interface UnlockTablesSlice {
  readonly chapters: ReadonlyArray<{ readonly id: string; readonly stageIds: readonly string[] }>;
  readonly stages: ReadonlyArray<{ readonly id: string }>;
  readonly unlocks: readonly UnlockConfig[];
}

/** 解锁判定存档切片（AccountSaveData 结构兼容：进度域 + 关卡记录）。 */
export interface UnlockStateSlice {
  readonly stageRecords: Readonly<Record<string, { readonly cleared: boolean }>>;
  readonly playerLevel: number;
  readonly realmIndex: number;
  readonly accountAgeDays: number;
}

/** 功能开关探测依赖（结构兼容 platform/FeatureFlags.isFeatureEnabled 的安全默认语义）。 */
export interface UnlockFlagProbe {
  readonly isFlagEnabled: (flagId: string) => boolean;
}

/** 导航/面板入口三态（V10-02）：normal 可点；locked_visible 显示条件文案不可点；hidden 移除。 */
export type FeatureEntryState =
  | { readonly kind: 'normal' }
  | { readonly kind: 'locked_visible'; readonly lockedText: string }
  | { readonly kind: 'hidden' };

/** 由存档与当前时间构建判定切片；账号创建时间优先身份域，旧档回退顶层 createdAt。 */
export function buildUnlockEvaluationState(save: AccountSaveData, now: number): UnlockStateSlice {
  const createdAt = save.identity.accountCreatedAt > 0 ? save.identity.accountCreatedAt : save.createdAt;
  return {
    stageRecords: save.stageRecords,
    playerLevel: save.playerLevel,
    realmIndex: save.realmIndex,
    accountAgeDays: computeAccountAgeDays(createdAt, now),
  };
}

/** 账号创建天数：按 24h 向下取整；创建时间未知（≤0）或时钟回拨（now ≤ createdAt）返回 0，不为负。 */
export function computeAccountAgeDays(createdAt: number, now: number): number {
  if (!Number.isFinite(createdAt) || !Number.isFinite(now) || createdAt <= 0 || now <= createdAt) {
    return 0;
  }
  return Math.floor((now - createdAt) / ACCOUNT_AGE_DAY_MS);
}

/** 该关是否通关过（任意难度；与 StageProgress.isStageCleared 同语义）。 */
export function isStageClearedForUnlock(state: UnlockStateSlice, stageId: string): boolean {
  for (const key of Object.keys(state.stageRecords)) {
    const record = state.stageRecords[key];
    if (record !== undefined && record.cleared && key.split(RECORD_KEY_SEPARATOR)[0] === stageId) {
      return true;
    }
  }
  return false;
}

/** 章节是否已完成：收录的全部关卡（任意难度）均通关；未知章节/关卡快速失败。 */
export function isChapterClearedForUnlock(
  tables: UnlockTablesSlice,
  state: UnlockStateSlice,
  chapterId: string,
): boolean {
  const chapter = tables.chapters.find((candidate) => candidate.id === chapterId);
  if (chapter === undefined) {
    throw new Error(`[UnlockSystem] Unknown chapter id "${chapterId}"`);
  }
  if (chapter.stageIds.length === 0) {
    return false;
  }
  for (const stageId of chapter.stageIds) {
    if (!tables.stages.some((candidate) => candidate.id === stageId)) {
      throw new Error(`[UnlockSystem] Unknown stage id "${stageId}" in chapter "${chapterId}"`);
    }
    if (!isStageClearedForUnlock(state, stageId)) {
      return false;
    }
  }
  return true;
}

/** 单条解锁条件判定；条件引用未知关卡/章节快速失败（配置校验已拦截，双保险）。 */
export function isUnlockConditionMet(
  tables: UnlockTablesSlice,
  state: UnlockStateSlice,
  condition: UnlockConfig['condition'],
): boolean {
  switch (condition.kind) {
    case 'always':
      return true;
    case 'playerLevel':
      return state.playerLevel >= condition.level;
    case 'stageClear':
      if (!tables.stages.some((candidate) => candidate.id === condition.stageId)) {
        throw new Error(`[UnlockSystem] Unknown stage id "${condition.stageId}"`);
      }
      return isStageClearedForUnlock(state, condition.stageId);
    case 'chapterClear':
      return isChapterClearedForUnlock(tables, state, condition.chapterId);
    case 'realmIndex':
      return state.realmIndex >= condition.realmIndex;
    case 'accountAgeDays':
      return state.accountAgeDays >= condition.days;
    default: {
      const exhaustive: never = condition;
      throw new Error(`[UnlockSystem] Unsupported unlock condition: ${String(exhaustive)}`);
    }
  }
}

/**
 * 解析功能入口三态。返回 null 仅表示 featureId 未绑定解锁表（安全隐藏语义，
 * 调用方负责告警——正常配置经启动校验不会出现）；开关关闭恒隐藏；未解锁按
 * lockedBehavior 返回 locked_visible（文案来自配置）或 hidden。
 */
export function resolveFeatureEntryState(
  tables: UnlockTablesSlice,
  state: UnlockStateSlice,
  featureId: string,
  flags: UnlockFlagProbe,
): FeatureEntryState | null {
  const config = tables.unlocks.find((candidate) => candidate.featureId === featureId);
  if (config === undefined) {
    return null;
  }
  if (config.featureFlag !== null && !flags.isFlagEnabled(config.featureFlag)) {
    return { kind: 'hidden' };
  }
  if (isUnlockConditionMet(tables, state, config.condition)) {
    return { kind: 'normal' };
  }
  return config.lockedBehavior === 'show_condition'
    ? { kind: 'locked_visible', lockedText: config.lockedText }
    : { kind: 'hidden' };
}
