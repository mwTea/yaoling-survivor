/**
 * 任务系统数据层（V08-08）。
 *
 * 单文件叶子模块（零跨文件值导入，仅类型导入，可被 node 纯逻辑测试直接加载）：
 * - 进度追踪：领域事件按条件类型映射为增量（killCount/clearCount/collectXp/
 *   levelUpCount/spendResource），由调用方（V08-09 事件接线）传入；重复发布同一
 *   事件由上游单次发布保证，进度按增量累计并在目标值截断（不溢出）。
 * - 周期桶：主线永久桶 periodKey 恒 'main' 不重置；每日/每周桶 periodKey 为
 *   TimeService 的 dayKey/weekKey，写入前惰性校验——key 变化即整桶重置
 *   （进度与领取态清空，跨日/跨周自然刷新）。
 * - 前置链：prerequisiteTaskId 未领取奖励前不累计进度（前置未完成不可接取）。
 * - 领取事务：校验完成 → 资源单事务 → 账号经验 → 记录领取（标志位最后写入，
 *   失败路径零修改；重复领取拒绝）。
 */
import type {
  PlayerLevelConfig,
  TaskCondition,
  TaskConfig,
  TaskPeriod,
} from '../config/ConfigTypes';
import type { AccountTxEntry, TaskBucketsSave, TaskPeriodBucketSave } from './AccountSave';
import type { EconomyOpRequest, EconomyOpResult } from '../economy/Economy';
import type { AddAccountXpResult, PlayerLevelState } from './PlayerLeveling';

// 与 AccountSave.TASK_MAIN_PERIOD_KEY 同值（叶子模块零值导入约束，内联定义；
// 一致性由 node 测试交叉验证）。
const MAIN_PERIOD_KEY = 'main';

/** 任务配置表切片（GameConfig 结构兼容）。 */
export interface TaskTables {
  readonly tasks: readonly TaskConfig[];
  readonly playerLevel: PlayerLevelConfig;
}

/** 任务系统存档切片（AccountSaveData 结构兼容：任务桶 + 库存 + 审计 + 玩家等级）。 */
export interface TaskSystemState extends PlayerLevelState {
  taskBuckets: TaskBucketsSave;
  balances: Record<string, number>;
  recentTransactions: AccountTxEntry[];
}

/** 任务经济/经验依赖（结构兼容 EconomyService.grant / addAccountXp）。 */
export interface TaskEconomyOps {
  grant(state: TaskSystemState, request: EconomyOpRequest): EconomyOpResult;
}

export interface TaskLevelOps {
  addAccountXp(state: PlayerLevelState, config: PlayerLevelConfig, amount: number): AddAccountXpResult;
}

/** 周期 key 上下文（由装配层经 TimeService 计算）。 */
export interface TaskPeriodKeys {
  readonly dayKey: string;
  readonly weekKey: string;
}

export type TaskClaimResult =
  | { readonly ok: true; readonly accountXp: number; readonly resources: Readonly<Record<string, number>> }
  | {
    readonly ok: false;
    readonly reason: 'unknown_task' | 'not_completed' | 'already_claimed' | 'grant_rejected' | 'xp_rejected';
    readonly detail: string | null;
  };

export interface TaskClaimRequest {
  readonly txId: string;
  readonly at: number;
}

/** 任务所属周期桶的当前 periodKey；主线桶恒为 'main'。 */
export function currentPeriodKey(period: TaskPeriod, keys: TaskPeriodKeys): string {
  if (period === 'main') {
    return MAIN_PERIOD_KEY;
  }
  return period === 'daily' ? keys.dayKey : keys.weekKey;
}

function bucketFor(state: TaskSystemState, period: TaskPeriod): TaskPeriodBucketSave {
  return period === 'daily' ? state.taskBuckets.daily : period === 'weekly' ? state.taskBuckets.weekly : state.taskBuckets.main;
}

/** 惰性周期校验：桶 periodKey 与当前 key 不一致即整桶重置（跨日/跨周清进度与领取态）。 */
function ensureBucketPeriod(bucket: TaskPeriodBucketSave, currentKey: string): TaskPeriodBucketSave {
  if (bucket.periodKey === currentKey) {
    return bucket;
  }
  bucket.progress = {};
  bucket.claimedTaskIds = [];
  bucket.periodKey = currentKey;
  return bucket;
}

