import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applySettlementBonus,
  canClaimDailyResource,
  canOfferSettlementBonus,
  claimDailyResource,
  computeSettlementTopUp,
  getAdDailyUses,
} from '../assets/scripts/account/AdRewards.ts';
import { normalizeAccountSave } from '../assets/scripts/account/AccountSave.ts';
import { EconomyService } from '../assets/scripts/economy/Economy.ts';
import { INITIAL_GAME_CONFIG } from '../assets/scripts/config/GameConfig.ts';
import { addAccountXp } from '../assets/scripts/account/PlayerLeveling.ts';

const BONUS = INITIAL_GAME_CONFIG.ads.settlementBonus;
const DAILY = INITIAL_GAME_CONFIG.ads.dailyResource;
const enabled = () => true;

/** 一关结算配置切片（测试夹具：与 GameConfig 同结构）。 */
const REWARD = {
  stageId: 'stage_mvp_01',
  accountXp: 30,
  resources: { res_lingshi: 100, res_xiuwei: 30 },
  defeatRatio: 0.5,
  abortRatio: 0.5,
};

function freshSave() {
  return normalizeAccountSave({ createdAt: 1_000, lastSavedAt: 1_000 });
}

function xpAdder() {
  return (state, amount) => addAccountXp(state, INITIAL_GAME_CONFIG.playerLevel, amount);
}

function makeEconomy() {
  return new EconomyService([{ id: 'res_lingshi', displayName: '灵石', capacity: 999_999 }, { id: 'res_xiuwei', displayName: '修为', capacity: 999_999 }], { txLogCapacity: 20 });
}

test('settlement top-up doubles victory rewards exactly once (floor per item)', () => {
  const topUp = computeSettlementTopUp(REWARD, 'victory', 1, BONUS);
  assert.deepEqual(topUp, { accountXp: 30, resources: { res_lingshi: 100, res_xiuwei: 30 } },
    'x2 top-up = the same amounts again');
});

test('settlement top-up on defeat follows the retained-ratio baseline', () => {
  // defeat 基础 = 50%：已发 floor(100×0.5)=50，翻倍线 floor(100×0.5×2)=100 → 补 50。
  const topUp = computeSettlementTopUp(REWARD, 'defeat', 1, BONUS);
  assert.deepEqual(topUp, { accountXp: 15, resources: { res_lingshi: 50, res_xiuwei: 15 } });
});

test('settlement top-up applies the difficulty multiplier on the doubled baseline', () => {
  const topUp = computeSettlementTopUp(REWARD, 'victory', 1.5, BONUS);
  // 已发 floor(100×1.5)=150；翻倍线 floor(100×1.5×2)=300；补差 150（经验同式 45→90 补 45）。
  assert.deepEqual(topUp, { accountXp: 45, resources: { res_lingshi: 150, res_xiuwei: 45 } });
});

test('settlement bonus gates: result offered, per-day limit, once per battle', () => {
  const save = freshSave();
  const DAY = '2026-10-05';
  assert.equal(canOfferSettlementBonus(save, BONUS, 'abort', DAY, false, enabled).ok, false, 'abort never offers');
  assert.equal(canOfferSettlementBonus(save, BONUS, 'victory', DAY, true, enabled).ok, false, 'already topped up this battle');
  assert.equal(canOfferSettlementBonus(save, BONUS, 'victory', DAY, false, () => false).ok, false, 'placement off');
  let check = canOfferSettlementBonus(save, BONUS, 'victory', DAY, false, enabled);
  assert.equal(check.ok, true);

  // 用满每日次数后拒绝。
  for (let i = 0; i < BONUS.maxPerDay; i += 1) {
    const economy = makeEconomy();
    applySettlementBonus(
      save,
      BONUS,
      { accountXp: 10, resources: { res_lingshi: 10 } },
      economy,
      xpAdder(),
      { txId: `t${i}`, at: i },
      DAY,
    );
  }
  check = canOfferSettlementBonus(save, BONUS, 'victory', DAY, false, enabled);
  assert.equal(check.ok, false);
  if (!check.ok) {
    assert.equal(check.reason, 'per_day_limit');
  }
  assert.equal(getAdDailyUses(save, BONUS.placementId, DAY), BONUS.maxPerDay, 'audit counts every granted use');
});

