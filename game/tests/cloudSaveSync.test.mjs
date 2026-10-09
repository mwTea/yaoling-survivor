import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CLOUD_SAVE_UPLOAD_MIN_INTERVAL_MS,
  CloudSaveController,
  MockCloudSaveAdapter,
  buildCloudSavePayload,
  canUploadNow,
  computeChecksum,
  decideSyncDirection,
} from '../assets/scripts/platform/CloudSaveController.ts';
import {
  AccountStore,
  ACCOUNT_SAVE_SCHEMA_VERSION,
  serializeAccountSave,
} from '../assets/scripts/account/AccountSave.ts';
import { MemoryStorageAdapter } from '../assets/scripts/platform/StorageAdapter.ts';
import { TimeService } from '../assets/scripts/platform/TimeService.ts';

const OPENID = 'oX-test-openid';

function makeSave(playerLevel, savedAt = 1_000_000) {
  const store = new AccountStore(new MemoryStorageAdapter(), () => savedAt);
  const save = store.load();
  save.playerLevel = playerLevel;
  return save;
}

function payloadOf(save) {
  return buildCloudSavePayload(OPENID, save, serializeAccountSave);
}

function makeController(adapter, storage, time) {
  const store = new AccountStore(storage, () => time.now());
  store.load();
  const controller = new CloudSaveController({
    adapter,
    store,
    time,
    getOpenid: () => OPENID,
    currentSchemaVersion: ACCOUNT_SAVE_SCHEMA_VERSION,
    serialize: serializeAccountSave,
    parse: (raw) => {
      const parsed = JSON.parse(raw);
      return typeof parsed?.playerLevel === 'number' ? { ok: true, data: parsed } : { ok: false };
    },
  });
  return { controller, store };
}

test('checksum is deterministic and detects any payload change', () => {
  assert.equal(computeChecksum('abc'), computeChecksum('abc'));
  assert.notEqual(computeChecksum('abc'), computeChecksum('abd'));
  assert.match(computeChecksum(''), /^[0-9a-f]{8}$/);
});

test('sync direction follows the strict lastSavedAt rule with no silent overwrite', () => {
  const local = payloadOf(makeSave(3));
  const currentSchema = ACCOUNT_SAVE_SCHEMA_VERSION;

  assert.deepEqual(decideSyncDirection(local, null, currentSchema), { direction: 'upload' }, 'no cloud doc uploads');

  const sameContent = { ...local };
  assert.deepEqual(decideSyncDirection(local, sameContent, currentSchema), { direction: 'in_sync' });

  const cloudOlder = { ...payloadOf(makeSave(2)), lastSavedAt: local.lastSavedAt - 1000 };
  assert.deepEqual(decideSyncDirection(local, cloudOlder, currentSchema), { direction: 'upload' });

  const cloudNewer = { ...payloadOf(makeSave(9)), lastSavedAt: local.lastSavedAt + 1000 };
  assert.deepEqual(decideSyncDirection(local, cloudNewer, currentSchema), { direction: 'download' });

  const sameTimeDifferentContent = { ...payloadOf(makeSave(2)), lastSavedAt: local.lastSavedAt };
  assert.deepEqual(decideSyncDirection(local, sameTimeDifferentContent, currentSchema), {
    direction: 'conflict',
    reason: 'same_timestamp_different_content',
  }, 'identical timestamps with different content never overwrite either side');

  const futureSchema = { ...cloudNewer, schemaVersion: currentSchema + 1 };
  assert.deepEqual(decideSyncDirection(local, futureSchema, currentSchema), {
    direction: 'conflict',
    reason: 'cloud_schema_ahead',
  }, 'a newer cloud schema never downgrades or overwrites local');
});

test('upload throttle requires the min interval since last success', () => {
  assert.equal(canUploadNow(0, { lastUploadAt: -1 }), true, 'first upload always allowed');
  assert.equal(canUploadNow(CLOUD_SAVE_UPLOAD_MIN_INTERVAL_MS - 1, { lastUploadAt: 0 }), false);
  assert.equal(canUploadNow(CLOUD_SAVE_UPLOAD_MIN_INTERVAL_MS, { lastUploadAt: 0 }), true);
});

test('startup sync uploads a local-newer save and records cloud sync metadata', async () => {
  const storage = new MemoryStorageAdapter();
  const time = new TimeService(() => 1_000_000);
  const adapter = new MockCloudSaveAdapter();
  const { controller, store } = makeController(adapter, storage, time);

  await controller.syncOnStartup();

  assert.equal(controller.currentStatus, 'uploaded');
  const stored = JSON.parse(storage.getString('yaoling_account_save'));
  assert.equal(stored.cloudSync.lastSyncSource, 'upload');
  assert.equal(stored.cloudSync.lastSyncedAt, 1_000_000);
  assert.equal(adapter.store !== undefined, true);
  const uploaded = await adapter.load(OPENID);
  assert.ok(uploaded !== null);
});

