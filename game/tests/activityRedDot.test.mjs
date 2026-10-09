import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getActivityWindowStatus,
  isActivityEntryVisible,
  syncActivityInstances,
} from '../assets/scripts/account/ActivitySystem.ts';
import { RedDotService } from '../assets/scripts/ui/RedDotService.ts';

const TABLES = {
  activities: [
    { id: 'act_window', displayName: '限时活动', type: 'login', contentRef: 'loginRewards', featureFlag: 'login_reward', window: { startDayKey: '2026-10-01', endDayKey: '2026-10-31' } },
    { id: 'act_permanent', displayName: '永久活动', type: 'login', contentRef: 'loginRewards', featureFlag: 'login_reward', window: null },
    { id: 'act_flagged', displayName: '关闭活动', type: 'login', contentRef: 'loginRewards', featureFlag: 'not_a_flag', window: null },
  ],
};

const PROBES_FLAG_ON = {
  isFlagEnabled: (flag) => flag === 'login_reward',
  hasUnclaimed: () => true,
};

test('window status follows dayKey boundaries (open/not_started/ended)', () => {
  assert.equal(getActivityWindowStatus(TABLES, 'act_window', '2026-09-30'), 'not_started');
  assert.equal(getActivityWindowStatus(TABLES, 'act_window', '2026-10-01'), 'open');
  assert.equal(getActivityWindowStatus(TABLES, 'act_window', '2026-10-31'), 'open', 'end day inclusive');
  assert.equal(getActivityWindowStatus(TABLES, 'act_window', '2026-11-01'), 'ended');
  assert.equal(getActivityWindowStatus(TABLES, 'act_permanent', '2027-01-01'), 'open', 'null window is permanent');
  assert.equal(getActivityWindowStatus(TABLES, 'act_ghost', '2026-10-01'), 'unknown');
});

test('entry visibility gates on both the window and the feature flag', () => {
  assert.equal(isActivityEntryVisible(TABLES, 'act_window', '2026-10-05', PROBES_FLAG_ON), true);
  assert.equal(isActivityEntryVisible(TABLES, 'act_window', '2026-11-05', PROBES_FLAG_ON), false, 'outside window hidden');
  assert.equal(isActivityEntryVisible(TABLES, 'act_flagged', '2026-10-05', PROBES_FLAG_ON), false, 'flag off degrades to hidden');
});

test('instance sync records statuses and the closed-unclaimed marker once', () => {
  const state = { activities: {} };

  const opened = syncActivityInstances(state, TABLES, '2026-10-05', PROBES_FLAG_ON);
  assert.deepEqual(opened, ['act_window', 'act_permanent', 'act_flagged']);
  assert.equal(state.activities.act_window.status, 'open');
  assert.equal(state.activities.act_permanent.status, 'open');

  // 活动结束且内容有未领取：记 closed_unclaimed_handled。
  const closed = syncActivityInstances(state, TABLES, '2026-11-02', PROBES_FLAG_ON);
  assert.ok(closed.includes('act_window'));
  assert.equal(state.activities.act_window.status, 'closed_unclaimed_handled');

  // 幂等：已记录的处理标记不回退、不重复报告。
  const again = syncActivityInstances(state, TABLES, '2026-11-02', PROBES_FLAG_ON);
  assert.equal(state.activities.act_window.status, 'closed_unclaimed_handled');
  assert.equal(again.includes('act_window'), false);
});

test('red dot service recomputes providers on refresh and notifies subscribers', () => {
  const service = new RedDotService();
  let taskClaimable = false;
  let offerClaimable = false;
  service.registerSource('tasks', () => taskClaimable);
  service.registerSource('reward_center', () => taskClaimable || offerClaimable);

  let notifications = 0;
  const unsubscribe = service.onChange(() => {
    notifications += 1;
  });

  service.refresh();
  assert.equal(service.isLit('tasks'), false);
  assert.equal(service.isLit('reward_center'), false);

  taskClaimable = true;
  service.refresh();
  assert.equal(service.isLit('tasks'), true, 'lit after the underlying claimable query flips');
  assert.equal(service.isLit('reward_center'), true, 'aggregate dot follows its sources');
  assert.equal(service.isLit('unknown_dot'), false);
  assert.ok(notifications >= 2, 'subscribers are notified on each refresh');

  // 领取后（可领取查询翻转回 false）红点清除。
  taskClaimable = false;
  service.refresh();
  assert.equal(service.isLit('tasks'), false);

  unsubscribe();
  const before = notifications;
  service.refresh();
  assert.equal(notifications, before, 'unsubscribed listeners are not called');
});

test('a failing provider is treated as unlit without blocking other dots', () => {
  const service = new RedDotService();
  service.registerSource('broken', () => {
    throw new Error('boom');
  });
  service.registerSource('ok', () => true);

  service.refresh();
  assert.equal(service.isLit('broken'), false);
  assert.equal(service.isLit('ok'), true);
});
