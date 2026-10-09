import assert from 'node:assert/strict';
import test from 'node:test';

import { MonsterVitals } from '../assets/scripts/combat/Combat.ts';

class RecordingSinks {
  constructor() {
    this.calls = [];
  }
  unregisterTarget(entityId) {
    this.calls.push(`unregister:${entityId}`);
  }
  publishMonsterDied(payload) {
    this.calls.push(`died:${payload.entityId}:${payload.monsterId}:xp${payload.xpValue}`);
  }
  returnToPool() {
    this.calls.push('pool');
  }
}

function createVitals(sinks, maxHp = 20) {
  return new MonsterVitals('monster_basic', maxHp, 3, sinks);
}

function request(overrides = {}) {
  return { sourceEntityId: 11, targetEntityId: 1, amount: 5, damageType: 'sword', ...overrides };
}

test('non-lethal damage reduces hp without touching any sink', () => {
  const sinks = new RecordingSinks();
  const vitals = createVitals(sinks);

  const result = vitals.takeDamage(request(), 1, { x: 4, y: 5 });

  assert.deepEqual(result, { status: 'applied', died: false });
  assert.equal(vitals.currentHp, 15);
  assert.deepEqual(sinks.calls, []);
});

test('lethal damage runs unregister -> single died event -> return to pool, in order', () => {
  const sinks = new RecordingSinks();
  const vitals = createVitals(sinks);

  const result = vitals.takeDamage(request({ amount: 20 }), 1, { x: 4, y: 5 });

  assert.deepEqual(result, { status: 'applied', died: true });
  assert.deepEqual(sinks.calls, ['unregister:1', 'died:1:monster_basic:xp3', 'pool']);
});

test('a second lethal hit in the same frame is rejected without a second event', () => {
  const sinks = new RecordingSinks();
  const vitals = createVitals(sinks);

  vitals.takeDamage(request({ amount: 999 }), 1, { x: 0, y: 0 });
  const second = vitals.takeDamage(request({ amount: 999 }), 1, { x: 0, y: 0 });

  assert.deepEqual(second, { status: 'rejected', died: false, reason: 'target_dead' });
  assert.equal(sinks.calls.filter((call) => call.startsWith('died:')).length, 1);
  assert.equal(sinks.calls.filter((call) => call === 'pool').length, 1, 'no second release attempt');
});

test('stale entity ids are rejected and cannot misdamage the current activation', () => {
  const sinks = new RecordingSinks();
  const vitals = createVitals(sinks);

  const result = vitals.takeDamage(request({ targetEntityId: 99 }), 1, { x: 0, y: 0 });

  assert.deepEqual(result, { status: 'rejected', died: false, reason: 'target_mismatch' });
  assert.equal(vitals.currentHp, 20);
  assert.deepEqual(sinks.calls, []);
});

test('a fresh vitals instance after re-acquisition starts at full hp with no death state', () => {
  const sinks = new RecordingSinks();
  const firstLife = createVitals(sinks);
  firstLife.takeDamage(request({ amount: 999 }), 1, { x: 0, y: 0 });

  const secondLife = createVitals(sinks);
  assert.equal(secondLife.currentHp, 20);
  assert.equal(secondLife.isDead, false);

  const staleHit = secondLife.takeDamage(request({ targetEntityId: 1, amount: 10 }), 5, { x: 0, y: 0 });
  assert.deepEqual(staleHit, { status: 'rejected', died: false, reason: 'target_mismatch' });
  assert.equal(secondLife.currentHp, 20, 'stale id cannot damage the new activation');

  const freshHit = secondLife.takeDamage(request({ targetEntityId: 5 }), 5, { x: 0, y: 0 });
  assert.deepEqual(freshHit, { status: 'applied', died: false });
  assert.equal(secondLife.currentHp, 15);
});
