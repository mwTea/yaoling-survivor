import assert from 'node:assert/strict';
import test from 'node:test';

import { INVALID_ENTITY_ID, TargetRegistry } from '../assets/scripts/combat/TargetRegistry.ts';

class FakeTarget {
  readPosition(out) {
    out.x = 1;
    out.y = 2;
  }
}

test('registration assigns unique increasing ids and tracks the count', () => {
  const registry = new TargetRegistry();
  const first = new FakeTarget();
  const second = new FakeTarget();

  const firstId = registry.register(first);
  const secondId = registry.register(second);

  assert.equal(firstId, 1);
  assert.equal(secondId, 2);
  assert.equal(INVALID_ENTITY_ID, 0);
  assert.equal(registry.count, 2);
  assert.equal(registry.isValid(firstId), true);
  assert.equal(registry.isValid(secondId), true);
  assert.equal(registry.isValid(INVALID_ENTITY_ID), false);
});

test('unregister invalidates the id and reports missing entries as false', () => {
  const registry = new TargetRegistry();
  const target = new FakeTarget();
  const entityId = registry.register(target);

  assert.equal(registry.unregister(entityId), true);
  assert.equal(registry.isValid(entityId), false);
  assert.equal(registry.count, 0);
  assert.equal(registry.unregister(entityId), false);
});

test('re-registering a recycled target gets a fresh id and the stale id stays invalid', () => {
  const registry = new TargetRegistry();
  const target = new FakeTarget();
  const staleId = registry.register(target);

  registry.unregister(staleId);
  const freshId = registry.register(target);

  assert.notEqual(freshId, staleId);
  assert.equal(registry.isValid(staleId), false);
  assert.equal(registry.isValid(freshId), true);
  assert.equal(registry.count, 1);
});
