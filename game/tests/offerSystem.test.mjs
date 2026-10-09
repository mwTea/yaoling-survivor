import assert from 'node:assert/strict';
import test from 'node:test';

import { EconomyService } from '../assets/scripts/economy/Economy.ts';
import { addAccountXp } from '../assets/scripts/account/PlayerLeveling.ts';
import {
  claimOffer,
  getOfferUnlockStatus,
  isOfferClaimable,
} from '../assets/scripts/account/OfferSystem.ts';
import { claimAllSequential } from '../assets/scripts/account/RewardCenter.ts';
import { buildStageRecordKey } from '../assets/scripts/account/AccountSave.ts';

const TABLES = {
  playerLevel: { levelCurve: [{ level: 1, requiredXp: 60 }, { level: 2, requiredXp: 80 }, { level: 3, requiredXp: 90 }] },
  chapters: [
    { id: 'chapter_a', displayName: '甲', stageIds: ['stage_a1', 'stage_a2'], requiredChapterId: null },
  ],
  offers: [
    {
      id: 'offer_lv2',
      displayName: '成长·二阶',
      description: '',
      contents: { accountXp: 0, resources: { res_lingshi: 200 } },
      priceType: 'free',
      price: 0,
      unlockCondition: { kind: 'playerLevel', level: 2 },
      purchaseLimit: 1,
      prerequisiteOfferId: null,
    },
    {
      id: 'offer_lv3',
      displayName: '成长·三阶',
      description: '',
      contents: { accountXp: 10, resources: {} },
      priceType: 'free',
      price: 0,
      unlockCondition: { kind: 'playerLevel', level: 3 },
      purchaseLimit: 1,
      prerequisiteOfferId: 'offer_lv2',
    },
    {
      id: 'offer_chapter',
      displayName: '章节礼包',
      description: '',
      contents: { accountXp: 0, resources: { res_xiuwei: 50 } },
      priceType: 'free',
      price: 0,
      unlockCondition: { kind: 'chapterClear', chapterId: 'chapter_a' },
      purchaseLimit: 1,
      prerequisiteOfferId: null,
    },
  ],
};

function makeState({ playerLevel = 1, realmIndex = 0, stageRecords = {} } = {}) {
  return {
    playerLevel,
    playerXp: 0,
    realmIndex,
    stageRecords,
    offerClaims: {},
    balances: {},
    recentTransactions: [],
  };
}

function makeEconomy() {
  return new EconomyService(
    [
      { id: 'res_lingshi', displayName: '灵石', capacity: 999999 },
      { id: 'res_xiuwei', displayName: '修为', capacity: 999999 },
    ],
    { txLogCapacity: 20 },
  );
}

test('offer unlock requires the condition and a claimed prerequisite', () => {
  const state = makeState({ playerLevel: 3 });

  assert.deepEqual(getOfferUnlockStatus(state, TABLES, 'offer_lv2'), { unlocked: true });
  assert.deepEqual(getOfferUnlockStatus(state, TABLES, 'offer_lv3'), { unlocked: false, reason: 'prerequisite_locked' });

  const claimed = makeState({ playerLevel: 3, stageRecords: {} });
  claimed.offerClaims.offer_lv2 = { claimCount: 1 };
  assert.deepEqual(getOfferUnlockStatus(claimed, TABLES, 'offer_lv3'), { unlocked: true });

  // 条件未达：等级不足 / 章节未全通关。
  assert.deepEqual(getOfferUnlockStatus(makeState({ playerLevel: 1 }), TABLES, 'offer_lv2'), { unlocked: false, reason: 'condition_unmet' });
  const partial = makeState({ stageRecords: { [buildStageRecordKey('stage_a1', 'diff_normal')]: { cleared: true } } });
  assert.deepEqual(getOfferUnlockStatus(partial, TABLES, 'offer_chapter'), { unlocked: false, reason: 'condition_unmet' });
  assert.equal(isOfferClaimable(partial, TABLES, 'offer_chapter'), false);
});

test('chapter clear requires every stage cleared on any difficulty', () => {
  const state = makeState({
    stageRecords: {
      [buildStageRecordKey('stage_a1', 'diff_hard')]: { cleared: true },
      [buildStageRecordKey('stage_a2', 'diff_normal')]: { cleared: true },
    },
  });
  assert.deepEqual(getOfferUnlockStatus(state, TABLES, 'offer_chapter'), { unlocked: true });
  assert.equal(isOfferClaimable(state, TABLES, 'offer_chapter'), true);
});

test('claiming grants via the economy once; repeats and unknown ids are rejected', () => {
  const state = makeState({ playerLevel: 2 });
  const economy = makeEconomy();

  const claimed = claimOffer(state, TABLES, economy, { addAccountXp }, 'offer_lv2', { txId: 'o1', at: 1 });
  assert.equal(claimed.ok, true);
  assert.equal(claimed.resources.res_lingshi, 200);
  assert.equal(economy.getBalance(state, 'res_lingshi'), 200);
  assert.equal(state.offerClaims.offer_lv2.claimCount, 1);
  assert.equal(state.recentTransactions[0].kind, 'offer_reward');

  const repeat = claimOffer(state, TABLES, economy, { addAccountXp }, 'offer_lv2', { txId: 'o2', at: 2 });
  assert.equal(repeat.reason, 'already_claimed');
  assert.equal(economy.getBalance(state, 'res_lingshi'), 200);

  assert.equal(claimOffer(state, TABLES, economy, { addAccountXp }, 'offer_ghost', { txId: 'o3', at: 3 }).reason, 'unknown_offer');
});

test('claimAllSequential continues past failures and reports each outcome', () => {
  const outcome = claimAllSequential([
    { id: 'a', title: 'A', claim: () => ({ ok: true }) },
    { id: 'b', title: 'B', claim: () => ({ ok: false, reason: 'not_completed' }) },
    { id: 'c', title: 'C', claim: () => ({ ok: true }) },
    { id: 'd', title: 'D', claim: () => { throw new Error('boom'); } },
  ]);

  assert.deepEqual(outcome.succeeded.map((entry) => entry.id), ['a', 'c'], 'failure does not block the rest');
  assert.deepEqual(outcome.failed, [
    { id: 'b', title: 'B', reason: 'not_completed' },
    { id: 'd', title: 'D', reason: 'Error: boom' },
  ]);
});
