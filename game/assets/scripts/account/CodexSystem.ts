/**
 * 图鉴数据层（V08-11）。
 *
 * 单文件叶子模块（零跨文件值导入，仅类型导入，可被 node 纯逻辑测试直接加载）：
 * - "已见/已击败"记录由战斗遭遇写入（V0.8 唯一来源 = monsterDied 击杀事件，
 *   经 BattleResultStats.killCounts 在结算点应用——战斗中不回写账号）：
 *   seenIds（遭遇过）与 defeatedIds（已击败）同时写入；当前两集合一致，
 *   "已见但未击败"态预留（未来若加入出场类事件仅写 seenIds）。
 * - 记录只增不减、幂等（重复击杀同 ID 不产生重复条目）。
 * - 章节点亮不落图鉴域：由 StageProgress 的关卡通关记录派生（isStageCleared）。
 */
import type { CodexSaveState } from './AccountSave';

/** 图鉴存档切片（AccountSaveData 结构兼容）。 */
export interface CodexState {
  codex: CodexSaveState;
}

/** 应用一局击杀分布：把出现过的配置 ID 写入 seenIds 与 defeatedIds（增量、幂等）。 */
export function recordCodexKills(state: CodexState, killCounts: Readonly<Record<string, number>>): void {
  for (const monsterId of Object.keys(killCounts)) {
    const count = killCounts[monsterId];
    if (typeof count !== 'number' || count <= 0 || monsterId.length === 0) {
      continue;
    }
    if (state.codex.seenIds.indexOf(monsterId) === -1) {
      state.codex.seenIds.push(monsterId);
    }
    if (state.codex.defeatedIds.indexOf(monsterId) === -1) {
      state.codex.defeatedIds.push(monsterId);
    }
  }
}

export function isDefeated(state: CodexState, configId: string): boolean {
  return state.codex.defeatedIds.indexOf(configId) !== -1;
}

export function isSeen(state: CodexState, configId: string): boolean {
  return state.codex.seenIds.indexOf(configId) !== -1;
}
