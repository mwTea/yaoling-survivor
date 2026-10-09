/**
 * 灵兽培养与出战（V05-06，V0.5 局外成长）。
 *
 * 单文件叶子模块（零跨文件值导入，仅类型导入，可被 node 纯逻辑测试直接加载）：
 * - 灵魄按兽隔离：解锁/升星只消耗该灵兽自己的灵魄资源（config.soulResourceId 显式声明），
 *   无跨兽互换（PROGRESSION.md）；升级消耗 res_lingshi；一律走经济原子事务。
 * - 存档 beasts 表缺省条目按配置推导默认态：unlockSoulCost 为 0 的灵兽默认解锁，
 *   其余默认锁定；等级 1、星级 0（星级上限 = starUpCosts.length）。
 * - 等级上限 = levelUpCosts.length + 1 且受玩家等级钳制（两种封顶分别返回原因）。
 * - 出战为单槽：deployBeast 直接切换（未解锁不可出战）；出战技能数值仅定义配置，
 *   战斗接入在 V05-08；持有被动 V0.5 不做。
 */
import type { BeastConfig } from '../config/ConfigTypes';
import type { AccountTxEntry, BeastSaveEntry } from '../account/AccountSave';
import type { EconomyOpRequest, EconomyOpResult } from '../economy/Economy';
import type { PlayerLevelState } from './PlayerLeveling';

/** 灵兽通用升级货币（灵石，见 CONFIG.md ResourceConfig）。 */
export const BEAST_LEVEL_UP_RESOURCE_ID = 'res_lingshi';

/** 事务来源标记（审计日志 kind）。 */
export const BEAST_UNLOCK_TX_KIND = 'beast_unlock';
export const BEAST_LEVEL_UP_TX_KIND = 'beast_level_up';
export const BEAST_STAR_UP_TX_KIND = 'beast_star_up';

/** 灵兽花名册状态切片（AccountSaveData 养成域结构兼容，按结构类型传入）。 */
export interface BeastRosterState {
  beasts: Record<string, BeastSaveEntry>;
  deployedBeastId: string | null;
}

/** 经济状态切片（EconomyState 结构兼容；通常与 AccountSaveData 同一对象传入）。 */
export interface BeastEconomyState {
  balances: Record<string, number>;
  recentTransactions: AccountTxEntry[];
}

/** 经济事务依赖（结构兼容 EconomyService 的只读+消耗子集；测试可注入确定性实现）。 */
export interface BeastEconomyOps {
  getBalance(state: BeastEconomyState, resourceId: string): number;
  spend(state: BeastEconomyState, request: EconomyOpRequest): EconomyOpResult;
}

export interface BeastOpRequest {
  readonly txId: string;
  readonly at: number;
}

export type BeastOpFailureReason =
  | 'unknown_beast'
  | 'not_unlocked'
  | 'already_unlocked'
  | 'at_max_level'
  | 'player_level_cap'
  | 'at_max_star'
  | 'economy_rejected';

export type BeastOpResult =
  | {
    readonly ok: true;
    /** 操作后的灵兽状态快照（解锁/升级/升星共通）。 */
    readonly entry: BeastSaveEntry;
  }
  | {
    readonly ok: false;
    readonly reason: BeastOpFailureReason;
    /** 指出灵兽 ID/资源/字段的详情，开发期快速定位；不用于 UI 文案。 */
    readonly detail: string;
  };

export type DeployBeastResult =
  | {
    readonly ok: true;
    readonly deployedBeastId: string;
    readonly previousDeployedId: string | null;
  }
  | {
    readonly ok: false;
    readonly reason: 'unknown_beast' | 'not_unlocked';
    readonly detail: string;
  };

/** 读取灵兽存档条目；缺省条目按配置推导默认态（默认解锁灵兽为 unlocked）。 */
export function getBeastEntry(state: BeastRosterState, config: BeastConfig): BeastSaveEntry {
  const existing = state.beasts[config.id];
  if (existing !== undefined) {
    return existing;
  }
  return {
    unlocked: config.unlockSoulCost === 0,
    level: 1,
    star: 0,
  };
}

/** 灵兽等级上限 = 升级曲线长度 + 1，且受玩家等级钳制。 */
export function getBeastLevelCap(config: BeastConfig, playerLevel: number): number {
  return Math.min(config.levelUpCosts.length + 1, Math.max(1, playerLevel));
}

/**
 * 解锁灵兽：原子扣耗自身灵魄（unlockSoulCost 为 0 的灵兽默认解锁，不可重复解锁）。
 * 已有条目时保留其等级/星级，仅置 unlocked。
 */
export function unlockBeast(
  state: BeastRosterState,
  economyState: BeastEconomyState,
  configs: readonly BeastConfig[],
  economy: BeastEconomyOps,
  beastId: string,
  request: BeastOpRequest,
): BeastOpResult {
  const config = findBeast(configs, beastId);
  if (typeof config === 'string') {
    return { ok: false, reason: 'unknown_beast', detail: config };
  }
  const entry = getBeastEntry(state, config);
  if (entry.unlocked) {
    return { ok: false, reason: 'already_unlocked', detail: `beast "${beastId}" is already unlocked` };
  }
  const spend = economy.spend(economyState, {
    txId: request.txId,
    kind: BEAST_UNLOCK_TX_KIND,
    deltas: { [config.soulResourceId]: -config.unlockSoulCost },
    at: request.at,
  });
  if (!spend.ok) {
    return { ok: false, reason: 'economy_rejected', detail: spend.detail };
  }
  const updated: BeastSaveEntry = { unlocked: true, level: entry.level, star: entry.star };
  state.beasts[beastId] = updated;
  return { ok: true, entry: updated };
}

