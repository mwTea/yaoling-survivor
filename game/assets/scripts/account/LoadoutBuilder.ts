/**
 * 出战快照装配（V05-07，V0.5 局外成长 → 战斗注入）。
 *
 * 单文件叶子模块（零跨文件值导入，仅类型导入，可被 node 纯逻辑测试直接加载）：
 * - 从账号存档切片 + 培养配置表构建只读 `BattleLoadoutSnapshot`，开局由装配层
 *   （V05-10 起的账号服务）一次性注入战斗；战斗全程不得回写账号（PRODUCT.md）。
 * - 培养派生公式与 `account/WeaponGrowth`（伤害加成）/ `account/RealmProgress`
 *   （境界 maxHp 累计）同源，均以 CONFIG.md 为唯一公式定义；此处为快照装配的
 *   独立实现，保持叶子模块可测（仓库 node 测试约束：零跨文件值导入）。
 * - 空/未培养账号对应 `EMPTY_BATTLE_LOADOUT`，注入后战斗数值与既有行为完全一致。
 */
import type { BeastConfig, BeastSkillEffect, RealmConfig, WeaponGrowthConfig } from '../config/ConfigTypes';
import type { BeastSaveEntry } from '../account/AccountSave';

/** 只读出战快照：战斗开局注入一次，战斗中不修改。 */
export interface BattleLoadoutSnapshot {
  /** 法器培养伤害加成（青霄剑等级派生的基础攻击增量）。 */
  readonly weaponDamageBonus: number;
  /** 境界累计 maxHp 加成。 */
  readonly maxHpBonus: number;
  /** 出战灵兽及其触发技能；未出战/锁定/配置缺失为 null。 */
  readonly deployedBeast: {
    readonly beastId: string;
    readonly skill: BeastSkillEffect;
  } | null;
}

/** 无任何局外加成的空快照（无账号服务时的默认注入，行为与 V0.1 一致）。 */
export const EMPTY_BATTLE_LOADOUT: BattleLoadoutSnapshot = {
  weaponDamageBonus: 0,
  maxHpBonus: 0,
  deployedBeast: null,
};

/** 账号存档的养成/进度切片（AccountSaveData 结构兼容，按结构类型传入）。 */
export interface LoadoutAccountState {
  weaponLevels: Record<string, number>;
  realmIndex: number;
  beasts: Record<string, BeastSaveEntry>;
  deployedBeastId: string | null;
}

/** 培养配置表切片（GameConfig 结构兼容，按结构类型传入）。 */
export interface LoadoutConfigTables {
  readonly realms: readonly RealmConfig[];
  readonly weaponGrowth: readonly WeaponGrowthConfig[];
  readonly beasts: readonly BeastConfig[];
}

/** 构建只读出战快照；全部字段只读，快照对象不携带账号状态引用。 */
export function buildBattleLoadout(
  state: LoadoutAccountState,
  tables: LoadoutConfigTables,
): BattleLoadoutSnapshot {
  return {
    weaponDamageBonus: buildWeaponDamageBonus(state.weaponLevels, tables.weaponGrowth),
    maxHpBonus: buildRealmMaxHpBonus(state.realmIndex, tables.realms),
    deployedBeast: buildDeployedBeast(state, tables.beasts),
  };
}

function buildWeaponDamageBonus(
  weaponLevels: Record<string, number>,
  growthConfigs: readonly WeaponGrowthConfig[],
): number {
  let bonus = 0;
  for (const growth of growthConfigs) {
    const level = weaponLevels[growth.weaponId];
    const safeLevel = typeof level === 'number' && level >= 1 ? Math.floor(level) : 1;
    bonus += growth.damagePerLevel * (safeLevel - 1);
  }
  return bonus;
}

function buildRealmMaxHpBonus(realmIndex: number, realms: readonly RealmConfig[]): number {
  if (realms.length === 0 || realmIndex < 0) {
    return 0;
  }
  // 存档下标超出配置（境界表缩短）时钳到最后一个境界：不回收已拥有收益。
  const clampedIndex = Math.min(realmIndex, realms.length - 1);
  let total = 0;
  for (let index = 0; index <= clampedIndex; index += 1) {
    const realm = realms[index];
    if (realm !== undefined) {
      total += realm.maxHpBonus;
    }
  }
  return total;
}

function buildDeployedBeast(
  state: LoadoutAccountState,
  beasts: readonly BeastConfig[],
): BattleLoadoutSnapshot['deployedBeast'] {
  const beastId = state.deployedBeastId;
  if (beastId === null) {
    return null;
  }
  const config = beasts.find((candidate) => candidate.id === beastId);
  if (config === undefined) {
    return null;
  }
  const entry: BeastSaveEntry = state.beasts[beastId] ?? {
    unlocked: config.unlockSoulCost === 0,
    level: 1,
    star: 0,
  };
  if (!entry.unlocked) {
    return null;
  }
  return { beastId, skill: config.skill };
}
