import assert from 'node:assert/strict';
import test from 'node:test';

import {
  REALM_XIUWEI_RESOURCE_ID,
  autoPromoteSubRealms,
  confirmBreakthrough,
  getTotalRealmMaxHpBonus,
  previewBreakthrough,
  promoteSubRealm,
} from '../assets/scripts/account/RealmProgress.ts';
import { EconomyService } from '../assets/scripts/economy/Economy.ts';

// 三境小模型：A(3 层) → B(2 层) → C(1 层，末境)。
const REALMS = [
  {
    id: 'realm_a',
    displayName: '练气',
    subRealmCosts: [30, 40, 50],
    maxHpBonus: 0,
    breakthrough: { xiuweiCost: 100, materialId: 'res_yaodan', materialCost: 4, requiredPlayerLevel: 5 },
  },
  {
    id: 'realm_b',
    displayName: '筑基',
    subRealmCosts: [60, 70],
    maxHpBonus: 4,
    breakthrough: { xiuweiCost: 200, materialId: 'res_yaodan', materialCost: 8, requiredPlayerLevel: 10 },
  },
  { id: 'realm_c', displayName: '金丹', subRealmCosts: [80], maxHpBonus: 8, breakthrough: null },
];

function makeEconomy() {
  return new EconomyService(
    [
      { id: 'res_xiuwei', displayName: '修为', capacity: 9999 },
      { id: 'res_yaodan', displayName: '妖丹', capacity: 9999 },
    ],
    { txLogCapacity: 20 },
  );
}

/** 同一对象结构兼容 RealmState / RealmEconomyState / PlayerLevelState 三个切片。 */
function makeSave({ realmIndex = 0, subRealmIndex = 0, xiuwei = 0, yaodan = 0, playerLevel = 1 } = {}) {
  return {
    realmIndex,
    subRealmIndex,
    playerLevel,
    balances: {
      ...(xiuwei > 0 ? { res_xiuwei: xiuwei } : {}),
      ...(yaodan > 0 ? { res_yaodan: yaodan } : {}),
    },
    recentTransactions: [],
  };
}

function lastTx(save) {
  return save.recentTransactions[save.recentTransactions.length - 1];
}

test('sub-realm promotion consumes exact xiuwei via an economy transaction and advances', () => {
  const economy = makeEconomy();
  const save = makeSave({ xiuwei: 100 });

  const result = promoteSubRealm(save, save, REALMS, economy, { txId: 'tx-p1', at: 1000 });

  assert.ok(result.ok);
  assert.equal(save.subRealmIndex, 1);
  assert.equal(save.balances.res_xiuwei, 70);
  const entry = lastTx(save);
  assert.equal(entry.kind, 'realm_sub_realm_promote');
  assert.deepEqual(entry.deltas, { [REALM_XIUWEI_RESOURCE_ID]: -30 });
});

test('promotion with insufficient xiuwei is rejected and changes nothing', () => {
  const economy = makeEconomy();
  const save = makeSave({ xiuwei: 10 });

  const result = promoteSubRealm(save, save, REALMS, economy, { txId: 'tx-p2', at: 1000 });

  assert.deepEqual(
    { ok: result.ok, reason: result.ok ? null : result.reason },
    { ok: false, reason: 'economy_rejected' },
  );
  assert.equal(save.subRealmIndex, 0);
  assert.equal(save.balances.res_xiuwei, 10);
  assert.equal(save.recentTransactions.length, 0);
});

test('promotion is refused once the realm is perfected; breakthrough is the next step', () => {
  const economy = makeEconomy();
  const save = makeSave({ subRealmIndex: 3, xiuwei: 999 });

  const result = promoteSubRealm(save, save, REALMS, economy, { txId: 'tx-p3', at: 1000 });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'sub_realm_maxed');
  assert.equal(save.subRealmIndex, 3);
});

test('promotion with an out-of-range realm index is rejected', () => {
  const economy = makeEconomy();
  const save = makeSave({ realmIndex: 9, xiuwei: 999 });

  const result = promoteSubRealm(save, save, REALMS, economy, { txId: 'tx-p4', at: 1000 });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'invalid_realm_state');
});

