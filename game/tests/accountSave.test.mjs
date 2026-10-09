import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACCOUNT_SAVE_SCHEMA_VERSION,
  ACCOUNT_SAVE_SCHEMA_VERSION_V1,
  ACCOUNT_SAVE_SCHEMA_VERSION_V2,
  ACCOUNT_SAVE_STORAGE_KEY,
  CORRUPT_SAVE_BACKUP_SUFFIX,
  MAX_RECENT_TRANSACTIONS,
  TASK_MAIN_PERIOD_KEY,
  AccountStore,
  buildStageRecordKey,
  createEmptyAccountSave,
  normalizeAccountSave,
  parseAccountSave,
  serializeAccountSave,
  upgradeAccountSaveV2ToV3,
} from '../assets/scripts/account/AccountSave.ts';
import { MemoryStorageAdapter } from '../assets/scripts/platform/StorageAdapter.ts';

/** v1 完整存档（V0.5 时代形状，用于迁移测试）。 */
function buildPopulatedV1Save(now = 1700000000000) {
  return {
    schemaVersion: ACCOUNT_SAVE_SCHEMA_VERSION_V1,
    createdAt: now,
    lastSavedAt: now,
    playerLevel: 7,
    playerXp: 320,
    realmIndex: 1,
    subRealmIndex: 3,
    weaponLevels: { weapon_qingxiao_sword: 4 },
    beasts: { beast_qinglong: { unlocked: true, level: 2, star: 1 } },
    deployedBeastId: 'beast_qinglong',
    balances: { res_lingshi: 900, res_xiuwei: 40 },
    recentTransactions: [
      { txId: 'tx-1', kind: 'reward_grant', deltas: { res_lingshi: 100 }, at: now },
      { txId: 'tx-2', kind: 'weapon_level_up', deltas: { res_lingshi: -80 }, at: now + 1 },
    ],
  };
}

/** v2 完整存档（V0.8 时代形状，各域非默认值，用于 v2→v3 迁移测试）。 */
function buildPopulatedV2Save(now = 1700000000000) {
  return {
    schemaVersion: ACCOUNT_SAVE_SCHEMA_VERSION_V2,
    createdAt: now,
    lastSavedAt: now,
    playerLevel: 7,
    playerXp: 320,
    realmIndex: 1,
    subRealmIndex: 3,
    stageRecords: {
      [buildStageRecordKey('stage_mvp_01', 'diff_normal')]: {
        highestStars: 3,
        cleared: true,
        firstClearClaimed: true,
        claimedStarRewardTiers: 2,
      },
    },
    unlockedChapterIds: ['chapter_01'],
    stageSelection: { stageId: 'stage_mvp_01', difficultyId: 'diff_normal' },
    weaponLevels: { weapon_qingxiao_sword: 4 },
    beasts: { beast_qinglong: { unlocked: true, level: 2, star: 1 } },
    deployedBeastId: 'beast_qinglong',
    balances: { res_lingshi: 900, res_xiuwei: 40 },
    taskBuckets: {
      main: { periodKey: 'main', progress: { task_main_01: 5 }, claimedTaskIds: ['task_main_01'] },
      daily: { periodKey: '2026-10-03', progress: { task_daily_01: 2 }, claimedTaskIds: [] },
      weekly: { periodKey: '2026-W40', progress: { task_weekly_01: 9 }, claimedTaskIds: ['task_weekly_01'] },
    },
    achievements: { ach_slayer: { progress: 42, claimedTier: 1 } },
    loginReward: { totalDays: 6, lastCountedDayKey: '2026-10-03', claimedTier: 5 },
    shop: { refreshDayKey: '2026-10-03', purchaseCounts: { shop_item_pill: 2 } },
    codex: { seenIds: ['monster_basic', 'boss_shiyao_general'], defeatedIds: ['monster_basic'] },
    offerClaims: { offer_growth_01: { claimCount: 1 } },
    activities: { activity_login_01: { status: 'open' } },
    recentTransactions: [
      { txId: 'tx-1', kind: 'reward_grant', deltas: { res_lingshi: 100 }, at: now },
      { txId: 'tx-2', kind: 'weapon_level_up', deltas: { res_lingshi: -80 }, at: now + 1 },
    ],
  };
}

