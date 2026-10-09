import { _decorator, AudioClip, AudioSource, Component, director, Node } from 'cc';

import { AccountSystem } from '../account/AccountSystem';
import type { SettingsSaveState } from '../account/AccountSave';
import type { AudioChannelId } from '../config/ConfigTypes';
import { INITIAL_GAME_CONFIG } from '../config/GameConfig';
import { beginPlay, canPlay, computeChannelVolume, createAudioMixerState } from './AudioMixer';
import type { AudioMixerState } from './AudioMixer';

const { ccclass, property } = _decorator;

/**
 * 音频服务（V10-05，平台适配层）：BGM/技能/命中/UI 四组的统一播放入口。
 * - 挂在 HomeScene persist 节点（与 AccountSystem 同节点或独立节点均可），
 *   跨场景常驻；未装配时各接线点经 `AudioService.instance?.` 静默跳过，
 *   直开战斗场景（无音频装配）不报错。
 * - 音量 = 配置组基线 × 设置域主音量（bgm→bgmVolume，其余→sfxVolume）；
 *   `applySettings` 由装配层在启动与设置变化（V10-06）时调用，实时生效。
 * - 并发上限/节流/组开关/静音判定全部经 AudioMixer 纯逻辑；hit 等高频组由
 *   minIntervalMs 节流，不在热路径每帧触发（接线点均为低频事件）。
 * - 占位音频：`clips` 槽拖入 game/assets/audio 下的占位剪辑，资产名与
 *   GameConfig.audio.clips 的 ID 一一对应；缺失剪辑 warn 一次并跳过（不报错）。
 *   正式音频随 V10-14 管线替换；真机并发/性能随 V10-15 门禁复核。
 */
@ccclass('AudioService')
export class AudioService extends Component {
  /** 勾选后本节点成为跨场景常驻根节点（HomeScene 装配使用）。 */
  @property
  private persistent = false;

  /** 占位音频剪辑（资产名 = 配置 clip ID：bgm_main/sfx_levelup/sfx_boss/sfx_hit/sfx_click）。 */
  @property({ type: [AudioClip] })
  private clips: AudioClip[] = [];

  /** 跨场景访问点（persist 装配后全局唯一）；节点销毁时清空。 */
  public static instance: AudioService | null = null;

  private readonly mixer: AudioMixerState = createAudioMixerState();
  private readonly clipByChannel = new Map<AudioChannelId, AudioClip[]>();
  private readonly missingWarned = new Set<string>();
  private settings = { bgmVolume: 100, sfxVolume: 100 };
  private bgmSource: AudioSource | null = null;
  private sfxSource: AudioSource | null = null;
  private bgmClip: AudioClip | null = null;

  protected override onLoad(): void {
    if (AudioService.instance !== null && AudioService.instance !== this) {
      this.node.destroy();
      return;
    }
    AudioService.instance = this;
    if (this.persistent) {
      director.addPersistRootNode(this.node);
    }
    for (const clip of this.clips) {
      const binding = INITIAL_GAME_CONFIG.audio.clips.find((candidate) => candidate.id === clip.name);
      if (binding === undefined) {
        this.warnOnce(`audio clip "${clip.name}" is not bound in GameConfig.audio.clips`);
        continue;
      }
      const list = this.clipByChannel.get(binding.channel) ?? [];
      list.push(clip);
      this.clipByChannel.set(binding.channel, list);
      if (binding.channel === 'bgm') {
        this.bgmClip = clip;
      }
    }
    this.bgmSource = this.createSource('AudioBgm', true);
    this.sfxSource = this.createSource('AudioSfx', false);
    const save = AccountSystem.instance?.accountSave ?? null;
    if (save !== null) {
      this.applySettings(save.settings);
    }
    // 启动 BGM（装配了 bgm_main 且音量 > 0 时；静音/缺剪辑为静默 no-op）。
    this.playBgm();
  }

  protected override onDestroy(): void {
    if (AudioService.instance === this) {
      AudioService.instance = null;
    }
  }