test('settlement bonus grants via economy tx and stamps audit once', () => {
  const save = freshSave();
  const economy = makeEconomy();
  const outcome = applySettlementBonus(
    save,
    BONUS,
    { accountXp: 30, resources: { res_lingshi: 100 } },
    economy,
    xpAdder(),
    { txId: 'tx-1', at: 42 },
    '2026-10-05',
  );
  assert.equal(outcome.ok, true);
  assert.equal(outcome.accountXp, 30);
  assert.equal(economy.getBalance(save, 'res_lingshi'), 100);
  assert.equal(save.playerXp, 30);
  const tx = save.recentTransactions[save.recentTransactions.length - 1];
  assert.equal(tx.kind, 'ad_settlement_bonus');
  assert.equal(getAdDailyUses(save, BONUS.placementId, '2026-10-05'), 1);
  // 空补差（翻倍无增益）为幂等 no-op：零资源零经验，仍记一次审计。
  const noGain = applySettlementBonus(save, BONUS, { accountXp: 0, resources: {} }, makeEconomy(), xpAdder(), { txId: 'tx-2', at: 43 }, '2026-10-05');
  assert.equal(noGain.ok, true);
  assert.equal(getAdDailyUses(save, BONUS.placementId, '2026-10-05'), 2);
});

test('daily resource gates: placement, per-day, cooldown anchored on last claim', () => {
  const save = freshSave();
  const DAY = '2026-10-05';
  const economy = makeEconomy();

  assert.equal(canClaimDailyResource(save, DAILY, DAY, 0, () => false).ok, false);
  let check = canClaimDailyResource(save, DAILY, DAY, 0, enabled);
  assert.equal(check.ok, true);

  // 第一次领取（t=600 分钟）：成功。
  const first = claimDailyResource(save, DAILY, economy, { txId: 'd1', at: 1 }, DAY, 600);
  assert.equal(first.ok, true);
  assert.equal(economy.getBalance(save, 'res_lingshi'), 150);

  // 冷却内（10 分钟）拒绝。
  check = canClaimDailyResource(save, DAILY, DAY, 600 + DAILY.cooldownMinutes - 1, enabled);
  assert.equal(check.ok, false);
  if (!check.ok) {
    assert.equal(check.reason, 'cooldown');
  }
  // 冷却期满 + 次数未满：可再领。
  check = canClaimDailyResource(save, DAILY, DAY, 600 + DAILY.cooldownMinutes, enabled);
  assert.equal(check.ok, true);
  claimDailyResource(save, DAILY, economy, { txId: 'd2', at: 2 }, DAY, 620);

  // 每日次数用满：拒绝。
  check = canClaimDailyResource(save, DAILY, DAY, 700, enabled);
  assert.equal(check.ok, false);
  if (!check.ok) {
    assert.equal(check.reason, 'per_day_limit');
  }
  assert.equal(economy.getBalance(save, 'res_lingshi'), 300);
  assert.equal(getAdDailyUses(save, DAILY.placementId, DAY), 2);
});

test('daily resource audit prunes previous days and does not collide with other placements', () => {
  const save = freshSave();
  const economy = makeEconomy();
  claimDailyResource(save, DAILY, economy, { txId: 'd1', at: 1 }, '2026-10-04', 600);
  claimDailyResource(save, DAILY, economy, { txId: 'd2', at: 2 }, '2026-10-05', 600);
  assert.equal(save.offerClaims[`ad_${DAILY.placementId}_2026-10-04`], undefined, 'old day pruned');
  save.offerClaims['ad_revive_2026-10-05'] = { claimCount: 5 };
  claimDailyResource(save, DAILY, economy, { txId: 'd3', at: 3 }, '2026-10-05', 620);
  assert.deepEqual(save.offerClaims['ad_revive_2026-10-05'], { claimCount: 5 }, 'other placement audit untouched');
});

test('initial ad config passes structural expectations', () => {
  assert.equal(BONUS.rewardMultiplier, 2);
  assert.deepEqual(BONUS.results, ['victory', 'defeat']);
  assert.equal(DAILY.resources['res_lingshi'] > 0, true);
  const ids = INITIAL_GAME_CONFIG.ads.placements.map((p) => p.id);
  assert.deepEqual(ids, ['ad_revive', 'ad_settlement', 'ad_daily', 'ad_reroll']);
});