/** v3 完整存档（当前形状，各域非默认值，用于往返测试）。 */
function buildPopulatedV3Save(now = 1700000000000) {
  return {
    ...buildPopulatedV2Save(now),
    schemaVersion: ACCOUNT_SAVE_SCHEMA_VERSION,
    identity: {
      localGuestId: 'guest_ab12cd34',
      wxOpenId: 'oX-1234567890',
      accountCreatedAt: now,
      lastLoginAt: now + 5000,
    },
    settings: { bgmVolume: 60, sfxVolume: 80, vibrationEnabled: false, qualityTier: 1, agreementVersion: 2 },
    guide: { scriptVersion: 1, completedStepIds: ['guide_move', 'guide_attack', 'guide_pickup'] },
    cloudSync: { lastSyncedAt: now + 9000, lastSyncSource: 'upload' },
  };
}

test('fresh save has explicit domain defaults and no shared vague level field', () => {
  const fresh = createEmptyAccountSave(1000);

  assert.equal(fresh.schemaVersion, ACCOUNT_SAVE_SCHEMA_VERSION);
  assert.equal(fresh.playerLevel, 1);
  assert.equal(fresh.playerXp, 0);
  assert.equal(fresh.realmIndex, 0);
  assert.equal(fresh.subRealmIndex, 0);
  assert.deepEqual(fresh.weaponLevels, {});
  assert.deepEqual(fresh.beasts, {});
  assert.equal(fresh.deployedBeastId, null);
  assert.deepEqual(fresh.balances, {});
  assert.deepEqual(fresh.recentTransactions, []);
  assert.equal(fresh.createdAt, 1000);
  // v2 新域默认值（V08-01）。
  assert.deepEqual(fresh.stageRecords, {});
  assert.deepEqual(fresh.unlockedChapterIds, []);
  assert.equal(fresh.stageSelection, null);
  assert.deepEqual(fresh.taskBuckets.main, { periodKey: 'main', progress: {}, claimedTaskIds: [] });
  assert.deepEqual(fresh.taskBuckets.daily, { periodKey: '', progress: {}, claimedTaskIds: [] });
  assert.deepEqual(fresh.taskBuckets.weekly, { periodKey: '', progress: {}, claimedTaskIds: [] });
  assert.deepEqual(fresh.achievements, {});
  assert.deepEqual(fresh.loginReward, { totalDays: 0, lastCountedDayKey: '', claimedTier: 0 });
  assert.deepEqual(fresh.shop, { refreshDayKey: '', purchaseCounts: {} });
  assert.deepEqual(fresh.codex, { seenIds: [], defeatedIds: [] });
  assert.deepEqual(fresh.offerClaims, {});
  assert.deepEqual(fresh.activities, {});
  // v3 新域默认值（V10-01）。
  assert.deepEqual(fresh.identity, { localGuestId: '', wxOpenId: '', accountCreatedAt: 1000, lastLoginAt: 0 });
  assert.deepEqual(fresh.settings, { bgmVolume: 100, sfxVolume: 100, vibrationEnabled: true, qualityTier: 0, agreementVersion: 0 });
  assert.deepEqual(fresh.guide, { scriptVersion: 0, completedStepIds: [] });
  assert.deepEqual(fresh.cloudSync, { lastSyncedAt: 0, lastSyncSource: '' });
});

test('stage record key joins stage and difficulty ids with a stable separator', () => {
  assert.equal(buildStageRecordKey('stage_mvp_01', 'diff_normal'), 'stage_mvp_01|diff_normal');
  assert.notEqual(
    buildStageRecordKey('stage_a', 'diff_1'),
    buildStageRecordKey('stage_a_diff_1', ''),
  );
});

