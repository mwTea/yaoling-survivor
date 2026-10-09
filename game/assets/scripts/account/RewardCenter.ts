/**
 * 奖励中心聚合编排（V08-15）。
 *
 * 单文件叶子模块（零跨文件值导入，仅类型导入，可被 node 纯逻辑测试直接加载）。
 * 各系统（任务/成就/累计登录/礼包）的可领取查询与领取事务保留在各自领域模块
 * （奖励中心不设独立领取真相——列表与各系统领取态天然一致）；本模块只提供
 * "一键领取"的顺序执行编排：逐项调用注入的领取事务，单项失败不阻断其余。
 * 不建邮件/补发队列（阶段决策 6，无对应场景）。
 */

/** 一键领取条目（由 UI/装配层用各系统领取事务构造闭包）。 */
export interface RewardCenterClaimEntry {
  readonly id: string;
  readonly title: string;
  readonly claim: () => { readonly ok: boolean; readonly reason?: string };
}

export interface RewardCenterClaimOutcome {
  readonly succeeded: ReadonlyArray<{ readonly id: string; readonly title: string }>;
  readonly failed: ReadonlyArray<{ readonly id: string; readonly title: string; readonly reason: string }>;
}

/** 顺序逐项领取：单项失败（含抛错兜底）记录原因后继续下一项。 */
export function claimAllSequential(entries: readonly RewardCenterClaimEntry[]): RewardCenterClaimOutcome {
  const succeeded: Array<{ id: string; title: string }> = [];
  const failed: Array<{ id: string; title: string; reason: string }> = [];
  for (const entry of entries) {
    try {
      const outcome = entry.claim();
      if (outcome.ok) {
        succeeded.push({ id: entry.id, title: entry.title });
      } else {
        failed.push({ id: entry.id, title: entry.title, reason: outcome.reason ?? 'unknown' });
      }
    } catch (error) {
      failed.push({ id: entry.id, title: entry.title, reason: String(error) });
    }
  }
  return { succeeded, failed };
}
