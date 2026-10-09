/**
 * 出战灵兽触发技能运行计划与节拍器（V05-08，V0.5 局外成长）。
 *
 * 单文件叶子模块（零跨文件值导入，仅类型导入，可被 node 纯逻辑测试直接加载）：
 * - `createBeastCompanionPlan`：把 BeastSkillEffect 配置展开为运行计划（kind 分派、
 *   数值全部来自配置，无默认值兜底——缺配置属装配错误，由组件启动校验拒绝）。
 * - `BeastCompanionTrigger`：受战斗时间门控的周期节拍器——只在战斗模拟运行时推进，
 *   暂停冻结；到点进入 due 后持续保持（供组件完成"无目标重试"），触发方显式
 *   `markFired` 重新计时；每帧至多触发一次，长帧余量保留保持节奏。
 */
import type { BeastSkillEffect } from '../config/ConfigTypes';

/** 灵兽触发技能运行计划（配置展开，组件据此执行伤害或治疗）。 */
export interface BeastCompanionPlan {
  readonly kind: 'damage' | 'heal';
  readonly intervalSeconds: number;
  /** kind = damage：单发伤害。 */
  readonly damage: number;
  /** kind = heal：单次回复量。 */
  readonly healValue: number;
  /** kind = damage：每轮投射物数量。 */
  readonly projectileCount: number;
}

/** 把灵兽技能配置展开为运行计划；数值只读透传，不做任何默认值兜底。 */
export function createBeastCompanionPlan(skill: BeastSkillEffect): BeastCompanionPlan {
  if (skill.kind === 'damageNearest') {
    return {
      kind: 'damage',
      intervalSeconds: skill.intervalSeconds,
      damage: skill.damage,
      healValue: 0,
      projectileCount: skill.projectileCount,
    };
  }
  return {
    kind: 'heal',
    intervalSeconds: skill.intervalSeconds,
    damage: 0,
    healValue: skill.value,
    projectileCount: 0,
  };
}

export type BeastTriggerTick = 'idle' | 'due';

export class BeastCompanionTrigger {
  private readonly intervalSeconds: number;
  private remainingSeconds: number;

  constructor(plan: BeastCompanionPlan) {
    if (!(plan.intervalSeconds > 0) || !Number.isFinite(plan.intervalSeconds)) {
      throw new Error(`BeastCompanionTrigger interval must be a positive finite number, got ${plan.intervalSeconds}`);
    }
    this.intervalSeconds = plan.intervalSeconds;
    this.remainingSeconds = 0;
  }

  /**
   * 推进节拍：仅战斗模拟运行（running）且 delta > 0 时累计；暂停/零 delta 冻结。
   * 到点返回 'due' 并保持 due（无目标重试由调用方不调用 markFired 实现）。
   */
  public advance(deltaSeconds: number, simulationRunning: boolean): BeastTriggerTick {
    if (!simulationRunning || !(deltaSeconds > 0)) {
      return this.isDue ? 'due' : 'idle';
    }
    this.remainingSeconds -= deltaSeconds;
    return this.isDue ? 'due' : 'idle';
  }

  /** 是否到点（首次 tick 即 due，与武器发射节奏一致）。 */
  public get isDue(): boolean {
    return this.remainingSeconds <= 0;
  }

  /** 触发完成，重新计时整个间隔（余量保留，长帧不丢拍；每帧至多触发一次）。 */
  public markFired(): void {
    this.remainingSeconds += this.intervalSeconds;
    if (this.remainingSeconds < 0) {
      this.remainingSeconds = 0;
    }
  }
}
