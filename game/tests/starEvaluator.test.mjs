import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateStageStars } from '../assets/scripts/battle/StarEvaluator.ts';

const CONDITIONS = [
  { kind: 'clear' },
  { kind: 'hpRatioAbove', ratio: 0.5 },
  { kind: 'hitTakenAtMost', count: 10 },
];

const WIN = { victory: true, elapsedSeconds: 300, hitTakenCount: 4, hpRatio: 0.8 };

test('victory with all conditions met grants three stars', () => {
  const evaluation = evaluateStageStars(CONDITIONS, WIN);

  assert.equal(evaluation.stars, 3);
  assert.equal(evaluation.details.length, 3);
  assert.deepEqual(evaluation.details.map((detail) => detail.met), [true, true, true]);
  assert.equal(evaluation.details[0].star, 1);
  assert.equal(evaluation.details[0].kind, 'clear');
});

test('defeat always yields zero stars even when every condition numeric value passes', () => {
  const evaluation = evaluateStageStars(CONDITIONS, { ...WIN, victory: false });

  assert.equal(evaluation.stars, 0);
  assert.deepEqual(evaluation.details.map((detail) => detail.met), [false, true, true]);
});

test('condition boundaries: exact ratio, exact time and exact hit count all count as met', () => {
  // 剩余生命比例相等达成（10/20 = 0.5）。
  assert.equal(evaluateStageStars(CONDITIONS, { ...WIN, hpRatio: 0.5 }).stars, 3);
  // 限时相等达成。
  const timed = [
    { kind: 'clear' },
    { kind: 'hpRatioAbove', ratio: 0.5 },
    { kind: 'timeUnder', seconds: 420 },
  ];
  assert.equal(evaluateStageStars(timed, { ...WIN, elapsedSeconds: 420 }).stars, 3);
  assert.equal(evaluateStageStars(timed, { ...WIN, elapsedSeconds: 420.5 }).stars, 2);
  // 受击计数相等达成，超一次即失。
  assert.equal(evaluateStageStars(CONDITIONS, { ...WIN, hitTakenCount: 10 }).stars, 3);
  assert.equal(evaluateStageStars(CONDITIONS, { ...WIN, hitTakenCount: 11 }).stars, 2);
  // 比例略低于阈值即失。
  assert.equal(evaluateStageStars(CONDITIONS, { ...WIN, hpRatio: 0.499 }).stars, 2);
});

test('star details carry display text with rounded percentages', () => {
  const evaluation = evaluateStageStars(CONDITIONS, { ...WIN, hpRatio: 2 / 3 });

  const hpDetail = evaluation.details[1];
  assert.equal(hpDetail.met, true);
  assert.match(hpDetail.text, /剩余生命不低于 50%/);
  assert.match(hpDetail.text, /67%/);
});

test('missing conditions evaluate as unmet without throwing', () => {
  const evaluation = evaluateStageStars([{ kind: 'clear' }], WIN);

  assert.equal(evaluation.stars, 1);
  assert.equal(evaluation.details[1].met, false);
  assert.equal(evaluation.details[1].kind, 'missing');
});

test('unknown condition kinds are unmet and flagged in details', () => {
  const evaluation = evaluateStageStars(
    [{ kind: 'clear' }, { kind: 'hpRatioAbove', ratio: 0.5 }, { kind: 'mystery' }],
    WIN,
  );

  assert.equal(evaluation.stars, 2);
  assert.equal(evaluation.details[2].met, false);
  assert.match(evaluation.details[2].text, /未知条件/);
});
