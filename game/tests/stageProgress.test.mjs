import assert from 'node:assert/strict';
import test from 'node:test';

import { EconomyService } from '../assets/scripts/economy/Economy.ts';
import { addAccountXp } from '../assets/scripts/account/PlayerLeveling.ts';
import {
  claimFirstClearMilestone,
  claimStarTierMilestone,
  claimStarTier,
  findStageOrThrow,
  getClaimableStarTiers,
  getClaimedStarTiers,
  getDefaultStageSelection,
  getHighestStars,
  isChapterCompleted,
  isChapterUnlocked,
  isDifficultyUnlocked,
  isFirstClearClaimed,
  isStageCleared,
  isStageUnlocked,
  markFirstClearClaimed,
  recordStageOutcome,
  resolveStageSelection,
  stageRecordKey,
  syncUnlockedChapters,
} from '../assets/scripts/account/StageProgress.ts';
import { buildStageRecordKey } from '../assets/scripts/account/AccountSave.ts';

/** 3 章节 × 每章 2 关的合成关卡表（每关 2 档难度）。 */
function makeTables() {
  const stage = (id, chapterId) => ({
    id,
    displayName: id,
    chapterId,
    duration: 60,
    activeMonsterSoftCap: 10,
    activeMonsterHardCap: 20,
    spawnMinRadius: 100,
    spawnMaxRadius: 200,
    playArea: { minX: -100, maxX: 100, minY: -100, maxY: 100 },
    waveIds: [],
    bossId: null,
    starConditions: [{ kind: 'clear' }, { kind: 'hpRatioAbove', ratio: 0.5 }, { kind: 'clear' }],
    difficulties: [
      { id: 'diff_normal', displayName: '普通', hpMultiplier: 1, speedMultiplier: 1, contactDamageMultiplier: 1, xpMultiplier: 1, rewardMultiplier: 1, requiredStarsOnPrevious: 0 },
      { id: 'diff_hard', displayName: '困难', hpMultiplier: 2, speedMultiplier: 1, contactDamageMultiplier: 1, xpMultiplier: 1.5, rewardMultiplier: 1.6, requiredStarsOnPrevious: 1 },
    ],
    milestoneRewards: {
      firstClear: { accountXp: 10, resources: { res_lingshi: 120 } },
      perStar: [
        { accountXp: 4, resources: { res_lingshi: 40 } },
        { accountXp: 6, resources: { res_lingshi: 60 } },
        { accountXp: 10, resources: { res_lingshi: 100 } },
      ],
    },
  });
  return {
    chapters: [
      { id: 'chapter_a', displayName: '甲', stageIds: ['stage_a1', 'stage_a2'], requiredChapterId: null },
      { id: 'chapter_b', displayName: '乙', stageIds: ['stage_b1', 'stage_b2'], requiredChapterId: 'chapter_a' },
      { id: 'chapter_c', displayName: '丙', stageIds: ['stage_c1', 'stage_c2'], requiredChapterId: 'chapter_b' },
    ],
    stages: [
      stage('stage_a1', 'chapter_a'),
      stage('stage_a2', 'chapter_a'),
      stage('stage_b1', 'chapter_b'),
      stage('stage_b2', 'chapter_b'),
      stage('stage_c1', 'chapter_c'),
      stage('stage_c2', 'chapter_c'),
    ],
  };
}

function makeState() {
  return { stageRecords: {}, unlockedChapterIds: [] };
}

test('stage record key format matches the save schema builder', () => {
  assert.equal(stageRecordKey('stage_mvp_01', 'diff_hard'), buildStageRecordKey('stage_mvp_01', 'diff_hard'));
});

test('default selection is first chapter, first stage, first difficulty', () => {
  const tables = makeTables();
  assert.deepEqual(getDefaultStageSelection(tables), { stageId: 'stage_a1', difficultyId: 'diff_normal' });
});

test('resolveStageSelection passes valid selections and fast-fails unknown ids', () => {
  const tables = makeTables();

  assert.deepEqual(resolveStageSelection(tables, null), { stageId: 'stage_a1', difficultyId: 'diff_normal' });
  assert.deepEqual(
    resolveStageSelection(tables, { stageId: 'stage_b2', difficultyId: 'diff_hard' }),
    { stageId: 'stage_b2', difficultyId: 'diff_hard' },
  );
  assert.throws(() => resolveStageSelection(tables, { stageId: 'stage_ghost', difficultyId: 'diff_normal' }));
  assert.throws(() => resolveStageSelection(tables, { stageId: 'stage_a1', difficultyId: 'diff_ghost' }));
  assert.throws(() => findStageOrThrow(tables, 'stage_ghost'));
});

