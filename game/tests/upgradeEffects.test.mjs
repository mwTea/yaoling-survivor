import assert from 'node:assert/strict';
import test from 'node:test';

import { PlayerCombatStats } from '../assets/scripts/combat/PlayerCombatStats.ts';
import { UpgradeService } from '../assets/scripts/progression/UpgradeService.ts';

const WEAPON = {
  id: 'weapon_flying_sword',
  projectileId: 'projectile_flying_sword',
  baseDamage: 10,
  cooldown: 0.8,
  minCooldown: 0.2,
  projectileCount: 1,
  maxProjectileCount: 8,
  maxActiveProjectiles: 32,
  projectileSpreadDegrees: 10,
  attackRadius: 650,
  targetRetryInterval: 0.1,
};

const UPGRADES = [
  {
    id: 'sword_damage_up',
    title: '剑意精进',
    description: '飞剑伤害 +5',
    maxStacks: 8,
    weight: 1,
    effects: [{ kind: 'addSwordDamage', value: 5 }],
  },
  {
    id: 'sword_cooldown_down',
    title: '御剑疾行',
    description: '发射间隔降低 12%',
    maxStacks: 6,
    weight: 1,
    effects: [{ kind: 'multiplySwordCooldown', value: 0.88 }],
  },
  {
    id: 'sword_count_up',
    title: '分光化剑',
    description: '每轮飞剑数量 +1',
    maxStacks: 7,
    weight: 1,
    effects: [{ kind: 'addSwordCount', value: 1 }],
  },
];

test('combat stats start from weapon config and stack damage additively', () => {
  const stats = new PlayerCombatStats(WEAPON);

  assert.equal(stats.swordDamage, 10);
  assert.equal(stats.swordCooldown, 0.8);
  assert.equal(stats.swordProjectileCount, 1);

  stats.addSwordDamage(5);
  stats.addSwordDamage(5);
  assert.equal(stats.swordDamage, 20);
  stats.addSwordDamage(0);
  stats.addSwordDamage(-3);
  assert.equal(stats.swordDamage, 20, 'non-positive modifiers are ignored');
});

test('cooldown multiplier never goes below the configured minimum', () => {
  const stats = new PlayerCombatStats(WEAPON);

  for (let index = 0; index < 40; index += 1) {
    stats.multiplySwordCooldown(0.88);
  }
  assert.ok(stats.swordCooldown >= WEAPON.minCooldown, 'hard floor at minCooldown');
  assert.equal(stats.swordCooldown, WEAPON.minCooldown);
});

test('projectile count is capped at the configured maximum', () => {
  const stats = new PlayerCombatStats(WEAPON);

  for (let index = 0; index < 20; index += 1) {
    stats.addSwordCount(1);
  }
  assert.equal(stats.swordProjectileCount, WEAPON.maxProjectileCount);
});

test('upgrade service applies each effect kind and rejects unknown options', () => {
  const service = new UpgradeService(UPGRADES);
  const stats = new PlayerCombatStats(WEAPON);

  service.applyEffects(stats, 'sword_damage_up');
  assert.equal(stats.swordDamage, 15);

  service.applyEffects(stats, 'sword_cooldown_down');
  assert.ok(Math.abs(stats.swordCooldown - 0.8 * 0.88) < 1e-12);

  service.applyEffects(stats, 'sword_count_up');
  assert.equal(stats.swordProjectileCount, 2);

  assert.throws(() => service.applyEffects(stats, 'not_an_option'), /unknown optionId/);
});

test('stacking all cooldown upgrades respects the configured floor', () => {
  const service = new UpgradeService(UPGRADES);
  const stats = new PlayerCombatStats(WEAPON);

  for (let index = 0; index < UPGRADES[1].maxStacks; index += 1) {
    service.applyEffects(stats, 'sword_cooldown_down');
  }
  const afterMaxStacks = stats.swordCooldown;
  const expected = Math.max(WEAPON.minCooldown, 0.8 * Math.pow(0.88, UPGRADES[1].maxStacks));
  assert.ok(afterMaxStacks >= WEAPON.minCooldown);
  assert.ok(Math.abs(afterMaxStacks - expected) < 1e-9, `${afterMaxStacks} ≈ ${expected}`);
});