test('serialize/parse roundtrip preserves all v3 fields and returns a new object', () => {
  const original = buildPopulatedV3Save();
  const raw = serializeAccountSave(original);
  const parsed = parseAccountSave(raw);

  assert.ok(parsed.ok);
  if (!parsed.ok) return;
  assert.equal(parsed.data.schemaVersion, ACCOUNT_SAVE_SCHEMA_VERSION);
  assert.deepEqual(parsed.data, original);
  assert.notEqual(parsed.data, original, 'parse must rebuild the state object');
  assert.notEqual(parsed.data.beasts, original.beasts, 'nested containers are rebuilt too');
  assert.notEqual(parsed.data.taskBuckets, original.taskBuckets);
  assert.notEqual(parsed.data.stageRecords, original.stageRecords);
  assert.notEqual(parsed.data.identity, original.identity);
  assert.notEqual(parsed.data.settings, original.settings);
  assert.notEqual(parsed.data.guide, original.guide);
  assert.notEqual(parsed.data.cloudSync, original.cloudSync);
});

test('parse rejects empty payload, invalid json and non-object payloads', () => {
  assert.deepEqual(parseAccountSave(''), { ok: false, reason: 'empty_payload' });
  assert.deepEqual(parseAccountSave('not json{{{'), { ok: false, reason: 'invalid_json' });
  assert.deepEqual(parseAccountSave('42'), { ok: false, reason: 'not_an_object' });
  assert.deepEqual(parseAccountSave('["array"]'), { ok: false, reason: 'not_an_object' });
});

test('parse rejects unsupported save versions instead of silently downgrading', () => {
  const raw = JSON.stringify({ ...buildPopulatedV2Save(), schemaVersion: 99 });
  assert.deepEqual(parseAccountSave(raw), { ok: false, reason: 'unsupported_save_version' });

  const v0 = JSON.stringify({ ...buildPopulatedV1Save(), schemaVersion: 0 });
  assert.deepEqual(parseAccountSave(v0), { ok: false, reason: 'unsupported_save_version' });
});

test('v2 save migrates to v3 losslessly: legacy fields preserved, new domains defaulted', () => {
  const v2 = buildPopulatedV2Save();
  const migrated = upgradeAccountSaveV2ToV3(v2);

  assert.equal(migrated.schemaVersion, ACCOUNT_SAVE_SCHEMA_VERSION);
  // v2 原字段全保留（无损）。
  assert.equal(migrated.createdAt, v2.createdAt);
  assert.equal(migrated.lastSavedAt, v2.lastSavedAt);
  assert.equal(migrated.playerLevel, 7);
  assert.equal(migrated.playerXp, 320);
  assert.equal(migrated.realmIndex, 1);
  assert.equal(migrated.subRealmIndex, 3);
  assert.deepEqual(migrated.stageRecords, v2.stageRecords);
  assert.deepEqual(migrated.unlockedChapterIds, ['chapter_01']);
  assert.deepEqual(migrated.stageSelection, { stageId: 'stage_mvp_01', difficultyId: 'diff_normal' });
  assert.deepEqual(migrated.weaponLevels, { weapon_qingxiao_sword: 4 });
  assert.deepEqual(migrated.beasts, { beast_qinglong: { unlocked: true, level: 2, star: 1 } });
  assert.equal(migrated.deployedBeastId, 'beast_qinglong');
  assert.deepEqual(migrated.balances, { res_lingshi: 900, res_xiuwei: 40 });
  assert.equal(migrated.taskBuckets.main.periodKey, TASK_MAIN_PERIOD_KEY);
  assert.equal(migrated.taskBuckets.daily.periodKey, '2026-10-03');
  assert.equal(migrated.taskBuckets.weekly.claimedTaskIds.length, 1);
  assert.deepEqual(migrated.achievements, { ach_slayer: { progress: 42, claimedTier: 1 } });
  assert.deepEqual(migrated.loginReward, { totalDays: 6, lastCountedDayKey: '2026-10-03', claimedTier: 5 });
  assert.deepEqual(migrated.shop, { refreshDayKey: '2026-10-03', purchaseCounts: { shop_item_pill: 2 } });
  assert.deepEqual(migrated.codex, v2.codex);
  assert.deepEqual(migrated.offerClaims, { offer_growth_01: { claimCount: 1 } });
  assert.deepEqual(migrated.activities, { activity_login_01: { status: 'open' } });
  assert.equal(migrated.recentTransactions.length, 2);
  // v3 新域补默认值（空串/0 占位，语义由后续任务赋予）。
  assert.deepEqual(migrated.identity, { localGuestId: '', wxOpenId: '', accountCreatedAt: 0, lastLoginAt: 0 });
  assert.deepEqual(migrated.settings, { bgmVolume: 100, sfxVolume: 100, vibrationEnabled: true, qualityTier: 0, agreementVersion: 0 });
  assert.deepEqual(migrated.guide, { scriptVersion: 0, completedStepIds: [] });
  assert.deepEqual(migrated.cloudSync, { lastSyncedAt: 0, lastSyncSource: '' });
});

