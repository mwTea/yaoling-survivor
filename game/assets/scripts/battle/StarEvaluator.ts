/**
 * 三星条件评估（V08-04，纯 TS 叶子模块：零跨文件值导入，可被 node 测试加载）。
 *
 * 规则（CODEX_TASKS_V08 / CONFIG.md）：
 * - 条件集来自关卡配置 `StageConfig.starConditions`（长度恒 3，下标即星序，
 *   第一星恒为通关 `clear`——由配置校验强制）。
 * - 失败（defeat）恒 0 星；胜利时逐条判定，星数 = 达成条数。
 * - 边界语义：剩余生命比例 `hp/maxHp >= ratio`（相等达成）、限时 `用时 <= 秒数`
 *   （相等达成）、受击 `次数 <= 上限`（相等达成）；暂停不计时由战斗时间门保证
 *   （elapsedSeconds 取战局时间，升级暂停期间不推进）。
 */
import type { StarCondition } from '../config/ConfigTypes';
import type { StarConditionDetail } from '../core/BattleEvents';

/** 结算瞬间的战斗快照（由 StageResultService 采集）。 */
export interface StarBattleSnapshot {
  /** 是否胜利（false 恒 0 星）。 */
  readonly victory: boolean;
  /** 战局用时（秒）。 */
  readonly elapsedSeconds: number;
  /** 全局受击次数（有效伤害结算次数）。 */
  readonly hitTakenCount: number;
  /** 结算时剩余生命比例（0～1；未受伤视为 1）。 */
  readonly hpRatio: number;
}

export interface StarEvaluation {
  readonly stars: number;
  readonly details: readonly StarConditionDetail[];
}

function conditionText(condition: StarCondition, snapshot: StarBattleSnapshot): string {
  switch (condition.kind) {
    case 'clear':
      return '通关本关';
    case 'hpRatioAbove': {
      const percent = Math.round(snapshot.hpRatio * 100);
      const threshold = Math.round(condition.ratio * 100);
      return `剩余生命不低于 ${threshold}%（当前 ${percent}%）`;
    }
    case 'timeUnder':
      return `用时不超过 ${condition.seconds} 秒（当前 ${Math.floor(snapshot.elapsedSeconds)} 秒）`;
    case 'hitTakenAtMost':
      return `受击不超过 ${condition.count} 次（当前 ${snapshot.hitTakenCount} 次）`;
    default: {
      const unreachable: never = condition;
      return `未知条件 ${String((unreachable as { kind: unknown }).kind)}`;
    }
  }
}

function isConditionMet(condition: StarCondition, snapshot: StarBattleSnapshot): boolean {
  switch (condition.kind) {
    case 'clear':
      return snapshot.victory;
    case 'hpRatioAbove':
      return snapshot.hpRatio >= condition.ratio;
    case 'timeUnder':
      return snapshot.elapsedSeconds <= condition.seconds;
    case 'hitTakenAtMost':
      return snapshot.hitTakenCount <= condition.count;
    default:
      return false;
  }
}

/** 评估 0～3 星与逐条明细；条件集长度不足 3 时按缺失条件未达成处理（不抛错）。 */
export function evaluateStageStars(
  conditions: readonly StarCondition[],
  snapshot: StarBattleSnapshot,
): StarEvaluation {
  const details: StarConditionDetail[] = [];
  let stars = 0;
  for (let star = 1; star <= 3; star += 1) {
    const condition = conditions[star - 1];
    if (condition === undefined) {
      details.push({ star, kind: 'missing', met: false, text: '条件缺失' });
      continue;
    }
    const met = isConditionMet(condition, snapshot);
    details.push({
      star,
      kind: condition.kind,
      met,
      text: conditionText(condition, snapshot),
    });
    if (met) {
      stars += 1;
    }
  }
  if (!snapshot.victory) {
    return { stars: 0, details };
  }
  return { stars, details };
}
