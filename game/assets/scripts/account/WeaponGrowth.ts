/**
 * 法器局外培养（V05-05，V0.5 局外成长）。
 *
 * 单文件叶子模块（零跨文件值导入，仅类型导入，可被 node 纯逻辑测试直接加载）：
 * - 法器等级为账号永久养成（存档 weaponLevels，key 为法器配置 ID，缺省视为 1 级）；
 * - 升级消耗 res_lingshi 走经济原子事务；生效等级上限 = min(配置上限, 玩家等级)，
 *   两种封顶（配置满级 / 玩家等级门槛）分别返回原因，供 UI 提示；
 * - 每级基础攻击伤害增量为纯派生（damagePerLevel × (等级 - 1)），
 *   局内 WeaponConfig 数值不变，增量只经 V05-07 出战快照注入；
 * - 绝学/流派仅配置预留（ultimateIds），本模块不建立任何效果。
 */
import type { AccountTxEntry } from '../account/AccountSave';
import type { EconomyOpRequest, EconomyOpResult } from '../economy/Economy';
import type { WeaponGrowthConfig } from '../config/ConfigTypes';
import type { PlayerLevelState } from './PlayerLeveling';

/** 灵石资源 ID（法器/灵兽通用升级货币，见 CONFIG.md ResourceConfig）。 */
export const WEAPON_LEVEL_UP_RESOURCE_ID = 'res_lingshi';

/** 事务来源标记（审计日志 kind）。 */
export const WEAPON_LEVEL_UP_TX_KIND = 'weapon_level_up';

/** 法器培养状态切片（AccountSaveData 养成域结构兼容，按结构类型传入）。 */
export interface WeaponGrowthState {
  weaponLevels: Record<string, number>;
}

/** 经济状态切片（EconomyState 结构兼容；通常与 AccountSaveData 同一对象传入）。 */
export interface WeaponEconomyState {
  balances: Record<string, number>;
  recentTransactions: AccountTxEntry[];
}

/** 经济事务依赖（结构兼容 EconomyService 的只读+消耗子集；测试可注入确定性实现）。 */
export interface WeaponEconomyOps {
  getBalance(state: WeaponEconomyState, resourceId: string): number;
  spend(state: WeaponEconomyState, request: EconomyOpRequest): EconomyOpResult;
}

export interface WeaponLevelUpRequest {
  readonly txId: string;
  readonly at: number;
}

export type WeaponLevelUpResult =
  | {
    readonly ok: true;
    readonly newLevel: number;
  }
  | {
    readonly ok: false;
    readonly reason:
      | 'unknown_weapon'
      | 'at_max_level'
      | 'player_level_cap'
      | 'economy_rejected';
    /** 指出法器 ID/资源/字段的详情，开发期快速定位；不用于 UI 文案。 */
    readonly detail: string;
  };

/** 读取法器当前等级；未培养过的法器视为 1 级。 */
export function getWeaponLevel(state: WeaponGrowthState, weaponId: string): number {
  const level = state.weaponLevels[weaponId];
  return typeof level === 'number' && level >= 1 ? level : 1;
}

/** 生效等级上限 = min(配置上限, 玩家等级)；玩家等级只升不降，故上限不会收缩已拥有等级。 */
export function getWeaponLevelCap(growth: WeaponGrowthConfig, playerLevel: number): number {
  return Math.min(growth.maxLevel, Math.max(1, playerLevel));
}

/** 等级 L 的基础攻击伤害加成（纯派生，不改写局内武器配置）。 */
export function getWeaponDamageBonus(growth: WeaponGrowthConfig, level: number): number {
  return growth.damagePerLevel * (level - 1);
}

/**
 * 法器升级：校验上限（配置满级 / 玩家等级门槛分别拒绝）→ 原子扣耗灵石 → 等级 +1。
 * 经济事务失败（灵石不足/非法请求）零修改。
 */
export function levelUpWeapon(
  state: WeaponGrowthState,
  playerLevelState: PlayerLevelState,
  economyState: WeaponEconomyState,
  growthConfigs: readonly WeaponGrowthConfig[],
  economy: WeaponEconomyOps,
  weaponId: string,
  request: WeaponLevelUpRequest,
): WeaponLevelUpResult {
  const growth = growthConfigs.find((candidate) => candidate.weaponId === weaponId);
  if (growth === undefined) {
    return { ok: false, reason: 'unknown_weapon', detail: `no growth config for weapon "${weaponId}"` };
  }
  const currentLevel = getWeaponLevel(state, weaponId);
  if (currentLevel >= growth.maxLevel) {
    return { ok: false, reason: 'at_max_level', detail: `weapon "${weaponId}" is at max level ${growth.maxLevel}` };
  }
  if (currentLevel >= playerLevelState.playerLevel) {
    return {
      ok: false,
      reason: 'player_level_cap',
      detail: `weapon "${weaponId}" level ${currentLevel} is capped by player level ${playerLevelState.playerLevel}`,
    };
  }
  const cost = growth.levelUpCosts[currentLevel - 1];
  if (cost === undefined) {
    return {
      ok: false,
      reason: 'at_max_level',
      detail: `missing level-up cost for "${weaponId}" at level ${currentLevel}`,
    };
  }
  const spend = economy.spend(economyState, {
    txId: request.txId,
    kind: WEAPON_LEVEL_UP_TX_KIND,
    deltas: { [WEAPON_LEVEL_UP_RESOURCE_ID]: -cost },
    at: request.at,
  });
  if (!spend.ok) {
    return { ok: false, reason: 'economy_rejected', detail: spend.detail };
  }
  state.weaponLevels[weaponId] = currentLevel + 1;
  return { ok: true, newLevel: currentLevel + 1 };
}