test('v1 save migrates losslessly through the same normalize path (v2 fields defaulted)', () => {
  const migrated = upgradeAccountSaveV2ToV3(buildPopulatedV1Save());

  assert.equal(migrated.schemaVersion, ACCOUNT_SAVE_SCHEMA_VERSION);
  assert.equal(migrated.playerLevel, 7);
  assert.equal(migrated.deployedBeastId, 'beast_qinglong');
  assert.deepEqual(migrated.balances, { res_lingshi: 900, res_xiuwei: 40 });
  assert.equal(migrated.recentTransactions.length, 2);
  // v2 容器补默认值。
  assert.deepEqual(migrated.stageRecords, {});
  assert.deepEqual(migrated.unlockedChapterIds, []);
  assert.equal(migrated.stageSelection, null);
  assert.deepEqual(migrated.taskBuckets.main, { periodKey: TASK_MAIN_PERIOD_KEY, progress: {}, claimedTaskIds: [] });
  // v3 新域补默认值。
  assert.deepEqual(migrated.identity, { localGuestId: '', wxOpenId: '', accountCreatedAt: 0, lastLoginAt: 0 });
  assert.deepEqual(migrated.settings, { bgmVolume: 100, sfxVolume: 100, vibrationEnabled: true, qualityTier: 0, agreementVersion: 0 });
  assert.deepEqual(migrated.guide, { scriptVersion: 0, completedStepIds: [] });
  assert.deepEqual(migrated.cloudSync, { lastSyncedAt: 0, lastSyncSource: '' });
});

test('migration is idempotent: migrating migrated output (and serialized v3) changes nothing', () => {
  const once = upgradeAccountSaveV2ToV3(buildPopulatedV2Save());
  const twice = upgradeAccountSaveV2ToV3(once);
  assert.deepEqual(twice, once, 'v2 -> v3 -> v3 is stable');

  const v3 = buildPopulatedV3Save();
  assert.deepEqual(upgradeAccountSaveV2ToV3(v3), v3, 'v3 data passes through unchanged');

  // 序列化往返后再迁移同样稳定（存档反复加载不漂移）。
  const reparsed = parseAccountSave(serializeAccountSave(once));
  assert.ok(reparsed.ok);
  if (!reparsed.ok) return;
  assert.deepEqual(reparsed.data, once);
});

