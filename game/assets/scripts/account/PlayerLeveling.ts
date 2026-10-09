/**
 * 账号玩家等级（V05-03，V0.5 局外成长）。
 *
 * 单文件叶子模块（零跨文件值导入，仅类型导入，可被 node 纯逻辑测试直接加载）：
 * - 与局内战斗等级完全隔离：局内经验（experienceCollected）不进入账号，
 *   账号经验只来自结算奖励（V05-09 接入）；
 * - 等级只进不退：任何路径都不得降低已拥有等级（含配置曲线缩短的场景）；
 * - 满级策略定案（PROGRESSION.md 要求首发前只能选一种）：**溢出保留**——
 *   满级后账号经验继续累积在 playerXp，不转换不丢弃，后续提高曲线上限时自然消化。
 */
import type { PlayerLevelConfig } from '../config/ConfigTypes';

/** 玩家等级状态切片（AccountSaveData 进度域结构兼容，按结构类型传入）。 */
export interface PlayerLevelState {
  playerLevel: number;
  playerXp: number;
}

export type AddAccountXpResult =
  | {
    readonly ok: true;
    readonly levelsGained: number;
    readonly newLevel: number;
    readonly newXp: number;
  }
  | {
    readonly ok: false;
    readonly reason: 'invalid_amount';
    /** 指出非法字段的详情，开发期快速定位；不用于 UI 文案。 */
    readonly detail: string;
  };

/** 当前等级的升级进度；requiredXp 为 null 表示已满级（无下一级）。 */
export interface AccountLevelProgress {
  readonly level: number;
  readonly xp: number;
  readonly requiredXp: number | null;
}

/**
 * 发放账号经验并结算升级：跨级一次处理（循环消化阈值）、满级溢出保留、
 * 等级只进不退。非法数额（非正整数）整体拒绝且不修改状态。
 */
export function addAccountXp(
  state: PlayerLevelState,
  config: PlayerLevelConfig,
  amount: number,
): AddAccountXpResult {
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
    return {
      ok: false,
      reason: 'invalid_amount',
      detail: `account xp amount must be a positive integer, got ${String(amount)}`,
    };
  }

  const maxLevel = config.levelCurve.length;
  let level = state.playerLevel;
  let xp = state.playerXp + amount;
  let levelsGained = 0;
  // 曲线覆盖不到的等级（存档等级高于曲线长度的配置缩短场景）按满级处理：不再升级、经验累积。
  while (level < maxLevel) {
    const entry = config.levelCurve[level - 1];
    if (entry === undefined || xp < entry.requiredXp) {
      break;
    }
    xp -= entry.requiredXp;
    level += 1;
    levelsGained += 1;
  }

  state.playerLevel = level;
  state.playerXp = xp;
  return { ok: true, levelsGained, newLevel: level, newXp: xp };
}

/** 读取升级进度；level 高于曲线长度（配置缩短）时同样按满级语义返回 null。 */
export function getAccountLevelProgress(
  state: PlayerLevelState,
  config: PlayerLevelConfig,
): AccountLevelProgress {
  const level = state.playerLevel;
  const entry = config.levelCurve[level - 1];
  return {
    level,
    xp: state.playerXp,
    requiredXp: entry === undefined ? null : entry.requiredXp,
  };
}
