import assert from 'node:assert/strict';
import test from 'node:test';

import {
  describeRealmLine,
  unmetText,
} from '../assets/scripts/ui/PanelText.ts';

const REALMS = [
  { id: 'realm_a', displayName: '练气', subRealmCosts: [30, 40], maxHpBonus: 0, breakthrough: null },
  { id: 'realm_b', displayName: '筑基', subRealmCosts: [60], maxHpBonus: 4, breakthrough: null },
];

test('realm line shows the current layer counting from one', () => {
  assert.equal(describeRealmLine(REALMS, 0, 0), '练气第1层');
  assert.equal(describeRealmLine(REALMS, 0, 1), '练气第2层');
  assert.equal(describeRealmLine(REALMS, 1, 0), '筑基第1层');
});

test('a perfected realm reads as 圆满 and unknown indices degrade gracefully', () => {
  assert.equal(describeRealmLine(REALMS, 0, 2), '练气圆满');
  assert.equal(describeRealmLine(REALMS, 1, 1), '筑基圆满');
  assert.equal(describeRealmLine(REALMS, 9, 0), '境界未知');
  assert.equal(describeRealmLine(REALMS, -1, 0), '境界未知');
});

test('unmet conditions render as Chinese copy joined by 、', () => {
  assert.equal(unmetText([]), '无');
  assert.equal(unmetText(['xiuwei']), '修为不足');
  assert.equal(unmetText(['material']), '妖丹不足');
  assert.equal(unmetText(['playerLevel']), '玩家等级不足');
  assert.equal(unmetText(['xiuwei', 'material', 'playerLevel']), '修为不足、妖丹不足、玩家等级不足');
});