  /**
   * 应用设置域音量（启动默认 + V10-06 设置页实时变更）：BGM 源音量即时生效，
   * 一次性播放音量在下次 play 时取用。
   */
  public applySettings(settings: SettingsSaveState): void {
    this.settings = { bgmVolume: settings.bgmVolume, sfxVolume: settings.sfxVolume };
    if (this.bgmSource !== null) {
      this.bgmSource.volume = computeChannelVolume(INITIAL_GAME_CONFIG.audio, this.settings, 'bgm');
    }
  }

  /** 当前生效的组音量（设置页/验收观察用）。 */
  public getChannelVolume(channel: AudioChannelId): number {
    return computeChannelVolume(INITIAL_GAME_CONFIG.audio, this.settings, channel);
  }

  /**
   * 播放一次性音效（clip ID 来自 GameConfig.audio.clips；服务未就绪/剪辑缺失/
   * 并发与节流拒绝/静音时静默跳过——音效永不阻断玩法路径）。
   */
  public play(clipId: string): void {
    if (this.sfxSource === null) {
      return;
    }
    const binding = INITIAL_GAME_CONFIG.audio.clips.find((candidate) => candidate.id === clipId);
    if (binding === undefined) {
      this.warnOnce(`audio clip "${clipId}" is not bound in GameConfig.audio.clips`);
      return;
    }
    const clip = this.pickClip(binding.channel, clipId);
    if (clip === null) {
      return;
    }
    const nowMs = Date.now();
    const check = canPlay(INITIAL_GAME_CONFIG.audio, this.mixer, binding.channel, this.settings, nowMs);
    if (!check.ok) {
      return;
    }
    beginPlay(
      INITIAL_GAME_CONFIG.audio,
      this.mixer,
      binding.channel,
      this.settings,
      nowMs,
      clip.getDuration() * 1000,
    );
    // 音量以 playOneShot 的 scale 生效（源音量保持 1，组音量逐次计算）。
    this.sfxSource.playOneShot(clip, check.volume);
  }

  /** 播放 BGM（循环；静音时拒绝启动。已在上播同一剪辑则跳过）。 */
  public playBgm(clipId = 'bgm_main'): void {
    if (this.bgmSource === null) {
      return;
    }
    const bgmChannel = INITIAL_GAME_CONFIG.audio.channels.find((candidate) => candidate.channel === 'bgm');
    if (bgmChannel === undefined || !bgmChannel.enabled) {
      return;
    }
    const clip = this.pickClip('bgm', clipId);
    if (clip === null) {
      return;
    }
    if (this.bgmSource.playing && this.bgmClip === clip) {
      return;
    }
    const volume = computeChannelVolume(INITIAL_GAME_CONFIG.audio, this.settings, 'bgm');
    if (volume <= 0) {
      return;
    }
    this.bgmClip = clip;
    this.bgmSource.clip = clip;
    this.bgmSource.loop = true;
    this.bgmSource.volume = volume;
    this.bgmSource.play();
  }

  /** 停止 BGM（设置页/验收用；玩法不主动停）。 */
  public stopBgm(): void {
    this.bgmSource?.stop();
  }

  private createSource(name: string, loop: boolean): AudioSource {
    const node = new Node(name);
    node.setParent(this.node);
    const source = node.addComponent(AudioSource);
    source.loop = loop;
    source.playOnAwake = false;
    source.volume = 0;
    return source;
  }

  private pickClip(channel: AudioChannelId, clipId: string): AudioClip | null {
    const list = this.clipByChannel.get(channel);
    if (list === undefined) {
      this.warnOnce(`no audio clip assembled for channel "${channel}" (clip "${clipId}")`);
      return null;
    }
    const clip = list.find((candidate) => candidate.name === clipId) ?? list[0];
    if (clip === undefined) {
      this.warnOnce(`no audio clip assembled for channel "${channel}" (clip "${clipId}")`);
      return null;
    }
    return clip;
  }

  private warnOnce(message: string): void {
    if (this.missingWarned.has(message)) {
      return;
    }
    this.missingWarned.add(message);
    console.warn(`[AudioService] ${message}`);
  }
}
