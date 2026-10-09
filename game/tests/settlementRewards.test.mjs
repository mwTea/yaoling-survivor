import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyStageRewards,
  computeStageRewards,
} from '../assets/scripts/account/SettlementRewards.ts';
import { addAccountXp } from '../assets/scripts/account/PlayerLeveling.ts';
import { autoPromoteSubRealms } from '../assets/scripts/account/RealmProgress.ts';
import { EconomyService } from '../assets/scripts/economy/Economy.ts';

const REWARD = {
  stageId: 'stage_mvp_01',
  accountXp: 30,
  resources: {
    res_lingshi: 100,
    res_xiuwei: 30,
    res_yaodan: 1,
    res_lingpo_qinglong: 2,
  },
  defeatRatio: 0.5,
  abortRatio: 0.5,
};

const TABLES = {
  playerLevel: { levelCurve: [
    { level: 1, requiredXp: 60 },
    { level: 2, requiredXp: 80 },
  ] },
  realms: [
    {
      id: 'realm_a',
      displayName: '练气',
      subRealmCosts: [30, 40],
      maxHpBonus: 0,
      breakthrough: null,
    },
  ],
};

function makeEconomy() {
  return new EconomyService(
    [
      { id: 'res_lingshi', displayName: '灵石', capacity: 9999 },
      { id: 'res_xiuwei', displayName: '修为', capacity: 9999 },
      { id: 'res_yaodan', displayName: '妖丹', capacity: 9999 },
      { id: 'res_lingpo_qinglong', displayName: '青龙灵魄', capacity: 9999 },
    ],
    { txLogCapacity: 20 },
  );
}

function makeSave({ playerLevel = 1, playerXp = 0, realmIndex = 0, subRealmIndex = 0 } = {}) {
  return {
    playerLevel,
    playerXp,
    realmIndex,
    subRealmIndex,
    balances: {},
    recentTransactions: [],
  };
}

function makeOps(economy) {
  return { addAccountXp, autoPromoteSubRealms, economy };
}

test('victory grants the full plan unchanged', () => {
  const plan = computeStageRewards(REWARD, 'victory');

  assert.deepEqual(plan, {
    result: 'victory',
    ratio: 1,
    accountXp: 30,
    resourceDeltas: { res_lingshi: 100, res_xiuwei: 30, res_yaodan: 1, res_lingpo_qinglong: 2 },
  });
});

test('defeat and abort apply their ratios with per-item floor', () => {
  const defeat = computeStageRewards(REWARD, 'defeat');
  assert.deepEqual(defeat, {
    result: 'defeat',
    ratio: 0.5,
    accountXp: 15,
    resourceDeltas: { res_lingshi: 50, res_xiuwei: 15, res_lingpo_qinglong: 1 },
  }, '妖丹 1×0.5 floors to 0 and is omitted');

  const abort = computeStageRewards(REWARD, 'abort');
  assert.deepEqual(abort.resourceDeltas, { res_lingshi: 50, res_xiuwei: 15, res_lingpo_qinglong: 1 });
  assert.equal(abort.accountXp, 15);
});

test('apply grants resources in one audited transaction then settles account xp', () => {
  const economy = makeEconomy();
  const save = makeSave();

  const outcome = applyStageRewards(
    save, TABLES, computeStageRewards(REWARD, 'victory'), makeOps(economy),
    { txId: 'tx-set-1', at: 1000 },
  );

  assert.equal(outcome.ok, true);
  assert.equal(outcome.accountXpGranted, 30);
  assert.equal(outcome.levelsGained, 0, '30 xp below the 60 threshold');
  assert.deepEqual(outcome.appliedResources, { res_lingshi: 100, res_xiuwei: 30, res_yaodan: 1, res_lingpo_qinglong: 2 });
  assert.deepEqual(outcome.lostToCap, {});
  assert.equal(save.playerXp, 30);
  const rewardTx = save.recentTransactions[0];
  assert.equal(rewardTx.kind, 'stage_reward_victory');
  assert.deepEqual(rewardTx.deltas, { res_lingshi: 100, res_xiuwei: 30, res_yaodan: 1, res_lingpo_qinglong: 2 });
  assert.equal(save.recentTransactions.length, 2, 'reward tx + one promotion tx (30 xiuwei affords layer 1)');
});

