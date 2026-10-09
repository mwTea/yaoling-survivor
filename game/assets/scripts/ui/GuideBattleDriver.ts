import { _decorator, Component, director, Node, UITransform, view } from 'cc';

import { AccountSystem } from '../account/AccountSystem';
import { getActiveGuideStep } from '../account/GuideSystem';
import { BattleController } from '../battle/BattleController';
import { AutoSwordWeapon } from '../combat/AutoSwordWeapon';
import { PlayerMover } from '../player/PlayerMover';
import { INITIAL_GAME_CONFIG } from '../config/GameConfig';
import { getActivePanel } from './PanelKit';
import { GuideAnchor } from './GuideAnchor';
import { emitGuideEvent, registerGuideAnchor } from './GuideEvents';
import { BeastPanel } from './BeastPanel';
import { RealmPanel } from './RealmPanel';

const { ccclass, property } = _decorator;

/**
 * 战斗内引导驱动（V10-04）：把战斗事实映射为引导语义事件，订阅成对解除。
 * - 事件源：battleStateChanged（首次 Running → 开局）、experienceCollected（拾取）、
 *   levelUpResolved（三选一完成）、battleFinished（结算面板出现）。
 * - 移动/攻击无现成事件：battleDeltaTime > 0 时轮询缓存组件的只读状态
 *   （isMoving / totalFired，无分配、无每帧节点查找），各自首次满足即发一次；
 *   状态机幂等，重复投递无副作用。
 * 独立成文件：Cocos 约束每个脚本文件最多一个 Component 类。
 */
@ccclass('GuideBattleDriver')
export class GuideBattleDriver extends Component {
  @property({ type: Node })
  private playerNode: Node | null = null;

  @property({ type: BattleController })
  private battleController: BattleController | null = null;

  private unsubscribeFns: Array<() => void> = [];
  private mover: PlayerMover | null = null;
  private weapon: AutoSwordWeapon | null = null;
  private battleStartEmitted = false;
  private moveEmitted = false;
  private attackEmitted = false;

  protected override start(): void {
    if (this.battleController === null) {
      throw new Error('[GuideBattleDriver] missing reference: battleController ← 把 Systems 节点拖入该属性槽');
    }
    if (this.playerNode !== null) {
      this.mover = this.playerNode.getComponent(PlayerMover);
      this.weapon = this.battleController.getComponent(AutoSwordWeapon);
    }
    const events = this.battleController.events;
    this.unsubscribeFns = [
      events.on('battleStateChanged', (payload) => {
        if (!this.battleStartEmitted && payload.current === 'running') {
          this.battleStartEmitted = true;
          emitGuideEvent('guide_battle_started');
        }
      }),
      events.on('experienceCollected', () => emitGuideEvent('guide_xp_collected')),
      events.on('levelUpResolved', () => emitGuideEvent('guide_levelup_resolved')),
      events.on('battleFinished', () => emitGuideEvent('guide_settlement_shown')),
    ];
  }

  protected override update(): void {
    if (this.moveEmitted && this.attackEmitted) {
      return;
    }
    if (this.battleController === null || this.battleController.battleDeltaTime <= 0) {
      return;
    }
    if (!this.moveEmitted && this.mover !== null && this.mover.isMoving) {
      this.moveEmitted = true;
      emitGuideEvent('guide_move_started');
    }
    if (!this.attackEmitted && this.weapon !== null && this.weapon.totalFired > 0) {
      this.attackEmitted = true;
      emitGuideEvent('guide_attack_fired');
    }
  }

  protected override onDisable(): void {
    for (const unsubscribe of this.unsubscribeFns) {
      unsubscribe();
    }
    this.unsubscribeFns = [];
  }
}
