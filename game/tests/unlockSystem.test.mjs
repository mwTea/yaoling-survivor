import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACCOUNT_AGE_DAY_MS,
  buildUnlockEvaluationState,
  computeAccountAgeDays,
  isChapterClearedForUnlock,
  isStageClearedForUnlock,
  isUnlockConditionMet,
  resolveFeatureEntryState,
} from '../assets/scripts/account/UnlockSystem.ts';
import { isChapterCompleted, isStageCleared } from '../assets/scripts/account/StageProgress.ts';
import { INITIAL_GAME_CONFIG } from '../assets/scripts/config/GameConfig.ts';

/** 合成解锁表（覆盖 show_condition 与未知开关路径）。 */
const SYNTHETIC_TABLES = {
  chapters: [{ id: 'chapter_a', stageIds: ['stage_a1', 'stage_a2'] }],
  stages: [{ id: 'stage_a1' }, { id: 'stage_a2' }],
  unlocks: [
    { id: 'unlock_free', featureId: 'free', condition: { kind: 'always' }, lockedBehavior: 'hide', lockedText: '', featureFlag: null },
    { id: 'unlock_lvl', featureId: 'lvl', condition: { kind: 'playerLevel', level: 3 }, lockedBehavior: 'show_condition', lockedText: '玩家等级 3 级解锁', featureFlag: null },
    { id: 'unlock_stage', featureId: 'stage', condition: { kind: 'stageClear', stageId: 'stage_a1' }, lockedBehavior: 'hide', lockedText: '', featureFlag: null },
    { id: 'unlock_chapter', featureId: 'chapter', condition: { kind: 'chapterClear', chapterId: 'chapter_a' }, lockedBehavior: 'hide', lockedText: '', featureFlag: null },
    { id: 'unlock_realm', featureId: 'realm', condition: { kind: 'realmIndex', realmIndex: 1 }, lockedBehavior: 'hide', lockedText: '', featureFlag: null },
    { id: 'unlock_age', featureId: 'age', condition: { kind: 'accountAgeDays', days: 7 }, lockedBehavior: 'hide', lockedText: '', featureFlag: null },
    { id: 'unlock_flagged', featureId: 'flagged', condition: { kind: 'always' }, lockedBehavior: 'hide', lockedText: '', featureFlag: 'some_flag' },
    { id: 'unlock_locked_text', featureId: 'locked_text', condition: { kind: 'always' }, lockedBehavior: 'hide', lockedText: '不应出现', featureFlag: null },
  ],
};

const EMPTY_RECORDS = {};

function stateWith(records, extra = {}) {
  return { stageRecords: records, playerLevel: 1, realmIndex: 0, accountAgeDays: 0, ...extra };
}

test('unlock conditions evaluate every kind with explicit parameters', () => {
  const tables = SYNTHETIC_TABLES;
  const clearedFirst = { 'stage_a1|diff_normal': { cleared: true } };
  const clearedBoth = {
    'stage_a1|diff_normal': { cleared: true },
    'stage_a2|diff_hard': { cleared: true },
  };

  assert.equal(isUnlockConditionMet(tables, stateWith(EMPTY_RECORDS), { kind: 'always' }), true);

  assert.equal(isUnlockConditionMet(tables, stateWith(EMPTY_RECORDS, { playerLevel: 2 }), { kind: 'playerLevel', level: 3 }), false);
  assert.equal(isUnlockConditionMet(tables, stateWith(EMPTY_RECORDS, { playerLevel: 3 }), { kind: 'playerLevel', level: 3 }), true);

  assert.equal(isUnlockConditionMet(tables, stateWith(EMPTY_RECORDS), { kind: 'stageClear', stageId: 'stage_a1' }), false);
  assert.equal(isUnlockConditionMet(tables, stateWith(clearedFirst), { kind: 'stageClear', stageId: 'stage_a1' }), true);

  assert.equal(isUnlockConditionMet(tables, stateWith(clearedFirst), { kind: 'chapterClear', chapterId: 'chapter_a' }), false);
  assert.equal(isUnlockConditionMet(tables, stateWith(clearedBoth), { kind: 'chapterClear', chapterId: 'chapter_a' }), true);

  assert.equal(isUnlockConditionMet(tables, stateWith(EMPTY_RECORDS, { realmIndex: 0 }), { kind: 'realmIndex', realmIndex: 1 }), false);
  assert.equal(isUnlockConditionMet(tables, stateWith(EMPTY_RECORDS, { realmIndex: 1 }), { kind: 'realmIndex', realmIndex: 1 }), true);

  assert.equal(isUnlockConditionMet(tables, stateWith(EMPTY_RECORDS, { accountAgeDays: 6 }), { kind: 'accountAgeDays', days: 7 }), false);
  assert.equal(isUnlockConditionMet(tables, stateWith(EMPTY_RECORDS, { accountAgeDays: 7 }), { kind: 'accountAgeDays', days: 7 }), true);
});

