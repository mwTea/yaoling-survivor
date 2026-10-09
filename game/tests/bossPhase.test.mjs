import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveBossPhase, resolveBurstInterval } from '../assets/scripts/monster/BossPhase.ts';

test('boss phase flips at half health with the boundary on normal', () => {
  assert.equal(resolveBossPhase(1), 'normal');
  assert.equal(resolveBossPhase(0.75), 'normal');
  assert.equal(resolveBossPhase(0.5), 'normal', 'boundary belongs to normal');
  assert.equal(resolveBossPhase(0.49), 'enraged');
  assert.equal(resolveBossPhase(0), 'enraged');
});

test('burst interval uses the phase table and never falls below 0.1s', () => {
  assert.equal(resolveBurstInterval('normal', 5, 3), 5);
  assert.equal(resolveBurstInterval('enraged', 5, 3), 3);
  assert.equal(resolveBurstInterval('enraged', 2, 3), 2, 'enraged never slower than normal');
  assert.equal(resolveBurstInterval('normal', 0, 3), 0.1, 'degenerate config floors at 0.1');
});