test('auto promotion keeps advancing across layers until xiuwei runs short', () => {
  const economy = makeEconomy();
  const save = makeSave({ xiuwei: 100 });

  const outcome = autoPromoteSubRealms(save, save, REALMS, economy, { txId: 'auto', at: 1000 });

  assert.deepEqual(outcome, { promoted: 2, stoppedReason: 'economy_rejected' });
  assert.equal(save.subRealmIndex, 2, '30 + 40 spent, 30 left, next layer costs 50');
  assert.equal(save.balances.res_xiuwei, 30);
  assert.deepEqual(
    save.recentTransactions.map((entry) => entry.txId),
    ['auto#1', 'auto#2'],
    'each promotion gets a derived unique tx id',
  );
});

test('auto promotion stops at a perfected realm instead of looping forever', () => {
  const economy = makeEconomy();
  const save = makeSave({ xiuwei: 9999 });

  const outcome = autoPromoteSubRealms(save, save, REALMS, economy, { txId: 'auto', at: 1000 });

  assert.deepEqual(outcome, { promoted: 3, stoppedReason: 'sub_realm_maxed' });
  assert.equal(save.subRealmIndex, 3);
});

test('auto promotion reports invalid realm state without promoting', () => {
  const economy = makeEconomy();
  const save = makeSave({ realmIndex: 9, xiuwei: 9999 });

  const outcome = autoPromoteSubRealms(save, save, REALMS, economy, { txId: 'auto', at: 1000 });

  assert.deepEqual(outcome, { promoted: 0, stoppedReason: 'invalid_realm_state' });
});

test('breakthrough preview is null before the realm is perfected', () => {
  const economy = makeEconomy();
  const save = makeSave({ subRealmIndex: 2, xiuwei: 9999, yaodan: 99, playerLevel: 99 });

  assert.equal(previewBreakthrough(save, save, save, REALMS, economy), null);
});

test('breakthrough preview lists exact costs and cumulative hp bonus when eligible', () => {
  const economy = makeEconomy();
  const save = makeSave({ subRealmIndex: 3, xiuwei: 150, yaodan: 10, playerLevel: 6 });

  const preview = previewBreakthrough(save, save, save, REALMS, economy);

  assert.ok(preview);
  if (!preview) return;
  assert.equal(preview.realmId, 'realm_a');
  assert.equal(preview.nextRealmId, 'realm_b');
  assert.equal(preview.xiuweiCost, 100);
  assert.equal(preview.materialId, 'res_yaodan');
  assert.equal(preview.materialCost, 4);
  assert.equal(preview.xiuweiBalance, 150);
  assert.equal(preview.materialBalance, 10);
  assert.equal(preview.nextTotalMaxHpBonus, 4, 'realm_a 0 + realm_b 4');
  assert.deepEqual(preview.unmet, []);
  assert.equal(preview.canBreakthrough, true);
});

test('breakthrough preview reports stable unmet keys for each missing condition', () => {
  const economy = makeEconomy();

  const allMissing = makeSave({ subRealmIndex: 3, xiuwei: 0, yaodan: 0, playerLevel: 1 });
  assert.deepEqual(previewBreakthrough(allMissing, allMissing, allMissing, REALMS, economy).unmet, [
    'xiuwei',
    'material',
    'playerLevel',
  ]);

  const onlyMaterial = makeSave({ subRealmIndex: 3, xiuwei: 999, yaodan: 3, playerLevel: 99 });
  assert.deepEqual(previewBreakthrough(onlyMaterial, onlyMaterial, onlyMaterial, REALMS, economy).unmet, [
    'material',
  ]);

  const onlyLevel = makeSave({ subRealmIndex: 3, xiuwei: 999, yaodan: 99, playerLevel: 4 });
  assert.deepEqual(previewBreakthrough(onlyLevel, onlyLevel, onlyLevel, REALMS, economy).unmet, [
    'playerLevel',
  ]);
});

test('breakthrough preview is null at the final realm', () => {
  const economy = makeEconomy();
  const save = makeSave({ realmIndex: 2, subRealmIndex: 1, xiuwei: 9999, yaodan: 99, playerLevel: 99 });

  assert.equal(previewBreakthrough(save, save, save, REALMS, economy), null);
});

