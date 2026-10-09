import assert from 'node:assert/strict';
import test from 'node:test';

import { buildMonsterEffectiveStats } from '../assets/scripts/monster/EliteStats.ts';

const BASE = {
  id: 'monster_basic',
  prefabId: 'prefab_monster_basic',
  maxHp: 20,
  moveSpeed: 90,
  contactDamage: 2,
  xpValue: 1,
  collisionRadius: 24,
};

const MODIFIER = {
  hpMultiplier: 4,
  speedMultiplier: 0.85,
  contactDamageMultiplier: 2,
  xpMultiplier: 5,
  collisionRadiusMultiplier: 1.5,
};

test('non-elite monsters keep the base config untouched', () => {
  const stats = buildMonsterEffectiveStats(BASE, MODIFIER, false);

  assert.deepEqual(stats, {
    maxHp: 20,
    moveSpeed: 90,
    contactDamage: 2,
    xpValue: 1,
    collisionRadius: 24,
    isElite: false,
  });
});

test('elite monsters apply every multiplier with sane rounding', () => {
  const stats = buildMonsterEffectiveStats(BASE, MODIFIER, true);

  assert.deepEqual(stats, {
    maxHp: 80,
    moveSpeed: 76.5,
    contactDamage: 4,
    xpValue: 5,
    collisionRadius: 36,
    isElite: true,
  });
});

test('elite scaling never produces zero hp or xp', () => {
  const weak = { ...BASE, maxHp: 1, xpValue: 0 };

  const stats = buildMonsterEffectiveStats(weak, MODIFIER, true);

  assert.equal(stats.maxHp, 4);
  assert.equal(stats.xpValue, 1, 'xp floors at 1');
});

test('difficulty multipliers compose with the elite prefix (V08-03)', () => {
  const difficulty = { hp: 2.2, speed: 1.1, contactDamage: 1.5, xp: 1.6 };
  const normal = buildMonsterEffectiveStats(BASE, MODIFIER, false, difficulty);
  assert.deepEqual(normal, {
    maxHp: Math.round(20 * 2.2),
    moveSpeed: 90 * 1.1,
    contactDamage: Math.round(2 * 1.5),
    xpValue: Math.max(1, Math.round(1 * 1.6)),
    collisionRadius: 24,
    isElite: false,
  });

  const elite = buildMonsterEffectiveStats(BASE, MODIFIER, true, difficulty);
  assert.equal(elite.maxHp, Math.round(20 * 2.2 * 4));
  assert.equal(elite.xpValue, Math.max(1, Math.round(1 * 1.6 * 5)));
  assert.equal(elite.isElite, true);
});

test('without difficulty multipliers the legacy behaviour is bit-identical', () => {
  assert.deepEqual(buildMonsterEffectiveStats(BASE, MODIFIER, false), {
    maxHp: 20, moveSpeed: 90, contactDamage: 2, xpValue: 1, collisionRadius: 24, isElite: false,
  });
});