test('parse auto-migrates stored v1 payloads', () => {
  const parsed = parseAccountSave(JSON.stringify(buildPopulatedV1Save()));

  assert.ok(parsed.ok);
  if (!parsed.ok) return;
  assert.equal(parsed.data.schemaVersion, ACCOUNT_SAVE_SCHEMA_VERSION);
  assert.equal(parsed.data.playerLevel, 7);
  assert.equal(parsed.data.deployedBeastId, 'beast_qinglong');
  assert.deepEqual(parsed.data.loginReward, { totalDays: 0, lastCountedDayKey: '', claimedTier: 0 });
  assert.deepEqual(parsed.data.guide, { scriptVersion: 0, completedStepIds: [] });
});

test('parse auto-migrates stored v2 payloads', () => {
  const parsed = parseAccountSave(JSON.stringify(buildPopulatedV2Save()));

  assert.ok(parsed.ok);
  if (!parsed.ok) return;
  assert.equal(parsed.data.schemaVersion, ACCOUNT_SAVE_SCHEMA_VERSION);
  assert.equal(parsed.data.playerLevel, 7);
  assert.deepEqual(parsed.data.stageSelection, { stageId: 'stage_mvp_01', difficultyId: 'diff_normal' });
  assert.deepEqual(parsed.data.identity, { localGuestId: '', wxOpenId: '', accountCreatedAt: 0, lastLoginAt: 0 });
  assert.deepEqual(parsed.data.settings, { bgmVolume: 100, sfxVolume: 100, vibrationEnabled: true, qualityTier: 0, agreementVersion: 0 });
  assert.deepEqual(parsed.data.cloudSync, { lastSyncedAt: 0, lastSyncSource: '' });
});

