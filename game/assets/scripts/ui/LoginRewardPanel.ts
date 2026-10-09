import { _decorator, Color, Component, Label, Node, view } from 'cc';

import { AccountSystem } from '../account/AccountSystem';
import { INITIAL_GAME_CONFIG } from '../config/GameConfig';
import { addAccountXp } from '../account/PlayerLeveling';
import {
  claimLoginReward,
  getClaimableTierIndex,
  isLoginRoundCompleted,
} from '../account/LoginReward';
import { addPanelBackdrop, bringPanelToFront, claimActivePanel, clearActivePanel, createClickRegion, createLabel } from './PanelKit';

const { ccclass, property } = _decorator;

const CLAIMABLE_COLOR = new Color(70, 110, 60, 255);
const CLAIMED_COLOR = new Color(45, 45, 45, 220);
const LOCKED_COLOR = new Color(70, 70, 70, 255);

/**
 * 签到页（V08-14，灰盒）：30 日累计登录——当前累计天数、本轮已领档/当前档/
 * 可领高亮、逐档领取（领取事务：经济入账 + 账号经验）、领取完成状态。
 * 天数推进在会话启动（AccountSystem.onLoad → advanceLoginDay，每自然日最多 +1）；
 * 本页只读展示 + 领取。内容全部代码构建（PanelKit），场景装配 2 节点。
 */
@ccclass('LoginRewardPanel')
export class LoginRewardPanel extends Component {
  @property({ type: Node })
  private content: Node | null = null;

  /** 操作完成后的回调（首页资源栏刷新用）。 */
  public onOperationDone: (() => void) | null = null;

  private headlineLabel: Label | null = null;
  private statusLabel: Label | null = null;
  private claimButton: ReturnType<typeof createClickRegion> | null = null;
  private built = false;

