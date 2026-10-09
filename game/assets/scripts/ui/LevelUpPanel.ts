import { _decorator, Button, Color, Component, Label, Node, UITransform } from 'cc';
import { INITIAL_GAME_CONFIG } from '../config/GameConfig';
import { adResultGrantsReward, createAdAdapterProxy } from '../platform/AdAdapterUi';

import { BattleController } from '../battle/BattleController';
import { ProgressionSystem } from '../progression/ProgressionSystem';

const { ccclass, property } = _decorator;

/**
 * 升级三选一面板：订阅 levelUpRequested 展示候选（标题+描述来自冻结配置），
 * 点击只把 option ID 回传给 ProgressionSystem.chooseOption；levelUpResolved 后
 * 若仍有待处理等级（新请求已先到达）则保持显示并刷新，否则隐藏。
 * 内容挂在 content 子节点上切换显隐，组件本体常驻以维持事件订阅成对性。
 */
@ccclass('LevelUpPanel')
export class LevelUpPanel extends Component {
  @property({ type: Node })
  private content: Node | null = null;

  @property({ type: [Button] })
  private optionButtons: Button[] = [];

  @property({ type: [Label] })
  private optionLabels: Label[] = [];

  @property({ type: ProgressionSystem })
  private progressionSystem: ProgressionSystem | null = null;

  @property({ type: BattleController })
  private battleController: BattleController | null = null;

  private rerollButton: Button | null = null;
  private rerollLabel: Label | null = null;
  private rerollPending = false;

  /** 换一批按钮（V10-11 追加广告位）：动态构建；点击走激励广告 → 重抽候选。 */
  private buildRerollButton(): void {
    if (this.content === null || this.rerollButton !== null) {
      return;
    }
    const node = new Node('RerollButton');
    node.setParent(this.content);
    node.setPosition(0, -260, 0);
    const transform = node.addComponent(UITransform);
    transform.setContentSize(220, 46);
    const label = node.addComponent(Label);
    label.string = '';
    label.fontSize = 18;
    label.horizontalAlign = Label.HorizontalAlign.CENTER;
    label.verticalAlign = Label.VerticalAlign.CENTER;
    node.on(Button.EventType.CLICK, () => void this.handleRerollClicked());
    this.rerollButton = node.addComponent(Button);
    this.rerollLabel = label;
    this.refreshRerollButton();
  }

  private refreshRerollButton(): void {
    if (this.rerollLabel === null || this.rerollButton === null) {
      return;
    }
    const placement = INITIAL_GAME_CONFIG.ads.reroll;
    const enabled = this.progressionSystem !== null
      && this.progressionSystem.remainingRerolls > 0
      && !this.rerollPending;
    const remaining = this.progressionSystem !== null ? this.progressionSystem.remainingRerolls : 0;
    this.rerollLabel.string = `换一批（剩 ${remaining}/${placement.maxPerBattle}）`;
    this.rerollButton.interactable = enabled;
  }

  private async handleRerollClicked(): Promise<void> {
    if (this.progressionSystem === null || this.rerollPending) {
      return;
    }
    this.rerollPending = true;
    this.refreshRerollButton();
    const ok = await this.progressionSystem.handleRerollRequested();
    this.rerollPending = false;
    if (!ok && this.rerollLabel !== null) {
      this.rerollLabel.string = '未完整观看，次数未扣除，可重试';
    }
    this.refreshRerollButton();
  }

  private offeredIds: string[] = [];
  private isHandlingClick = false;
  private unsubscribeRequested: (() => void) | null = null;
  private unsubscribeResolved: (() => void) | null = null;

  protected override start(): void {
    if (this.content === null) {
      throw new Error('[LevelUpPanel] missing reference: content ← 把面板内容子节点拖入该属性槽');
    }
    if (this.optionButtons.length === 0 || this.optionLabels.length === 0) {
      throw new Error('[LevelUpPanel] optionButtons 与 optionLabels 至少各需一个条目');
    }
    if (this.progressionSystem === null) {
      throw new Error('[LevelUpPanel] missing reference: progressionSystem ← 把 Systems 节点拖入该属性槽');
    }
    if (this.battleController === null) {
      throw new Error('[LevelUpPanel] missing reference: battleController ← 把 Systems 节点拖入该属性槽');
    }

    for (let index = 0; index < this.optionButtons.length; index += 1) {
      const button = this.optionButtons[index];
      if (button === undefined) {
        continue;
      }
      button.node.on(Button.EventType.CLICK, () => {
        this.handleOptionClicked(index);
      });
    }
    this.buildRerollButton();
    this.content.active = false;
  }

  protected override onEnable(): void {
    if (this.battleController === null) {
      return;
    }
    this.unsubscribeRequested = this.battleController.events.on('levelUpRequested', (payload) => {
      this.showOptions(payload.optionIds);
    });
    this.unsubscribeResolved = this.battleController.events.on('levelUpResolved', () => {
      if (this.progressionSystem?.hasPendingLevelUp !== true) {
        this.hideContent();
      }
    });
  }

  protected override onDisable(): void {
    this.unsubscribeRequested?.();
    this.unsubscribeRequested = null;
    this.unsubscribeResolved?.();
    this.unsubscribeResolved = null;
  }

  private showOptions(optionIds: readonly string[]): void {
    if (this.content === null) {
      return;
    }
    this.offeredIds = [...optionIds];
    this.isHandlingClick = false;

    for (let index = 0; index < this.optionButtons.length; index += 1) {
      const button = this.optionButtons[index];
      const label = this.optionLabels[index];
      const optionId = this.offeredIds[index];
      if (button === undefined) {
        continue;
      }
      button.node.active = optionId !== undefined;
      if (optionId === undefined || label === undefined) {
        continue;
      }
      const option =
        INITIAL_GAME_CONFIG.upgrades.find((candidate) => candidate.id === optionId) ??
        INITIAL_GAME_CONFIG.gongfas.find((candidate) => candidate.id === optionId) ??
        INITIAL_GAME_CONFIG.treasures.find((candidate) => candidate.id === optionId);
      label.string = option === undefined ? optionId : `${option.title}\n${option.description}`;
    }
    this.content.active = true;
  }

  private handleOptionClicked(index: number): void {
    if (this.isHandlingClick || this.content?.active !== true) {
      return;
    }
    const optionId = this.offeredIds[index];
    if (optionId === undefined || this.progressionSystem === null) {
      return;
    }
    this.isHandlingClick = true;
    this.progressionSystem.chooseOption(optionId);
  }

  private hideContent(): void {
    if (this.content !== null) {
      this.buildRerollButton();
    this.content.active = false;
    }
    this.offeredIds = [];
    this.isHandlingClick = false;
  }
}
