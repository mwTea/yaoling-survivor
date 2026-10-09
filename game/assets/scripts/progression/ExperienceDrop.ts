/**
 * 经验掉落决策（纯 TS）：预算内直接在死亡位置生成新经验物；
 * 达到在场预算且有现存经验物时，合并进最近的现存经验物（总量守恒）。
 * 没有现存经验物时宁可超出预算也直接生成——经验不允许丢失。
 */
export type ExperienceDropDecision = 'spawn' | 'merge';

export function decideExperienceDrop(
  activeCount: number,
  maxActiveCount: number,
  hasActiveGem: boolean,
): ExperienceDropDecision {
  if (activeCount < maxActiveCount || !hasActiveGem) {
    return 'spawn';
  }
  return 'merge';
}
