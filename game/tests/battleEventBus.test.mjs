import assert from 'node:assert/strict';
import test from 'node:test';

import { BattleEventBus } from '../assets/scripts/core/BattleEventBus.ts';

test('battle event bus delivers typed payloads and stops after unsubscribe', () => {
  const bus = new BattleEventBus();
  const received = [];
  const unsubscribe = bus.on('monsterDied', (payload) => {
    received.push(payload.entityId);
  });

  bus.emit('monsterDied', { entityId: 7, monsterId: 'monster_basic', position: { x: 1, y: 2 }, xpValue: 3 });
  unsubscribe();
  bus.emit('monsterDied', { entityId: 8, monsterId: 'monster_basic', position: { x: 0, y: 0 }, xpValue: 1 });

  assert.deepEqual(received, [7]);
});

test('emit iterates a snapshot of listeners', () => {
  const bus = new BattleEventBus();
  const calls = [];
  const second = () => {
    calls.push('second');
  };
  bus.on('experienceCollected', () => {
    calls.push('first');
    bus.off('experienceCollected', second);
    bus.on('experienceCollected', () => {
      calls.push('late');
    });
  });
  bus.on('experienceCollected', second);

  bus.emit('experienceCollected', { amount: 5 });
  assert.deepEqual(calls, ['first', 'second'], 'snapshot keeps removed listener, skips listener added mid-emit');

  bus.emit('experienceCollected', { amount: 5 });
  assert.deepEqual(calls, ['first', 'second', 'first', 'late']);
});

test('off on a name without listeners is a no-op', () => {
  const bus = new BattleEventBus();

  assert.doesNotThrow(() => bus.off('levelUpRequested', () => {}));
  bus.emit('levelUpRequested', { level: 2, optionIds: [] });
});

test('dispose clears listeners, silences emit, and rejects new subscriptions', () => {
  const bus = new BattleEventBus();
  let calls = 0;
  bus.on('battleStateChanged', () => {
    calls += 1;
  });

  bus.dispose();
  bus.emit('battleStateChanged', { previous: 'running', current: 'ended' });
  assert.equal(calls, 0);
  assert.throws(() => bus.on('battleStateChanged', () => {}), /subscribe after dispose/);
});
