import { _decorator, Color, Component, Label, Node, UITransform, view } from 'cc';

import { addPanelBackdrop, bringPanelToFront, createClickRegion, createLabel } from './PanelKit';
import type { AdShowResult } from '../platform/AdAdapter';

const { ccclass, property } = _decorator;

const BUTTON_COLOR = new Color(70, 110, 60, 255);
const GIVE_UP_COLOR = new Color(120, 70, 60, 255);

/**
 * 复活要约面板（V10-10，灰盒）：失败结算前的广告复活要约 UI。
 * Controller 在死亡暂停时调用 show(remainingToday, actions)；广告中途关闭/
 * 失败时 showRetryMessage 提示"不发奖不扣次数"，要约保留由玩家重选或放弃。
 * 内容全部代码构建（PanelKit），场景装配仅需根节点 + content 子节点；
 * 正式美术随 V10-14 替换。
 */
@ccclass('ReviveOfferPanel')
export class ReviveOfferPanel extends Component {
  @property({ type: Node })
  private content: Node | null = null;

  private headlineLabel: Label | null = null;
  private detailLabel: Label | null = null;
  private watchButton: ReturnType<typeof createClickRegion> | null = null;
  private built = false;
  private actions: { readonly onWatch: () => void; readonly onGiveUp: () => void } | null = null;

  protected override start(): void {
    if (this.content === null) {
      throw new Error('[ReviveOfferPanel] missing reference: content ← 在本节点下建子节点 content 并拖入该槽');
    }
    this.build();
    this.content.active = false;
  }

  protected override onEnable(): void {
    view.on('canvas-resize', this.layoutContent, this);
  }

  protected override onDisable(): void {
    view.off('canvas-resize', this.layoutContent, this);
  }

  public show(remainingToday: number, actions: { readonly onWatch: () => void; readonly onGiveUp: () => void }): void {
    if (this.content === null) {
      return;
    }
    this.actions = actions;
    this.build();
    this.content.active = true;
    this.layoutContent();
    bringPanelToFront(this.node);
    if (this.headlineLabel !== null) {
      this.headlineLabel.string = '角色已力竭，可选择复活';
    }
    if (this.detailLabel !== null) {
      this.detailLabel.string = `复活后回复 50% 生命并获得短暂无敌。今日剩余 ${remainingToday} 次。`;
    }
    this.watchButton?.setEnabled(true);
  }

  /** 广告播放中：防重入（不自动连播、不重复扣次数）。 */
  public setAdPending(pending: boolean): void {
    this.watchButton?.setEnabled(!pending);
    if (this.detailLabel !== null && pending) {
      this.detailLabel.string = '广告播放中…';
    }
  }

  /** 中途关闭/失败提示：不发奖不扣次数，要约保留。 */
  public showRetryMessage(result: AdShowResult): void {
    if (this.detailLabel === null) {
      return;
    }
    this.detailLabel.string =
      result === 'closed_early'
        ? '未完整观看广告，本次未复活、未扣除次数，可重试或放弃。'
        : '广告暂时不可用，本次未复活、未扣除次数，可重试或放弃。';
    this.watchButton?.setEnabled(true);
  }

  public hide(): void {
    this.actions = null;
    if (this.content !== null) {
      this.content.active = false;
    }
  }

  private build(): void {
    if (this.content === null || this.built) {
      return;
    }
    this.built = true;
    const content = this.content;
    addPanelBackdrop(content);
    this.headlineLabel = createLabel(content, 'Headline', '', 0, 0, 22, 0);
    this.detailLabel = createLabel(content, 'Detail', '', 0, 0, 17, 0);
    this.headlineLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
    this.detailLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
    this.watchButton = createClickRegion(
      content, 'WatchAd', '观看广告复活', 0, 0, 260, 60,
      () => this.actions?.onWatch(),
      BUTTON_COLOR.clone(),
      { normal: 'btn_revive_n', pressed: 'btn_revive_p', sliced: true },
    );
    createClickRegion(
      content, 'GiveUp', '放弃复活', 0, 0, 200, 46,
      () => this.actions?.onGiveUp(),
      GIVE_UP_COLOR.clone(),
      { normal: 'btn_secondary_n', pressed: 'btn_secondary_p', sliced: true },
    );
    this.layoutContent();
  }

  private readonly layoutContent = (): void => {
    if (!this.built) {
      return;
    }
    const size = view.getVisibleSize();
    for (const label of [this.headlineLabel, this.detailLabel]) {
      const transform = label?.getComponent(UITransform);
      if (transform !== null && transform !== undefined) {
        transform.width = Math.max(240, size.width - 48);
        transform.setAnchorPoint(0.5, 0.5);
        if (label !== null) {
          label.overflow = Label.Overflow.RESIZE_HEIGHT;
        }
      }
    }
    const centerY = 0;
    this.headlineLabel?.node.setPosition(0, centerY + 88, 0);
    this.detailLabel?.node.setPosition(0, centerY + 48, 0);
    if (this.watchButton !== null) {
      this.watchButton.root.setPosition(0, centerY - 24, 0);
    }
    const giveUp = this.content?.getChildByName('GiveUp');
    giveUp?.setPosition(0, centerY - 92, 0);
  };
}
