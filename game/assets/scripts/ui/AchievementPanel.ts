import { _decorator, Color, Component, Label, Node, view } from 'cc';

import { AccountSystem } from '../account/AccountSystem';
import { INITIAL_GAME_CONFIG } from '../config/GameConfig';
import { addAccountXp } from '../account/PlayerLeveling';
import {
  claimAchievementTier,
  listAchievementViews,
} from '../account/AchievementSystem';
import { addPanelBackdrop, bringPanelToFront, claimActivePanel, clearActivePanel, createClickRegion, createLabel } from './PanelKit';

const { ccclass, property } = _decorator;

const CLAIMABLE_COLOR = new Color(70, 110, 60, 255);
const CLAIMED_ALL_COLOR = new Color(45, 45, 45, 220);
const DEFAULT_COLOR = new Color(70, 70, 70, 255);

/**
 * 成就页（V08-10，灰盒）：只显示当前阶段（下一未领取档），可领取高亮，
 * 点击行领取（成就领取事务：经济入账（灵玉）+ 账号经验 + claimedTier 推进）。
 * 隐藏成就未达第一阶目标前不出现在列表（红点同源）。内容全部代码构建。
 */
@ccclass('AchievementPanel')
export class AchievementPanel extends Component {
  @property({ type: Node })
  private content: Node | null = null;

  /** 操作完成后的回调（首页资源栏刷新用）。 */
  public onOperationDone: (() => void) | null = null;

  private statusLabel: Label | null = null;
  private rowRegions: ReturnType<typeof createClickRegion>[] = [];
  private built = false;

  protected override start(): void {
    if (this.content === null) {
      throw new Error('[AchievementPanel] missing reference: content ← 在本节点下建子节点 content 并拖入该槽');
    }
    this.build();
    this.content.active = false;
  }

  public show(): void {
    if (this.content === null) {
      return;
    }
    bringPanelToFront(this.node);
    claimActivePanel(this);
    this.content.active = true;
    this.render();
  }

  /** 关闭面板（互斥注册表 + 隐藏内容）。 */
  public hide(): void {
    clearActivePanel(this);
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
    const visibleSize = view.getVisibleSize();
    const width = visibleSize.width;
    const height = visibleSize.height;
    const top = height / 2;
    // 行数随成就表生成（当前 6 项）；行高自适应可用高度。
    const rowCount = INITIAL_GAME_CONFIG.achievements.length;
    const rowHeight = Math.min(46, Math.floor((height - 200) / Math.max(1, rowCount)));
    const rowWidth = width - 200;

    createLabel(content, 'Title', '成就', 0, top - 34, 24);
    createClickRegion(content, 'Close', '关闭', width / 2 - 60, top - 34, 92, 42, () => {
      this.hide();
    });

    INITIAL_GAME_CONFIG.achievements.forEach((achievement, index) => {
      const region = createClickRegion(
        content,
        `Ach_${achievement.id}`,
        achievement.displayName,
        -width / 2 + 100 + rowWidth / 2,
        top - 84 - index * (rowHeight + 6) - rowHeight / 2,
        rowWidth,
        rowHeight,
        () => this.handleRowClicked(achievement.id),
        DEFAULT_COLOR.clone(),
      );
      this.rowRegions.push(region);
    });

    this.statusLabel = createLabel(content, 'Status', '点击可领取的成就行', 0, -height / 2 + 26, 15);
  }

  private render(): void {
    if (this.content === null || !this.content.active) {
      return;
    }
    const account = AccountSystem.instance;
    const save = account?.accountSave ?? null;
    if (account === null || save === null) {
      for (const region of this.rowRegions) {
        region.label.string = '账号服务未装配';
        region.setLook(null);
      }
      return;
    }
    const views = listAchievementViews(save, INITIAL_GAME_CONFIG);
    INITIAL_GAME_CONFIG.achievements.forEach((achievement, index) => {
      const region = this.rowRegions[index];
      if (region === undefined) {
        return;
      }
      const view = views.find((candidate) => candidate.id === achievement.id);
      if (view === undefined) {
        // 隐藏成就未解锁：整行隐藏（红点/列表同源）。
        region.root.active = false;
        return;
      }
      region.root.active = true;
      if (view.currentTarget === null) {
        region.label.string = `${view.displayName}　✓ 全部领取（${view.claimedTier}/${view.tierCount} 阶）`;
        region.setLook(CLAIMED_ALL_COLOR);
      } else if (view.claimable) {
        region.label.string =
          `${view.displayName}　第 ${view.currentTierIndex + 1}/${view.tierCount} 阶 ${view.progress}/${view.currentTarget}　● 可领取`;
        region.setLook(CLAIMABLE_COLOR);
      } else {
        region.label.string =
          `${view.displayName}　第 ${view.currentTierIndex + 1}/${view.tierCount} 阶 ${view.progress}/${view.currentTarget}　${view.description}`;
        region.setLook(DEFAULT_COLOR);
      }
    });
  }

  private handleRowClicked(achievementId: string): void {
    const account = AccountSystem.instance;
    const save = account?.accountSave ?? null;
    const economy = account?.economy ?? null;
    if (account === null || save === null || economy === null) {
      return;
    }
    const outcome = claimAchievementTier(save, INITIAL_GAME_CONFIG, economy, { addAccountXp }, achievementId, {
      txId: `achievement_claim_${account.time.now()}`,
      at: account.time.now(),
    });
    if (outcome.ok) {
      const resourceText = Object.keys(outcome.resources)
        .map((resourceId) => `${resourceId} +${outcome.resources[resourceId]}`)
        .join('　');
      this.setStatus(`已领取第 ${outcome.tierIndex + 1} 阶奖励：${resourceText || '无资源'}　修行经验 +${outcome.accountXp}`);
    } else {
      this.setStatus(`领取失败：${describeClaimFailure(outcome.reason)}`);
    }
    account.persistSave();
    this.render();
    this.onOperationDone?.();
  }

  private setStatus(text: string): void {
    if (this.statusLabel !== null) {
      this.statusLabel.string = text;
    }
  }
}

function describeClaimFailure(reason: string): string {
  switch (reason) {
    case 'tier_not_reached':
      return '当前阶段目标未达成';
    case 'all_claimed':
      return '全部阶段已领取';
    case 'hidden':
      return '成就尚未解锁';
    case 'grant_rejected':
      return '资源发放被拒绝';
    case 'xp_rejected':
      return '账号经验结算失败';
    case 'unknown_achievement':
      return '成就不存在';
    default:
      return '状态异常';
  }
}