function isConditionMatch(condition: TaskCondition, kind: TaskCondition['kind'], resourceId: string | null): boolean {
  if (condition.kind !== kind) {
    return false;
  }
  if (condition.kind === 'spendResource') {
    return resourceId === condition.resourceId;
  }
  return true;
}

/** 前置任务是否已领取（其所在桶的 claimedTaskIds；前置未领取 → 任务不累计进度）。 */
function isPrerequisiteClaimed(
  state: TaskSystemState,
  tables: TaskTables,
  prerequisiteTaskId: string | null,
): boolean {
  if (prerequisiteTaskId === null) {
    return true;
  }
  const prerequisite = tables.tasks.find((candidate) => candidate.id === prerequisiteTaskId);
  if (prerequisite === undefined) {
    // 配置引用断裂由启动校验拦截；运行时按未完成处理（不累计、不可领）。
    return false;
  }
  const bucket = bucketFor(state, prerequisite.period);
  return bucket.claimedTaskIds.indexOf(prerequisiteTaskId) !== -1;
}

/**
 * 应用一次领域事件增量：遍历匹配条件类型的任务，前置已领取且桶周期有效时
 * 累计进度（按目标截断）。directly 改写传入存档切片；返回发生变化的任务 ID。
 */
export function applyTaskProgress(
  state: TaskSystemState,
  tables: TaskTables,
  kind: TaskCondition['kind'],
  amount: number,
  resourceId: string | null,
  keys: TaskPeriodKeys,
): string[] {
  if (!(amount > 0)) {
    return [];
  }
  const changed: string[] = [];
  for (const task of tables.tasks) {
    if (!isConditionMatch(task.condition, kind, resourceId)) {
      continue;
    }
    if (!isPrerequisiteClaimed(state, tables, task.prerequisiteTaskId)) {
      continue;
    }
    const bucket = ensureBucketPeriod(bucketFor(state, task.period), currentPeriodKey(task.period, keys));
    const target = task.condition.target;
    const current = bucket.progress[task.id];
    const base = typeof current === 'number' && Number.isFinite(current) && current > 0 ? Math.floor(current) : 0;
    const next = Math.min(target, base + Math.floor(amount));
    if (next !== base) {
      bucket.progress[task.id] = next;
      changed.push(task.id);
    }
  }
  return changed;
}

/** 便捷包装：一次事件映射（无资源维度）。 */
export function applyTaskEvent(
  state: TaskSystemState,
  tables: TaskTables,
  kind: Exclude<TaskCondition['kind'], 'spendResource'>,
  amount: number,
  keys: TaskPeriodKeys,
): string[] {
  return applyTaskProgress(state, tables, kind, amount, null, keys);
}

/** 资源消耗映射（经济 spend 后调用；amount = 消耗量）。 */
export function applyTaskSpend(
  state: TaskSystemState,
  tables: TaskTables,
  resourceId: string,
  amount: number,
  keys: TaskPeriodKeys,
): string[] {
  return applyTaskProgress(state, tables, 'spendResource', amount, resourceId, keys);
}

/** 结算统计切片（BattleResultStats 结构兼容）。 */
export interface BattleStatsSlice {
  readonly result: 'victory' | 'defeat';
  readonly killCount: number;
  readonly xpCollected: number;
  readonly levelReached: number;
}

/**
 * 战局结算 → 任务进度（V08-09 接线）：击杀/拾取经验/升级次数/通关由
 * battleFinished 统计一次性应用（战斗全程不回写账号，结算点是唯一账号写入点）；
 * 升级次数 = levelReached - 1（局内战斗等级恒从 1 开局）。
 */