test('normalize repairs wrong-typed and out-of-range fields to safe defaults', () => {
  const data = normalizeAccountSave({
    playerLevel: 'x',
    playerXp: -5,
    realmIndex: 2.9,
    subRealmIndex: -1,
    weaponLevels: { weapon_qingxiao_sword: 0, '': 9, broken: 'n/a' },
    beasts: { beast_qinglong: { unlocked: 1, level: '3', star: -2 }, broken: 'x' },
    deployedBeastId: '',
    balances: { res_lingshi: -10, res_xiuwei: 3.7 },
    recentTransactions: 'oops',
    stageRecords: {
      [buildStageRecordKey('stage_mvp_01', 'diff_hard')]: { highestStars: 9, cleared: 'yes', firstClearClaimed: true, claimedStarRewardTiers: -3 },
      broken: 'x',
    },
    unlockedChapterIds: ['chapter_01', 'chapter_01', '', 42, 'chapter_02'],
    stageSelection: { stageId: 'stage_mvp_01', difficultyId: '' },
    taskBuckets: { main: { periodKey: '', progress: { task_main_01: -2 }, claimedTaskIds: ['ok', 'ok', ''] }, daily: 'oops' },
    achievements: { ach_slayer: { progress: 'x', claimedTier: 1.8 }, broken: null },
    loginReward: { totalDays: -1, lastCountedDayKey: 7, claimedTier: '3' },
    shop: { refreshDayKey: null, purchaseCounts: { shop_item_pill: -5 } },
    codex: { seenIds: 'oops', defeatedIds: ['monster_basic', 'monster_basic'] },
    offerClaims: { offer_growth_01: { claimCount: -1 }, broken: 'x' },
    activities: { activity_login_01: { status: 0 }, broken: null },
    identity: { localGuestId: 7, wxOpenId: '', accountCreatedAt: -5, lastLoginAt: 2.9 },
    settings: { bgmVolume: 101, sfxVolume: -3, vibrationEnabled: 'yes', qualityTier: 9, agreementVersion: -1 },
    guide: { scriptVersion: -2, completedStepIds: ['guide_move', 'guide_move', '', 42, 'guide_attack'] },
    cloudSync: { lastSyncedAt: 'x', lastSyncSource: 0 },
  });

  assert.equal(data.playerLevel, 1);
  assert.equal(data.playerXp, 0);
  assert.equal(data.realmIndex, 2, 'finite floats floor into valid ints');
  assert.equal(data.subRealmIndex, 0);
  assert.deepEqual(data.weaponLevels, { weapon_qingxiao_sword: 1, broken: 1 });
  assert.deepEqual(data.beasts, {
    beast_qinglong: { unlocked: false, level: 1, star: 0 },
  });
  assert.equal(data.deployedBeastId, null);
  assert.deepEqual(data.balances, { res_lingshi: 0, res_xiuwei: 3 });
  assert.deepEqual(data.recentTransactions, []);
  // v2 新域修复。
  assert.deepEqual(data.stageRecords, {
    [buildStageRecordKey('stage_mvp_01', 'diff_hard')]: {
      highestStars: 3,
      cleared: false,
      firstClearClaimed: true,
      claimedStarRewardTiers: 0,
    },
  });
  assert.deepEqual(data.unlockedChapterIds, ['chapter_01', 'chapter_02'], 'dedupes and drops invalid items');
  assert.equal(data.stageSelection, null, 'selection missing a required id falls back to null');
  assert.deepEqual(data.taskBuckets.main.progress, { task_main_01: 0 });
  assert.deepEqual(data.taskBuckets.main.claimedTaskIds, ['ok']);
  assert.equal(data.taskBuckets.main.periodKey, 'main', 'empty main period key restores the default');
  assert.deepEqual(data.taskBuckets.daily, { periodKey: '', progress: {}, claimedTaskIds: [] });
  assert.deepEqual(data.achievements, { ach_slayer: { progress: 0, claimedTier: 1 } });
  assert.deepEqual(data.loginReward, { totalDays: 0, lastCountedDayKey: '', claimedTier: 0 });
  assert.deepEqual(data.shop, { refreshDayKey: '', purchaseCounts: { shop_item_pill: 0 } });
  assert.deepEqual(data.codex, { seenIds: [], defeatedIds: ['monster_basic'] });
  assert.deepEqual(data.offerClaims, { offer_growth_01: { claimCount: 0 } });
  assert.deepEqual(data.activities, { activity_login_01: { status: '' } });
  // v3 新域修复（V10-01）。
  assert.deepEqual(data.identity, { localGuestId: '', wxOpenId: '', accountCreatedAt: 0, lastLoginAt: 2 },
    'non-string ids fall back to empty, negative timestamps to 0, finite floats floor');
  assert.deepEqual(data.settings, { bgmVolume: 100, sfxVolume: 100, vibrationEnabled: true, qualityTier: 2, agreementVersion: 0 },
    'volumes clamp into 0..100, invalid boolean/enum falls back to default');
  assert.deepEqual(data.guide, { scriptVersion: 0, completedStepIds: ['guide_move', 'guide_attack'] },
    'step ids dedupe and drop invalid items');
  assert.deepEqual(data.cloudSync, { lastSyncedAt: 0, lastSyncSource: '' });
});

test('transaction log keeps only the most recent entries with valid shapes', () => {
  const entries = [];
  for (let i = 0; i < MAX_RECENT_TRANSACTIONS + 5; i++) {
    entries.push({ txId: `tx-${i}`, kind: 'reward_grant', deltas: { res_lingshi: i }, at: i });
  }
  entries.unshift({ broken: true });

  const data = normalizeAccountSave({ recentTransactions: entries });

  assert.equal(data.recentTransactions.length, MAX_RECENT_TRANSACTIONS);
  assert.equal(data.recentTransactions[0].txId, 'tx-5', 'oldest valid entries are dropped');
  assert.equal(
    data.recentTransactions[data.recentTransactions.length - 1].txId,
    `tx-${MAX_RECENT_TRANSACTIONS + 4}`,
    'newest entries survive at the tail',
  );
});

test('store starts a new save and persists it immediately when none exists', () => {
  const storage = new MemoryStorageAdapter();
  const store = new AccountStore(storage, () => 1000);

  assert.equal(store.hasSave(), false);
  const state = store.load();

  assert.equal(state.playerLevel, 1);
  assert.equal(store.lastResetReason, 'no_existing_save');
  assert.equal(store.hasSave(), true);
  const stored = JSON.parse(storage.getString(ACCOUNT_SAVE_STORAGE_KEY));
  assert.equal(stored.createdAt, 1000);
  assert.equal(stored.lastSavedAt, 1000);
});

