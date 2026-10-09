import assert from 'node:assert/strict';
import test from 'node:test';

import { NearestTargetQuery } from '../assets/scripts/combat/TargetQuery.ts';
import { CooldownTimer } from '../assets/scripts/combat/CooldownTimer.ts';

class FakeTarget {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
  readPosition(out) {
    out.x = this.x;
    out.y = this.y;
  }
  get collisionRadius() {
    return 10;
  }
}

class FakeRegistry {
  constructor(entries) {
    this.entries = entries;
  }
  forEachTarget(action) {
    for (const [entityId, target] of this.entries) {
      action(target, entityId);
    }
  }
}

test('nearest target inside the radius wins', () => {
  const registry = new FakeRegistry([
    [1, new FakeTarget(300, 0)],
    [2, new FakeTarget(-100, 0)],
    [3, new FakeTarget(0, 500)],
  ]);
  const query = new NearestTargetQuery(registry);

  const hit = query.findNearestTarget(0, 0, 650);

  assert.equal(hit.entityId, 2);
  assert.equal(hit.target, registry.entries[1][1]);
});

test('equal distances are broken by the smaller entity id for reproducibility', () => {
  const registry = new FakeRegistry([
    [9, new FakeTarget(100, 0)],
    [4, new FakeTarget(0, 100)],
    [7, new FakeTarget(-100, 0)],
  ]);
  const query = new NearestTargetQuery(registry);

  assert.equal(query.findNearestTarget(0, 0, 650).entityId, 4);
});

test('no target beyond the radius and no crash on empty registries', () => {
  const far = new NearestTargetQuery(new FakeRegistry([[1, new FakeTarget(1000, 0)]]));
  const empty = new NearestTargetQuery(new FakeRegistry([]));

  assert.equal(far.findNearestTarget(0, 0, 650), null);
  assert.equal(empty.findNearestTarget(0, 0, 650), null);
});

test('radius boundary is inclusive', () => {
  const registry = new FakeRegistry([[1, new FakeTarget(650, 0)]]);
  const query = new NearestTargetQuery(registry);

  assert.equal(query.findNearestTarget(0, 0, 650)?.entityId, 1);
  assert.equal(query.findNearestTarget(0, 0, 649)?.entityId ?? null, null);
});

test('cooldown timer validates duration, starts ready, and freezes on zero delta', () => {
  assert.throws(() => new CooldownTimer(0), /positive finite/);
  assert.throws(() => new CooldownTimer(Number.NaN), /positive finite/);

  const timer = new CooldownTimer(0.8);
  assert.equal(timer.isReady, true, 'starts ready for an immediate first shot');

  timer.trigger();
  assert.equal(timer.isReady, false);
  timer.advance(0);
  assert.equal(timer.isReady, false, 'zero delta (paused) freezes the timer');

  timer.advance(0.79);
  assert.equal(timer.isReady, false);
  timer.advance(0.01);
  assert.equal(timer.isReady, true);
});
