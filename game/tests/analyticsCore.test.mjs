import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AnalyticsBuffer,
  createAnalyticsEvent,
} from '../assets/scripts/platform/AnalyticsCore.ts';

function event(name, at, priority = 'normal') {
  return createAnalyticsEvent(name, at, 'sess_test', { stageId: 'stage_mvp_01' }, priority);
}

test('buffer enqueues FIFO and batches respect maxBatchSize', () => {
  const buffer = new AnalyticsBuffer({ maxBufferSize: 10, maxBatchSize: 4 });
  for (let i = 0; i < 9; i += 1) {
    buffer.enqueue(event('battle_started', i));
  }
  assert.equal(buffer.size, 9);
  const batch1 = buffer.nextBatch();
  assert.equal(batch1.length, 4, 'batch capped at maxBatchSize');
  assert.equal(batch1[0].at, 0, 'FIFO order');
  assert.equal(buffer.size, 5);
  const batch2 = buffer.nextBatch();
  assert.equal(batch2.length, 4);
  buffer.nextBatch();
  assert.equal(buffer.nextBatch().length, 0, 'empty buffer yields an empty batch');
});

test('ring buffer drops the oldest events when full and counts them', () => {
  const buffer = new AnalyticsBuffer({ maxBufferSize: 3, maxBatchSize: 2 });
  for (let i = 0; i < 5; i += 1) {
    buffer.enqueue(event('ad_result', i));
  }
  assert.equal(buffer.size, 3);
  assert.equal(buffer.dropped, 2);
  const batch = buffer.nextBatch();
  assert.deepEqual(batch.map((e) => e.at), [2, 3], 'oldest two dropped, newest survive');
});

test('failed batches requeue at the head in order (retry preserves sequence)', () => {
  const buffer = new AnalyticsBuffer({ maxBufferSize: 10, maxBatchSize: 3 });
  buffer.enqueue(event('battle_started', 0));
  buffer.enqueue(event('battle_started', 1));
  const failed = buffer.nextBatch();
  buffer.enqueue(event('battle_finished', 2));
  buffer.enqueue(event('ad_result', 3));
  buffer.requeue(failed);
  const all = [...buffer.nextBatch(), ...buffer.nextBatch(), ...buffer.nextBatch()];
  assert.deepEqual(all.map((e) => e.at), [0, 1, 2, 3], 'requeued events keep global order');
});

test('requeue beyond capacity drops from the tail and counts drops', () => {
  const buffer = new AnalyticsBuffer({ maxBufferSize: 2, maxBatchSize: 2 });
  buffer.enqueue(event('ad_result', 5));
  const failed = [event('ad_result', 1), event('ad_result', 2), event('ad_result', 3)];
  // 回填后队列为 [1,2,3,5]，容量 2 → 从队尾丢弃 3、5。
  buffer.requeue(failed);
  assert.equal(buffer.size, 2);
  assert.equal(buffer.dropped, 2, 'overflow dropped from the tail');
  const batch = buffer.nextBatch();
  assert.deepEqual(batch.map((e) => e.at), [1, 2], 'head of the requeued batch survives in order');
});

test('buffer rejects non-positive config fast', () => {
  assert.throws(() => new AnalyticsBuffer({ maxBufferSize: 0, maxBatchSize: 1 }), /must be positive/);
  assert.throws(() => new AnalyticsBuffer({ maxBufferSize: 8, maxBatchSize: -1 }), /must be positive/);
});

test('event contract carries narrow payload values and priority', () => {
  const normal = createAnalyticsEvent('build_option_chosen', 42, 's1', { level: 3, optionId: 'sword_damage_up' });
  assert.equal(normal.priority, 'normal', 'priority defaults to normal');
  const critical = createAnalyticsEvent('battle_finished', 42, 's1', { result: 'victory' }, 'critical');
  assert.equal(critical.priority, 'critical');
  assert.deepEqual(critical.payload, { result: 'victory' });
  // payload 值域窄化为原始类型（null 用于失败原因占位）。
  createAnalyticsEvent('purchase_result', 42, 's1', { ok: false, reason: null });
  assert.ok(true);
});
