import assert from 'node:assert/strict';
import test from 'node:test';

import { EconomyService } from '../assets/scripts/economy/Economy.ts';
import { addAccountXp } from '../assets/scripts/account/PlayerLeveling.ts';
import {
  advanceLoginDay,
  claimLoginReward,
  getClaimableTierIndex,
  isLoginRoundCompleted,
} from '../assets/scripts/account/LoginReward.ts';

const TABLES = {
  playerLevel: { levelCurve: [{ level: 1, requiredXp: 60 }, { level: 2, requiredXp: 80 }] },
  loginRewards: {
    totalDays: 30,
    tiers: Array.from({ length: 30 }, (_, index) => ({
      day: index + 1,
      reward: {
        accountXp: 5,
        resources: { res_lingshi: 50 + (index + 1) * 10, res_xiuwei: 20 + (index + 1) * 2 },
      },
    })),
  },
};

function makeState(totalDays = 0, lastCountedDayKey = '') {
  return {
    playerLevel: 1,
    playerXp: 0,
    loginReward: { totalDays, lastCountedDayKey, claimedTier: 0 },
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

test('same-day repeat logins advance at most once; missed days resume next day without reset', () => {
  const state = makeState();

  assert.equal(advanceLoginDay(state, '2026-10-01'), true);
  assert.equal(advanceLoginDay(state, '2026-10-01'), false, 'same day is idempotent');
  assert.equal(state.loginReward.totalDays, 1);
  assert.equal(advanceLoginDay(state, '2026-10-01'), false);

  // 漏登两天（10-02/10-03 未登录）：10-04 继续推进且不清零。
  assert.equal(advanceLoginDay(state, '2026-10-04'), true);
  assert.equal(state.loginReward.totalDays, 2, 'cumulative days never reset');

  // 不要求连续：跨月/任意间隔继续。
  assert.equal(advanceLoginDay(state, '2026-11-20'), true);
  assert.equal(state.loginReward.totalDays, 3);
});

test('claiming tiers requires cumulative days and grants via the economy', () => {
  const state = makeState();
  const economy = makeEconomy();

  assert.equal(getClaimableTierIndex(state, TABLES), null, 'nothing claimable at day 0');
  assert.equal(claimLoginReward(state, TABLES, economy, { addAccountXp }, { txId: 'l0', at: 0 }).reason, 'not_reached');

  advanceLoginDay(state, '2026-10-01');
  const claimable = getClaimableTierIndex(state, TABLES);
  assert.equal(claimable, 0, 'day 1 unlocks tier 1');
  const claimed = claimLoginReward(state, TABLES, economy, { addAccountXp }, { txId: 'l1', at: 1 });
  assert.equal(claimed.ok, true);
  assert.equal(claimed.tierDay, 1);
  assert.equal(claimed.completed, false);
  assert.equal(economy.getBalance(state, 'res_lingshi'), 60, 'tier 1 grants 50 + 1×10 lingshi');
  assert.equal(state.loginReward.claimedTier, 1);
  assert.equal(state.recentTransactions[0].kind, 'login_reward');

  const repeat = claimLoginReward(state, TABLES, economy, { addAccountXp }, { txId: 'l2', at: 2 });
  assert.equal(repeat.reason, 'not_reached', 'next tier needs day 2');
  assert.equal(economy.getBalance(state, 'res_lingshi'), 60, 'rejected claim leaves balances untouched');
});

test('the round completes after tier 30 and never loops', () => {
  const state = makeState();
  const economy = makeEconomy();

  // 推进 30 天（逐日 key，模拟完整一轮）。
  for (let day = 1; day <= 30; day += 1) {
    advanceLoginDay(state, `2026-10-${String(day).padStart(2, '0')}`);
  }
  assert.equal(state.loginReward.totalDays, 30);

  for (let tier = 0; tier < 30; tier += 1) {
    const outcome = claimLoginReward(state, TABLES, economy, { addAccountXp }, { txId: `l${tier}`, at: tier });
    assert.equal(outcome.ok, true);
  }
  assert.equal(isLoginRoundCompleted(state, TABLES), true, 'round completes after tier 30');
  assert.equal(getClaimableTierIndex(state, TABLES), null);

  // 第 31 天登录：天数继续累计，但本轮不循环、无可领。
  advanceLoginDay(state, '2026-11-01');
  assert.equal(state.loginReward.totalDays, 31);
  assert.equal(claimLoginReward(state, TABLES, economy, { addAccountXp }, { txId: 'l30', at: 30 }).reason, 'round_completed');
});
