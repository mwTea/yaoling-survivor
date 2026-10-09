import type { WeaponConfig } from '../config/ConfigTypes';

/**
 * 玩家战斗运行态：升级修正叠加在本对象上，不改写武器配置。
 * 冷却受配置下限保护，飞剑数量受配置上限保护。
 */
export class PlayerCombatStats {
  private readonly baseCooldown: number;
  private readonly minCooldown: number;
  private readonly maxProjectileCount: number;
  private baseDamage: number;
  private cooldownMultiplier: number;
  private projectileCount: number;
  private contactDamageMultiplier: number;
  private maxHpBonusValue: number;

  constructor(weaponConfig: WeaponConfig) {
    this.baseCooldown = weaponConfig.cooldown;
    this.minCooldown = weaponConfig.minCooldown;
    this.maxProjectileCount = weaponConfig.maxProjectileCount;
    this.baseDamage = weaponConfig.baseDamage;
    this.cooldownMultiplier = 1;
    this.projectileCount = weaponConfig.projectileCount;
    this.contactDamageMultiplier = 1;
    this.maxHpBonusValue = 0;
  }

  public get swordDamage(): number {
    return this.baseDamage;
  }

  /** 局外培养注入的最大生命加成（境界收益等）；玩家 Agent 建立生命运行态时读取。 */
  public get maxHpBonus(): number {
    return this.maxHpBonusValue;
  }

  /** 当前发射间隔 = 基础冷却 × 累计倍率，且永不低于配置下限。 */
  public get swordCooldown(): number {
    return Math.max(this.minCooldown, this.baseCooldown * this.cooldownMultiplier);
  }

  public get swordProjectileCount(): number {
    return this.projectileCount;
  }

  /** 诊断用：当前累计冷却倍率。 */
  public get currentCooldownMultiplier(): number {
    return this.cooldownMultiplier;
  }

  public addSwordDamage(value: number): void {
    if (!(value > 0)) {
      return;
    }
    this.baseDamage += value;
  }

  /** 注入局外 maxHp 加成（一次性；负数/0 忽略，重复注入会累加，调用方保证只调一次）。 */
  public addMaxHpBonus(value: number): void {
    if (!(value > 0)) {
      return;
    }
    this.maxHpBonusValue += value;
  }

  public multiplySwordCooldown(factor: number): void {
    if (!(factor > 0)) {
      return;
    }
    this.cooldownMultiplier *= factor;
  }

  public addSwordCount(value: number): void {
    if (!(value > 0)) {
      return;
    }
    this.projectileCount = Math.min(this.maxProjectileCount, this.projectileCount + value);
  }

  /** 护体罡气：每层按 (1 - value) 连乘接触伤害系数，永不到 0。 */
  public addContactDamageReduction(value: number): void {
    if (!(value > 0) || value >= 1) {
      return;
    }
    this.contactDamageMultiplier *= 1 - value;
  }

  /** 接触伤害减免后的实际结算值（下取整，系数下限 0.1 防完全免疫）。 */
  public reduceContactDamage(amount: number): number {
    const multiplier = Math.max(0.1, this.contactDamageMultiplier);
    return Math.floor(amount * multiplier);
  }

  /** 诊断用：当前接触伤害系数。 */
  public get currentContactDamageMultiplier(): number {
    return this.contactDamageMultiplier;
  }
}
