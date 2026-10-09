import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WEAPON_LEVEL_UP_RESOURCE_ID,
  getWeaponDamageBonus,
  getWeaponLevel,
  getWeaponLevelCap,
  levelUpWeapon,
} from '../assets/scripts/account/WeaponGrowth.ts';
import { EconomyService } from '../assets/scripts/economy/Economy.ts';

const GROWTH_CONFIGS = [
  {
    weaponId: 'weapon_qingxiao_sword',
    maxLevel: 5,
    levelUpCosts: [80, 95, 112, 132],
    damagePerLevel: 2,
    ultimateIds: [],
  },
];

function makeEconomy() {
  return new EconomyService(
    [{ id: 'res_lingshi', displayName: '灵石', capacity: 9999 }],
    { txLogCapacity: 20 },
  );
}

/** 同一对象结构兼容 WeaponGrowthState / WeaponEconomyState / PlayerLevelState。 */
function makeSave({ lingshi = 0, playerLevel = 20, weaponLevels = {} } = {}) {
  return {
    playerLevel,
    weaponLevels: { ...weaponLevels },
    balances: { ...(lingshi > 0 ? { res_lingshi: lingshi } : {}) },
    recentTransactions: [],
  };
}

const QINGXIAO = 'weapon_qingxiao_sword';

test('unowned weapons read as level 1', () => {
  assert.equal(getWeaponLevel({ weaponLevels: {} }, QINGXIAO), 1);
  assert.equal(getWeaponLevel({ weaponLevels: { [QINGXIAO]: 3 } }, QINGXIAO), 3);
});

test('level cap is the smaller of config max and player level', () => {
  const growth = GROWTH_CONFIGS[0];
  assert.equal(getWeaponLevelCap(growth, 3), 3, 'player level 3 caps at 3');
  assert.equal(getWeaponLevelCap(growth, 20), 5, 'config max 5 caps at 5');
  assert.equal(getWeaponLevelCap(growth, 0), 1, 'defensive floor at level 1');
});

test('damage bonus is the per-level increment accumulated from level 1', () => {
  const growth = GROWTH_CONFIGS[0];
  assert.equal(getWeaponDamageBonus(growth, 1), 0);
  assert.equal(getWeaponDamageBonus(growth, 3), 4);
  assert.equal(getWeaponDamageBonus(growth, 5), 8);
});

test('level up spends the exact configured cost and advances one level', () => {
  const economy = makeEconomy();
  const save = makeSave({ lingshi: 100, playerLevel: 20 });

  const result = levelUpWeapon(
    save, save, save, GROWTH_CONFIGS, economy, QINGXIAO, { txId: 'tx-w1', at: 1000 },
  );

  assert.deepEqual(result, { ok: true, newLevel: 2 });
  assert.equal(save.weaponLevels[QINGXIAO], 2);
  assert.equal(save.balances.res_lingshi, 20);
  const entry = save.recentTransactions[0];
  assert.equal(entry.kind, 'weapon_level_up');
  assert.deepEqual(entry.deltas, { [WEAPON_LEVEL_UP_RESOURCE_ID]: -80 });
});

test('level up from an unowned weapon starts at level 1', () => {
  const economy = makeEconomy();
  const save = makeSave({ lingshi: 999, playerLevel: 20 });

  const result = levelUpWeapon(
    save, save, save, GROWTH_CONFIGS, economy, QINGXIAO, { txId: 'tx-w2', at: 1000 },
  );

  assert.deepEqual(result, { ok: true, newLevel: 2 });
});

test('insufficient lingshi is rejected through the economy and changes nothing', () => {
  const economy = makeEconomy();
  const save = makeSave({ lingshi: 10, playerLevel: 20 });

  const result = levelUpWeapon(
    save, save, save, GROWTH_CONFIGS, economy, QINGXIAO, { txId: 'tx-w3', at: 1000 },
  );

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'economy_rejected');
  assert.ok(result.detail.includes('res_lingshi'));
  assert.equal(save.weaponLevels[QINGXIAO], undefined);
  assert.equal(save.balances.res_lingshi, 10);
  assert.equal(save.recentTransactions.length, 0);
});

test('configured max level refuses further growth regardless of resources', () => {
  const economy = makeEconomy();
  const save = makeSave({ lingshi: 9999, playerLevel: 20, weaponLevels: { [QINGXIAO]: 5 } });

  const result = levelUpWeapon(
    save, save, save, GROWTH_CONFIGS, economy, QINGXIAO, { txId: 'tx-w4', at: 1000 },
  );

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'at_max_level');
  assert.equal(save.weaponLevels[QINGXIAO], 5);
  assert.equal(save.balances.res_lingshi, 9999, 'no economy transaction is attempted');
});

test('player level caps weapon growth with a distinct reason until the player levels up', () => {
  const economy = makeEconomy();
  const save = makeSave({ lingshi: 9999, playerLevel: 2, weaponLevels: { [QINGXIAO]: 2 } });

  const capped = levelUpWeapon(
    save, save, save, GROWTH_CONFIGS, economy, QINGXIAO, { txId: 'tx-w5', at: 1000 },
  );
  assert.equal(capped.ok, false);
  assert.equal(capped.reason, 'player_level_cap');
  assert.ok(capped.detail.includes('player level 2'));

  save.playerLevel = 3;
  const allowed = levelUpWeapon(
    save, save, save, GROWTH_CONFIGS, economy, QINGXIAO, { txId: 'tx-w6', at: 1001 },
  );
  assert.deepEqual(allowed, { ok: true, newLevel: 3 });
});

test('unknown weapon ids are rejected', () => {
  const economy = makeEconomy();
  const save = makeSave({ lingshi: 9999, playerLevel: 20 });

  const result = levelUpWeapon(
    save, save, save, GROWTH_CONFIGS, economy, 'weapon_missing', { txId: 'tx-w7', at: 1000 },
  );

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unknown_weapon');
  assert.ok(result.detail.includes('weapon_missing'));
});

test('economy-side invalid requests surface as economy rejections without mutation', () => {
  const economy = makeEconomy();
  const save = makeSave({ lingshi: 9999, playerLevel: 20 });

  const result = levelUpWeapon(
    save, save, save, GROWTH_CONFIGS, economy, QINGXIAO, { txId: '  ', at: 1000 },
  );

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'economy_rejected');
  assert.equal(save.weaponLevels[QINGXIAO], undefined);
  assert.equal(save.balances.res_lingshi, 9999);
});

test('sequential upgrades follow the cost curve level by level', () => {
  const economy = makeEconomy();
  const save = makeSave({ lingshi: 80 + 95 + 112, playerLevel: 20 });

  const levels = [];
  for (let i = 0; i < 3; i++) {
    const result = levelUpWeapon(
      save, save, save, GROWTH_CONFIGS, economy, QINGXIAO, { txId: `tx-seq-${i}`, at: 1000 + i },
    );
    assert.ok(result.ok);
    if (result.ok) {
      levels.push(result.newLevel);
    }
  }
  assert.deepEqual(levels, [2, 3, 4]);
  assert.equal(save.balances.res_lingshi, 0);
  assert.equal(save.recentTransactions.length, 3);
});
