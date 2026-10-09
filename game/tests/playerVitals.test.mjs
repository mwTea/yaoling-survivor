import assert from 'node:assert/strict';
import test from 'node:test';

import { PlayerVitals } from '../assets/scripts/combat/Combat.ts';

class RecordingSinks {
  constructor() {
    this.calls = [];
  }
  markPlayerDead() {
    this.calls.push('dead');
  }
  publishPlayerDied(payload) {
    this.calls.push(`died:${payload.monsterId}:xp${payload.xpValue}`);
  }
}

function createVitals(sinks, overrides = {}) {
  return new PlayerVitals({ maxHp: 10, invulnerableSeconds: 0.8, ...overrides }, sinks);
}

function request(overrides = {}) {
  return { sourceEntityId: 3, targetEntityId: 1, amount: 4, damageType: 'contact', ...overrides };
}

test('contact damage reduces hp and starts the invulnerability window', () => {
  const sinks = new RecordingSinks();
  const vitals = createVitals(sinks);

  const result = vitals.takeContactDamage(request(), 1, { x: 0, y: 0 });

  assert.deepEqual(result, { status: 'applied', died: false });
  assert.equal(vitals.currentHp, 6);
  assert.equal(vitals.isInvulnerable, true);
  assert.deepEqual(sinks.calls, []);
});

test('repeated contact during the invulnerability window is rejected', () => {
  const sinks = new RecordingSinks();
  const vitals = createVitals(sinks);

  vitals.takeContactDamage(request(), 1, { x: 0, y: 0 });
  const second = vitals.takeContactDamage(request(), 1, { x: 0, y: 0 });

  assert.deepEqual(second, { status: 'rejected', died: false, reason: 'target_inactive' });
  assert.equal(vitals.currentHp, 6, 'no double damage while invulnerable');
});

test('invulnerability expires over battle time and accepts damage again', () => {
  const sinks = new RecordingSinks();
  const vitals = createVitals(sinks);

  vitals.takeContactDamage(request(), 1, { x: 0, y: 0 });
  vitals.advance(0.3);
  assert.equal(vitals.isInvulnerable, true);
  vitals.advance(0.5);
  assert.equal(vitals.isInvulnerable, false);

  const again = vitals.takeContactDamage(request(), 1, { x: 0, y: 0 });
  assert.deepEqual(again, { status: 'applied', died: false });
  assert.equal(vitals.currentHp, 2);

  vitals.advance(0);
  assert.equal(vitals.isInvulnerable, true, 'zero delta (paused) freezes the window');
});

test('lethal damage runs markPlayerDead then a single playerDied event, in order', () => {
  const sinks = new RecordingSinks();
  const vitals = createVitals(sinks);

  const result = vitals.takeContactDamage(request({ amount: 999 }), 1, { x: 5, y: 6 });

  assert.deepEqual(result, { status: 'applied', died: true });
  assert.deepEqual(sinks.calls, ['dead', 'died:player:xp0']);
});

test('death is idempotent: further hits are rejected without new events', () => {
  const sinks = new RecordingSinks();
  const vitals = createVitals(sinks);

  vitals.takeContactDamage(request({ amount: 999 }), 1, { x: 0, y: 0 });
  const second = vitals.takeContactDamage(request({ amount: 999 }), 1, { x: 0, y: 0 });

  assert.deepEqual(second, { status: 'rejected', died: false, reason: 'target_dead' });
  assert.equal(sinks.calls.length, 2, 'no extra death events or marks');
});

test('stale target ids are rejected and invalid requests fail the shared contract', () => {
  const sinks = new RecordingSinks();
  const vitals = createVitals(sinks);

  assert.deepEqual(vitals.takeContactDamage(request({ targetEntityId: 9 }), 1, { x: 0, y: 0 }), {
    status: 'rejected',
    died: false,
    reason: 'target_mismatch',
  });
  assert.throws(() => vitals.takeContactDamage(request({ amount: -1 }), 1, { x: 0, y: 0 }), /non-negative integer/);
  assert.equal(vitals.currentHp, 10);
});