test('startup sync downloads a cloud-newer save without losing its progress', async () => {
  // 云端档盖戳 6_000_000（比本地控制器时间 5_000_000 更新）。
  const cloudSave = makeSave(9, 6_000_000);
  cloudSave.stageSelection = { stageId: 'stage_qingyun_02', difficultyId: 'diff_hard' };
  const cloudPayload = payloadOf(cloudSave);
  const adapter = new MockCloudSaveAdapter([[OPENID, cloudPayload]]);

  const storage = new MemoryStorageAdapter();
  const time = new TimeService(() => 5_000_000);
  const { controller } = makeController(adapter, storage, time);

  await controller.syncOnStartup();

  assert.equal(controller.currentStatus, 'downloaded');
  const reloaded = new AccountStore(storage, () => time.now()).load();
  assert.equal(reloaded.playerLevel, 9, 'cloud progress survived the download');
  assert.deepEqual(reloaded.stageSelection, { stageId: 'stage_qingyun_02', difficultyId: 'diff_hard' });
  assert.equal(reloaded.cloudSync.lastSyncSource, 'download');
});

test('conflict keeps local state and never overwrites either side', async () => {
  const cloudSave = makeSave(2);
  const cloudPayload = { ...payloadOf(cloudSave) };
  const adapter = new MockCloudSaveAdapter([[OPENID, cloudPayload]]);

  const storage = new MemoryStorageAdapter();
  // 本地与云端 lastSavedAt 相同但内容不同（playerLevel 5）。
  const time = new TimeService(() => 1_000_000);
  const store = new AccountStore(storage, () => 1_000_000);
  const localSave = store.load();
  localSave.playerLevel = 5;
  store.save(localSave);
  const controller = new CloudSaveController({
    adapter,
    store,
    time,
    getOpenid: () => OPENID,
    currentSchemaVersion: ACCOUNT_SAVE_SCHEMA_VERSION,
    serialize: serializeAccountSave,
    parse: () => ({ ok: false }),
  });

  await controller.syncOnStartup();

  assert.equal(controller.currentStatus, 'conflict');
  assert.equal(store.load().playerLevel, 5, 'local state untouched');
  const cloudAfter = await adapter.load(OPENID);
  assert.equal(JSON.parse(cloudAfter.data).playerLevel, 2, 'cloud state untouched');
});

test('upload failure never blocks play and the next commit retries immediately', async () => {
  const storage = new MemoryStorageAdapter();
  let clock = 1_000_000;
  const time = new TimeService(() => clock);
  const adapter = new MockCloudSaveAdapter();
  adapter.setFailSave(true);
  const { controller, store } = makeController(adapter, storage, time);

  await controller.syncOnStartup();
  assert.equal(controller.currentStatus, 'upload_failed', 'failure is reported but nothing throws');

  // 失败不计入节流：恢复网络后的下一次提交立即上传成功。
  adapter.setFailSave(false);
  clock += 1;
  await controller.onLocalSave();
  assert.equal(controller.currentStatus, 'uploaded');
  const uploaded = await adapter.load(OPENID);
  assert.ok(uploaded !== null);
});

test('successful upload is throttled: a commit inside the interval is skipped', async () => {
  const storage = new MemoryStorageAdapter();
  let clock = 1_000_000;
  const time = new TimeService(() => clock);
  const adapter = new MockCloudSaveAdapter();
  const { controller, store } = makeController(adapter, storage, time);

  await controller.syncOnStartup();
  assert.equal(controller.currentStatus, 'uploaded');

  // 间隔内的关键事务提交被跳过：云端仍是最初内容（playerLevel 1）。
  clock += CLOUD_SAVE_UPLOAD_MIN_INTERVAL_MS - 1;
  store.load().playerLevel = 7;
  store.save(store.load());
  await controller.onLocalSave();
  let cloudPayload = await adapter.load(OPENID);
  assert.equal(JSON.parse(cloudPayload.data).playerLevel, 1, 'throttled commit did not reach the cloud');

  // 间隔后（内容已有变化）的提交立即上传。
  clock += 1;
  await controller.onLocalSave();
  assert.equal(controller.currentStatus, 'uploaded');
  cloudPayload = await adapter.load(OPENID);
  assert.equal(JSON.parse(cloudPayload.data).playerLevel, 7, 'post-interval commit reached the cloud');
});

test('content-identical syncs settle to in_sync instead of re-uploading forever', async () => {
  const storage = new MemoryStorageAdapter();
  let clock = 1_000_000;
  const time = new TimeService(() => clock);
  const adapter = new MockCloudSaveAdapter();
  const { controller } = makeController(adapter, storage, time);

  await controller.syncOnStartup();
  assert.equal(controller.currentStatus, 'uploaded');
  clock += CLOUD_SAVE_UPLOAD_MIN_INTERVAL_MS;
  await controller.onLocalSave();
  assert.equal(
    controller.currentStatus,
    'in_sync',
    'meta-only differences never re-trigger upload',
  );
});

test('missing openid disables cloud sync without touching storage', async () => {
  const storage = new MemoryStorageAdapter();
  const time = new TimeService(() => 1_000_000);
  const adapter = new MockCloudSaveAdapter();
  const store = new AccountStore(storage, () => time.now());
  store.load();
  const controller = new CloudSaveController({
    adapter,
    store,
    time,
    getOpenid: () => '',
    currentSchemaVersion: ACCOUNT_SAVE_SCHEMA_VERSION,
    serialize: serializeAccountSave,
    parse: () => ({ ok: false }),
  });

  await controller.syncOnStartup();
  assert.equal(controller.currentStatus, 'disabled');
  assert.equal(adapter.store.size, 0);
});
