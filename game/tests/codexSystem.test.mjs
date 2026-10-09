import assert from 'node:assert/strict';
import test from 'node:test';

import { isDefeated, isSeen, recordCodexKills } from '../assets/scripts/account/CodexSystem.ts';

test('codex kill records are additive and idempotent (V08-11)', () => {
  const state = { codex: { seenIds: [], defeatedIds: [] } };

  recordCodexKills(state, { monster_basic: 5, monster_yaonu: 1, boss_shiyao_general: 1 });
  assert.deepEqual(state.codex.seenIds, ['monster_basic', 'monster_yaonu', 'boss_shiyao_general']);
  assert.deepEqual(state.codex.defeatedIds, ['monster_basic', 'monster_yaonu', 'boss_shiyao_general']);

  recordCodexKills(state, { monster_basic: 9 });
  assert.equal(state.codex.seenIds.filter((id) => id === 'monster_basic').length, 1, 'no duplicate entries');
  assert.equal(isDefeated(state, 'monster_basic'), true);
  assert.equal(isSeen(state, 'monster_yaonu'), true);
  assert.equal(isDefeated(state, 'monster_duzhu'), false);
});