export function applyBattleStatsToTasks(
  state: TaskSystemState,
  tables: TaskTables,
  stats: BattleStatsSlice,
  keys: TaskPeriodKeys,
): string[] {
  const changed: string[] = [];
  if (stats.killCount > 0) {
    changed.push(...applyTaskEvent(state, tables, 'killCount', stats.killCount, keys));
  }
  if (stats.xpCollected > 0) {
    changed.push(...applyTaskEvent(state, tables, 'collectXp', stats.xpCollected, keys));
  }
  const levelUps = Math.max(0, stats.levelReached - 1);
  if (levelUps > 0) {
    changed.push(...applyTaskEvent(state, tables, 'levelUpCount', levelUps, keys));
  }
  if (stats.result === 'victory') {
    changed.push(...applyTaskEvent(state, tables, 'clearCount', 1, keys));
  }
  return changed;
}

/** 任务当前进度与目标（未累计 = 0）；周期不匹配视为 0（UI 展示用）。 */
export function getTaskProgress(
  state: TaskSystemState,
  tables: TaskTables,
  taskId: string,
  keys: TaskPeriodKeys,
): { readonly progress: number; readonly target: number; readonly claimed: boolean } {
  const task = tables.tasks.find((candidate) => candidate.id === taskId);
  if (task === undefined) {
    return { progress: 0, target: 0, claimed: false };
  }
  const bucket = bucketFor(state, task.period);
  if (bucket.periodKey !== currentPeriodKey(task.period, keys)) {
    return { progress: 0, target: task.condition.target, claimed: false };
  }
  const progress = bucket.progress[taskId];
  return {
    progress: typeof progress === 'number' && progress > 0 ? progress : 0,
    target: task.condition.target,
    claimed: bucket.claimedTaskIds.indexOf(taskId) !== -1,
  };
}

/** 任务是否已完成且未领取（红点/奖励中心可领取查询源，V08-16 复用）。 */
export function isTaskClaimable(
  state: TaskSystemState,
  tables: TaskTables,
  taskId: string,
  keys: TaskPeriodKeys,
): boolean {
  const progress = getTaskProgress(state, tables, taskId, keys);
  return progress.claimed === false && progress.target > 0 && progress.progress >= progress.target;
}

/**
 * 领取任务奖励：校验完成与未领取 → 资源单事务 → 账号经验 → 记录领取。
 * 失败路径零修改（领取记录最后写入）。
 */
export function claimTaskReward(
  state: TaskSystemState,
  tables: TaskTables,
  economy: TaskEconomyOps,
  levelOps: TaskLevelOps,
  taskId: string,
  keys: TaskPeriodKeys,
  request: TaskClaimRequest,
): TaskClaimResult {
  const task = tables.tasks.find((candidate) => candidate.id === taskId);
  if (task === undefined) {
    return { ok: false, reason: 'unknown_task', detail: `task "${taskId}" not found` };
  }
  const bucket = ensureBucketPeriod(bucketFor(state, task.period), currentPeriodKey(task.period, keys));
  const progressValue = bucket.progress[taskId];
  const progress = typeof progressValue === 'number' ? progressValue : 0;
  if (progress < task.condition.target) {
    return { ok: false, reason: 'not_completed', detail: null };
  }
  if (bucket.claimedTaskIds.indexOf(taskId) !== -1) {
    return { ok: false, reason: 'already_claimed', detail: null };
  }
  const resources: Record<string, number> = {};
  for (const resourceId of Object.keys(task.reward.resources)) {
    const amount = task.reward.resources[resourceId];
    if (typeof amount === 'number' && amount > 0) {
      resources[resourceId] = Math.floor(amount);
    }
  }
  if (Object.keys(resources).length > 0) {
    const grant = economy.grant(state, {
      txId: request.txId,
      kind: 'task_reward',
      deltas: resources,
      at: request.at,
    });
    if (!grant.ok) {
      return { ok: false, reason: 'grant_rejected', detail: grant.detail };
    }
  }
  if (task.reward.accountXp > 0) {
    const xp = levelOps.addAccountXp(state, tables.playerLevel, task.reward.accountXp);
    if (!xp.ok) {
      return { ok: false, reason: 'xp_rejected', detail: xp.detail };
    }
  }
  bucket.claimedTaskIds.push(taskId);
  return { ok: true, accountXp: task.reward.accountXp, resources };
}
