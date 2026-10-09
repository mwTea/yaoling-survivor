import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BattleSession,
  BattleStateTransitionError,
} from '../assets/scripts/core/BattleSession.ts';
import { SimulationClock } from '../assets/scripts/core/SimulationClock.ts';

test('battle session follows the complete legal level-up flow', () => {
  const session = new BattleSession();
  const changes = [];
  session.subscribe((previous, current) => changes.push([previous, current]));

  assert.equal(session.state, 'booting');
  session.start();
  session.pauseForLevelUp();
  session.resumeAfterLevelUp();
  session.end();

  assert.equal(session.state, 'ended');
  assert.deepEqual(changes, [
    ['booting', 'running'],
    ['running', 'level_up_paused'],
    ['level_up_paused', 'running'],
    ['running', 'ended'],
  ]);
});

test('illegal and duplicate transitions fail without changing state', () => {
  const session = new BattleSession();

  assert.throws(() => session.pauseForLevelUp(), BattleStateTransitionError);
  assert.equal(session.state, 'booting');

  session.start();
  assert.throws(() => session.start(), BattleStateTransitionError);
  assert.equal(session.state, 'running');

  session.end();
  assert.throws(() => session.resumeAfterLevelUp(), BattleStateTransitionError);
  assert.equal(session.state, 'ended');
});

test('unsubscribing and disposing remove state listeners', () => {
  const session = new BattleSession();
  let callCount = 0;
  const unsubscribe = session.subscribe(() => {
    callCount += 1;
  });

  session.start();
  unsubscribe();
  session.pauseForLevelUp();
  assert.equal(callCount, 1);

  session.subscribe(() => {
    callCount += 1;
  });
  session.dispose();
  session.resumeAfterLevelUp();
  assert.equal(callCount, 1);
});

test('simulation clock advances only while battle is running', () => {
  const clock = new SimulationClock();

  clock.advance(0.25, 'booting');
  assert.equal(clock.deltaTime, 0);
  assert.equal(clock.elapsedTime, 0);
  assert.equal(clock.isSimulationRunning, false);

  clock.advance(0.5, 'running');
  assert.equal(clock.deltaTime, 0.5);
  assert.equal(clock.elapsedTime, 0.5);
  assert.equal(clock.isSimulationRunning, true);

  let uiCallbackCount = 0;
  clock.advance(0.75, 'level_up_paused');
  uiCallbackCount += 1;
  assert.equal(clock.deltaTime, 0);
  assert.equal(clock.elapsedTime, 0.5);
  assert.equal(clock.isSimulationRunning, false);
  assert.equal(uiCallbackCount, 1);

  clock.advance(0.25, 'running');
  assert.equal(clock.elapsedTime, 0.75);
});

test('simulation clock rejects invalid frame time and can reset', () => {
  const clock = new SimulationClock();

  assert.throws(() => clock.advance(-0.1, 'running'), RangeError);
  assert.throws(() => clock.advance(Number.NaN, 'running'), RangeError);

  clock.advance(1, 'running');
  clock.reset();
  assert.equal(clock.deltaTime, 0);
  assert.equal(clock.elapsedTime, 0);
  assert.equal(clock.isSimulationRunning, false);
});

