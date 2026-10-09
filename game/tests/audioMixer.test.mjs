import assert from 'node:assert/strict';
import test from 'node:test';

import {
  beginPlay,
  canPlay,
  computeChannelVolume,
  createAudioMixerState,
} from '../assets/scripts/platform/AudioMixer.ts';
import { INITIAL_GAME_CONFIG } from '../assets/scripts/config/GameConfig.ts';

// 真实配置当前四组 enabled=false（用户决策测试期关闭）；本文件以开启态副本验证混音。
const AUDIO = {
  ...INITIAL_GAME_CONFIG.audio,
  channels: INITIAL_GAME_CONFIG.audio.channels.map((c) => ({ ...c, enabled: true })),
};
const FULL = { bgmVolume: 100, sfxVolume: 100 };
const state = () => createAudioMixerState();

test('channel volume blends config baseline with settings master volume', () => {
  assert.equal(computeChannelVolume(AUDIO, FULL, 'bgm'), 0.7, 'bgm baseline 70 at full master');
  assert.equal(computeChannelVolume(AUDIO, FULL, 'hit'), 0.6, 'hit baseline 60 at full master');
  assert.equal(computeChannelVolume(AUDIO, { bgmVolume: 50, sfxVolume: 80 }, 'bgm'), 0.35);
  assert.equal(computeChannelVolume(AUDIO, { bgmVolume: 50, sfxVolume: 80 }, 'ui'), 0.64, 'ui follows sfxVolume');
  assert.equal(computeChannelVolume(AUDIO, { bgmVolume: 0, sfxVolume: 100 }, 'bgm'), 0, 'bgm mute');
  assert.equal(computeChannelVolume(AUDIO, { bgmVolume: 100, sfxVolume: 0 }, 'skill'), 0, 'sfx mute silences skill/hit/ui');
  assert.equal(computeChannelVolume(AUDIO, FULL, 'no_such_channel'), 0, 'unknown channel yields 0');
});

test('muted settings reject playback on every channel', () => {
  const s = state();
  const muted = { bgmVolume: 0, sfxVolume: 0 };
  assert.equal(canPlay(AUDIO, s, 'bgm', muted, 0).ok, false);
  assert.equal(canPlay(AUDIO, s, 'skill', muted, 0).ok, false);
  assert.equal(canPlay(AUDIO, s, 'hit', muted, 0).ok, false);
  assert.equal(canPlay(AUDIO, s, 'ui', muted, 0).ok, false);
  assert.equal(beginPlay(AUDIO, s, 'hit', muted, 0, 100), false);
});

test('concurrent limit rejects the play that exceeds per-channel slots', () => {
  const s = state();
  // hit 上限 6：以 ≥90ms 间隔（避开节流）放满 6 个未过期槽，第 7 个拒绝。
  for (let i = 0; i < 6; i += 1) {
    assert.equal(beginPlay(AUDIO, s, 'hit', FULL, 1000 + i * 100, 10_000), true, `slot ${i + 1} accepted`);
  }
  assert.deepEqual(canPlay(AUDIO, s, 'hit', FULL, 7000), { ok: false, reason: 'concurrent_limit' });
  // 槽到期后立刻可复用。
  assert.equal(canPlay(AUDIO, s, 'hit', FULL, 1000 + 10_000).ok, true);
  assert.equal(beginPlay(AUDIO, s, 'hit', FULL, 1000 + 10_000, 100), true);
});

test('high-frequency channels are throttled by min interval', () => {
  const s = state();
  assert.equal(beginPlay(AUDIO, s, 'hit', FULL, 1000, 100), true);
  assert.deepEqual(canPlay(AUDIO, s, 'hit', FULL, 1000 + 89), { ok: false, reason: 'throttled' });
  assert.equal(canPlay(AUDIO, s, 'hit', FULL, 1000 + 90).ok, true, 'exactly minInterval later is allowed');
  assert.equal(beginPlay(AUDIO, s, 'ui', FULL, 1000, 100), true);
  assert.equal(canPlay(AUDIO, s, 'ui', FULL, 1000 + 40).ok, true, 'ui minInterval 40ms');
});

test('throttle measures from play start, not slot expiry', () => {
  const s = state();
  // 100ms 剪辑在 t=1000 播放，槽到期 t=1100；90ms 节流窗口在 t=1090 结束。
  assert.equal(beginPlay(AUDIO, s, 'hit', FULL, 1000, 100), true);
  assert.equal(canPlay(AUDIO, s, 'hit', FULL, 1090).ok, true, 'slot still active but interval elapsed');
});

test('unknown channel and disabled groups never play', () => {
  const s = state();
  assert.deepEqual(canPlay(AUDIO, s, 'nope', FULL, 0), { ok: false, reason: 'unknown_channel' });
  const disabled = {
    ...AUDIO,
    channels: AUDIO.channels.map((c) => (c.channel === 'hit' ? { ...c, enabled: false } : c)),
  };
  assert.deepEqual(canPlay(disabled, s, 'hit', FULL, 0), { ok: false, reason: 'disabled' });
});

test('initial audio config passes validation invariants', () => {
  const channels = AUDIO.channels.map((c) => c.channel).sort();
  assert.deepEqual(channels, ['bgm', 'hit', 'skill', 'ui']);
  for (const clip of AUDIO.clips) {
    assert.ok(AUDIO.channels.some((c) => c.channel === clip.channel), `clip ${clip.id} references a declared channel`);
  }
});

test('disabled channels reject playback regardless of volume (audio deferred via config)', () => {
  const s = state();
  // 发货配置四组全关（用户决策 2026-10-05）：任何音量/时间下都不播放。
  for (const channel of ['bgm', 'skill', 'hit', 'ui']) {
    assert.deepEqual(canPlay(INITIAL_GAME_CONFIG.audio, s, channel, FULL, 0), { ok: false, reason: 'disabled' });
    assert.equal(beginPlay(INITIAL_GAME_CONFIG.audio, s, channel, FULL, 0, 100), false);
  }
});