test('chapter unlock follows the requiredChapterId chain and requires full completion', () => {
  const tables = makeTables();
  const state = makeState();

  assert.equal(isChapterUnlocked(tables, state, 'chapter_a'), true, 'root chapter always unlocked');
  assert.equal(isChapterUnlocked(tables, state, 'chapter_b'), false);
  assert.equal(isChapterCompleted(tables, state, 'chapter_a'), false);

  recordStageOutcome(state, 'stage_a1', 'diff_normal', { cleared: true, stars: 1 });
  assert.equal(isChapterCompleted(tables, state, 'chapter_a'), false, 'partial clears do not complete a chapter');

  recordStageOutcome(state, 'stage_a2', 'diff_hard', { cleared: true, stars: 2 });
  assert.equal(isChapterCompleted(tables, state, 'chapter_a'), true, 'any difficulty clear counts');
  assert.equal(isChapterUnlocked(tables, state, 'chapter_b'), true);
  assert.equal(isChapterUnlocked(tables, state, 'chapter_c'), false);
  assert.throws(() => isChapterUnlocked(tables, state, 'chapter_ghost'));
});

test('stage unlock follows chapter unlock and previous stage clears', () => {
  const tables = makeTables();
  const state = makeState();

  assert.equal(isStageUnlocked(tables, state, 'stage_a1'), true);
  assert.equal(isStageUnlocked(tables, state, 'stage_a2'), false, 'previous stage not cleared');
  assert.equal(isStageUnlocked(tables, state, 'stage_b1'), false, 'chapter locked');

  recordStageOutcome(state, 'stage_a1', 'diff_normal', { cleared: true, stars: 1 });
  assert.equal(isStageUnlocked(tables, state, 'stage_a2'), true);
  assert.equal(isStageUnlocked(tables, state, 'stage_b1'), false, 'chapter still incomplete');

  recordStageOutcome(state, 'stage_a2', 'diff_normal', { cleared: true, stars: 1 });
  assert.equal(isStageUnlocked(tables, state, 'stage_b1'), true);
  assert.throws(() => isStageUnlocked(tables, state, 'stage_ghost'));
});

test('difficulty unlock requires required stars on the previous tier', () => {
  const tables = makeTables();
  const state = makeState();

  assert.equal(isDifficultyUnlocked(tables, state, 'stage_a1', 'diff_normal'), true);
  assert.equal(isDifficultyUnlocked(tables, state, 'stage_a1', 'diff_hard'), false, 'no stars yet');

  recordStageOutcome(state, 'stage_a1', 'diff_normal', { cleared: true, stars: 1 });
  assert.equal(isDifficultyUnlocked(tables, state, 'stage_a1', 'diff_hard'), true);

  const fresh = makeState();
  recordStageOutcome(fresh, 'stage_a1', 'diff_normal', { cleared: true, stars: 0 });
  assert.equal(isDifficultyUnlocked(tables, fresh, 'stage_a1', 'diff_hard'), false, 'clear without a star is not enough');
  assert.throws(() => isDifficultyUnlocked(tables, makeState(), 'stage_a1', 'diff_ghost'));
});

test('stage outcome history only moves forward (stars and clears)', () => {
  const tables = makeTables();
  const state = makeState();

  recordStageOutcome(state, 'stage_a1', 'diff_normal', { cleared: true, stars: 3 });
  recordStageOutcome(state, 'stage_a1', 'diff_normal', { cleared: false, stars: 1 });
  assert.equal(getHighestStars(state, 'stage_a1', 'diff_normal'), 3, 'lower-star replays never regress');
  assert.equal(isStageCleared(state, 'stage_a1'), true, 'cleared never revoked');

  recordStageOutcome(state, 'stage_a1', 'diff_hard', { cleared: true, stars: 2 });
  assert.equal(getHighestStars(state, 'stage_a1', 'diff_hard'), 2, 'difficulties record independently');
  assert.equal(isStageCleared(state, 'stage_a1'), true);
  assert.equal(getHighestStars(state, 'stage_a1', 'diff_normal'), 3);

  // 星级钳制到 0～3。
  recordStageOutcome(state, 'stage_a1', 'diff_hard', { cleared: true, stars: 9 });
  assert.equal(getHighestStars(state, 'stage_a1', 'diff_hard'), 3);
});

test('syncUnlockedChapters adds newly unlocked chapters once and never removes them', () => {
  const tables = makeTables();
  const state = makeState();

  assert.deepEqual(syncUnlockedChapters(tables, state), ['chapter_a']);
  assert.deepEqual(state.unlockedChapterIds, ['chapter_a']);

  recordStageOutcome(state, 'stage_a1', 'diff_normal', { cleared: true, stars: 1 });
  recordStageOutcome(state, 'stage_a2', 'diff_normal', { cleared: true, stars: 1 });
  assert.deepEqual(syncUnlockedChapters(tables, state), ['chapter_b']);
  assert.deepEqual(syncUnlockedChapters(tables, state), [], 'repeat sync is idempotent');
  assert.deepEqual(state.unlockedChapterIds, ['chapter_a', 'chapter_b']);
});

