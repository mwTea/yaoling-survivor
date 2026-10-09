/**
 * 音频混音纯逻辑（V10-05）。
 *
 * 单文件叶子模块（零跨文件值导入，仅类型导入，可被 node 纯逻辑测试直接加载）：
 * - 音量合成：组音量基线（config 0~100）× 设置域主音量（bgm→bgmVolume，
 *   其余→sfxVolume，0~100）→ [0,1] 播放音量；任一为 0 即静音（零播放）。
 * - 并发与节流：同组未过期播放槽（activeUntil 毫秒时间戳）计数达到上限即拒绝；
 *   距上次播放开始不足 minIntervalMs 的高频组被节流。槽按时间自然过期，
 *   无需回收回调。
 * - 时间由调用方注入（nowMs）；cc 绑定层传 Date.now()（平台适配层职责），
 *   纯逻辑零 Date 直读，测试确定性。
 */
import type { AudioChannelId, AudioConfig } from '../config/ConfigTypes';

/** 设置域切片（AccountSaveData.settings 结构兼容）。 */
export interface AudioSettingsSlice {
  readonly bgmVolume: number;
  readonly sfxVolume: number;
}

export interface AudioChannelRuntimeState {
  /** 未过期播放槽的到期时间戳（升序）。 */
  readonly activeUntil: number[];
  /** 上次播放开始时间戳；-1 = 从未播放。 */
  lastStartedAt: number;
}

/** 混音运行态：每组的并发槽与节流锚点。 */
export interface AudioMixerState {
  readonly bgm: AudioChannelRuntimeState;
  readonly skill: AudioChannelRuntimeState;
  readonly hit: AudioChannelRuntimeState;
  readonly ui: AudioChannelRuntimeState;
}

const CHANNEL_IDS: readonly AudioChannelId[] = ['bgm', 'skill', 'hit', 'ui'];

export function createAudioMixerState(): AudioMixerState {
  const create = () => ({ activeUntil: [] as number[], lastStartedAt: -1 });
  return { bgm: create(), skill: create(), hit: create(), ui: create() };
}

/** 实际播放音量 [0,1]：基线 × 主音量 / 10000。 */
export function computeChannelVolume(
  config: AudioConfig,
  settings: AudioSettingsSlice,
  channel: AudioChannelId,
): number {
  const channelConfig = config.channels.find((candidate) => candidate.channel === channel);
  if (channelConfig === undefined) {
    return 0;
  }
  const master = channel === 'bgm' ? settings.bgmVolume : settings.sfxVolume;
  const raw = (channelConfig.volume * master) / 10_000;
  return Math.min(1, Math.max(0, raw));
}

export type AudioPlayCheck =
  | { readonly ok: true; readonly volume: number }
  | {
      readonly ok: false;
      readonly reason: 'unknown_channel' | 'disabled' | 'muted' | 'concurrent_limit' | 'throttled';
    };

/** 判定一次播放是否放行（不修改状态；占用用 beginPlay）。 */
export function canPlay(
  config: AudioConfig,
  state: AudioMixerState,
  channel: AudioChannelId,
  settings: AudioSettingsSlice,
  nowMs: number,
): AudioPlayCheck {
  const channelConfig = config.channels.find((candidate) => candidate.channel === channel);
  if (channelConfig === undefined) {
    return { ok: false, reason: 'unknown_channel' };
  }
  if (!channelConfig.enabled) {
    return { ok: false, reason: 'disabled' };
  }
  const volume = computeChannelVolume(config, settings, channel);
  if (volume <= 0) {
    return { ok: false, reason: 'muted' };
  }
  const runtime = state[channel];
  if (runtime === undefined) {
    return { ok: false, reason: 'unknown_channel' };
  }
  pruneSlots(runtime.activeUntil, nowMs);
  if (runtime.activeUntil.length >= channelConfig.maxConcurrent) {
    return { ok: false, reason: 'concurrent_limit' };
  }
  if (channelConfig.minIntervalMs > 0 && runtime.lastStartedAt >= 0) {
    if (nowMs - runtime.lastStartedAt < channelConfig.minIntervalMs) {
      return { ok: false, reason: 'throttled' };
    }
  }
  return { ok: true, volume };
}

/**
 * 占用一个播放槽（到期 = nowMs + durationMs；调用方以剪辑时长传入）。
 * 放行失败返回 false 且零修改。
 */
export function beginPlay(
  config: AudioConfig,
  state: AudioMixerState,
  channel: AudioChannelId,
  settings: AudioSettingsSlice,
  nowMs: number,
  durationMs: number,
): boolean {
  const check = canPlay(config, state, channel, settings, nowMs);
  if (!check.ok) {
    return false;
  }
  const runtime = state[channel];
  if (runtime === undefined) {
    return false;
  }
  runtime.activeUntil.push(nowMs + Math.max(0, durationMs));
  runtime.lastStartedAt = nowMs;
  return true;
}

function pruneSlots(slots: number[], nowMs: number): void {
  while (slots.length > 0) {
    const head = slots[0];
    if (head === undefined || head > nowMs) {
      break;
    }
    slots.shift();
  }
}
