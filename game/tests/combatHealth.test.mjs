import assert from 'node:assert/strict';
import test from 'node:test';

import { validateDamageRequest, DamageRequestError, Health } from '../assets/scripts/combat/Combat.ts';

test('health validates maxHp at construction', () => {
  assert.throws(() => new Health(0), /integer >= 1/);
  assert.throws(() => new Health(-5), /integer >= 1/);
  assert.throws(() => new Health(2.5), /integer >= 1/);
  assert.throws(() => new Health(Number.NaN), /integer >= 1/);
});

test('health clamps damage and reaches zero exactly once', () => {
  const health = new Health(20);

  assert.equal(health.applyDamage(5), 5);
  assert.equal(health.currentHp, 15);
  assert.equal(health.isAlive, true);

  assert.equal(health.applyDamage(50), 15);
  assert.equal(health.currentHp, 0);
  assert.equal(health.isAlive, false);

  assert.equal(health.applyDamage(10), 0, 'no further damage after zero');
  assert.equal(health.currentHp, 0);

  assert.equal(health.applyDamage(0), 0, 'zero damage is a legal no-op');
  assert.equal(health.isAlive, false);
});

test('damage requests are validated with the failing field in the message', () => {
  const valid = { sourceEntityId: 1, targetEntityId: 2, amount: 10, damageType: 'sword' };
  assert.doesNotThrow(() => validateDamageRequest(valid));

  assert.throws(
    () => validateDamageRequest({ ...valid, sourceEntityId: -1 }),
    (error) => error instanceof DamageRequestError && /sourceEntityId/.test(error.message),
  );
  assert.throws(
    () => validateDamageRequest({ ...valid, targetEntityId: 0 }),
    (error) => error instanceof DamageRequestError && /targetEntityId/.test(error.message),
  );
  assert.throws(
    () => validateDamageRequest({ ...valid, amount: -3 }),
    (error) => error instanceof DamageRequestError && /amount/.test(error.message),
  );
  assert.throws(
    () => validateDamageRequest({ ...valid, amount: 1.5 }),
    (error) => error instanceof DamageRequestError && /amount/.test(error.message),
  );
  assert.throws(
    () => validateDamageRequest({ ...valid, amount: Number.NaN }),
    (error) => error instanceof DamageRequestError && /amount/.test(error.message),
  );
  assert.throws(
    () => validateDamageRequest({ ...valid, damageType: 'poison' }),
    (error) => error instanceof DamageRequestError && /damageType/.test(error.message),
  );
});
