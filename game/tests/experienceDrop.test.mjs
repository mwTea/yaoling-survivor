import assert from 'node:assert/strict';
import test from 'node:test';

import { decideExperienceDrop } from '../assets/scripts/progression/ExperienceDrop.ts';

test('drops spawn new gems while under the active budget', () => {
  assert.equal(decideExperienceDrop(0, 100, false), 'spawn');
  assert.equal(decideExperienceDrop(0, 100, true), 'spawn');
  assert.equal(decideExperienceDrop(99, 100, true), 'spawn');
});

test('drops merge into existing gems once the budget is reached', () => {
  assert.equal(decideExperienceDrop(100, 100, true), 'merge');
  assert.equal(decideExperienceDrop(150, 100, true), 'merge');
});

test('xp is never lost even at budget with no living gem', () => {
  assert.equal(decideExperienceDrop(100, 100, false), 'spawn', 'no merge target: prefer over-budget spawn to losing xp');
});

test('conservation holds across a long simulated run at the budget limit', () => {
  const xpPerDrop = 1;
  const cap = 100;
  let activeCount = 0;
  let activeXp = 0;
  let collectedXp = 0;
  let totalDropped = 0;

  for (let drop = 0; drop < 500; drop += 1) {
    totalDropped += xpPerDrop;
    const decision = decideExperienceDrop(activeCount, cap, activeCount > 0);
    if (decision === 'spawn') {
      activeCount += 1;
      activeXp += xpPerDrop;
    } else {
      activeXp += xpPerDrop;
    }
    // 模拟玩家稳定收集：场上超过半数时按固定节奏收取一颗满经验宝石。
    if (activeCount > cap / 2 && drop % 3 === 0) {
      collectedXp += activeXp;
      activeXp = 0;
      activeCount -= 1;
    }
    assert.equal(collectedXp + activeXp, totalDropped, `conservation broken at drop ${drop}`);
  }
});
