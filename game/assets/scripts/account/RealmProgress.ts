/**
 * 境界、小境界、修为与突破（V05-04，V0.5 局外成长）。
 *
 * 单文件叶子模块（零跨文件值导入，仅类型导入，可被 node 纯逻辑测试直接加载）：
 * - 小境界推进：当前层所需修为从库存 res_xiuwei 走经济事务扣耗（ECONOMY 语义，
 *   不设独立修为进度条字段），达标即前进；`autoPromoteSubRealms` 提供批量自动推进。
 * - 大境界突破两步制：`previewBreakthrough` 返回条件与消耗快照（UI 预览），
 *   `confirmBreakthrough` 复核条件后单事务扣耗修为+材料并前进；无失败机制（PROGRESSION.md）。
 * - 突破仅在小境界圆满（推进完当前大境界全部层数）后开放。
 * - economy 依赖通过结构接口注入（兼容 EconomyService，测试可注入确定性实现）。
 */
import type { AccountTxEntry } from '../account/AccountSave';
import type { EconomyOpRequest, EconomyOpResult } from '../economy/Economy';
import type { RealmConfig } from '../config/ConfigTypes';
import type { PlayerLevelState } from './PlayerLeveling';

/** 修为资源 ID（小境界推进与大境界突破共用，见 CONFIG.md ResourceConfig）。 */
export const REALM_XIUWEI_RESOURCE_ID = 'res_xiuwei';

/** 境界状态切片（AccountSaveData 进度域结构兼容，按结构类型传入）。 */
export interface RealmState {
  /** 大境界下标（config.realms 数组下标）。 */
  realmIndex: number;
  /** 当前大境界内的有序小境界下标（0 = 一层）；等于 subRealmCosts.length 表示圆满。 */
  subRealmIndex: number;
}

/** 经济状态切片（EconomyState 结构兼容；通常与 AccountSaveData 同一对象传入）。 */
export interface RealmEconomyState {
  balances: Record<string, number>;
  recentTransactions: AccountTxEntry[];
}

/** 经济事务依赖（结构兼容 EconomyService 的只读+消耗子集；测试可注入确定性实现）。 */
export interface RealmEconomyOps {
  getBalance(state: RealmEconomyState, resourceId: string): number;
  spend(state: RealmEconomyState, request: EconomyOpRequest): EconomyOpResult;
}

export interface RealmOpRequest {
  /** 事务 ID（自动推进时按 `txIdBase#n` 派生），由调用方保证可读且可追溯。 */
  readonly txId: string;
  /** 事务时间（epoch 毫秒）。 */
  readonly at: number;
}

export type RealmOpFailureReason =
  | 'invalid_realm_state'
  | 'sub_realm_maxed'
  | 'no_breakthrough_available'
  | 'condition_unmet'
  | 'economy_rejected';

export type RealmOpResult =
  | {
    readonly ok: true;
    /** 小境界推进后的新下标；大境界突破时为新 realmIndex（subRealmIndex 归零）。 */
    readonly newSubRealmIndex: number;
    readonly newRealmIndex: number;
  }
  | {
    readonly ok: false;
    readonly reason: RealmOpFailureReason;
    /** 指出境界/资源/字段的详情，开发期快速定位；不用于 UI 文案。 */
    readonly detail: string;
  };

/** 大境界突破预览快照（两步制第一步；UI 直接展示，确认时以 confirmBreakthrough 复核为准）。 */
export interface BreakthroughPreview {
  readonly realmId: string;
  readonly nextRealmId: string;
  readonly xiuweiCost: number;
  readonly materialId: string;
  readonly materialCost: number;
  readonly xiuweiBalance: number;
  readonly materialBalance: number;
  readonly requiredPlayerLevel: number;
  readonly playerLevel: number;
  /** 突破收益预览：目标大境界累计 maxHp 加成（含本次）。 */
  readonly nextTotalMaxHpBonus: number;
  readonly canBreakthrough: boolean;
  /** 未满足条件稳定 key（'xiuwei' | 'material' | 'playerLevel'），UI 负责文案。 */
  readonly unmet: readonly ('xiuwei' | 'material' | 'playerLevel')[];
}