test('store roundtrips committed changes across instances', () => {
  const storage = new MemoryStorageAdapter();
  const now = { value: 1000 };
  const store = new AccountStore(storage, () => now.value);

  const state = store.load();
  const updated = {
    ...state,
    playerLevel: 3,
    balances: { ...state.balances, res_lingshi: 250 },
    beasts: { ...state.beasts, beast_qinglong: { unlocked: true, level: 1, star: 0 } },
    deployedBeastId: 'beast_qinglong',
  };
  now.value = 2000;
  store.save(updated);

  const reloaded = new AccountStore(storage, () => now.value).load();
  assert.equal(reloaded.playerLevel, 3);
  assert.equal(reloaded.balances.res_lingshi, 250);
  assert.equal(reloaded.deployedBeastId, 'beast_qinglong');
  assert.equal(reloaded.lastSavedAt, 2000, 'save stamps lastSavedAt with injected clock');
  assert.equal(reloaded.createdAt, 1000, 'createdAt is preserved');
  assert.equal(new AccountStore(storage).lastResetReason, null);
});

test('store auto-migrates a stored v1 save to the current schema without resetting', () => {
  const storage = new MemoryStorageAdapter();
  storage.setString(ACCOUNT_SAVE_STORAGE_KEY, JSON.stringify(buildPopulatedV1Save()));

  const store = new AccountStore(storage, () => 1000);
  const state = store.load();

  assert.equal(state.schemaVersion, ACCOUNT_SAVE_SCHEMA_VERSION);
  assert.equal(store.lastResetReason, null, 'migration is not a reset');
  assert.equal(state.playerLevel, 7, 'legacy progress survives');
  assert.equal(state.deployedBeastId, 'beast_qinglong');
  assert.deepEqual(state.shop, { refreshDayKey: '', purchaseCounts: {} }, 'new domains are defaulted');
  assert.deepEqual(state.settings, { bgmVolume: 100, sfxVolume: 100, vibrationEnabled: true, qualityTier: 0, agreementVersion: 0 });
  // 未显式落盘前存储仍是 v1 原文（迁移确定性幂等，下次 save 自然写入当前版本）。
  const stored = JSON.parse(storage.getString(ACCOUNT_SAVE_STORAGE_KEY));
  assert.equal(stored.schemaVersion, ACCOUNT_SAVE_SCHEMA_VERSION_V1);
});

test('store auto-migrates a stored v2 save to v3 without resetting', () => {
  const storage = new MemoryStorageAdapter();
  storage.setString(ACCOUNT_SAVE_STORAGE_KEY, JSON.stringify(buildPopulatedV2Save()));

  const store = new AccountStore(storage, () => 1000);
  const state = store.load();

  assert.equal(state.schemaVersion, ACCOUNT_SAVE_SCHEMA_VERSION);
  assert.equal(store.lastResetReason, null, 'migration is not a reset');
  assert.equal(state.playerLevel, 7, 'v2 progress survives');
  assert.equal(state.settings.bgmVolume, 100, 'v3 domains are defaulted');
  assert.deepEqual(state.guide, { scriptVersion: 0, completedStepIds: [] });
  const stored = JSON.parse(storage.getString(ACCOUNT_SAVE_STORAGE_KEY));
  assert.equal(stored.schemaVersion, ACCOUNT_SAVE_SCHEMA_VERSION_V2, 'storage untouched until next save');
});

