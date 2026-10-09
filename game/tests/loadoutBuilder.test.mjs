import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EMPTY_BATTLE_LOADOUT,
  buildBattleLoadout,
} from '../assets/scripts/account/LoadoutBuilder.ts';
import { PlayerCombatStats } from '../assets/scripts/combat/PlayerCombatStats.ts';

// 配置表小模型：武器成长（青霄剑 + 假想法器）、两境、两兽。
const TABLES = {
  realms: [
    { id: 'realm_a', displayName: '练气', subRealmCosts: [30], maxHpBonus: 0, breakthrough: null },
    { id: 'realm_b', displayName: '筑基', subRealmCosts: [60], maxHpBonus: 4, breakthrough: null },
  ],
  weaponGrowth: [
    { weaponId: 'weapon_qingxiao_sword', maxLevel: 20, levelUpCosts: [80], damagePerLevel: 2, ultimateIds: [] },
    { weaponId: 'weapon_other', maxLevel: 10, levelUpCosts: [50], damagePerLevel: 3, ultimateIds: [] },
  ],
  beasts: [
    {
      id: 'beast_qinglong',
      displayName: '青龙',
      soulResourceId: 'res_lingpo_qinglong',
      unlockSoulCost: 0,
      levelUpCosts: [50],
      starUpCosts: [5],
      skill: { kind: 'damageNearest', intervalSeconds: 6, damage: 8, projectileCount: 1 },
      skillDescription: 'x',
    },
    {
      id: 'beast_baihu',
      displayName: '白虎',
      soulResourceId: 'res_lingpo_baihu',
      unlockSoulCost: 10,
      levelUpCosts: [50],
      starUpCosts: [5],
      skill: { kind: 'heal', intervalSeconds: 12, value: 3 },
      skillDescription: 'x',
    },
  ],
};

function makeState({ weaponLevels = {}, realmIndex = 0, beasts = {}, deployedBeastId = null } = {}) {
  return { weaponLevels, realmIndex, beasts, deployedBeastId };
}

test('empty account state yields the shared empty loadout', () => {
  assert.deepEqual(buildBattleLoadout(makeState(), TABLES), EMPTY_BATTLE_LOADOUT);
  assert.deepEqual(EMPTY_BATTLE_LOADOUT, { weaponDamageBonus: 0, maxHpBonus: 0, deployedBeast: null });
});

test('weapon damage bonus accumulates per level across growth entries', () => {
  const loadout = buildBattleLoadout(
    makeState({ weaponLevels: { weapon_qingxiao_sword: 4, weapon_other: 1 } }),
    TABLES,
  );
  assert.equal(loadout.weaponDamageBonus, 6, 'qingxiao 2×(4-1) + other 3×(1-1)');

  const both = buildBattleLoadout(
    makeState({ weaponLevels: { weapon_qingxiao_sword: 2, weapon_other: 3 } }),
    TABLES,
  );
  assert.equal(both.weaponDamageBonus, 8, '2×1 + 3×2');
});

test('malformed weapon level entries fall back to level 1 (no bonus)', () => {
  const loadout = buildBattleLoadout(
    makeState({ weaponLevels: { weapon_qingxiao_sword: -3, weapon_other: 2.9 } }),
    TABLES,
  );
  assert.equal(loadout.weaponDamageBonus, 3, 'invalid → level 1 (0 bonus); 2.9 floors to level 2 → 3×1');
});

test('realm hp bonus is the sum of increments up to the owned realm', () => {
  assert.equal(buildBattleLoadout(makeState({ realmIndex: 0 }), TABLES).maxHpBonus, 0);
  assert.equal(buildBattleLoadout(makeState({ realmIndex: 1 }), TABLES).maxHpBonus, 4);
});

test('realm index beyond the config table keeps owned bonuses without crashing', () => {
  const loadout = buildBattleLoadout(makeState({ realmIndex: 9 }), TABLES);
  assert.equal(loadout.maxHpBonus, 4, 'clamped to the last realm, owned state preserved');
  assert.equal(buildBattleLoadout(makeState({ realmIndex: -1 }), TABLES).maxHpBonus, 0);
});

test('deployed default-unlocked beast carries its skill without a save entry', () => {
  const loadout = buildBattleLoadout(makeState({ deployedBeastId: 'beast_qinglong' }), TABLES);
  assert.deepEqual(loadout.deployedBeast, {
    beastId: 'beast_qinglong',
    skill: { kind: 'damageNearest', intervalSeconds: 6, damage: 8, projectileCount: 1 },
  });
});

test('locked, unset and unknown deployed beasts resolve to null', () => {
  const locked = buildBattleLoadout(
    makeState({ deployedBeastId: 'beast_baihu' }),
    TABLES,
  );
  assert.equal(locked.deployedBeast, null, 'default-locked beast without an unlock entry cannot deploy');

  const explicitLocked = buildBattleLoadout(
    makeState({ deployedBeastId: 'beast_baihu', beasts: { beast_baihu: { unlocked: false, level: 1, star: 0 } } }),
    TABLES,
  );
  assert.equal(explicitLocked.deployedBeast, null);

  const unset = buildBattleLoadout(makeState({ deployedBeastId: null }), TABLES);
  assert.equal(unset.deployedBeast, null);

  const unknown = buildBattleLoadout(makeState({ deployedBeastId: 'beast_missing' }), TABLES);
  assert.equal(unknown.deployedBeast, null);
});

test('unlocked deployed beast carries its skill from the save entry', () => {
  const loadout = buildBattleLoadout(
    makeState({
      deployedBeastId: 'beast_baihu',
      beasts: { beast_baihu: { unlocked: true, level: 2, star: 1 } },
    }),
    TABLES,
  );
  assert.deepEqual(loadout.deployedBeast, {
    beastId: 'beast_baihu',
    skill: { kind: 'heal', intervalSeconds: 12, value: 3 },
  });
});

test('loadout injections land on PlayerCombatStats additively and once', () => {
  const weaponConfig = {
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
  const stats = new PlayerCombatStats(weaponConfig);
  assert.equal(stats.maxHpBonus, 0, 'no loadout, no bonus');

  stats.addSwordDamage(6);
  stats.addMaxHpBonus(4);
  assert.equal(stats.swordDamage, 16);
  assert.equal(stats.maxHpBonus, 4);

  stats.addMaxHpBonus(-3);
  stats.addMaxHpBonus(0);
  assert.equal(stats.maxHpBonus, 4, 'non-positive injections are ignored');
});
