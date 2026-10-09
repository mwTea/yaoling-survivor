import { _decorator, Component, director, Node, UITransform, view } from 'cc';

import { AccountSystem } from '../account/AccountSystem';
import { getActiveGuideStep } from '../account/GuideSystem';
import { INITIAL_GAME_CONFIG } from '../config/GameConfig';
import { getActivePanel } from './PanelKit';
import { GuideAnchor } from './GuideAnchor';
import { emitGuideEvent, registerGuideAnchor } from './GuideEvents';
import { BeastPanel } from './BeastPanel';
import { RealmPanel } from './RealmPanel';

const { ccclass, property } = _decorator;

/**
 * 首页引导驱动（V10-04）：进入首页发 guide_home_entered；观察互斥面板注册表
 * （引用比较，无分配），修行/灵兽面板打开即视为"首次培养"完成；新档
 * （引导从未启动）按 GAME_LOOP §4"首次进入直接开始第一局"自动进入战斗
 * （仅一次；老档与进行中引导零触发）。并注册底部导航锚点供培养步骤高亮。
 * 独立成文件：Cocos 约束每个脚本文件最多一个 Component 类。
 */
@ccclass('GuideHomeDriver')
export class GuideHomeDriver extends Component {
  @property({ type: RealmPanel })
  private realmPanel: RealmPanel | null = null;

  @property({ type: BeastPanel })
  private beastPanel: BeastPanel | null = null;

  /** 可选：底部导航宿主节点（注册 nav_realm 锚点定位用；缺省用本组件节点的父级）。 */
  @property({ type: Node })
  private navAnchorHost: Node | null = null;

  /** 结算后首次培养深链（GAME_LOOP §5 最短闭环）：培养步骤活跃时自动打开修行面板。 */
  @property
  private autoJumpToCultivate = true;

  private lastActivePanel: object | null = null;
  private cultivateEmitted = false;
  private autoStartDispatched = false;
  private jumpScheduled = false;

  protected override start(): void {
    emitGuideEvent('guide_home_entered');
    this.registerNavAnchor();
    this.maybeAutoStartFirstBattle();
    this.maybeScheduleCultivateJump();
  }

  protected override update(): void {
    if (this.cultivateEmitted) {
      return;
    }
    const active = getActivePanel();
    if (active === this.lastActivePanel) {
      return;
    }
    this.lastActivePanel = active;
    if (active !== null && (active === this.realmPanel || active === this.beastPanel)) {
      this.cultivateEmitted = true;
      emitGuideEvent('guide_cultivate_opened');
    }
  }

  /** 注册导航锚点（培养步骤高亮目标）：固定在宿主底部中央（导航条区域）。 */
  private registerNavAnchor(): void {
    const host = this.navAnchorHost ?? this.node.parent;
    if (host === null || host.getChildByName('GuideNavAnchor') !== null) {
      return;
    }
    const anchorNode = new Node('GuideNavAnchor');
    anchorNode.setParent(host);
    const transform = anchorNode.addComponent(UITransform);
    const size = view.getVisibleSize();
    transform.setContentSize(120, 56);
    anchorNode.setPosition(0, -size.height / 2 + 60, 0);
    anchorNode.addComponent(GuideAnchor).anchorId = 'nav_realm';
    // 同帧添加的节点 onEnable 可能晚于本方法：手动补登记（幂等）。
    registerGuideAnchor('nav_realm', anchorNode);
  }

  /**
   * 首次进入直接开始第一局：仅当引导从未启动（scriptVersion 0，即全新档）时
   * 延迟一拍进入战斗，避开同帧 persist 装配；返回首页（scriptVersion 非 0）不触发。
   */
  private maybeAutoStartFirstBattle(): void {
    if (this.autoStartDispatched) {
      return;
    }
    const save = AccountSystem.instance?.accountSave ?? null;
    // 自动开战属于引导首进流程（GAME_LOOP §4）：引导总开关关闭时不自动进入。
    if (save === null || !INITIAL_GAME_CONFIG.guide.enabled || save.guide.scriptVersion !== 0) {
      return;
    }
    this.autoStartDispatched = true;
    this.scheduleOnce(() => {
      console.log('[GuideHomeDriver] first session: auto-starting the first battle');
      director.loadScene('BattleScene');
    }, 0.2);
  }

  /**
   * 首次培养深链：培养步骤活跃（结算已看过、尚未打开培养面板）时延迟自动
   * 打开修行面板；完成事件由面板打开的观察路径发出。仅执行一次，可装配关闭。
   */
  private maybeScheduleCultivateJump(): void {
    if (!this.autoJumpToCultivate || this.cultivateEmitted || this.jumpScheduled) {
      return;
    }
    const save = AccountSystem.instance?.accountSave ?? null;
    if (save === null) {
      return;
    }
    const active = getActiveGuideStep(INITIAL_GAME_CONFIG.guide, save.guide);
    if (active === null || active.id !== 'guide_cultivate') {
      return;
    }
    this.jumpScheduled = true;
    this.scheduleOnce(() => {
      if (this.cultivateEmitted) {
        return;
      }
      console.log('[GuideHomeDriver] cultivate deep link: opening realm panel');
      this.realmPanel?.show();
    }, 0.8);
  }
}
