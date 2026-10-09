import assert from 'node:assert/strict';
import test from 'node:test';

import { EconomyService } from '../assets/scripts/economy/Economy.ts';
import { addAccountXp } from '../assets/scripts/account/PlayerLeveling.ts';
import {
  TASK_MAIN_PERIOD_KEY,
} from '../assets/scripts/account/AccountSave.ts';
import {
  applyBattleStatsToTasks,
  applyTaskEvent,
  applyTaskSpend,
  claimTaskReward,
  currentPeriodKey,
  getTaskProgress,
  isTaskClaimable,
} from '../assets/scripts/account/TaskSystem.ts';

const DAY_1 = '2026-10-04';
const DAY_2 = '2026-10-05';
const WEEK_1 = '2026-09-28';
const WEEK_2 = '2026-10-05';

function makeTables() {
  return {
    playerLevel: { levelCurve: [{ level: 1, requiredXp: 60 }, { level: 2, requiredXp: 80 }] },
    tasks: [
      { id: 'main_01', displayName: 'm1', description: '', period: 'main', condition: { kind: 'killCount', target: 20 }, reward: { accountXp: 20, resources: { res_lingshi: 80 } }, prerequisiteTaskId: null },
      { id: 'main_02', displayName: 'm2', description: '', period: 'main', condition: { kind: 'levelUpCount', target: 3 }, reward: { accountXp: 10, resources: {} }, prerequisiteTaskId: 'main_01' },
      { id: 'daily_kill', displayName: 'd1', description: '', period: 'daily', condition: { kind: 'killCount', target: 60 }, reward: { accountXp: 0, resources: { res_xiuwei: 20 } }, prerequisiteTaskId: null },
      { id: 'weekly_clear', displayName: 'w1', description: '', period: 'weekly', condition: { kind: 'clearCount', target: 8 }, reward: { accountXp: 0, resources: { res_lingshi: 300 } }, prerequisiteTaskId: null },
      { id: 'weekly_spend', displayName: 'w2', description: '', period: 'weekly', condition: { kind: 'spendResource', resourceId: 'res_lingshi', target: 1500 }, reward: { accountXp: 0, resources: { res_yaodan: 3 } }, prerequisiteTaskId: null },
    ],
  };
}

function makeState() {
  return {
    playerLevel: 1,
    playerXp: 0,
    taskBuckets: {
      main: { periodKey: 'main', progress: {}, claimedTaskIds: [] },
      daily: { periodKey: DAY_1, progress: {}, claimedTaskIds: [] },
      weekly: { periodKey: WEEK_1, progress: {}, claimedTaskIds: [] },
    },
    balances: {},
    recentTransactions: [],
  };
}

function makeEconomy() {
  return new EconomyService(
    [
      { id: 'res_lingshi', displayName: '灵石', capacity: 9999 },
      { id: 'res_xiuwei', displayName: '修为', capacity: 9999 },
      { id: 'res_yaodan', displayName: '妖丹', capacity: 9999 },
    ],
    { txLogCapacity: 20 },
  );
}

const KEYS_1 = { dayKey: DAY_1, weekKey: WEEK_1 };

test('currentPeriodKey maps main to the stable main key (cross-checked with save schema)', () => {
  assert.equal(currentPeriodKey('main', KEYS_1), TASK_MAIN_PERIOD_KEY);
  assert.equal(currentPeriodKey('daily', KEYS_1), DAY_1);
  assert.equal(currentPeriodKey('weekly', KEYS_1), WEEK_1);
});

test('progress accumulates per event and caps at the target without overflowing', () => {
  const tables = makeTables();
  const state = makeState();

  applyTaskEvent(state, tables, 'killCount', 15, KEYS_1);
  applyTaskEvent(state, tables, 'killCount', 15, KEYS_1);
  assert.equal(getTaskProgress(state, tables, 'main_01', KEYS_1).progress, 20, 'capped at target');
  assert.equal(isTaskClaimable(state, tables, 'main_01', KEYS_1), true);

  // 零/负增量被忽略（幂等防护的调用侧约定）。
  applyTaskEvent(state, tables, 'killCount', 0, KEYS_1);
  assert.equal(getTaskProgress(state, tables, 'main_01', KEYS_1).progress, 20);
});

test('prerequisite must be claimed before its successor accumulates progress', () => {
  const tables = makeTables();
  const state = makeState();

  applyTaskEvent(state, tables, 'levelUpCount', 5, KEYS_1);
  assert.equal(getTaskProgress(state, tables, 'main_02', KEYS_1).progress, 0, 'locked behind main_01');

  applyTaskEvent(state, tables, 'killCount', 20, KEYS_1);
  claimTaskReward(state, tables, makeEconomy(), { addAccountXp }, 'main_01', KEYS_1, { txId: 't1', at: 1 });
  applyTaskEvent(state, tables, 'levelUpCount', 2, KEYS_1);
  assert.equal(getTaskProgress(state, tables, 'main_02', KEYS_1).progress, 2, 'unlocked after prerequisite claimed');
});

