import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MockIdentityAdapter,
  applyLoginResult,
  createGuestId,
} from '../assets/scripts/platform/IdentityAdapter.ts';
import { normalizeAccountSave } from '../assets/scripts/account/AccountSave.ts';

const WX_RESULT = { ok: true, kind: 'wx', openid: 'oX-abcdef123456', detail: null };
const GUEST_RESULT = { ok: false, kind: 'guest', openid: '', detail: 'wx_unavailable' };

function sequentialRandom(values) {
  let index = 0;
  return () => {
    const value = values[index % values.length];
    index += 1;
    return value;
  };
}

function freshSave(now = 1_700_000_000_000) {
  return normalizeAccountSave({ createdAt: now, lastSavedAt: now });
}

test('createGuestId yields stable guest_ + 16 hex digits from the injected source', () => {
  const id = createGuestId(sequentialRandom([0, 0.0625, 0.125, 1 - 1e-9]));
  assert.equal(id, 'guest_012f012f012f012f', 'digits follow the injected sequence, 15 (0.999…) maps to f');
  assert.match(createGuestId(Math.random), /^guest_[0-9a-f]{16}$/);
  const random = sequentialRandom([0.5]);
  assert.equal(createGuestId(random), createGuestId(random), 'same sequence reproduces the same id');
});

test('successful wx login writes openid, stamps lastLoginAt and generates the guest id once', () => {
  const save = freshSave();
  const first = applyLoginResult(save, WX_RESULT, 5_000, () => 0.25);
  assert.equal(first.changed, true);
  assert.equal(first.mode, 'wx');
  assert.equal(save.identity.wxOpenId, 'oX-abcdef123456');
  assert.equal(save.identity.lastLoginAt, 5_000);
  const guestId = save.identity.localGuestId;
  assert.match(guestId, /^guest_[0-9a-f]{16}$/);

  // 幂等重入：同 openid 再次登录只推进时间戳，guestId 不变。
  const second = applyLoginResult(save, WX_RESULT, 9_000, () => 0.99);
  assert.equal(second.changed, true);
  assert.equal(save.identity.localGuestId, guestId, 'guest id never regenerates');
  assert.equal(save.identity.wxOpenId, 'oX-abcdef123456');
  assert.equal(save.identity.lastLoginAt, 9_000);
});

test('failed login falls back to guest mode without touching openid or lastLoginAt', () => {
  const save = freshSave();
  const first = applyLoginResult(save, GUEST_RESULT, 5_000, () => 0.5);
  assert.equal(first.mode, 'guest');
  assert.equal(first.changed, true, 'guest id generation counts as a change');
  assert.equal(save.identity.wxOpenId, '');
  assert.equal(save.identity.lastLoginAt, 0, 'failed login never stamps lastLoginAt');
  assert.match(save.identity.localGuestId, /^guest_/);

  // 再次失败：guestId 已存在 → 零变化（调用方不重复落盘）。
  const second = applyLoginResult(save, GUEST_RESULT, 6_000, () => 0.7);
  assert.equal(second.changed, false);
});

test('successful login after guest fallback replaces the empty openid and keeps retry semantics', () => {
  const save = freshSave();
  applyLoginResult(save, GUEST_RESULT, 1_000, () => 0.5);
  const retry = applyLoginResult(save, WX_RESULT, 2_000, () => 0.5);
  assert.equal(retry.mode, 'wx');
  assert.equal(save.identity.wxOpenId, 'oX-abcdef123456');
  assert.equal(save.identity.lastLoginAt, 2_000);
});

test('migrated legacy saves get accountCreatedAt backfilled exactly once', () => {
  const save = freshSave(1_700_000_000_000);
  assert.equal(save.identity.accountCreatedAt, 0, 'migrated v2 saves carry a zero identity creation time');
  applyLoginResult(save, GUEST_RESULT, 1_000, () => 0.5);
  assert.equal(save.identity.accountCreatedAt, 1_700_000_000_000, 'backfilled from save.createdAt');
  const before = save.identity.accountCreatedAt;
  applyLoginResult(save, GUEST_RESULT, 2_000, () => 0.5);
  assert.equal(save.identity.accountCreatedAt, before, 'backfill never overwrites a real value');
});

test('mock identity adapter succeeds with a stable mock openid and can simulate failures', async () => {
  const adapter = new MockIdentityAdapter();
  const ok = await adapter.login();
  assert.deepEqual(ok, { ok: true, kind: 'wx', openid: 'mock_openid_dev_0000000000', detail: null });

  adapter.setFailureMode('always');
  const failed = await adapter.login();
  assert.deepEqual(failed, { ok: false, kind: 'guest', openid: '', detail: 'mock_failure_injected' });
});