test('unlock stage/chapter checks agree with StageProgress on the same records', () => {
  const records = {
    'stage_a1|diff_normal': { highestStars: 2, cleared: true, firstClearClaimed: false, claimedStarRewardTiers: 0 },
    'stage_a2|diff_hard': { highestStars: 0, cleared: false, firstClearClaimed: false, claimedStarRewardTiers: 0 },
  };
  const state = stateWith(records);
  const tables = {
    chapters: [{ id: 'chapter_a', requiredChapterId: null, stageIds: ['stage_a1', 'stage_a2'] }],
    stages: [{ id: 'stage_a1' }, { id: 'stage_a2' }],
  };

  assert.equal(isStageClearedForUnlock(state, 'stage_a1'), isStageCleared({ stageRecords: records }, 'stage_a1'));
  assert.equal(isStageClearedForUnlock(state, 'stage_a2'), isStageCleared({ stageRecords: records }, 'stage_a2'));
  assert.equal(isChapterClearedForUnlock(tables, state, 'chapter_a'), isChapterCompleted(tables, { stageRecords: records }, 'chapter_a'));
  assert.equal(isChapterClearedForUnlock(tables, state, 'chapter_a'), false, 'one uncleared stage keeps the chapter locked');

  records['stage_a2|diff_hard'].cleared = true;
  assert.equal(isChapterClearedForUnlock(tables, state, 'chapter_a'), isChapterCompleted(tables, { stageRecords: records }, 'chapter_a'));
  assert.equal(isChapterClearedForUnlock(tables, state, 'chapter_a'), true);
});

test('unknown stage or chapter references fail fast in unlock conditions', () => {
  assert.throws(() => isUnlockConditionMet(SYNTHETIC_TABLES, stateWith(EMPTY_RECORDS), { kind: 'stageClear', stageId: 'stage_missing' }), /Unknown stage id/);
  assert.throws(() => isUnlockConditionMet(SYNTHETIC_TABLES, stateWith(EMPTY_RECORDS), { kind: 'chapterClear', chapterId: 'chapter_missing' }), /Unknown chapter id/);
  assert.throws(
    () =>
      isChapterClearedForUnlock(
        { chapters: [{ id: 'chapter_a', stageIds: ['stage_ghost'] }], stages: [], unlocks: [] },
        stateWith(EMPTY_RECORDS),
        'chapter_a',
      ),
    /Unknown stage id "stage_ghost"/,
  );
});

test('account age days floor to whole days and clamp clock rollback to zero', () => {
  const created = 1_700_000_000_000;
  assert.equal(computeAccountAgeDays(created, created + ACCOUNT_AGE_DAY_MS - 1), 0);
  assert.equal(computeAccountAgeDays(created, created + ACCOUNT_AGE_DAY_MS), 1);
  assert.equal(computeAccountAgeDays(created, created + 7.5 * ACCOUNT_AGE_DAY_MS), 7);
  assert.equal(computeAccountAgeDays(created, created - ACCOUNT_AGE_DAY_MS), 0, 'rollback never yields negative age');
  assert.equal(computeAccountAgeDays(0, created), 0, 'unknown creation time yields age 0');
});

test('buildUnlockEvaluationState prefers identity creation time and slices progress fields', () => {
  const now = 10 * ACCOUNT_AGE_DAY_MS;
  const save = {
    createdAt: 0,
    identity: { accountCreatedAt: now, localGuestId: '', wxOpenId: '', lastLoginAt: 0 },
    stageRecords: { 'stage_a1|diff_normal': { cleared: true } },
    playerLevel: 4,
    realmIndex: 2,
  };

  const state = buildUnlockEvaluationState(save, now + 3 * ACCOUNT_AGE_DAY_MS + 100);
  assert.equal(state.accountAgeDays, 3);
  assert.equal(state.playerLevel, 4);
  assert.equal(state.realmIndex, 2);
  assert.deepEqual(state.stageRecords, save.stageRecords);

  const legacy = buildUnlockEvaluationState({ ...save, identity: { ...save.identity, accountCreatedAt: 0 } }, now + 1 * ACCOUNT_AGE_DAY_MS);
  assert.equal(legacy.accountAgeDays, 0, 'createdAt=0 fallback yields age 0 (no fabricated history)');
});

test('resolveFeatureEntryState returns the three entry states from config data', () => {
  const flags = { isFlagEnabled: (flag) => flag === 'some_flag' };

  assert.deepEqual(resolveFeatureEntryState(SYNTHETIC_TABLES, stateWith(EMPTY_RECORDS), 'free', flags), { kind: 'normal' });
  assert.deepEqual(
    resolveFeatureEntryState(SYNTHETIC_TABLES, stateWith(EMPTY_RECORDS), 'lvl', flags),
    { kind: 'locked_visible', lockedText: '玩家等级 3 级解锁' },
    'locked text comes verbatim from config',
  );
  assert.deepEqual(resolveFeatureEntryState(SYNTHETIC_TABLES, stateWith(EMPTY_RECORDS, { playerLevel: 3 }), 'lvl', flags), { kind: 'normal' });
  assert.deepEqual(resolveFeatureEntryState(SYNTHETIC_TABLES, stateWith(EMPTY_RECORDS), 'stage', flags), { kind: 'hidden' });
  assert.deepEqual(resolveFeatureEntryState(SYNTHETIC_TABLES, stateWith(EMPTY_RECORDS), 'flagged', flags), { kind: 'normal' }, 'flag on keeps an always-unlocked feature visible');
  assert.equal(
    resolveFeatureEntryState(SYNTHETIC_TABLES, stateWith(EMPTY_RECORDS), 'flagged', { isFlagEnabled: () => false }).kind,
    'hidden',
    'flag off hides even an always-unlocked feature',
  );
  assert.equal(resolveFeatureEntryState(SYNTHETIC_TABLES, stateWith(EMPTY_RECORDS), 'no_such_feature', flags), null, 'unknown featureId is reported as unbound');
});

