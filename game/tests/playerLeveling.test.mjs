import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addAccountXp,
  getAccountLevelProgress,
} from '../assets/scripts/account/PlayerLeveling.ts';

// 小型确定性曲线：1→2 需 60，2→3 需 80，3→4 需 105，4 级即满级。
const CURVE = [
  { level: 1, requiredXp: 60 },
  { level: 2, requiredXp: 80 },
  { level: 3, requiredXp: 105 },
];
const CONFIG = { levelCurve: CURVE };

function makeState(level = 1, xp = 0) {
  return { playerLevel: level, playerXp: xp };
}

test('crossing the threshold levels up exactly once and resets in-level xp', () => {
  const state = makeState(1, 55);

  const result = addAccountXp(state, CONFIG, 5);

  assert.ok(result.ok);
  if (!result.ok) return;
  assert.deepEqual(result, { ok: true, levelsGained: 1, newLevel: 2, newXp: 0 });
  assert.equal(state.playerLevel, 2);
  assert.equal(state.playerXp, 0);
});

test('leftover xp carries into the next level', () => {
  const state = makeState(1, 0);

  const result = addAccountXp(state, CONFIG, 70);

  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.levelsGained, 1);
  assert.equal(result.newLevel, 2);
  assert.equal(result.newXp, 10, '70 - 60 = 10 carried over');
});

test('a single grant can cross multiple levels in one pass', () => {
  const state = makeState(1, 0);

  const result = addAccountXp(state, CONFIG, 300);

  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.levelsGained, 2);
  assert.equal(result.newLevel, 3, 'curve has 3 entries, max level is 3');
  assert.equal(result.newXp, 160, '300 - 60 - 80 = 160 held at max level');
});

test('reaching the exact threshold counts as enough for a level up', () => {
  const state = makeState(2, 0);

  const result = addAccountXp(state, CONFIG, 80);

  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.newLevel, 3);
  assert.equal(result.newXp, 0);
});

test('xp below the threshold accumulates without leveling', () => {
  const state = makeState(1, 10);

  const result = addAccountXp(state, CONFIG, 1);

  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.levelsGained, 0);
  assert.equal(result.newLevel, 1);
  assert.equal(result.newXp, 11);
});

test('overflow beyond max level is preserved for later curve extensions', () => {
  const state = makeState(2, 0);

  const first = addAccountXp(state, CONFIG, 200);
  assert.ok(first.ok);
  if (!first.ok) return;
  assert.equal(first.newLevel, 3, '80 consumed, reaching max level');
  assert.equal(first.newXp, 120, 'no threshold at max level: 200 - 80 kept as overflow');

  const second = addAccountXp(state, CONFIG, 50);
  assert.ok(second.ok);
  if (!second.ok) return;
  assert.equal(second.newLevel, 3, 'stays at max level');
  assert.equal(second.newXp, 170, 'overflow keeps accumulating');
});

test('levels never decrease even when the save exceeds the configured curve', () => {
  const state = makeState(25, 0);

  const result = addAccountXp(state, CONFIG, 100);

  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.levelsGained, 0);
  assert.equal(result.newLevel, 25, 'config shrink must not reduce owned level');
  assert.equal(result.newXp, 100);
});

test('invalid amounts are rejected and leave state untouched', () => {
  const state = makeState(2, 30);

  for (const amount of [0, -5, 2.5, Number.NaN]) {
    const result = addAccountXp(state, CONFIG, amount);
    assert.deepEqual(
      { ok: result.ok, reason: result.ok ? null : result.reason },
      { ok: false, reason: 'invalid_amount' },
      `amount ${String(amount)} must be rejected`,
    );
  }

  assert.equal(state.playerLevel, 2, 'rejected grants never mutate state');
  assert.equal(state.playerXp, 30);
});

test('level progress reports the current threshold, or null at max level', () => {
  const early = getAccountLevelProgress(makeState(1, 20), CONFIG);
  assert.deepEqual(early, { level: 1, xp: 20, requiredXp: 60 });

  const maxed = getAccountLevelProgress(makeState(4, 95), CONFIG);
  assert.deepEqual(maxed, { level: 4, xp: 95, requiredXp: null });

  const beyondCurve = getAccountLevelProgress(makeState(25, 5), CONFIG);
  assert.deepEqual(beyondCurve, { level: 25, xp: 5, requiredXp: null });
});
