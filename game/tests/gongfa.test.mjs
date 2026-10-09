import assert from 'node:assert/strict';
import test from 'node:test';

import { PlayerCombatStats } from '../assets/scripts/combat/PlayerCombatStats.ts';
import { GongfaRuntime } from '../assets/scripts/progression/GongfaRuntime.ts';
import { ProgressionService } from '../assets/scripts/progression/ProgressionService.ts';

const WEAPON = {
  id: 'weapon_qingxiao_sword',
  displayName: '青霄剑',
  projectileId: 'projectile_qingxiao_sword',
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

const GONGFAS = [
  {
    id: 'gongfa_sword_qi',
    title: '剑气冲击',
    description: '每 3 秒放出穿透剑气，每层 +1 道',
    maxStacks: 5,
    weight: 1,
    effects: [{ kind: 'addSwordQi', value: 1, intervalSeconds: 3, damageFactor: 0.6 }],
  },
  {
    id: 'gongfa_ward',
    title: '护体罡气',
    description: '接触伤害每层减免 15%',
    maxStacks: 5,
    weight: 1,
    effects: [{ kind: 'contactDamageReduction', value: 0.15 }],
  },
];

const CURVE = [
  { level: 1, requiredXp: 5 },
  { level: 2, requiredXp: 5 },
  { level: 3, requiredXp: 5 },
];

class SequenceRandom {
  constructor(values = [0]) {
    this.values = values;
    this.index = 0;
  }
  next() {
    const value = this.values[this.index % this.values.length];
    this.index += 1;
    return value;
  }
}

test('gongfa stacks accumulate and derive the sword qi count', () => {
  const runtime = new GongfaRuntime(GONGFAS);
  const stats = new PlayerCombatStats(WEAPON);

  runtime.addStack('gongfa_sword_qi', stats);
  runtime.addStack('gongfa_sword_qi', stats);

  assert.equal(runtime.swordQiCount, 2);
  assert.equal(runtime.getStackCount('gongfa_sword_qi'), 2);
});

test('unknown gongfa ids are rejected', () => {
  const runtime = new GongfaRuntime(GONGFAS);
  const stats = new PlayerCombatStats(WEAPON);

  assert.throws(() => runtime.addStack('not_a_gongfa', stats), /unknown gongfa id/);
});

test('ward stacks multiply the contact damage multiplier with a hard floor', () => {
  const runtime = new GongfaRuntime(GONGFAS);
  const stats = new PlayerCombatStats(WEAPON);

  runtime.addStack('gongfa_ward', stats);
  assert.equal(stats.reduceContactDamage(2), Math.floor(2 * 0.85));

  for (let index = 0; index < 15; index += 1) {
    runtime.addStack('gongfa_ward', stats);
  }
  assert.equal(stats.reduceContactDamage(100), 10, 'multiplier floors at 0.1, never full immunity');
  assert.equal(stats.currentContactDamageMultiplier < 0.1, true, 'raw multiplier keeps shrinking below the floor');
});

test('combined upgrade + gongfa pool serves non-duplicate reproducible candidates', () => {
  const upgrades = [
    { id: 'up_a', title: 'A', description: '', maxStacks: 8, weight: 1, effects: [] },
    { id: 'up_b', title: 'B', description: '', maxStacks: 8, weight: 1, effects: [] },
    { id: 'up_c', title: 'C', description: '', maxStacks: 8, weight: 1, effects: [] },
  ];
  const pool = [...upgrades, ...GONGFAS];
  const first = new ProgressionService(CURVE, pool, new SequenceRandom([0.1, 0.6, 0.3]));
  const second = new ProgressionService(CURVE, pool, new SequenceRandom([0.1, 0.6, 0.3]));

  first.addExperience(5);
  second.addExperience(5);

  const ids = first.currentChoice.optionIds;
  assert.equal(ids.length, 3);
  assert.equal(new Set(ids).size, 3);
  assert.deepEqual(second.currentChoice.optionIds, ids);
});

test('gongfa options can be served and resolved through the shared queue', () => {
  const upgrades = [
    { id: 'up_a', title: 'A', description: '', maxStacks: 8, weight: 1, effects: [] },
  ];
  const pool = [...upgrades, ...GONGFAS];
  const service = new ProgressionService(CURVE, pool, new SequenceRandom([0, 0, 0]));
  const runtime = new GongfaRuntime(GONGFAS);
  const stats = new PlayerCombatStats(WEAPON);

  service.addExperience(5);
  const choice = service.currentChoice;
  const gongfaId = choice.optionIds.find((id) => id.startsWith('gongfa_'));
  assert.ok(gongfaId, 'combined pool offers gongfa options');

  service.resolveLevelUp(gongfaId);
  runtime.addStack(gongfaId, stats);

  if (gongfaId === 'gongfa_sword_qi') {
    assert.equal(runtime.swordQiCount, 1);
  } else {
    assert.equal(stats.reduceContactDamage(2), Math.floor(2 * 0.85));
  }
});