test('milestone claim flags track first-clear and star tiers with a claimable remainder', () => {
  const state = makeState();

  assert.equal(isFirstClearClaimed(state, 'stage_a1', 'diff_normal'), false);
  assert.equal(getClaimableStarTiers(state, 'stage_a1', 'diff_normal'), 0);

  recordStageOutcome(state, 'stage_a1', 'diff_normal', { cleared: true, stars: 3 });
  assert.equal(getClaimableStarTiers(state, 'stage_a1', 'diff_normal'), 3);

  markFirstClearClaimed(state, 'stage_a1', 'diff_normal');
  markFirstClearClaimed(state, 'stage_a1', 'diff_normal');
  assert.equal(isFirstClearClaimed(state, 'stage_a1', 'diff_normal'), true, 'idempotent');

  claimStarTier(state, 'stage_a1', 'diff_normal');
  claimStarTier(state, 'stage_a1', 'diff_normal');
  assert.equal(getClaimedStarTiers(state, 'stage_a1', 'diff_normal'), 2);
  assert.equal(getClaimableStarTiers(state, 'stage_a1', 'diff_normal'), 1);
  assert.equal(getClaimedStarTiers(state, 'stage_a1', 'diff_hard'), 0, 'tiers are per difficulty');
});

function makeMilestoneSave() {
  const state = makeState();
  state.playerLevel = 1;
  state.playerXp = 0;
  state.balances = {};
  state.recentTransactions = [];
  return state;
}

function makeMilestoneTables() {
  return {
    playerLevel: { levelCurve: [{ level: 1, requiredXp: 60 }, { level: 2, requiredXp: 80 }] },
    stages: makeTables().stages,
  };
}

function makeEconomy() {
  return new EconomyService(
    [{ id: 'res_lingshi', displayName: '灵石', capacity: 9999 }],
    { txLogCapacity: 20 },
  );
}

test('claimFirstClearMilestone grants scaled rewards once and refuses repeats', () => {
  const tables = makeMilestoneTables();
  const state = makeMilestoneSave();
  const economy = makeEconomy();
  const ops = { addAccountXp };

  const locked = claimFirstClearMilestone(state, tables, economy, ops, 'stage_a1', 'diff_normal', { txId: 'm1', at: 1 });
  assert.equal(locked.ok, false);
  assert.equal(locked.reason, 'not_cleared');

  recordStageOutcome(state, 'stage_a1', 'diff_hard', { cleared: true, stars: 2 });
  const claimed = claimFirstClearMilestone(state, tables, economy, ops, 'stage_a1', 'diff_hard', { txId: 'm2', at: 2 });
  assert.equal(claimed.ok, true);
  assert.equal(claimed.accountXp, Math.floor(10 * 1.6), 'milestone xp scales with difficulty');
  assert.equal(claimed.resources.res_lingshi, Math.floor(120 * 1.6), 'fixture firstClear grants 120 lingshi');
  assert.equal(economy.getBalance(state, 'res_lingshi'), Math.floor(120 * 1.6));
  assert.equal(state.playerXp, Math.floor(10 * 1.6));
  assert.equal(isFirstClearClaimed(state, 'stage_a1', 'diff_hard'), true);
  assert.equal(state.recentTransactions.length, 1, 'grant leaves one audit entry');

  const balanceBefore = economy.getBalance(state, 'res_lingshi');
  const repeat = claimFirstClearMilestone(state, tables, economy, ops, 'stage_a1', 'diff_hard', { txId: 'm3', at: 3 });
  assert.equal(repeat.ok, false);
  assert.equal(repeat.reason, 'already_claimed');
  assert.equal(economy.getBalance(state, 'res_lingshi'), balanceBefore);

  const tier1 = claimStarTierMilestone(state, tables, economy, ops, 'stage_a1', 'diff_hard', { txId: 'm4', at: 4 });
  assert.equal(tier1.ok, true);
  const tier2 = claimStarTierMilestone(state, tables, economy, ops, 'stage_a1', 'diff_hard', { txId: 'm5', at: 5 });
  assert.equal(tier2.ok, true);
  assert.equal(getClaimableStarTiers(state, 'stage_a1', 'diff_hard'), 0);
  const tier3 = claimStarTierMilestone(state, tables, economy, ops, 'stage_a1', 'diff_hard', { txId: 'm6', at: 6 });
  assert.equal(tier3.ok, false);
  assert.equal(tier3.reason, 'already_claimed');

  assert.equal(claimFirstClearMilestone(state, tables, economy, ops, 'stage_ghost', 'diff_normal', { txId: 'm7', at: 7 }).reason, 'unknown_stage');
  assert.equal(claimFirstClearMilestone(state, tables, economy, ops, 'stage_a1', 'diff_ghost', { txId: 'm8', at: 8 }).reason, 'unknown_difficulty');
});