test('initial unlock table gates chapter-progression systems on stage clears', () => {
  const flags = { isFlagEnabled: () => true };
  const fresh = stateWith(EMPTY_RECORDS);
  const tables = INITIAL_GAME_CONFIG;

  // 首次进入：首页/关卡/基础法器恒可用。
  assert.deepEqual(resolveFeatureEntryState(tables, fresh, 'home', flags), { kind: 'normal' });
  assert.deepEqual(resolveFeatureEntryState(tables, fresh, 'stage_select', flags), { kind: 'normal' });
  assert.deepEqual(resolveFeatureEntryState(tables, fresh, 'base_weapon', flags), { kind: 'normal' });
  // 章节内推进：修行/灵兽=第1关，图鉴=第2关，商店=第3关；礼包=通关第一章；活动=境界1。
  assert.deepEqual(resolveFeatureEntryState(tables, fresh, 'realm', flags), { kind: 'hidden' });
  assert.deepEqual(resolveFeatureEntryState(tables, fresh, 'beast', flags), { kind: 'hidden' });
  assert.deepEqual(resolveFeatureEntryState(tables, fresh, 'codex', flags), { kind: 'hidden' });
  assert.deepEqual(resolveFeatureEntryState(tables, fresh, 'shop', flags), { kind: 'hidden' });
  assert.deepEqual(resolveFeatureEntryState(tables, fresh, 'offers', flags), { kind: 'hidden' });
  assert.deepEqual(resolveFeatureEntryState(tables, fresh, 'activities', flags), { kind: 'hidden' });

  // 通关第 1 关（首局结算）：修行/灵兽立即可用（GAME_LOOP §5 首次培养跳转前提）。
  const afterFirstVictory = stateWith({ 'stage_mvp_01|diff_normal': { cleared: true } });
  assert.deepEqual(resolveFeatureEntryState(tables, afterFirstVictory, 'realm', flags), { kind: 'normal' });
  assert.deepEqual(resolveFeatureEntryState(tables, afterFirstVictory, 'beast', flags), { kind: 'normal' });
  assert.equal(resolveFeatureEntryState(tables, afterFirstVictory, 'codex', flags).kind, 'hidden');
  assert.equal(resolveFeatureEntryState(tables, afterFirstVictory, 'shop', flags).kind, 'hidden');

  // 第 2/3 关逐级放开；第一章通关放开礼包。
  const afterSecond = stateWith({
    'stage_mvp_01|diff_normal': { cleared: true },
    'stage_qingyun_02|diff_normal': { cleared: true },
  });
  assert.deepEqual(resolveFeatureEntryState(tables, afterSecond, 'codex', flags), { kind: 'normal' });
  const afterThird = stateWith({
    'stage_mvp_01|diff_normal': { cleared: true },
    'stage_qingyun_02|diff_normal': { cleared: true },
    'stage_qingyun_03|diff_normal': { cleared: true },
  });
  assert.deepEqual(resolveFeatureEntryState(tables, afterThird, 'shop', flags), { kind: 'normal' });
  const afterChapter = stateWith({
    'stage_mvp_01|diff_normal': { cleared: true },
    'stage_qingyun_02|diff_normal': { cleared: true },
    'stage_qingyun_03|diff_normal': { cleared: true },
    'stage_qingyun_04|diff_normal': { cleared: true },
  });
  assert.deepEqual(resolveFeatureEntryState(tables, afterChapter, 'offers', flags), { kind: 'normal' });
  assert.equal(resolveFeatureEntryState(tables, afterChapter, 'activities', flags).kind, 'hidden', 'activities still wait for realm breakthrough');
});

test('feature flags intersect with unlock conditions at runtime', () => {
  // 开关关闭：已满足解锁条件的商店入口仍隐藏（与 FeatureFlags 取交集）。
  const flagsOff = { isFlagEnabled: (flag) => flag !== 'shop' };
  const clearedThird = stateWith({
    'stage_mvp_01|diff_normal': { cleared: true },
    'stage_qingyun_02|diff_normal': { cleared: true },
    'stage_qingyun_03|diff_normal': { cleared: true },
  });
  assert.equal(resolveFeatureEntryState(INITIAL_GAME_CONFIG, clearedThird, 'shop', flagsOff).kind, 'hidden');
});