/**
 * 推进一个小境界：原子消耗 costs[subRealmIndex] 点修为后 subRealmIndex += 1。
 * 圆满后拒绝（需走大境界突破）；经济事务失败（修为不足等）零修改。
 */
export function promoteSubRealm(
  realmState: RealmState,
  economyState: RealmEconomyState,
  realms: readonly RealmConfig[],
  economy: RealmEconomyOps,
  request: RealmOpRequest,
): RealmOpResult {
  const current = resolveCurrentRealm(realmState, realms);
  if (typeof current === 'string') {
    return { ok: false, reason: 'invalid_realm_state', detail: current };
  }
  if (realmState.subRealmIndex >= current.subRealmCosts.length) {
    return {
      ok: false,
      reason: 'sub_realm_maxed',
      detail: `realm "${current.id}" is perfected; breakthrough required`,
    };
  }
  const cost = current.subRealmCosts[realmState.subRealmIndex];
  if (cost === undefined) {
    return { ok: false, reason: 'invalid_realm_state', detail: `missing sub-realm cost for "${current.id}"` };
  }
  const spend = economy.spend(economyState, {
    txId: request.txId,
    kind: 'realm_sub_realm_promote',
    deltas: { [REALM_XIUWEI_RESOURCE_ID]: -cost },
    at: request.at,
  });
  if (!spend.ok) {
    return { ok: false, reason: 'economy_rejected', detail: spend.detail };
  }
  realmState.subRealmIndex += 1;
  return { ok: true, newSubRealmIndex: realmState.subRealmIndex, newRealmIndex: realmState.realmIndex };
}

/**
 * 批量自动推进：只要修为够下一层就继续（含跨层），修为不足或圆满即停。
 * 事务 ID 按 `txIdBase#1`、`txIdBase#2` 派生保证唯一。
 */
export function autoPromoteSubRealms(
  realmState: RealmState,
  economyState: RealmEconomyState,
  realms: readonly RealmConfig[],
  economy: RealmEconomyOps,
  request: RealmOpRequest,
): { promoted: number; stoppedReason: RealmOpFailureReason | null } {
  let promoted = 0;
  let stoppedReason: RealmOpFailureReason | null = null;
  const current = resolveCurrentRealm(realmState, realms);
  if (typeof current === 'string') {
    return { promoted: 0, stoppedReason: 'invalid_realm_state' };
  }
  // 尝试次数 = 剩余层数 + 1：最后一层推满后再试一次，以观察 sub_realm_maxed 停止原因。
  const maxAttempts = current.subRealmCosts.length - realmState.subRealmIndex + 1;
  for (let i = 0; i < maxAttempts; i += 1) {
    const result = promoteSubRealm(realmState, economyState, realms, economy, {
      txId: `${request.txId}#${i + 1}`,
      at: request.at,
    });
    if (!result.ok) {
      stoppedReason = result.reason;
      break;
    }
    promoted += 1;
  }
  return { promoted, stoppedReason };
}

/**
 * 大境界突破预览（两步制第一步）。未圆满、已是末个境界或下标非法时返回 null
 * （UI 显示"无可用突破"），不以假数据伪装可突破。
 */
export function previewBreakthrough(
  realmState: RealmState,
  playerLevelState: PlayerLevelState,
  economyState: RealmEconomyState,
  realms: readonly RealmConfig[],
  economy: RealmEconomyOps,
): BreakthroughPreview | null {
  const current = resolveCurrentRealm(realmState, realms);
  if (typeof current === 'string' || current.breakthrough === null) {
    return null;
  }
  if (realmState.subRealmIndex < current.subRealmCosts.length) {
    return null;
  }
  const nextIndex = realmState.realmIndex + 1;
  const nextRealm = realms[nextIndex];
  if (nextRealm === undefined) {
    return null;
  }
  const xiuweiBalance = economy.getBalance(economyState, REALM_XIUWEI_RESOURCE_ID);
  const materialBalance = economy.getBalance(economyState, current.breakthrough.materialId);
  const unmet: Array<'xiuwei' | 'material' | 'playerLevel'> = [];
  if (xiuweiBalance < current.breakthrough.xiuweiCost) {
    unmet.push('xiuwei');
  }
  if (materialBalance < current.breakthrough.materialCost) {
    unmet.push('material');
  }
  if (playerLevelState.playerLevel < current.breakthrough.requiredPlayerLevel) {
    unmet.push('playerLevel');
  }
  return {
    realmId: current.id,
    nextRealmId: nextRealm.id,
    xiuweiCost: current.breakthrough.xiuweiCost,
    materialId: current.breakthrough.materialId,
    materialCost: current.breakthrough.materialCost,
    xiuweiBalance,
    materialBalance,
    requiredPlayerLevel: current.breakthrough.requiredPlayerLevel,
    playerLevel: playerLevelState.playerLevel,
    nextTotalMaxHpBonus: getTotalRealmMaxHpBonus(realms, nextIndex),
    canBreakthrough: unmet.length === 0,
    unmet,
  };
}

