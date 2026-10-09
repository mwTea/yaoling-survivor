import assert from 'node:assert/strict';
import test from 'node:test';

import { StageResultRecorder } from '../assets/scripts/battle/StageResultRecorder.ts';

test('recorder accumulates kills and positive xp from events', () => {
  const recorder = new StageResultRecorder();

  recorder.onMonsterDied('monster_basic');
  recorder.onMonsterDied('monster_yaonu');
  recorder.onExperienceCollected(1);
  recorder.onExperienceCollected(5);

  const stats = recorder.finish('victory', 600, 7);
  assert.equal(stats.result, 'victory');
  assert.equal(stats.killCount, 2);
  assert.equal(stats.xpCollected, 6);
  assert.equal(stats.levelReached, 7);
});

test('kill breakdown is tracked per monster config id including bosses (V08-11)', () => {
  const recorder = new StageResultRecorder();

  recorder.onMonsterDied('monster_basic');
  recorder.onMonsterDied('monster_basic');
  recorder.onMonsterDied('boss_shiyao_general');

  const stats = recorder.finish('victory', 60, 3);
  assert.deepEqual(stats.killCounts, { monster_basic: 2, boss_shiyao_general: 1 });
});

test('non-positive xp amounts are ignored', () => {
  const recorder = new StageResultRecorder();

  recorder.onExperienceCollected(0);
  recorder.onExperienceCollected(-3);
  recorder.onExperienceCollected(2);

  assert.equal(recorder.finish('defeat', 10, 1).xpCollected, 2);
});

test('elapsed seconds are floored and clamped, snapshots are fresh objects', () => {
  const recorder = new StageResultRecorder();
  recorder.onMonsterDied('monster_basic');

  const first = recorder.finish('victory', 123.9, 3);
  const second = recorder.finish('victory', 123.9, 3);

  assert.equal(first.elapsedSeconds, 123);
  assert.deepEqual(first, second);
  assert.notEqual(first, second, 'each finish returns a new snapshot');
  assert.notEqual(first.killCounts, second.killCounts, 'kill breakdown is a fresh object too');
});

test('clamping rejects negative elapsed time', () => {
  const recorder = new StageResultRecorder();

  assert.equal(recorder.finish('defeat', -5, 1).elapsedSeconds, 0);
});