test('confirmed breakthrough spends xiuwei and material in one atomic transaction', () => {
  const economy = makeEconomy();
  const save = makeSave({ subRealmIndex: 3, xiuwei: 100, yaodan: 4, playerLevel: 5 });

  const result = confirmBreakthrough(save, save, save, REALMS, economy, { txId: 'tx-bt', at: 1000 });

  assert.ok(result.ok);
  assert.deepEqual(
    { newRealmIndex: result.newRealmIndex, newSubRealmIndex: result.newSubRealmIndex },
    { newRealmIndex: 1, newSubRealmIndex: 0 },
  );
  assert.deepEqual(save.balances, { res_xiuwei: 0, res_yaodan: 0 }, 'spent-down balances read as zero');
  const entry = lastTx(save);
  assert.equal(entry.kind, 'realm_breakthrough');
  assert.deepEqual(entry.deltas, { res_xiuwei: -100, res_yaodan: -4 });
});

test('confirmed breakthrough without material is rejected and spends nothing', () => {
  const economy = makeEconomy();
  const save = makeSave({ subRealmIndex: 3, xiuwei: 100, yaodan: 3, playerLevel: 5 });

  const result = confirmBreakthrough(save, save, save, REALMS, economy, { txId: 'tx-bt', at: 1000 });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'condition_unmet');
  assert.ok(result.detail.includes('res_yaodan'));
  assert.equal(save.realmIndex, 0);
  assert.equal(save.balances.res_xiuwei, 100, 'xiuwei untouched when material falls short');
  assert.equal(save.recentTransactions.length, 0);
});

test('confirmed breakthrough below the player level gate is rejected', () => {
  const economy = makeEconomy();
  const save = makeSave({ subRealmIndex: 3, xiuwei: 100, yaodan: 4, playerLevel: 4 });

  const result = confirmBreakthrough(save, save, save, REALMS, economy, { txId: 'tx-bt', at: 1000 });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'condition_unmet');
  assert.equal(save.realmIndex, 0);
  assert.equal(save.recentTransactions.length, 0);
});

test('confirmed breakthrough requires a perfected realm first', () => {
  const economy = makeEconomy();
  const save = makeSave({ subRealmIndex: 2, xiuwei: 100, yaodan: 4, playerLevel: 5 });

  const result = confirmBreakthrough(save, save, save, REALMS, economy, { txId: 'tx-bt', at: 1000 });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'condition_unmet');
  assert.equal(save.realmIndex, 0);
});

test('confirmed breakthrough with insufficient xiuwei fails atomically through the economy', () => {
  const economy = makeEconomy();
  const save = makeSave({ subRealmIndex: 3, xiuwei: 50, yaodan: 4, playerLevel: 5 });

  const result = confirmBreakthrough(save, save, save, REALMS, economy, { txId: 'tx-bt', at: 1000 });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'economy_rejected');
  assert.deepEqual(save.balances, { res_xiuwei: 50, res_yaodan: 4 }, 'atomic spend leaves both untouched');
});

test('repeating a confirmed breakthrough is gated by the next realm conditions', () => {
  const economy = makeEconomy();
  const save = makeSave({ subRealmIndex: 3, xiuwei: 300, yaodan: 4, playerLevel: 5 });

  const first = confirmBreakthrough(save, save, save, REALMS, economy, { txId: 'tx-bt1', at: 1000 });
  assert.ok(first.ok);
  assert.equal(save.realmIndex, 1);

  const second = confirmBreakthrough(save, save, save, REALMS, economy, { txId: 'tx-bt2', at: 1001 });
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'condition_unmet', 'realm_b needs yaodan 8 / playerLevel 10');
  assert.equal(save.realmIndex, 1, 'no double breakthrough from a repeat call');
});

test('confirming at the final realm reports no breakthrough available', () => {
  const economy = makeEconomy();
  const save = makeSave({ realmIndex: 2, subRealmIndex: 1, xiuwei: 9999, yaodan: 99, playerLevel: 99 });

  const result = confirmBreakthrough(save, save, save, REALMS, economy, { txId: 'tx-bt', at: 1000 });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no_breakthrough_available');
});

test('total realm hp bonus is the sum of increments up to the current realm', () => {
  assert.equal(getTotalRealmMaxHpBonus(REALMS, 0), 0);
  assert.equal(getTotalRealmMaxHpBonus(REALMS, 1), 4);
  assert.equal(getTotalRealmMaxHpBonus(REALMS, 2), 12);
  assert.equal(getTotalRealmMaxHpBonus(REALMS, 9), 0, 'out-of-range reads as no bonus');
  assert.equal(getTotalRealmMaxHpBonus(REALMS, -1), 0);
});
