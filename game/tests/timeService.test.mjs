import assert from 'node:assert/strict';
import test from 'node:test';

import { TimeService } from '../assets/scripts/platform/TimeService.ts';

test('now() returns the injected clock value', () => {
  let current = 1_000;
  const time = new TimeService(() => current);
  assert.equal(time.now(), 1_000);
  current = 2_000;
  assert.equal(time.now(), 2_000);
});

test('dayKey formats the local calendar day and flips at local midnight', () => {
  const time = new TimeService(() => 0);
  // 用本地时区构造固定时刻，任何 TZ 下结果一致。
  const beforeMidnight = new Date(2026, 9, 4, 23, 59, 59, 999).getTime();
  const atMidnight = new Date(2026, 9, 5, 0, 0, 0, 0).getTime();

  assert.equal(time.dayKey(beforeMidnight), '2026-10-04');
  assert.equal(time.dayKey(atMidnight), '2026-10-05', 'day key flips at local midnight');
  assert.equal(time.dayKey(new Date(2026, 0, 1, 12).getTime()), '2026-01-01');
});

test('weekKey returns the Monday key of the local natural week', () => {
  const time = new TimeService(() => 0);

  // 2026-10-04 是周日：本周一为 2026-09-28。
  const sunday = new Date(2026, 9, 4, 12).getTime();
  assert.equal(time.weekKey(sunday), '2026-09-28');
  // 周一当天 00:00 即翻到新一周。
  const mondayMorning = new Date(2026, 9, 5, 0, 0, 0).getTime();
  assert.equal(time.weekKey(mondayMorning), '2026-10-05');
  // 周内任意时刻同 key。
  const wednesday = new Date(2026, 9, 7, 18).getTime();
  assert.equal(time.weekKey(wednesday), '2026-10-05');
});

test('dayKey and weekKey agree on the injected clock for period resets', () => {
  let current = new Date(2026, 9, 4, 22).getTime();
  const time = new TimeService(() => current);

  const dayBefore = time.dayKey();
  const weekBefore = time.weekKey();
  // 跨过本地午夜（次日周一 00:01）。
  current = new Date(2026, 9, 5, 0, 1).getTime();

  assert.notEqual(time.dayKey(), dayBefore, 'daily bucket resets across midnight');
  assert.notEqual(time.weekKey(), weekBefore, 'weekly bucket resets on Monday');
});


test('syncWithServer anchors time to the server and keeps output monotonic (V10-08)', () => {
  let local = 1_000_000;
  const time = new TimeService(() => local);
  assert.equal(time.timeStatus, 'local');

  time.syncWithServer(2_000_000);
  assert.equal(time.timeStatus, 'synced');
  assert.equal(time.now(), 2_000_000, 'server value is the new anchor');
  assert.equal(time.serverOffsetMs, 1_000_000);

  local += 5_000;
  assert.equal(time.now(), 2_005_000, 'offset applies to advancing local clock');

  // 输出单调：本地时钟微抖（回退 200ms < 阈值）被钳制。
  local -= 200;
  assert.equal(time.now(), 2_005_000);
});

test('obvious device clock rollback freezes dayKey until resync (V10-08)', () => {
  let local = 1_000_000;
  const time = new TimeService(() => local);
  time.syncWithServer(1_000_000_000_000);
  const trustedDay = time.dayKey();

  // 回退 2 小时（远超 60s 阈值）：时间与 dayKey 冻结在上次可信值。
  local -= 2 * 3_600_000;
  assert.equal(time.now(), 1_000_000_000_000);
  assert.equal(time.timeStatus, 'frozen');
  assert.equal(time.dayKey(), trustedDay, 'shop/sign-in semantics freeze on the last trusted day');
  assert.equal(time.weekKey(), new TimeService(() => 1_000_000_000_000).weekKey());

  // 重新校时解除冻结：以服务器值为锚。
  time.syncWithServer(1_000_000_100_000);
  assert.equal(time.timeStatus, 'synced');
  assert.equal(time.now(), 1_000_000_100_000);

  // 时钟追上可信值后同样自动解除冻结。
  local += 2 * 3_600_000;
  assert.equal(time.now() >= 1_000_000_100_000, true);
  assert.notEqual(time.timeStatus, 'frozen');
});

test('unsynced rollback freezes on the last trusted local reading (V10-08)', () => {
  let local = 1_000_000_000_000;
  const time = new TimeService(() => local);
  const trustedDay = time.dayKey();
  assert.equal(time.timeStatus, 'local', 'never synced records the degraded local status');

  local -= 24 * 3_600_000;
  assert.equal(time.now(), 1_000_000_000_000, 'unsynced rollback freezes on the last trusted reading');
  assert.equal(time.timeStatus, 'frozen');
  assert.equal(time.dayKey(), trustedDay, 'no backward day flip means no reward re-grant window');

  // 非法校时值被忽略，不破坏冻结状态。
  time.syncWithServer(Number.NaN);
  time.syncWithServer(-5);
  assert.equal(time.timeStatus, 'frozen');
});

test('v08 day/week semantics are unchanged under server offset (regression)', () => {
  let local = 1_000_000;
  const time = new TimeService(() => local);
  assert.equal(time.now(), 1_000_000, 'unsynced now() equals the injected clock');
  time.syncWithServer(1_000_000);
  local += 3_600_000;
  const later = time.now();
  assert.equal(time.dayKey(later), time.dayKey(), 'dayKey defaults to calibrated now()');
});
