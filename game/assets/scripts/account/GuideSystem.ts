/**
 * 新手引导状态机纯逻辑（V10-03）。
 *
 * 单文件叶子模块（零跨文件值导入，仅类型导入，可被 node 纯逻辑测试直接加载）：
 * - 线性链式脚本：当前步骤 = 从入口沿 nextStepId 走到的第一个未完成步骤；
 *   完成事件仅对当前活跃步骤生效（乱序事件忽略），重复完成事件幂等不重复记录。
 * - 脚本启动：存档 scriptVersion 为 0（从未引导）且入口步骤触发事件到达时，
 *   盖章 scriptVersion = 脚本版本并开始；此后不再重复盖章。
 * - 版本迁移（不重卡老玩家）：scriptVersion 非 0 且 ≠ 当前脚本版本 → 视为脚本
 *   已完结（旧版/未来版一律不再推进），不改写存档；改版对老玩家零打扰。
 * - 跳过规则：仅 skippable 步骤可跳过（跳过 = 记完成并推进，不区分来源）；
 *   strong 步骤拒绝跳过（白名单与 skippable 冲突由配置校验拦截，双保险）。
 * - 阻塞语义：strong 步骤阻塞战斗（表现层暂停/聚焦），weak/info 不阻塞；
 *   可跳过步骤永远不阻塞战斗（配置校验保证 skippable ⇒ 非 strong）。
 *
 * 状态写存档引导域（AccountSaveData.guide，V10-01 schema v3），本模块直接改写
 * 传入切片，落盘由调用方负责（同 recordStageOutcome 先例）。
 */
import type { GuideEventId, GuideScriptConfig, GuideStepConfig } from '../config/ConfigTypes';
import type { GuideSaveState } from './AccountSave';

/** 引导事件处理结果：progressed = 存档引导域发生变化；kind/reason 供表现层诊断。 */
export interface GuideAdvanceResult {
  readonly progressed: boolean;
  readonly kind: 'script_started' | 'step_completed' | 'ignored';
  /** 触发变化的步骤 ID（script_started 为入口步骤；step_completed 为完成步骤）。 */
  readonly stepId: string | null;
  readonly nextStepId: string | null;
  readonly scriptCompleted: boolean;
  readonly reason: 'script_done' | 'not_started' | 'event_mismatch' | null;
}

export type GuideSkipResult =
  | { readonly ok: true; readonly skippedStepId: string; readonly nextStepId: string | null; readonly scriptCompleted: boolean }
  | { readonly ok: false; readonly reason: 'not_started' | 'script_done' | 'not_skippable' };

/**
 * 脚本是否已终结：总开关关闭视为终结（不启动、不显示、零写入——配置单点
 * 恢复）；从未开始（version 0）不算终结；版本错位（老玩家/回滚档）视为终结。
 */
export function isGuideScriptDone(script: GuideScriptConfig, guideState: GuideSaveState): boolean {
  if (!script.enabled) {
    return true;
  }
  if (guideState.scriptVersion === 0) {
    return false;
  }
  return guideState.scriptVersion !== script.version;
}

/** 从入口沿 nextStepId 链找第一个未完成步骤；脚本未启动（version 0）无活跃步骤。 */
export function getActiveGuideStep(
  script: GuideScriptConfig,
  guideState: GuideSaveState,
): GuideStepConfig | null {
  if (guideState.scriptVersion === 0 || isGuideScriptDone(script, guideState)) {
    return null;
  }
  const byId = new Map(script.steps.map((step) => [step.id, step]));
  let cursor = byId.get(script.entryStepId);
  const visited = new Set<string>();
  while (cursor !== undefined) {
    if (guideState.completedStepIds.indexOf(cursor.id) === -1) {
      return cursor;
    }
    if (visited.has(cursor.id) || cursor.nextStepId === null) {
      return null;
    }
    visited.add(cursor.id);
    const next = byId.get(cursor.nextStepId);
    if (next === undefined) {
      throw new Error(`[GuideSystem] Unknown next step id "${cursor.nextStepId}" after "${cursor.id}"`);
    }
    cursor = next;
  }
  return null;
}

