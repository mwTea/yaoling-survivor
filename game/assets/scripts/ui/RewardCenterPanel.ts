import { _decorator, Color, Component, Label, Node, view } from 'cc';

import { AccountSystem } from '../account/AccountSystem';
import { INITIAL_GAME_CONFIG } from '../config/GameConfig';
import { addAccountXp } from '../account/PlayerLeveling';
import { claimTaskReward, isTaskClaimable } from '../account/TaskSystem';
import { listAchievementViews, claimAchievementTier } from '../account/AchievementSystem';
import { getClaimableTierIndex, claimLoginReward } from '../account/LoginReward';
import { isOfferClaimable, claimOffer } from '../account/OfferSystem';
import { claimAllSequential } from '../account/RewardCenter';
import { buildUnlockEvaluationState, resolveFeatureEntryState } from '../account/UnlockSystem';
import { isFeatureEnabled, isFeatureFlagId } from '../platform/FeatureFlags';
import { trackAnalytics } from '../platform/AnalyticsService';
import { addPanelBackdrop, bringPanelToFront, claimActivePanel, clearActivePanel, createClickRegion, createLabel } from './PanelKit';

const { ccclass, property } = _decorator;

const CLAIMABLE_COLOR = new Color(70, 110, 60, 255);
const EMPTY_COLOR = new Color(56, 60, 80, 255);

const MAX_ROWS = 12;

/**
 * 奖励中心（V08-15 最小版，灰盒）：聚合任务/成就/累计登录/礼包的可领取状态
 * （直接查询各系统领域模块，领取态天然一致；不建邮件队列——阶段决策 6）。
 * 逐项领取复用各系统领取事务；一键领取经 claimAllSequential 顺序逐项执行
 * （单项失败不阻断其余）。内容全部代码构建，场景装配 2 节点。
 */
@ccclass('RewardCenterPanel')
export class RewardCenterPanel extends Component {
  @property({ type: Node })
  private content: Node | null = null;

  /** 操作完成后的回调（首页资源栏刷新用）。 */
  public onOperationDone: (() => void) | null = null;

  private headlineLabel: Label | null = null;
  private statusLabel: Label | null = null;
  private claimAllButton: ReturnType<typeof createClickRegion> | null = null;
  private rowRegions: ReturnType<typeof createClickRegion>[] = [];
  private built = false;