/**
 * 大境界突破确认（两步制第二步）：复核圆满与全部条件后，修为+材料单事务原子扣耗，
 * realmIndex + 1、subRealmIndex 归零。条件不足/事务失败均零修改；无失败机制（必成）。
 */
export function confirmBreakthrough(
  realmState: RealmState,
  playerLevelState: PlayerLevelState,
  economyState: RealmEconomyState,
  realms: readonly RealmConfig[],
  economy: RealmEconomyOps,
  request: RealmOpRequest,
): RealmOpResult {
  const current = resolveCurrentRealm(realmState, realms);
  if (typeof current === 'string') {
    return { ok: false, reason: 'invalid_realm_state', detail: current };
  }
  if (current.breakthrough === null) {
    return {
      ok: false,
      reason: 'no_breakthrough_available',
      detail: `realm "${current.id}" is the final realm`,
    };
  }
  if (realmState.subRealmIndex < current.subRealmCosts.length) {
    return {
      ok: false,
      reason: 'condition_unmet',
      detail: `realm "${current.id}" is not perfected (subRealmIndex ${realmState.subRealmIndex})`,
    };
  }
  if (playerLevelState.playerLevel < current.breakthrough.requiredPlayerLevel) {
    return {
      ok: false,
      reason: 'condition_unmet',
      detail: `playerLevel ${playerLevelState.playerLevel} below required ${current.breakthrough.requiredPlayerLevel}`,
    };
  }
  const materialBalance = economy.getBalance(economyState, current.breakthrough.materialId);
  if (materialBalance < current.breakthrough.materialCost) {
    return {
      ok: false,
      reason: 'condition_unmet',
      detail: `material "${current.breakthrough.materialId}" have ${materialBalance}, need ${current.breakthrough.materialCost}`,
    };
  }
  const spend = economy.spend(economyState, {
    txId: request.txId,
    kind: 'realm_breakthrough',
    deltas: {
      [REALM_XIUWEI_RESOURCE_ID]: -current.breakthrough.xiuweiCost,
      [current.breakthrough.materialId]: -current.breakthrough.materialCost,
    },
    at: request.at,
  });
  if (!spend.ok) {
    return { ok: false, reason: 'economy_rejected', detail: spend.detail };
  }
  realmState.realmIndex += 1;
  realmState.subRealmIndex = 0;
  return { ok: true, newSubRealmIndex: 0, newRealmIndex: realmState.realmIndex };
}

/** 当前大境界累计 maxHp 加成（进入境界 0..realmIndex 的增量之和）；下标非法按 0。 */
export function getTotalRealmMaxHpBonus(realms: readonly RealmConfig[], realmIndex: number): number {
  if (realmIndex < 0 || realmIndex >= realms.length) {
    return 0;
  }
  let total = 0;
  for (let index = 0; index <= realmIndex; index += 1) {
    const realm = realms[index];
    if (realm !== undefined) {
      total += realm.maxHpBonus;
    }
  }
  return total;
}

function resolveCurrentRealm(
  realmState: RealmState,
  realms: readonly RealmConfig[],
): RealmConfig | string {
  const realm = realms[realmState.realmIndex];
  if (realm === undefined) {
    return `realmIndex ${realmState.realmIndex} out of range (${realms.length} realms)`;
  }
  if (realmState.subRealmIndex < 0) {
    return `subRealmIndex ${realmState.subRealmIndex} must not be negative`;
  }
  return realm;
}