/** 灵兽升级：需已解锁；等级上限 = min(曲线长度 + 1, 玩家等级)，两种封顶分别拒绝。 */
export function levelUpBeast(
  state: BeastRosterState,
  playerLevelState: PlayerLevelState,
  economyState: BeastEconomyState,
  configs: readonly BeastConfig[],
  economy: BeastEconomyOps,
  beastId: string,
  request: BeastOpRequest,
): BeastOpResult {
  const config = findBeast(configs, beastId);
  if (typeof config === 'string') {
    return { ok: false, reason: 'unknown_beast', detail: config };
  }
  const entry = getBeastEntry(state, config);
  if (!entry.unlocked) {
    return { ok: false, reason: 'not_unlocked', detail: `beast "${beastId}" is locked` };
  }
  const maxLevel = config.levelUpCosts.length + 1;
  if (entry.level >= maxLevel) {
    return { ok: false, reason: 'at_max_level', detail: `beast "${beastId}" is at max level ${maxLevel}` };
  }
  if (entry.level >= playerLevelState.playerLevel) {
    return {
      ok: false,
      reason: 'player_level_cap',
      detail: `beast "${beastId}" level ${entry.level} is capped by player level ${playerLevelState.playerLevel}`,
    };
  }
  const cost = config.levelUpCosts[entry.level - 1];
  if (cost === undefined) {
    return { ok: false, reason: 'at_max_level', detail: `missing level-up cost for "${beastId}" at level ${entry.level}` };
  }
  const spend = economy.spend(economyState, {
    txId: request.txId,
    kind: BEAST_LEVEL_UP_TX_KIND,
    deltas: { [BEAST_LEVEL_UP_RESOURCE_ID]: -cost },
    at: request.at,
  });
  if (!spend.ok) {
    return { ok: false, reason: 'economy_rejected', detail: spend.detail };
  }
  const updated: BeastSaveEntry = { ...entry, level: entry.level + 1 };
  state.beasts[beastId] = updated;
  return { ok: true, entry: updated };
}

/** 灵兽升星：需已解锁；星级上限 = starUpCosts.length（0 星起步），只消耗自身灵魄。 */
export function starUpBeast(
  state: BeastRosterState,
  economyState: BeastEconomyState,
  configs: readonly BeastConfig[],
  economy: BeastEconomyOps,
  beastId: string,
  request: BeastOpRequest,
): BeastOpResult {
  const config = findBeast(configs, beastId);
  if (typeof config === 'string') {
    return { ok: false, reason: 'unknown_beast', detail: config };
  }
  const entry = getBeastEntry(state, config);
  if (!entry.unlocked) {
    return { ok: false, reason: 'not_unlocked', detail: `beast "${beastId}" is locked` };
  }
  if (entry.star >= config.starUpCosts.length) {
    return { ok: false, reason: 'at_max_star', detail: `beast "${beastId}" is at max star ${config.starUpCosts.length}` };
  }
  const cost = config.starUpCosts[entry.star];
  if (cost === undefined) {
    return { ok: false, reason: 'at_max_star', detail: `missing star-up cost for "${beastId}" at star ${entry.star}` };
  }
  const spend = economy.spend(economyState, {
    txId: request.txId,
    kind: BEAST_STAR_UP_TX_KIND,
    deltas: { [config.soulResourceId]: -cost },
    at: request.at,
  });
  if (!spend.ok) {
    return { ok: false, reason: 'economy_rejected', detail: spend.detail };
  }
  const updated: BeastSaveEntry = { ...entry, star: entry.star + 1 };
  state.beasts[beastId] = updated;
  return { ok: true, entry: updated };
}

/** 切换出战灵兽（单槽，直接覆盖；未解锁不可出战；重复出战同一灵兽为幂等成功）。 */
export function deployBeast(
  state: BeastRosterState,
  configs: readonly BeastConfig[],
  beastId: string,
): DeployBeastResult {
  const config = findBeast(configs, beastId);
  if (typeof config === 'string') {
    return { ok: false, reason: 'unknown_beast', detail: config };
  }
  if (!getBeastEntry(state, config).unlocked) {
    return { ok: false, reason: 'not_unlocked', detail: `beast "${beastId}" is locked` };
  }
  const previousDeployedId = state.deployedBeastId;
  state.deployedBeastId = beastId;
  return { ok: true, deployedBeastId: beastId, previousDeployedId };
}

/** 读取当前出战灵兽；未设置或配置缺失（如存档引用已删除灵兽）返回 null。 */
export function getDeployedBeast(
  state: BeastRosterState,
  configs: readonly BeastConfig[],
): { beastId: string; config: BeastConfig; entry: BeastSaveEntry } | null {
  const beastId = state.deployedBeastId;
  if (beastId === null) {
    return null;
  }
  const config = configs.find((candidate) => candidate.id === beastId);
  if (config === undefined) {
    return null;
  }
  return { beastId, config, entry: getBeastEntry(state, config) };
}

function findBeast(configs: readonly BeastConfig[], beastId: string): BeastConfig | string {
  const config = configs.find((candidate) => candidate.id === beastId);
  return config === undefined ? `unknown beast id "${beastId}"` : config;
}