  protected override start(): void {
    if (this.content === null) {
      throw new Error('[LoginRewardPanel] missing reference: content ← 在本节点下建子节点 content 并拖入该槽');
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

    createLabel(content, 'Title', '累计登录（30 日）', 0, top - 36, 24);
    createClickRegion(content, 'Close', '关闭', width / 2 - 60, top - 36, 92, 42, () => {
      this.hide();
    });
    this.headlineLabel = createLabel(content, 'Headline', '', -width / 2 + 60, top - 92, 18, width - 120);

    // 近 7 档预览行（当前档 ± 窗口），灰盒不铺 30 行。
    const previewRows = 7;
    for (let index = 0; index < previewRows; index += 1) {
      const region = createClickRegion(
        content,
        `TierRow${index + 1}`,
        '',
        -width / 2 + 100 + (width - 200) / 2,
        top - 140 - index * 44 - 22,
        width - 200,
        40,
        () => undefined,
        LOCKED_COLOR.clone(),
      );
      region.label.fontSize = 15;
      this.rowRegions.push(region);
    }

    this.claimButton = createClickRegion(
      content, 'Claim', '领取当前档奖励', 0, -height / 2 + 96, 260, 50,
      () => this.handleClaimClicked(),
      CLAIMABLE_COLOR.clone(),
    );
    this.statusLabel = createLabel(content, 'Status', '', 0, -height / 2 + 56, 15);
  }

  private readonly rowRegions: ReturnType<typeof createClickRegion>[] = [];

  private render(): void {
    if (this.content === null || !this.content.active || this.headlineLabel === null) {
      return;
    }
    const account = AccountSystem.instance;
    const save = account?.accountSave ?? null;
    if (account === null || save === null) {
      this.headlineLabel.string = '账号服务未装配';
      this.claimButton?.setEnabled(false);
      return;
    }
    const tiers = INITIAL_GAME_CONFIG.loginRewards.tiers;
    const totalDays = INITIAL_GAME_CONFIG.loginRewards.totalDays;
    const claimed = save.loginReward.claimedTier;
    const completed = isLoginRoundCompleted(save, INITIAL_GAME_CONFIG);
    this.headlineLabel.string =
      `累计登录 ${save.loginReward.totalDays} 天　已领 ${claimed}/${totalDays} 档` +
      (completed ? '　◆ 本轮已完结（首发不循环）' : '');

    // 近 7 档窗口：以"下一未领取档"为中心向前看。
    const claimableIndex = getClaimableTierIndex(save, INITIAL_GAME_CONFIG);
    const startIndex = Math.max(0, Math.min(claimed - 1, tiers.length - this.rowRegions.length));
    for (let index = 0; index < this.rowRegions.length; index += 1) {
      const region = this.rowRegions[index];
      const tierIndex = startIndex + index;
      const tier = tiers[tierIndex];
      if (region === undefined || tier === undefined) {
        continue;
      }
      region.root.active = true;
      const reached = save.loginReward.totalDays >= tier.day;
      const isClaimed = tierIndex < claimed;
      const isClaimable = tierIndex === claimableIndex;
      const rewardText = describeReward(tier);
      if (isClaimed) {
        region.label.string = `第 ${tier.day} 天　✓ 已领取　${rewardText}`;
        region.setLook(CLAIMED_COLOR);
      } else if (isClaimable) {
        region.label.string = `第 ${tier.day} 天　● 可领取　${rewardText}`;
        region.setLook(CLAIMABLE_COLOR);
      } else {
        region.label.string = `第 ${tier.day} 天　${reached ? '（未领取）' : '🔒 未达成'}　${rewardText}`;
        region.setLook(LOCKED_COLOR);
      }
    }

    this.claimButton?.setEnabled(claimableIndex !== null);
    if (this.claimButton !== null) {
      const claimableTier = claimableIndex !== null ? tiers[claimableIndex] : undefined;
      this.claimButton.label.string = claimableTier !== undefined
        ? `领取第 ${claimableTier.day} 天奖励`
        : (completed ? '本轮已完结' : '累计天数未达下一档');
    }
  }

  private handleClaimClicked(): void {
    const account = AccountSystem.instance;
    const save = account?.accountSave ?? null;
    const economy = account?.economy ?? null;
    if (account === null || save === null || economy === null) {
      return;
    }
    const outcome = claimLoginReward(save, INITIAL_GAME_CONFIG, economy, { addAccountXp }, {
      txId: `login_reward_${account.time.now()}`,
      at: account.time.now(),
    });
    if (outcome.ok) {
      const resourceText = Object.keys(outcome.resources)
        .map((resourceId) => `${resourceId} +${outcome.resources[resourceId]}`)
        .join('　');
      this.setStatus(
        `已领取第 ${outcome.tierDay} 天奖励：${resourceText || '无资源'}　修行经验 +${outcome.accountXp}` +
        (outcome.completed ? '　本轮完结！' : ''),
      );
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

function describeReward(tier: { reward: { accountXp: number; resources: Readonly<Record<string, number>> } }): string {
  const resourceNames: Record<string, string> = {
    res_lingshi: '灵石',
    res_xiuwei: '修为',
    res_yaodan: '妖丹',
    res_lingpo_qinglong: '青龙灵魄',
    res_lingpo_baihu: '白虎灵魄',
    res_lingpo_zhuque: '朱雀灵魄',
    res_lingpo_xuanwu: '玄武灵魄',
    res_lingpo_jiuweihu: '九尾狐灵魄',
  };
  const parts: string[] = [];
  for (const resourceId of Object.keys(tier.reward.resources)) {
    const amount = tier.reward.resources[resourceId];
    if (typeof amount === 'number' && amount > 0) {
      parts.push(`${resourceNames[resourceId] ?? resourceId}×${amount}`);
    }
  }
  if (tier.reward.accountXp > 0) {
    parts.push(`经验×${tier.reward.accountXp}`);
  }
  return parts.join(' ');
}

function describeClaimFailure(reason: string): string {
  switch (reason) {
    case 'not_reached':
      return '累计天数未达该档';
    case 'already_claimed':
      return '已领取过';
    case 'round_completed':
      return '本轮 30 档已全部领完';
    case 'grant_rejected':
      return '资源发放被拒绝';
    case 'xp_rejected':
      return '账号经验结算失败';
    default:
      return '状态异常';
  }
}

