import assert from 'node:assert/strict';
import test from 'node:test';

import { EconomyService } from '../assets/scripts/economy/Economy.ts';
import { addAccountXp } from '../assets/scripts/account/PlayerLeveling.ts';
import {
  applyAchievementEvent,
  claimAchievementTier,
  getAchievementView,
  listAchievementViews,
} from '../assets/scripts/account/AchievementSystem.ts';

function makeTables() {
  return {
    playerLevel: { levelCurve: [{ level: 1, requiredXp: 60 }, { level: 2, requiredXp: 80 }] },
    achievements: [
      {
        id: 'ach_kill',
        displayName: '斩妖',
        description: '击杀',
        condition: { kind: 'killCount' },
        tiers: [
          { target: 100, reward: { accountXp: 20, resources: { res_lingyu: 10 } } },
          { target: 1000, reward: { accountXp: 60, resources: { res_lingyu: 30 } } },
        ],
        hidden: false,
      },
      {
        id: 'ach_spend',
        displayName: '挥金',
        description: '消耗灵石',
        condition: { kind: 'spendResource', resourceId: 'res_lingshi' },
        tiers: [{ target: 500, reward: { accountXp: 0, resources: { res_lingyu: 10 } } }],
        hidden: false,
      },
      {
        id: 'ach_secret',
        displayName: '？？？',
        description: '隐藏成就',
        condition: { kind: 'clearCount' },
        tiers: [{ target: 30, reward: { accountXp: 100, resources: { res_lingyu: 50 } } }],
        hidden: true,
      },
    ],
  };
}

function makeState() {
  return {
    playerLevel: 1,
    playerXp: 0,
    achievements: {},
    balances: {},
    recentTransactions: [],
  };
}

function makeEconomy() {
  return new EconomyService(
    [{ id: 'res_lingyu', displayName: '灵玉', capacity: 9999 }],
    { txLogCapacity: 20 },
  );
}

test('achievement progress accumulates per event, caps at the final tier and never regresses', () => {
  const tables = makeTables();
  const state = makeState();

  applyAchievementEvent(state, tables, 'killCount', 600, null);
  assert.equal(getAchievementView(state, tables, 'ach_kill').progress, 600);
  applyAchievementEvent(state, tables, 'killCount', 9999, null);
  assert.equal(getAchievementView(state, tables, 'ach_kill').progress, 1000, 'capped at final tier target');

  // 条件不匹配的资源事件不影响。
  applyAchievementEvent(state, tables, 'spendResource', 999, 'res_xiuwei');
  assert.equal(getAchievementView(state, tables, 'ach_spend').progress, 0);
  applyAchievementEvent(state, tables, 'spendResource', 999, 'res_lingshi');
  assert.equal(getAchievementView(state, tables, 'ach_spend').progress, 500, 'capped at tier 1 target');
});

test('tiered claims are one per tier and completion never regresses with config shrink', () => {
  const tables = makeTables();
  const state = makeState();
  const economy = makeEconomy();

  applyAchievementEvent(state, tables, 'killCount', 100, null);
  const view = getAchievementView(state, tables, 'ach_kill');
  assert.equal(view.currentTierIndex, 0, 'current tier is the first unclaimed one');
  assert.equal(view.claimable, true);

  const claimed = claimAchievementTier(state, tables, economy, { addAccountXp }, 'ach_kill', { txId: 'a1', at: 1 });
  assert.equal(claimed.ok, true);
  assert.equal(claimed.tierIndex, 0);
  assert.equal(economy.getBalance(state, 'res_lingyu'), 10, 'lingyu granted via economy transaction');
  assert.equal(state.playerXp, 20);
  assert.equal(state.achievements.ach_kill.claimedTier, 1);
  assert.equal(state.recentTransactions[0].kind, 'achievement_reward');

  // 进度 100 < 第 2 档 1000：下一档未达成不可领。
  const next = claimAchievementTier(state, tables, economy, { addAccountXp }, 'ach_kill', { txId: 'a2', at: 2 });
  assert.equal(next.ok, false);
  assert.equal(next.reason, 'tier_not_reached');

  // 历史进度与领取状态保留（重复累计/重放事件不回退）。
  applyAchievementEvent(state, tables, 'killCount', 100, null);
  assert.equal(state.achievements.ach_kill.claimedTier, 1);
  assert.equal(getAchievementView(state, tables, 'ach_kill').claimedTier, 1);
});

test('hidden achievements stay invisible until the first tier target is reached', () => {
  const tables = makeTables();
  const state = makeState();

  assert.equal(listAchievementViews(state, tables).some((view) => view.id === 'ach_secret'), false,
    'hidden achievement not listed before unlock');
  assert.equal(getAchievementView(state, tables, 'ach_secret').visible, false);

  applyAchievementEvent(state, tables, 'clearCount', 5, null);
  assert.equal(getAchievementView(state, tables, 'ach_secret').visible, false, 'below first tier target');

  applyAchievementEvent(state, tables, 'clearCount', 30, null);
  const view = getAchievementView(state, tables, 'ach_secret');
  assert.equal(view.visible, true, 'visible once first tier reached');
  assert.equal(view.claimable, true);
});

test('claims are rejected for unknown ids and exhausted tiers without side effects', () => {
  const tables = makeTables();
  const state = makeState();
  const economy = makeEconomy();

  assert.equal(claimAchievementTier(state, tables, economy, { addAccountXp }, 'ach_ghost', { txId: 'x', at: 0 }).reason, 'unknown_achievement');

  applyAchievementEvent(state, tables, 'spendResource', 500, 'res_lingshi');
  assert.equal(claimAchievementTier(state, tables, economy, { addAccountXp }, 'ach_spend', { txId: 'y1', at: 1 }).ok, true);
  const exhausted = claimAchievementTier(state, tables, economy, { addAccountXp }, 'ach_spend', { txId: 'y2', at: 2 });
  assert.equal(exhausted.reason, 'all_claimed');
  assert.equal(economy.getBalance(state, 'res_lingyu'), 10, 'no double grant');
});
