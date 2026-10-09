import assert from 'node:assert/strict';
import test from 'node:test';

import { SpawnPlanner } from '../assets/scripts/monster/SpawnPlanner.ts';

class SequenceRandom {
  constructor(values) {
    this.values = values;
    this.index = 0;
  }
  next() {
    if (this.index >= this.values.length) {
      throw new Error('random sequence exhausted');
    }
    const value = this.values[this.index];
    this.index += 1;
    return value;
  }
}

const STAGE = {
  id: 'stage_test',
  duration: 600,
  activeMonsterSoftCap: 3,
  activeMonsterHardCap: 5,
  spawnMinRadius: 100,
  spawnMaxRadius: 200,
  playArea: { minX: -300, maxX: 300, minY: -200, maxY: 200 },
  waveIds: ['wave_test'],
};

const WAVE = {
  id: 'wave_test',
  startTime: 0,
  endTime: 100,
  spawnInterval: 2,
  batchSize: 2,
  monsters: [{ monsterId: 'monster_basic', weight: 1 }],
};

const SINGLE_BATCH_WAVE = { ...WAVE, batchSize: 1 };

function createPlanner(random, wave = WAVE) {
  return new SpawnPlanner(STAGE, [wave], random, 50);
}

function assertRequest(actual, expected) {
  assert.equal(actual.monsterId, expected.monsterId);
  assert.ok(Math.abs(actual.x - expected.x) < 1e-9, `x ${actual.x} ≈ ${expected.x}`);
  assert.ok(Math.abs(actual.y - expected.y) < 1e-9, `y ${actual.y} ≈ ${expected.y}`);
}

test('spawns one batch per interval at ring positions around the player', () => {
  const planner = createPlanner(new SequenceRandom([0, 0, 0.5, 0]));

  assert.deepEqual(planner.advance(1, 0, 0, 0), []);
  const requests = planner.advance(1, 0, 0, 0);

  assert.equal(requests.length, 2);
  assertRequest(requests[0], { monsterId: 'monster_basic', elite: false, x: 100, y: 0 });
  assertRequest(requests[1], { monsterId: 'monster_basic', elite: false, x: -100, y: 0 });
});

test('positions are clamped into the play area', () => {
  const planner = createPlanner(new SequenceRandom([0, 0.5]), SINGLE_BATCH_WAVE);

  const requests = planner.advance(2, 0, 250, 150);

  assert.equal(planner.elapsedTime, 2);
  assert.deepEqual(requests, [{ monsterId: 'monster_basic', elite: false, x: 300, y: 150 }]);
});

test('positions too close to the player after clamping are retried deterministically', () => {
  const planner = createPlanner(new SequenceRandom([0, 0, 0.5, 0]), SINGLE_BATCH_WAVE);

  const requests = planner.advance(2, 0, 290, 150);

  assert.equal(requests.length, 1);
  assertRequest(requests[0], { monsterId: 'monster_basic', elite: false, x: 190, y: 150 });
});

test('soft cap skips the whole batch and restores the normal rhythm afterwards', () => {
  const planner = createPlanner(new SequenceRandom([0, 0]));

  assert.deepEqual(planner.advance(2, 3, 0, 0), []);
  assert.deepEqual(planner.advance(1.9, 3, 0, 0), []);
  const requests = planner.advance(0.1, 2, 0, 0);
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0], { monsterId: 'monster_basic', elite: false, x: 100, y: 0 });
});

test('partial capacity trims the batch instead of skipping it', () => {
  const planner = createPlanner(new SequenceRandom([0, 0]));

  const requests = planner.advance(2, 2, 0, 0);

  assert.equal(requests.length, 1);
});

test('zero delta freezes the rhythm and a big delta never bursts batches', () => {
  const planner = createPlanner(new SequenceRandom([0, 0, 0.5, 0, 0, 0, 0.5, 0]));

  assert.deepEqual(planner.advance(0, 0, 0, 0), []);
  assert.equal(planner.elapsedTime, 0);

  const burst = planner.advance(10, 0, 0, 0);
  assert.equal(burst.length, 2);
  assert.deepEqual(planner.advance(1.9, 0, 0, 0), []);
  assert.equal(planner.advance(0.1, 0, 0, 0).length, 2);
});

test('waves only spawn inside their time window', () => {
  const delayedWave = { ...WAVE, startTime: 4, endTime: 6, spawnInterval: 1 };
  const planner = createPlanner(new SequenceRandom([0, 0, 0.5, 0]), delayedWave);

  assert.deepEqual(planner.advance(3.9, 0, 0, 0), []);
  assert.equal(planner.advance(1, 0, 0, 0).length, 2);
  assert.deepEqual(planner.advance(1.2, 0, 0, 0), []);
});

test('weighted picks and full runs are reproducible with the same random sequence', () => {
  const mixedWave = {
    ...WAVE,
    monsters: [
      { monsterId: 'monster_a', weight: 3 },
      { monsterId: 'monster_b', weight: 1 },
    ],
  };
  // 每只怪物消耗 roll → angle → radius 三个随机数。
  const sequence = [0, 0, 0, 0.9, 0.5, 0, 0, 0, 0, 0.9, 0.5, 0];
  const firstPlanner = createPlanner(new SequenceRandom([...sequence]), mixedWave);
  const secondPlanner = createPlanner(new SequenceRandom([...sequence]), mixedWave);

  const firstRun = [firstPlanner.advance(2, 0, 0, 0), firstPlanner.advance(2, 0, 0, 0)];
  const secondRun = [secondPlanner.advance(2, 0, 0, 0), secondPlanner.advance(2, 0, 0, 0)];

  assert.equal(firstRun[0][0].monsterId, 'monster_a');
  assert.equal(firstRun[0][1].monsterId, 'monster_b');
  assert.deepEqual(firstRun, secondRun);
});

test('elite wave entries are picked by weight and flagged in requests', () => {
  const eliteWave = {
    ...WAVE,
    batchSize: 1,
    monsters: [
      { monsterId: 'monster_basic', weight: 3 },
      { monsterId: 'monster_basic', weight: 1, elite: true },
    ],
  };
  const planner = createPlanner(new SequenceRandom([0.9, 0, 0]), eliteWave);

  const requests = planner.advance(2, 0, 0, 0);

  assert.equal(requests.length, 1);
  assert.equal(requests[0].elite, true, 'roll 0.9 falls into the elite entry');
  assert.equal(requests[0].monsterId, 'monster_basic');

  const normalPlanner = createPlanner(new SequenceRandom([0, 0, 0]), eliteWave);
  const normalRequests = normalPlanner.advance(2, 0, 0, 0);
  assert.equal(normalRequests[0].elite, false);
});
