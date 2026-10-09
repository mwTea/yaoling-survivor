import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BeastCompanionTrigger,
  createBeastCompanionPlan,
} from '../assets/scripts/combat/BeastCompanionTrigger.ts';

test('damageNearest skills expand into a damage plan straight from config', () => {
  const plan = createBeastCompanionPlan({
    kind: 'damageNearest',
    intervalSeconds: 6,
    damage: 8,
    projectileCount: 2,
  });

  assert.deepEqual(plan, {
    kind: 'damage',
    intervalSeconds: 6,
    damage: 8,
    healValue: 0,
    projectileCount: 2,
  });
});

test('heal skills expand into a heal plan straight from config', () => {
  const plan = createBeastCompanionPlan({ kind: 'heal', intervalSeconds: 12, value: 3 });

  assert.deepEqual(plan, {
    kind: 'heal',
    intervalSeconds: 12,
    damage: 0,
    healValue: 3,
    projectileCount: 0,
  });
});

test('the trigger is due on the first running tick and refires on the interval', () => {
  const trigger = new BeastCompanionTrigger(createBeastCompanionPlan({
    kind: 'heal',
    intervalSeconds: 6,
    value: 3,
  }));

  assert.equal(trigger.advance(4, true), 'due', 'first tick fires immediately');
  trigger.markFired();

  assert.equal(trigger.advance(2, true), 'due', 'elapsed 4s carries over: next due at t=6');
  trigger.markFired();

  assert.equal(trigger.advance(5, true), 'idle');
  assert.equal(trigger.advance(1, true), 'due');
});

test('paused or zero-delta ticks freeze the timer and keep the current state', () => {
  const trigger = new BeastCompanionTrigger(createBeastCompanionPlan({
    kind: 'damageNearest',
    intervalSeconds: 3,
    damage: 8,
    projectileCount: 1,
  }));

  // 首拍（真实首帧 ≈16ms）即触发，之后按完整间隔节奏。
  assert.equal(trigger.advance(0.016, true), 'due');
  trigger.markFired();
  assert.equal(trigger.advance(10, false), 'idle', 'paused tick after firing stays idle (frozen)');
  assert.equal(trigger.advance(2, true), 'idle', 'paused time never consumed the interval');
  assert.equal(trigger.advance(1, true), 'due');
});

test('long frames fire at most once per tick and keep the rhythm', () => {
  const trigger = new BeastCompanionTrigger(createBeastCompanionPlan({
    kind: 'damageNearest',
    intervalSeconds: 6,
    damage: 8,
    projectileCount: 1,
  }));

  assert.equal(trigger.advance(100, true), 'due', 'single fire even for huge deltas');
  trigger.markFired();
  assert.equal(trigger.advance(100, true), 'due', 'markFired keeps one interval of carry-over');
});

test('non-positive intervals are rejected at construction', () => {
  assert.throws(
    () => new BeastCompanionTrigger({
      kind: 'damage',
      intervalSeconds: 0,
      damage: 1,
      healValue: 0,
      projectileCount: 1,
    }),
    /interval must be a positive finite number/,
  );
});