test('daily and weekly buckets reset when the period key changes', () => {
  const tables = makeTables();
  const state = makeState();

  applyTaskEvent(state, tables, 'killCount', 30, KEYS_1);
  assert.equal(getTaskProgress(state, tables, 'daily_kill', KEYS_1).progress, 30);

  // 跨日：进度清零、可领态消失。
  const keysDay2 = { dayKey: DAY_2, weekKey: WEEK_1 };
  assert.equal(getTaskProgress(state, tables, 'daily_kill', keysDay2).progress, 0);
  applyTaskEvent(state, tables, 'killCount', 10, keysDay2);
  assert.equal(getTaskProgress(state, tables, 'daily_kill', keysDay2).progress, 10);
  assert.equal(state.taskBuckets.daily.periodKey, DAY_2);

  // 跨周：周桶重置（周日 → 周一）。
  applyTaskEvent(state, tables, 'clearCount', 3, KEYS_1);
  const keysWeek2 = { dayKey: DAY_2, weekKey: WEEK_2 };
  assert.equal(getTaskProgress(state, tables, 'weekly_clear', keysWeek2).progress, 0);
});

test('claiming a task grants resources via the economy and records the claim once', () => {
  const tables = makeTables();
  const state = makeState();
  const economy = makeEconomy();

  applyTaskEvent(state, tables, 'killCount', 20, KEYS_1);
  const early = claimTaskReward(state, tables, economy, { addAccountXp }, 'daily_kill', KEYS_1, { txId: 't0', at: 0 });
  assert.equal(early.ok, false, 'incomplete task cannot be claimed');

  const claimed = claimTaskReward(state, tables, economy, { addAccountXp }, 'main_01', KEYS_1, { txId: 't1', at: 1 });
  assert.equal(claimed.ok, true);
  assert.equal(claimed.accountXp, 20);
  assert.equal(claimed.resources.res_lingshi, 80);
  assert.equal(economy.getBalance(state, 'res_lingshi'), 80);
  assert.equal(state.playerXp, 20);
  assert.deepEqual(state.taskBuckets.main.claimedTaskIds, ['main_01']);
  assert.equal(state.recentTransactions[0].kind, 'task_reward');

  const repeat = claimTaskReward(state, tables, economy, { addAccountXp }, 'main_01', KEYS_1, { txId: 't2', at: 2 });
  assert.equal(repeat.ok, false);
  assert.equal(repeat.reason, 'already_claimed');
  assert.equal(economy.getBalance(state, 'res_lingshi'), 80, 'repeat claim leaves balances untouched');

  // 已领取的前置解锁后继任务（前置链消费 claimedTaskIds）。
  assert.equal(isTaskClaimable(state, tables, 'main_01', KEYS_1), false, 'claimed task is no longer claimable');
});

test('spend tasks track resource consumption by resource id', () => {
  const tables = makeTables();
  const state = makeState();

  applyTaskSpend(state, tables, 'res_xiuwei', 500, KEYS_1);
  assert.equal(getTaskProgress(state, tables, 'weekly_spend', KEYS_1).progress, 0, 'other resources do not count');

  applyTaskSpend(state, tables, 'res_lingshi', 1000, KEYS_1);
  applyTaskSpend(state, tables, 'res_lingshi', 600, KEYS_1);
  assert.equal(getTaskProgress(state, tables, 'weekly_spend', KEYS_1).progress, 1500);
  assert.equal(isTaskClaimable(state, tables, 'weekly_spend', KEYS_1), true);
});

test('applyBattleStatsToTasks maps battleFinished stats to all four condition kinds', () => {
  const tables = makeTables();
  const state = makeState();

  const changed = applyBattleStatsToTasks(
    state, tables,
    { result: 'victory', killCount: 25, xpCollected: 40, levelReached: 4 },
    KEYS_1,
  );

  assert.equal(getTaskProgress(state, tables, 'main_01', KEYS_1).progress, 20, 'killCount applied');
  assert.ok(getTaskProgress(state, tables, 'daily_kill', KEYS_1).progress >= 25);
  assert.equal(isTaskClaimable(state, tables, 'daily_xp_placeholder', KEYS_1), false);
  assert.equal(getTaskProgress(state, tables, 'daily_kill', KEYS_1).progress, 25);
  assert.equal(getTaskProgress(state, tables, 'weekly_clear', KEYS_1).progress, 1, 'victory counts as one clear');
  assert.ok(changed.length > 0);
});
