import assert from 'node:assert/strict';
import test from 'node:test';

import { PlayerVitals } from '../assets/scripts/combat/Combat.ts';
import { TreasureRuntime } from '../assets/scripts/progression/TreasureRuntime.ts';

const TREASURES = [
  {
    id: 'treasure_shiyao_banner',
    title: '噬妖幡',
    description: '每次击杀回复 2 点生命，每层 +2',
    maxStacks: 3,
    weight: 1,
    effects: [{ kind: 'healOnKill', value: 2 }],
  },
];

class Sink {
  markPlayerDead() {}
  publishPlayerDied() {}
}

test('treasure stacks accumulate the heal-on-kill amount', () => {
  const runtime = new TreasureRuntime(TREASURES);

  assert.equal(runtime.healOnKillAmount, 0);
  runtime.addStack('treasure_shiyao_banner');
  runtime.addStack('treasure_shiyao_banner');
  assert.equal(runtime.healOnKillAmount, 4);
  assert.equal(runtime.getStackCount('treasure_shiyao_banner'), 2);
});

test('unknown treasure ids are rejected', () => {
  const runtime = new TreasureRuntime(TREASURES);

  assert.throws(() => runtime.addStack('not_a_treasure'), /unknown treasure id/);
});

test('heal clamps at maxHp and is rejected after death', () => {
  const vitals = new PlayerVitals({ maxHp: 10, invulnerableSeconds: 0 }, new Sink());

  assert.equal(vitals.heal(3), 0, 'already at max: no over-heal');
  assert.equal(vitals.currentHp, 10);

  vitals.takeContactDamage(
    { sourceEntityId: 5, targetEntityId: 1, amount: 6, damageType: 'contact' },
    1,
    { x: 0, y: 0 },
  );
  assert.equal(vitals.currentHp, 4);

  assert.equal(vitals.heal(2), 2);
  assert.equal(vitals.currentHp, 6);

  assert.equal(vitals.heal(99), 4, 'clamped to maxHp');
  assert.equal(vitals.currentHp, 10);

  vitals.takeContactDamage(
    { sourceEntityId: 5, targetEntityId: 1, amount: 99, damageType: 'contact' },
    1,
    { x: 0, y: 0 },
  );
  assert.equal(vitals.isDead, true);
  assert.equal(vitals.heal(5), 0, 'dead players cannot heal');
});

test('damage after heal still respects the shared contract', () => {
  const vitals = new PlayerVitals({ maxHp: 10, invulnerableSeconds: 0 }, new Sink());

  vitals.takeContactDamage(
    { sourceEntityId: 5, targetEntityId: 1, amount: 4, damageType: 'contact' },
    1,
    { x: 0, y: 0 },
  );
  vitals.heal(2);
  vitals.advance(1);

  const result = vitals.takeContactDamage(
    { sourceEntityId: 5, targetEntityId: 1, amount: 4, damageType: 'contact' },
    1,
    { x: 0, y: 0 },
  );

  assert.deepEqual(result, { status: 'applied', died: false });
  assert.equal(vitals.currentHp, 4);
});