/** strong 步骤阻塞战斗（表现层暂停/聚焦）；weak/info 不阻塞。 */
export function isGuideStepBlocking(step: GuideStepConfig): boolean {
  return step.type === 'strong';
}

/**
 * 引导事件推进：入口触发事件启动脚本（幂等盖章）；当前步骤完成事件记档并推进。
 * 乱序/重复事件一律忽略（幂等：重复完成不重复记录，脚本完结后零写入）。
 */
export function handleGuideEvent(
  script: GuideScriptConfig,
  guideState: GuideSaveState,
  event: GuideEventId,
): GuideAdvanceResult {
  if (isGuideScriptDone(script, guideState)) {
    return { progressed: false, kind: 'ignored', stepId: null, nextStepId: null, scriptCompleted: true, reason: 'script_done' };
  }
  const entry = findStepOrThrow(script, script.entryStepId);
  if (guideState.scriptVersion === 0) {
    if (event !== entry.trigger) {
      return { progressed: false, kind: 'ignored', stepId: null, nextStepId: null, scriptCompleted: false, reason: 'not_started' };
    }
    guideState.scriptVersion = script.version;
    return { progressed: true, kind: 'script_started', stepId: entry.id, nextStepId: entry.nextStepId, scriptCompleted: false, reason: null };
  }
  const active = getActiveGuideStep(script, guideState);
  if (active === null) {
    return { progressed: false, kind: 'ignored', stepId: null, nextStepId: null, scriptCompleted: true, reason: 'script_done' };
  }
  if (event !== active.completionEvent) {
    return { progressed: false, kind: 'ignored', stepId: null, nextStepId: null, scriptCompleted: false, reason: 'event_mismatch' };
  }
  markStepCompleted(guideState, active.id);
  const next = active.nextStepId !== null ? findStepOrThrow(script, active.nextStepId) : null;
  return {
    progressed: true,
    kind: 'step_completed',
    stepId: active.id,
    nextStepId: next !== null ? next.id : null,
    scriptCompleted: next === null,
    reason: null,
  };
}

/**
 * 跳过当前活跃步骤：仅 skippable 步骤允许（strong 拒绝）；跳过 = 记完成并推进，
 * 语义上"可跳过步骤不阻塞战斗"——跳过后脚本继续，不等待原完成事件。
 */
export function skipActiveGuideStep(script: GuideScriptConfig, guideState: GuideSaveState): GuideSkipResult {
  if (isGuideScriptDone(script, guideState)) {
    return { ok: false, reason: 'script_done' };
  }
  if (guideState.scriptVersion === 0) {
    return { ok: false, reason: 'not_started' };
  }
  const active = getActiveGuideStep(script, guideState);
  if (active === null) {
    return { ok: false, reason: 'script_done' };
  }
  if (!active.skippable) {
    return { ok: false, reason: 'not_skippable' };
  }
  markStepCompleted(guideState, active.id);
  const next = active.nextStepId !== null ? findStepOrThrow(script, active.nextStepId) : null;
  return { ok: true, skippedStepId: active.id, nextStepId: next !== null ? next.id : null, scriptCompleted: next === null };
}

function findStepOrThrow(script: GuideScriptConfig, stepId: string): GuideStepConfig {
  const step = script.steps.find((candidate) => candidate.id === stepId);
  if (step === undefined) {
    throw new Error(`[GuideSystem] Unknown step id "${stepId}"`);
  }
  return step;
}

/** 记完成（幂等：已在列表则零写入，保持首次完成顺序）。 */
function markStepCompleted(guideState: GuideSaveState, stepId: string): void {
  if (guideState.completedStepIds.indexOf(stepId) === -1) {
    guideState.completedStepIds.push(stepId);
  }
}
