/** Boss 阶段：半血以上为 normal，以下进入 enraged（弹幕加速）。 */
export type BossPhase = 'normal' | 'enraged';

/** 阶段判定（纯 TS）：hpRatio ∈ [0, 1]，"半血以下"激怒，边界 0.5 归 normal。 */
export function resolveBossPhase(hpRatio: number): BossPhase {
  return hpRatio >= 0.5 ? 'normal' : 'enraged';
}

/** 当前阶段应使用的弹幕间隔；enraged 间隔不得晚于 normal（配置约束外的兜底）。 */
export function resolveBurstInterval(
  phase: BossPhase,
  burstIntervalSeconds: number,
  enragedIntervalSeconds: number,
): number {
  const normal = Math.max(0.1, burstIntervalSeconds);
  const enraged = Math.max(0.1, enragedIntervalSeconds);
  return phase === 'enraged' ? Math.min(normal, enraged) : normal;
}
