import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getFeatureFlagDefinitions,
  isFeatureEnabled,
  isFeatureFlagId,
} from '../assets/scripts/platform/FeatureFlags.ts';

test('implemented V0.8 features default to enabled, unbuilt ones to disabled', () => {
  assert.equal(isFeatureEnabled('stage_select'), true);
  assert.equal(isFeatureEnabled('profile'), true);
  // 未实装系统的入口默认隐藏（关闭时入口隐藏，不做假数据）。
  assert.equal(isFeatureEnabled('tasks'), true, 'V08-09 实装后默认开启');
  assert.equal(isFeatureEnabled('achievements'), true, 'V08-10 实装后默认开启');
  assert.equal(isFeatureEnabled('codex'), true, 'V08-11 实装后默认开启');
  assert.equal(isFeatureEnabled('shop'), true, 'V08-13 实装后默认开启');
  assert.equal(isFeatureEnabled('reward_center'), true, 'V08-15 实装后默认开启');
  assert.equal(isFeatureEnabled('login_reward'), true, 'V08-14 实装后默认开启');
});

test('flag definitions carry stable unique ids with descriptions', () => {
  const definitions = getFeatureFlagDefinitions();
  const ids = definitions.map((definition) => definition.id);
  assert.equal(new Set(ids).size, ids.length, 'flag ids are unique');
  for (const definition of definitions) {
    assert.ok(definition.description.length > 0);
    assert.ok(isFeatureFlagId(definition.id));
  }
});

test('unknown flag ids are rejected by the guard and never enabled', () => {
  assert.equal(isFeatureFlagId('not_a_flag'), false);
  assert.equal(isFeatureFlagId(''), false);
});