  protected override start(): void {
    if (this.content === null) {
      throw new Error('[RewardCenterPanel] missing reference: content ← 在本节点下建子节点 content 并拖入该槽');
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

    createLabel(content, 'Title', '奖励中心', 0, top - 34, 24);
    createClickRegion(content, 'Close', '关闭', width / 2 - 60, top - 34, 92, 42, () => {
      this.hide();
    });
    this.headlineLabel = createLabel(content, 'Headline', '', -width / 2 + 60, top - 70, 16, width - 220);

    const rowHeight = Math.min(34, Math.floor((height - 280) / MAX_ROWS));
    for (let index = 0; index < MAX_ROWS; index += 1) {
      const region = createClickRegion(
        content,
        `Entry${index + 1}`,
        '',
        -width / 2 + 100 + (width - 200) / 2,
        top - 100 - index * (rowHeight + 6) - rowHeight / 2,
        width - 200,
        rowHeight,
        () => undefined,
        EMPTY_COLOR.clone(),
      );
      region.label.fontSize = 14;
      this.rowRegions.push(region);
    }

    this.claimAllButton = createClickRegion(
      content, 'ClaimAll', '一键领取', 0, -height / 2 + 92, 240, 48,
      () => this.handleClaimAllClicked(),
      CLAIMABLE_COLOR.clone(),
    );
    this.statusLabel = createLabel(content, 'Status', '', 0, -height / 2 + 56, 15);
  }

  /** 聚合当前全部可领取条目（与各系统领取态同源查询）。 */
  private collectEntries(): Array<{
    readonly id: string;
    readonly title: string;
    readonly claim: () => { readonly ok: boolean; readonly reason?: string };
  }> {
    const account = AccountSystem.instance;
    const save = account?.accountSave ?? null;
    const economy = account?.economy ?? null;
    if (account === null || save === null || economy === null) {
      return [];
    }
    const keys = { dayKey: account.time.dayKey(), weekKey: account.time.weekKey() };
    const entries: Array<{
      readonly id: string;
      readonly title: string;
      readonly claim: () => { readonly ok: boolean; readonly reason?: string };
    }> = [];

    for (const task of INITIAL_GAME_CONFIG.tasks) {
      if (isTaskClaimable(save, INITIAL_GAME_CONFIG, task.id, keys)) {
        entries.push({
          id: `task:${task.id}`,
          title: `任务·${task.displayName}`,
          claim: () => claimTaskReward(save, INITIAL_GAME_CONFIG, economy, { addAccountXp }, task.id, keys, {
            txId: `reward_center_task_${account.time.now()}`,
            at: account.time.now(),
          }),
        });
      }
    }
    for (const view of listAchievementViews(save, INITIAL_GAME_CONFIG)) {
      if (view.claimable) {
        entries.push({
          id: `achievement:${view.id}`,
          title: `成就·${view.displayName}（第 ${view.currentTierIndex + 1} 阶）`,
          claim: () => claimAchievementTier(save, INITIAL_GAME_CONFIG, economy, { addAccountXp }, view.id, {
            txId: `reward_center_ach_${account.time.now()}`,
            at: account.time.now(),
          }),
        });
      }
    }
    if (getClaimableTierIndex(save, INITIAL_GAME_CONFIG) !== null) {
      entries.push({
        id: 'login:next',
        title: '累计登录·当前档',
        claim: () => claimLoginReward(save, INITIAL_GAME_CONFIG, economy, { addAccountXp }, {
          txId: `reward_center_login_${account.time.now()}`,
          at: account.time.now(),
        }),
      });
    }
    // 礼包区（V10-02）：按解锁表 featureId "offers" 门控（通关第一章解锁）——
    // 未解锁（或解锁表未绑定）时不聚合礼包条目，一键领取同步排除。
    const offersState = resolveFeatureEntryState(
      INITIAL_GAME_CONFIG,
      buildUnlockEvaluationState(save, account.time.now()),
      'offers',
      { isFlagEnabled: (flag) => isFeatureFlagId(flag) && isFeatureEnabled(flag) },
    );
    if (offersState !== null && offersState.kind === 'normal') {
      for (const offer of INITIAL_GAME_CONFIG.offers) {
        if (isOfferClaimable(save, INITIAL_GAME_CONFIG, offer.id)) {
          entries.push({
            id: `offer:${offer.id}`,
            title: `礼包·${offer.displayName}`,
            claim: () => claimOffer(save, INITIAL_GAME_CONFIG, economy, { addAccountXp }, offer.id, {
              txId: `reward_center_offer_${account.time.now()}`,
              at: account.time.now(),
            }),
          });
        }
      }
    }
    return entries;
  }

  private render(): void {
    if (this.content === null || !this.content.active || this.headlineLabel === null) {
      return;
    }
    const account = AccountSystem.instance;
    if (account === null || account.accountSave === null) {
      this.headlineLabel.string = '账号服务未装配';
      this.claimAllButton?.setEnabled(false);
      return;
    }
    const entries = this.collectEntries();
    this.headlineLabel.string =
      entries.length > 0 ? `可领取 ${entries.length} 项` : '暂无可领取奖励';

    for (let index = 0; index < this.rowRegions.length; index += 1) {
      const region = this.rowRegions[index];
      const entry = entries[index];
      if (region === undefined) {
        continue;
      }
      if (entry === undefined) {
        region.root.active = false;
        continue;
      }
      region.root.active = true;
      region.label.string = entry.title;
      region.setLook(CLAIMABLE_COLOR);
      // 逐项领取：重建点击行为（TOUCH_END 处理器读取最新条目）。
      region.root.off(Node.EventType.TOUCH_END);
      region.root.on(Node.EventType.TOUCH_END, () => {
        this.claimOne(entry.id, entry.title, entry.claim);
      });
    }

    const overflow = entries.length - MAX_ROWS;
    this.setStatus(overflow > 0 ? `（仅显示前 ${MAX_ROWS} 项，其余 ${overflow} 项请用一键领取）` : '');
    this.claimAllButton?.setEnabled(entries.length > 0);
  }

  private claimOne(id: string, title: string, claim: () => { readonly ok: boolean; readonly reason?: string }): void {
    const account = AccountSystem.instance;
    if (account === null) {
      return;
    }
    const outcome = claimAllSequential([{ id, title, claim }]);
    trackAnalytics('purchase_result', {
      kind: 'reward_center',
      id,
      ok: outcome.succeeded.length > 0,
      reason: outcome.succeeded.length > 0 ? null : (outcome.failed[0]?.reason ?? 'unknown'),
    });
    if (outcome.succeeded.length > 0) {
      this.setStatus(`已领取：${title}`);
    } else {
      this.setStatus(`领取失败：${title}（${outcome.failed[0]?.reason ?? '状态异常'}）`);
    }
    account.persistSave();
    this.render();
    this.onOperationDone?.();
  }

  private handleClaimAllClicked(): void {
    const account = AccountSystem.instance;
    if (account === null || account.accountSave === null) {
      return;
    }
    const entries = this.collectEntries();
    const outcome = claimAllSequential(entries);
    const parts: string[] = [];
    if (outcome.succeeded.length > 0) {
      parts.push(`成功 ${outcome.succeeded.length} 项`);
    }
    if (outcome.failed.length > 0) {
      const firstFailure = outcome.failed[0];
      if (firstFailure !== undefined) {
        parts.push(`失败 ${outcome.failed.length} 项（${firstFailure.title}: ${firstFailure.reason}）`);
      }
    }
    this.setStatus(parts.length > 0 ? `一键领取完成：${parts.join('；')}` : '没有可领取奖励');
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
