import type { EliteModifierConfig, MonsterConfig, StageDifficultyConfig } from '../config/ConfigTypes';

/** 一次激活怪物的有效数值快照（基础值或精英强化值）。 */
export interface MonsterEffectiveStats {
  readonly maxHp: number;
  readonly moveSpeed: number;
  readonly contactDamage: number;
  readonly xpValue: number;
  readonly collisionRadius: number;
  readonly isElite: boolean;
}

/**
 * 难度档数值乘数切片（V08-03 战斗装配；来自选中关卡的 StageDifficultyConfig）。
 * 作用于运行态快照，不改写配置对象。
 */
export interface DifficultyStatMultipliers {
  readonly hp: number;
  readonly speed: number;
  readonly contactDamage: number;
  readonly xp: number;
}

/** 从难度档配置提取战斗侧数值乘数（奖励乘数归结算，不在此列）。 */
export function buildDifficultyStatMultipliers(
  difficulty: StageDifficultyConfig,
): DifficultyStatMultipliers {
  return {
    hp: difficulty.hpMultiplier,
    speed: difficulty.speedMultiplier,
    contactDamage: difficulty.contactDamageMultiplier,
    xp: difficulty.xpMultiplier,
  };
}

/**
 * 基础怪物 → 有效数值快照：elite 时逐项乘 eliteModifier，难度乘数最后叠加。
 * 取整规则：elite 路径与 V0.1 一致（hp/xp 取整且下限 1，contactDamage 取整，
 * 速度/半径保留小数）；难度乘数叠加后同样取整（hp/xp 下限 1，contactDamage 取整）。
 * 无难度乘数时保持既有行为完全不变（非精英直通基础值）。
 */
export function buildMonsterEffectiveStats(
  monsterConfig: MonsterConfig,
  modifier: EliteModifierConfig,
  isElite: boolean,
  difficulty?: DifficultyStatMultipliers,
): MonsterEffectiveStats {
  if (difficulty === undefined) {
    if (!isElite) {
      return {
        maxHp: monsterConfig.maxHp,
        moveSpeed: monsterConfig.moveSpeed,
        contactDamage: monsterConfig.contactDamage,
        xpValue: monsterConfig.xpValue,
        collisionRadius: monsterConfig.collisionRadius,
        isElite: false,
      };
    }
    return {
      maxHp: Math.max(1, Math.round(monsterConfig.maxHp * modifier.hpMultiplier)),
      moveSpeed: monsterConfig.moveSpeed * modifier.speedMultiplier,
      contactDamage: Math.round(monsterConfig.contactDamage * modifier.contactDamageMultiplier),
      xpValue: Math.max(1, Math.round(monsterConfig.xpValue * modifier.xpMultiplier)),
      collisionRadius: monsterConfig.collisionRadius * modifier.collisionRadiusMultiplier,
      isElite: true,
    };
  }
  const hpScale = difficulty.hp * (isElite ? modifier.hpMultiplier : 1);
  const speedScale = difficulty.speed * (isElite ? modifier.speedMultiplier : 1);
  const contactScale = difficulty.contactDamage * (isElite ? modifier.contactDamageMultiplier : 1);
  const xpScale = difficulty.xp * (isElite ? modifier.xpMultiplier : 1);
  return {
    maxHp: Math.max(1, Math.round(monsterConfig.maxHp * hpScale)),
    moveSpeed: monsterConfig.moveSpeed * speedScale,
    contactDamage: Math.round(monsterConfig.contactDamage * contactScale),
    xpValue: Math.max(1, Math.round(monsterConfig.xpValue * xpScale)),
    collisionRadius: monsterConfig.collisionRadius * (isElite ? modifier.collisionRadiusMultiplier : 1),
    isElite,
  };
}
