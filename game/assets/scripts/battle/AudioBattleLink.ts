import { _decorator, Component } from 'cc';

import { BattleController } from './BattleController';
import { AudioService } from '../platform/AudioService';

const { ccclass, property } = _decorator;

/**
 * 战斗音效接线（V10-05）：把低频战斗事实映射为音效播放——命中/击杀（hit 组，
 * 90ms 节流 + 并发上限）、升级三选一面板出现（skill）、Boss 出场（skill）。
 * 订阅成对解除；AudioService 未装配（直开战斗场景无音频链路）时静默跳过，
 * 音效永不阻断玩法路径。Boss 弹幕等高频声源不接线（热路径约束）。
 */
@ccclass('AudioBattleLink')
export class AudioBattleLink extends Component {
  @property({ type: BattleController })
  private battleControllerRef: BattleController | null = null;

  private unsubscribeFns: Array<() => void> = [];

  protected override start(): void {
    if (this.battleControllerRef === null) {
      throw new Error('[AudioBattleLink] missing reference: battleControllerRef ← 把 Systems 节点拖入该属性槽');
    }
    const events = this.battleControllerRef.events;
    this.unsubscribeFns = [
      events.on('monsterDied', () => AudioService.instance?.play('sfx_hit')),
      events.on('levelUpRequested', () => AudioService.instance?.play('sfx_levelup')),
      events.on('bossSpawned', () => AudioService.instance?.play('sfx_boss')),
    ];
  }

  protected override onDisable(): void {
    for (const unsubscribe of this.unsubscribeFns) {
      unsubscribe();
    }
    this.unsubscribeFns = [];
  }
}