test('store backs up corrupt payloads and recovers with a fresh save', () => {
  const storage = new MemoryStorageAdapter();
  storage.setString(ACCOUNT_SAVE_STORAGE_KEY, '{oops');

  const store = new AccountStore(storage, () => 1000);
  const state = store.load();

  assert.equal(state.playerLevel, 1, 'corrupt save falls back to fresh state');
  assert.equal(store.lastResetReason, 'invalid_json');
  assert.equal(storage.getString(ACCOUNT_SAVE_STORAGE_KEY + CORRUPT_SAVE_BACKUP_SUFFIX), '{oops');
  const stored = JSON.parse(storage.getString(ACCOUNT_SAVE_STORAGE_KEY));
  assert.equal(stored.createdAt, 1000, 'fresh save persisted immediately');
});

test('store backs up unsupported versions rather than loading them', () => {
  const storage = new MemoryStorageAdapter();
  const futureRaw = JSON.stringify({ ...buildPopulatedV2Save(), schemaVersion: 99 });
  storage.setString(ACCOUNT_SAVE_STORAGE_KEY, futureRaw);

  const store = new AccountStore(storage, () => 1000);
  const state = store.load();

  assert.equal(state.playerLevel, 1);
  assert.equal(store.lastResetReason, 'unsupported_save_version');
  assert.equal(storage.getString(ACCOUNT_SAVE_STORAGE_KEY + CORRUPT_SAVE_BACKUP_SUFFIX), futureRaw);
});

test('store caches the working state and does not rewrite storage on load', () => {
  const storage = new MemoryStorageAdapter();
  const store = new AccountStore(storage, () => 1000);
  const first = store.load();
  store.save({ ...first, playerLevel: 9 });

  const second = store.load();

  assert.equal(second.playerLevel, 9);
  assert.equal(second, store.load(), 'cached working state is returned');
  const stored = JSON.parse(storage.getString(ACCOUNT_SAVE_STORAGE_KEY));
  assert.equal(stored.lastSavedAt, 1000, 'load does not restamp storage');
});

test('store resetToNewSave discards progress and persists a fresh v3 save', () => {
  const storage = new MemoryStorageAdapter();
  const store = new AccountStore(storage, () => 5000);
  const first = store.load();
  store.save({
    ...first,
    playerLevel: 9,
    stageSelection: { stageId: 'stage_qingyun_02', difficultyId: 'diff_hard' },
    identity: { ...first.identity, localGuestId: 'guest_keepme', wxOpenId: 'oX-keepme', lastLoginAt: 6000 },
    settings: { ...first.settings, bgmVolume: 30, vibrationEnabled: false, qualityTier: 2, agreementVersion: 3 },
    guide: { scriptVersion: 1, completedStepIds: ['guide_move'] },
    cloudSync: { lastSyncedAt: 6500, lastSyncSource: 'upload' },
  });

  const fresh = store.resetToNewSave();

  assert.equal(fresh.playerLevel, 1, 'progress discarded');
  assert.equal(fresh.stageSelection, null, 'selection cleared');
  assert.equal(fresh.schemaVersion, ACCOUNT_SAVE_SCHEMA_VERSION);
  assert.equal(fresh.createdAt, 5000);
  // v3 新域清档后恢复默认（身份/设置/引导/云同步全部归零占位）。
  assert.deepEqual(fresh.identity, { localGuestId: '', wxOpenId: '', accountCreatedAt: 5000, lastLoginAt: 0 });
  assert.deepEqual(fresh.settings, { bgmVolume: 100, sfxVolume: 100, vibrationEnabled: true, qualityTier: 0, agreementVersion: 0 });
  assert.deepEqual(fresh.guide, { scriptVersion: 0, completedStepIds: [] });
  assert.deepEqual(fresh.cloudSync, { lastSyncedAt: 0, lastSyncSource: '' });
  assert.equal(store.lastResetReason, null, 'explicit reset is not a failure');
  const stored = JSON.parse(storage.getString(ACCOUNT_SAVE_STORAGE_KEY));
  assert.equal(stored.playerLevel, 1, 'fresh save persisted immediately');
  assert.equal(store.load().playerLevel, 1, 'working state replaced (stamped copy cached)');
});
