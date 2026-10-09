import assert from 'node:assert/strict';
import test from 'node:test';

import { ProgressionService } from '../assets/scripts/progression/ProgressionService.ts';

class SequenceRandom {
  constructor(values = [0]) {
    this.values = values;
    this.index = 0;
  }
  next() {
    const value = this.values[this.index % this.values.length];
    this.index += 1;
    return value;
  }
}

const CURVE = [
  { level: 1, requiredXp: 5 },
  { level: 2, requiredXp: 8 },
  { level: 3, requiredXp: 12 },
  { level: 4, requiredXp: 17 },
  { level: 5, requiredXp: 23 },
];

const UPGRADES = [
  { id: 'a', title: 'A', description: '', maxStacks: 8, weight: 1, effects: [] },
  { id: 'b', title: 'B', description: '', maxStacks: 6, weight: 1, effects: [] },
  { id: 'c', title: 'C', description: '', maxStacks: 7, weight: 1, effects: [] },
];

function createService(random = new SequenceRandom(), upgrades = UPGRADES, curve = CURVE) {
  return new ProgressionService(curve, upgrades, random);
}

test('boundary experience levels up exactly and resets the bucket', () => {
  const service = createService();

  const levelUps = service.addExperience(5);

  assert.equal(levelUps, 1);
  assert.equal(service.level, 2);
  assert.equal(service.experience, 0);
  assert.equal(service.hasPendingLevelUp, true);
  assert.equal(service.currentChoice.level, 2);
});

test('a large grant can cross several levels and queues them one at a time', () => {
  const service = createService();

  const levelUps = service.addExperience(45);

  assert.equal(levelUps, 4);
  assert.equal(service.level, 5, 'reached max level');
  assert.equal(service.hasPendingLevelUp, true);
  const first = service.currentChoice;
  assert.equal(first.level, 2, 'only the first queued level is served');

  service.resolveLevelUp(first.optionIds[0]);
  assert.equal(service.currentChoice.level, 3, 'next queued level served after resolving');
  assert.equal(service.hasPendingLevelUp, true);
});

test('invalid experience amounts and choices fail fast', () => {
  const service = createService();

  assert.throws(() => service.addExperience(-1), /non-negative integer/);
  assert.throws(() => service.addExperience(1.5), /non-negative integer/);
  assert.throws(() => service.addExperience(Number.NaN), /non-negative integer/);
  assert.throws(() => service.resolveLevelUp('a'), /without a pending choice/);

  service.addExperience(5);
  assert.throws(() => service.resolveLevelUp('not_offered'), /not among the offered choices/);
});

test('candidates are three distinct ids and reproducible with the same sequence', () => {
  const first = createService(new SequenceRandom([0.1, 0.6, 0.3]));
  const second = createService(new SequenceRandom([0.1, 0.6, 0.3]));

  first.addExperience(5);
  second.addExperience(5);

  const firstIds = first.currentChoice.optionIds;
  assert.equal(firstIds.length, 3);
  assert.equal(new Set(firstIds).size, 3, 'no duplicate options');
  assert.deepEqual(second.currentChoice.optionIds, firstIds);
});

test('maxed options are filtered and depleted pools degrade below three', () => {
  const smallUpgrades = [
    { id: 'only', title: 'Only', description: '', maxStacks: 1, weight: 1, effects: [] },
  ];
  const service = createService(new SequenceRandom(), smallUpgrades);

  service.addExperience(5);
  assert.deepEqual(service.currentChoice.optionIds, ['only'], 'single option degrades to one candidate');

  service.resolveLevelUp('only');
  assert.equal(service.getStackCount('only'), 1);

  service.addExperience(8);
  assert.equal(service.hasPendingLevelUp, false, 'fully maxed level-up completes without a choice');
  assert.equal(service.level, 3, 'the level itself is still granted');
});

test('stacked selections filter the option from later candidates', () => {
  const twoUpgrades = [
    { id: 'x', title: 'X', description: '', maxStacks: 1, weight: 1, effects: [] },
    { id: 'y', title: 'Y', description: '', maxStacks: 9, weight: 1, effects: [] },
  ];
  const service = createService(new SequenceRandom([0, 0, 0]), twoUpgrades);

  service.addExperience(5);
  service.resolveLevelUp(service.currentChoice.optionIds[0]);

  service.addExperience(8);
  const ids = service.currentChoice.optionIds;
  assert.equal(ids.includes('x'), false, 'maxed option no longer offered');
  assert.deepEqual(ids, ['y'], 'remaining pool offers what is left');
});

test('choice listeners fire once per served choice and can unsubscribe', () => {
  const service = createService();
  const served = [];
  const unsubscribe = service.onLevelUpChoice((choice) => served.push(choice.level));

  service.addExperience(45);
  assert.deepEqual(served, [2], 'only the first level serves a choice immediately');

  unsubscribe();
  service.resolveLevelUp(service.currentChoice.optionIds[0]);
  assert.deepEqual(served, [2], 'listener removed');
});

test('experience at max level accumulates nothing and progress stays full', () => {
  const service = createService();

  service.addExperience(45);
  for (let index = 0; index < 4; index += 1) {
    service.resolveLevelUp(service.currentChoice.optionIds[0]);
  }
  assert.equal(service.hasPendingLevelUp, false);
  assert.equal(service.level, 5);

  service.addExperience(100);
  assert.equal(service.hasPendingLevelUp, false);
  assert.equal(service.experience, 0);
  assert.equal(service.progressRatio, 1);
});

test('progress ratio reflects the current level bucket only', () => {
  const service = createService();

  assert.equal(service.progressRatio, 0);
  service.addExperience(4);
  assert.equal(service.progressRatio, 0.8);
});
