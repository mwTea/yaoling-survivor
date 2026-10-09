import assert from 'node:assert/strict';
import test from 'node:test';

import { MockAdAdapter, adResultGrantsReward } from '../assets/scripts/platform/AdAdapter.ts';
import {
  canOfferRevive,
  computeReviveRestore,
  getDailyAdUses,
  recordReviveUse,
} from '../assets/scripts/battle/ReviveFlow.ts';
import { normalizeAccountSave } from '../assets/scripts/account/AccountSave.ts';
import { INITIAL_GAME_CONFIG } from '../assets/scripts/config/GameConfig.ts';

const CONFIG = INITIAL_GAME_CONFIG.ads.revive;
const DAY = '2026-10-05';
const STAGE = 'stage_mvp_01';
const PLACEMENT = CONFIG.placementId;
const enabled = () => true;

function freshSave() {
  return normalizeAccountSave({ createdAt: 1_000, lastSavedAt: 1_000 });
}

function runtime(used = 0) {
  return { usedThisBattle: used };
}

test('revive offer checks gate in order: placement, per-battle, per-day, stage', () => {
  const save = freshSave();
  assert.deepEqual(canOfferRevive(save, runtime(), CONFIG, DAY, STAGE, enabled), { ok: true });

  assert.deepEqual(
    canOfferRevive(save, runtime(), CONFIG, DAY, STAGE, () => false),
    { ok: false, reason: 'placement_disabled' },
  );
  assert.deepEqual(
    canOfferRevive(save, runtime(CONFIG.maxPerBattle), CONFIG, DAY, STAGE, enabled),
    { ok: false, reason: 'per_battle_limit' },
    'per-battle limit is a runtime counter, independent of the daily audit',
  );
  const used = runtime();
  for (let i = 0; i < CONFIG.maxPerDay; i += 1) {
    recordReviveUse(save, used, CONFIG, PLACEMENT, DAY);
  }
  assert.deepEqual(
    canOfferRevive(save, runtime(), CONFIG, DAY, STAGE, enabled),
    { ok: false, reason: 'per_day_limit' },
  );
  assert.deepEqual(
    canOfferRevive(freshSave(), runtime(), { ...CONFIG, disabledStageIds: ['stage_ghost'] }, DAY, 'stage_ghost', enabled),
    { ok: false, reason: 'stage_disabled' },
    'a stage listed in disabledStageIds never offers a revive',
  );
});

test('daily usage audit writes offerClaims keys and prunes previous days', () => {
  const save = freshSave();
  const used = runtime();
  recordReviveUse(save, used, CONFIG, PLACEMENT, '2026-10-04');
  recordReviveUse(save, used, CONFIG, PLACEMENT, '2026-10-05');
  assert.equal(used.usedThisBattle, 2);
  assert.deepEqual(save.offerClaims[`ad_${PLACEMENT}_2026-10-05`], { claimCount: 1 });
  assert.equal(save.offerClaims[`ad_${PLACEMENT}_2026-10-04`], undefined, 'previous day key pruned (bounded storage)');
  assert.equal(getDailyAdUses(save, PLACEMENT, '2026-10-05'), 1);
  assert.equal(getDailyAdUses(save, PLACEMENT, '2026-10-04'), 0, 'pruned key reads as zero');
  // 其他投放的键不受清理影响。
  save.offerClaims['ad_other_2026-10-04'] = { claimCount: 3 };
  recordReviveUse(save, used, CONFIG, PLACEMENT, '2026-10-05');
  assert.deepEqual(save.offerClaims['ad_other_2026-10-04'], { claimCount: 3 });
});

test('revive restore floors the hp ratio and passes invulnerable seconds', () => {
  assert.deepEqual(computeReviveRestore(CONFIG, 20), { hp: 10, invulnerableSeconds: 2 });
  assert.deepEqual(computeReviveRestore(CONFIG, 25), { hp: 12, invulnerableSeconds: 2 }, 'floors partial hp');
});

test('only a fully watched ad grants the reward (closed early/failed never do)', () => {
  assert.equal(adResultGrantsReward('rewarded'), true);
  assert.equal(adResultGrantsReward('closed_early'), false);
  assert.equal(adResultGrantsReward('failed'), false);
});

test('mock ad adapter simulates outcomes with explicit simulated-ads logging', async () => {
  const adapter = new MockAdAdapter();
  assert.equal(await adapter.show(PLACEMENT), 'rewarded');
  adapter.setOutcome('closed_early');
  assert.equal(await adapter.show(PLACEMENT), 'closed_early');
  adapter.setOutcome('failed');
  assert.equal(await adapter.show(PLACEMENT), 'failed');
  assert.equal(await adapter.load(PLACEMENT), true);
});