test('settlement xp crosses account levels with carry-over', () => {
  const economy = makeEconomy();
  const save = makeSave({ playerXp: 45 });

  const outcome = applyStageRewards(
    save, TABLES, computeStageRewards(REWARD, 'victory'), makeOps(economy),
    { txId: 'tx-set-2', at: 1000 },
  );

  assert.equal(outcome.levelsGained, 1);
  assert.equal(outcome.newLevel, 2);
  assert.equal(save.playerXp, 15, '45 + 30 - 60 = 15 carried into level 2');
});

test('xiuwei from the settlement auto-promotes sub-realms in the same settlement', () => {
  const economy = makeEconomy();
  const save = makeSave();

  const outcome = applyStageRewards(
    save, TABLES, computeStageRewards(REWARD, 'victory'), makeOps(economy),
    { txId: 'tx-set-3', at: 1000 },
  );

  assert.equal(outcome.subRealmPromotions, 1, '30 xiuwei granted affords exactly layer 1 (cost 30)');
  assert.equal(save.subRealmIndex, 1);
  assert.equal(save.balances.res_xiuwei, 0);
  const promoteTx = save.recentTransactions[1];
  assert.equal(promoteTx.kind, 'realm_sub_realm_promote');
  assert.equal(promoteTx.txId, 'tx-set-3#promote#1', 'promotion tx derives its id from the settlement');
});

test('a failed resource grant applies nothing and reports the failure', () => {
  const economy = new EconomyService(
    [{ id: 'res_lingshi', displayName: '灵石', capacity: 9999 }],
    { txLogCapacity: 20 },
  );
  const save = makeSave();

  const outcome = applyStageRewards(
    save, TABLES, computeStageRewards(REWARD, 'victory'), makeOps(economy),
    { txId: 'tx-set-4', at: 1000 },
  );

  assert.equal(outcome.ok, false);
  assert.ok(outcome.failureDetail.includes('unknown resource id'));
  assert.equal(outcome.accountXpGranted, 0, 'no xp is granted after a failed grant');
  assert.equal(save.playerXp, 0);
  assert.equal(save.recentTransactions.length, 0);
});

test('repeated settlement of the same plan is not applied twice per event consumer call', () => {
  const economy = makeEconomy();
  const save = makeSave();

  applyStageRewards(save, TABLES, computeStageRewards(REWARD, 'victory'), makeOps(economy), { txId: 'tx-a', at: 1000 });
  const balancesAfterFirst = { ...save.balances };

  const second = applyStageRewards(
    save, TABLES, computeStageRewards(REWARD, 'victory'), makeOps(economy), { txId: 'tx-b', at: 1001 },
  );

  assert.equal(second.ok, true, 'a distinct battleFinished event grants again (event-once is upstream)');
  assert.notDeepEqual(save.balances, balancesAfterFirst);
  assert.equal(second.levelsGained, 1, 'each published battleFinished carries its own grant');
  assert.equal(save.recentTransactions.filter((entry) => entry.kind.startsWith('stage_reward')).length, 2,
    'each settlement leaves exactly one reward transaction with its own source kind');
});

test('difficulty reward multiplier scales the victory plan and floors each item (V08-03)', () => {
  const plan = computeStageRewards(REWARD, 'victory', 1.6);

  assert.equal(plan.accountXp, Math.floor(30 * 1.6), '48');
  assert.deepEqual(plan.resourceDeltas, {
    res_lingshi: Math.floor(100 * 1.6),
    res_xiuwei: Math.floor(30 * 1.6),
    res_yaodan: Math.floor(1 * 1.6),
    res_lingpo_qinglong: Math.floor(2 * 1.6),
  });

  const nightmare = computeStageRewards(REWARD, 'defeat', 2.4);
  assert.equal(nightmare.accountXp, Math.floor(30 * 2.4 * 0.5));
  assert.equal(nightmare.resourceDeltas.res_yaodan, Math.floor(1 * 2.4 * 0.5), 'floor(1.2) = 1');

  assert.deepEqual(computeStageRewards(REWARD, 'victory'), computeStageRewards(REWARD, 'victory', 1),
    'default multiplier keeps the V0.5 plan');
});
