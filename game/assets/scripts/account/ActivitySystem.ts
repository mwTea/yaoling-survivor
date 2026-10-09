/**
 * 基础活动框架数据层（V08-16）。
 *
 * 单文件叶子模块（零跨文件值导入，仅类型导入，可被 node 纯逻辑测试直接加载）：
 * - 活动壳只做编排：窗口状态计算（dayKey 字典序）+ 功能开关门控 + 实例状态记录；
 *   内容系统（login → LoginReward）的领取逻辑完全不在此复制（验证复用）。
 * - 实例状态写入存档 activities 域：open/not_started/ended；
 *   **活动关闭后未领取处理记录**：ended 且内容仍有未领取（由注入探针判定，
 *   login = claimedTier < totalDays）→ 记为 'closed_unclaimed_handled' 且不回退。
 * - 功能开关未知/关闭按隐藏处理（安全默认值，可降级）。
 */
import type { ActivityConfig } from '../config/ConfigTypes';
import type { ActivitySaveEntry } from './AccountSave';

/** 活动配置表切片（GameConfig 结构兼容）。 */
export interface ActivityTables {
  readonly activities: readonly ActivityConfig[];
}

/** 活动实例存档切片（AccountSaveData 结构兼容）。 */
export interface ActivityState {
  activities: Record<string, ActivitySaveEntry>;
}

export type ActivityWindowStatus = 'open' | 'not_started' | 'ended';

/** 活动内容探针（由装配层注入；login 类型判 claimedTier < totalDays）。 */
export interface ActivityProbes {
  isFlagEnabled(featureFlag: string): boolean;
  hasUnclaimed(activity: ActivityConfig): boolean;
}

/** 窗口状态：dayKey 字典序比较（yyyy-MM-dd 格式保证正确性）。 */
export function getActivityWindowStatus(
  tables: ActivityTables,
  activityId: string,
  dayKey: string,
): ActivityWindowStatus | 'unknown' {
  const activity = tables.activities.find((candidate) => candidate.id === activityId);
  if (activity === undefined) {
    return 'unknown';
  }
  if (activity.window === null) {
    return 'open';
  }
  if (dayKey < activity.window.startDayKey) {
    return 'not_started';
  }
  if (dayKey > activity.window.endDayKey) {
    return 'ended';
  }
  return 'open';
}

/** 入口是否可见：窗口开放且功能开关开启（关闭/未知开关可降级隐藏）。 */
export function isActivityEntryVisible(
  tables: ActivityTables,
  activityId: string,
  dayKey: string,
  probes: ActivityProbes,
): boolean {
  const activity = tables.activities.find((candidate) => candidate.id === activityId);
  if (activity === undefined) {
    return false;
  }
  if (!probes.isFlagEnabled(activity.featureFlag)) {
    return false;
  }
  return getActivityWindowStatus(tables, activityId, dayKey) === 'open';
}

/**
 * 同步活动实例状态到存档（幂等；返回发生变化的实例 ID）。
 * ended 且有未领取 → 记 'closed_unclaimed_handled'（一次性，不回退）；
 * flag 关闭不改变实例状态（只影响入口可见性）。
 */
export function syncActivityInstances(
  state: ActivityState,
  tables: ActivityTables,
  dayKey: string,
  probes: ActivityProbes,
): string[] {
  const changed: string[] = [];
  for (const activity of tables.activities) {
    const windowStatus = getActivityWindowStatus(tables, activity.id, dayKey);
    if (windowStatus === 'unknown') {
      continue;
    }
    const existing = state.activities[activity.id];
    if (existing !== undefined && existing.status === 'closed_unclaimed_handled') {
      continue;
    }
    let status: string;
    if (windowStatus === 'ended') {
      status = probes.hasUnclaimed(activity) ? 'closed_unclaimed_handled' : 'ended';
    } else {
      status = windowStatus;
    }
    if (existing === undefined || existing.status !== status) {
      state.activities[activity.id] = { status };
      changed.push(activity.id);
    }
  }
  return changed;
}
