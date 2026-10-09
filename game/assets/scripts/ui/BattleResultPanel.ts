import { _decorator, Button, Color, Component, director, Label, Node, Sprite, UITransform } from 'cc';

import { BattleController } from '../battle/BattleController';
import { ActiveStage } from '../battle/ActiveStage';
import { INITIAL_GAME_CONFIG } from '../config/GameConfig';
import { AccountSystem } from '../account/AccountSystem';
import { computeStageRewards } from '../account/SettlementRewards';
import type { BattleResultStats } from '../core/BattleEvents';
import {
  applySettlementBonus,
  canOfferSettlementBonus,
  computeSettlementTopUp,
} from '../account/AdRewards';
import { adResultGrantsReward, createAdAdapterProxy } from '../platform/AdAdapterUi';
import { applyArtSprite, loadSpriteFrameForButton } from './ArtLoader';
import { addPanelBackdrop } from './PanelKit';
import { addAccountXp } from '../account/PlayerLeveling';

const { ccclass, property } = _decorator;

const RESULT_TITLES: Readonly<Record<BattleResultStats['result'], string>> = {
  victory: '战斗胜利',
  defeat: '修行受挫',
};

/** 结算奖励行的资源展示顺序与简称（仅展示；真实发放以 resourceId 事务为准）。 */
const REWARD_DISPLAY_ORDER: ReadonlyArray<readonly [string, string]> = [
  ['res_lingshi', '灵石'],
  ['res_xiuwei', '修为'],
  ['res_yaodan', '妖丹'],
  ['res_lingpo_qinglong', '青龙灵魄'],
  ['res_lingpo_baihu', '白虎灵魄'],
  ['res_lingpo_zhuque', '朱雀灵魄'],
  ['res_lingpo_xuanwu', '玄武灵魄'],
  ['res_lingpo_jiuweihu', '九尾狐灵魄'],
];

/**
 * 终局浮层：订阅 battleFinished 展示胜负与四项统计，"再来一局"重载
 * BattleScene（场景重载即完整重置，T13 已验证归零与无泄漏）。
 * 内容挂在 content 子节点上切换显隐，组件常驻维持订阅成对。
 */
@ccclass('BattleResultPanel')
export class BattleResultPanel extends Component {
  @property({ type: Node })
  private content: Node | null = null;

  @property({ type: Label })
  private titleLabel: Label | null = null;

  @property({ type: [Label] })
  private statLabels: Label[] = [];

  /** 奖励明细行（可选）：未装配时不展示奖励，不影响结算面板其他功能。 */
  @property({ type: Label })
  private rewardLabel: Label | null = null;

  @property({ type: Button })
  private retryButton: Button | null = null;

  /** 返回首页按钮（可选，V05-10）：未装配时不展示，重开一局仍可用。 */
  @property({ type: Button })
  private homeButton: Button | null = null;

  @property({ type: BattleController })
  private battleController: BattleController | null = null;

  private unsubscribeFinished: (() => void) | null = null;
  /** 广告翻倍按钮位置锚点（可选）：拖入结算面板内的空节点即按其位置摆放；
   *  未装配时默认在奖励行下方 44px（再兜底面板底部 -160）。 */
  @property({ type: Node })
  private bonusAnchor: Node | null = null;

  private bonusButton: Button | null = null;
  private bonusStateLabel: Label | null = null;
  private lastStats: BattleResultStats | null = null;
  private bonusToppedUp = false;
  private bonusPending = false;
  private victoryTitleArt: Node | null = null;
  private defeatTitleArt: Node | null = null;
  private starIcons: Node[] = [];

  protected override start(): void {
    if (this.content === null) {
      throw new Error('[BattleResultPanel] missing reference: content ← 把浮层内容子节点拖入该属性槽');
    }
    if (this.titleLabel === null || this.statLabels.length === 0) {
      throw new Error('[BattleResultPanel] titleLabel 与 statLabels 至少各需一个条目');
    }
    if (this.retryButton === null) {
      throw new Error('[BattleResultPanel] missing reference: retryButton ← 把再来一局按钮拖入该属性槽');
    }
    if (this.battleController === null) {
      throw new Error('[BattleResultPanel] missing reference: battleController ← 把 Systems 节点拖入该属性槽');
    }

    // 结算面板底图（V10-14 P1）：竖版装饰框垫在场景内容之下（sibling 0/1）。
    addPanelBackdrop(this.content, { frameArt: 'panel_settlement', frameWidth: 640, frameHeight: 820 });
    this.victoryTitleArt = this.createTitleArtNode('VictoryTitleArt');
    this.defeatTitleArt = this.createTitleArtNode('DefeatTitleArt');
    void this.loadTitleArt('title_victory', this.victoryTitleArt);
    void this.loadTitleArt('title_defeat', this.defeatTitleArt);
    this.buildStarIconRow();
    this.retryButton.node.on(Button.EventType.CLICK, this.handleRetryClicked);
    if (this.homeButton !== null) {
      this.homeButton.node.on(Button.EventType.CLICK, this.handleHomeClicked);
    }
    this.buildBonusButton();
    this.content.active = false;
  }

  /**
   * 广告翻倍按钮（V10-11，灰盒代码构建）：复用 rewardLabel 同一资源行下方，
   * 可用性按 canOfferSettlementBonus 三重门（投放/结果/每日次数 + 本局已翻倍）。
   */
  private buildBonusButton(): void {
    if (this.content === null || this.bonusButton !== null) {
      return;
    }
    const buttonNode = new Node('AdBonusButton');
    buttonNode.setParent(this.content);
    const transform = buttonNode.addComponent(UITransform);
    transform.setContentSize(220, 46);
    // 位置：优先用户摆放的锚点；否则奖励行正下方 44px；再兜底面板底部。
    const fallbackY =
      this.rewardLabel !== null ? this.rewardLabel.node.position.y - 44 : -160;
    const anchor = this.bonusAnchor;
    const x = anchor !== null ? anchor.position.x : 0;
    const y = anchor !== null ? anchor.position.y : fallbackY;
    buttonNode.setPosition(x, y, 0);
    const label = buttonNode.addComponent(Label);
    label.string = '广告翻倍';
    label.fontSize = 20;
    label.horizontalAlign = Label.HorizontalAlign.CENTER;
    label.verticalAlign = Label.VerticalAlign.CENTER;
    const button = buttonNode.addComponent(Button);
    buttonNode.on(Button.EventType.CLICK, () => this.handleBonusClicked());
    applyArtSprite(buttonNode, 'btn_primary_n', { sliced: true });
    this.bonusButton = button;
    const stateNode = new Node('AdBonusState');
    stateNode.setParent(this.content);
    stateNode.setPosition(x, y - 36, 0);
    this.bonusStateLabel = stateNode.addComponent(Label);
    this.bonusStateLabel.string = '';
    this.bonusStateLabel.fontSize = 14;
  }

  private refreshBonusButton(): void {
    if (this.bonusButton === null || this.lastStats === null) {
      return;
    }
    const account = AccountSystem.instance;
    const save = account?.accountSave ?? null;
    const config = INITIAL_GAME_CONFIG.ads.settlementBonus;
    const check =
      save !== null && account !== null
        ? canOfferSettlementBonus(
            save,
            config,
            this.lastStats.result,
            account.time.dayKey(),
            this.bonusToppedUp,
            isPlacementEnabled,
          )
        : ({ ok: false, reason: 'placement_disabled' } as const);
    this.bonusButton.node.active = check.ok;
    if (this.bonusStateLabel !== null) {
      this.bonusStateLabel.string = check.ok ? `今日剩余 ${check.remainingToday} 次` : '';
    }
  }

  private async handleBonusClicked(): Promise<void> {
    const account = AccountSystem.instance;
    const stats = this.lastStats;
    if (account === null || account.accountSave === null || stats === null || this.bonusPending) {
      return;
    }
    this.bonusPending = true;
    let result: 'rewarded' | 'closed_early' | 'failed';
    try {
      result = await createAdAdapterProxy().show(INITIAL_GAME_CONFIG.ads.settlementBonus.placementId);
    } catch {
      result = 'failed';
    }
    this.bonusPending = false;
    if (!adResultGrantsReward(result)) {
      if (this.bonusStateLabel !== null) {
        this.bonusStateLabel.string = '未完整观看，未扣除次数，可重试';
      }
      return;
    }
    const save = account.accountSave;
    const { stage, difficulty } = ActiveStage.current;
    const reward = INITIAL_GAME_CONFIG.stageRewards.find((candidate) => candidate.stageId === stage.id);
    const config = INITIAL_GAME_CONFIG.ads.settlementBonus;
    if (reward === undefined) {
      return;
    }
    const topUp = computeSettlementTopUp(reward, stats.result, difficulty.rewardMultiplier, config);
    const outcome = applySettlementBonus(
      save,
      config,
      topUp,
      { grant: (state, request) => account.economy?.grant(state, request) ?? { ok: false, reason: 'unknown_resource', detail: 'no_economy' } },
      (state, amount) => addAccountXp(state, INITIAL_GAME_CONFIG.playerLevel, amount),
      { txId: `ad_bonus_${account.time.now()}`, at: account.time.now() },
      account.time.dayKey(),
    );
    if (outcome.ok) {
      this.bonusToppedUp = true;
      account.persistSave();
      console.log(`[BattleResultPanel] settlement bonus applied: xp+${outcome.accountXp}, res=${JSON.stringify(outcome.appliedResources)}`);
    } else if (this.bonusStateLabel !== null) {
      this.bonusStateLabel.string = `发放失败：${outcome.failureDetail}`;
    }
    this.refreshBonusButton();
  }

  protected override onEnable(): void {
    if (this.battleController === null) {
      return;
    }
    this.unsubscribeFinished = this.battleController.events.on('battleFinished', (payload) => {
      this.showResult(payload.stats);
    });
  }

  protected override onDisable(): void {
    this.unsubscribeFinished?.();
    this.unsubscribeFinished = null;
  }

  private showResult(stats: BattleResultStats): void {
    if (this.content === null || this.titleLabel === null) {
      return;
    }
    this.titleLabel.string = RESULT_TITLES[stats.result];
    const lines = [
      `用时 ${stats.elapsedSeconds}s`,
      `击杀 ${stats.killCount}`,
      `经验 ${stats.xpCollected}`,
      `达到 Lv.${stats.levelReached}`,
    ];
    // V08-04：星级与逐条达成明细（装配了更多 statLabels 时逐行展示）。
    if (stats.result === 'victory') {
      lines.push(`星级 ${'★'.repeat(stats.stars)}${'☆'.repeat(Math.max(0, 3 - stats.stars))}`);
      for (const detail of stats.starDetails) {
        lines.push(`${detail.met ? '✓' : '✗'} ${detail.text}`);
      }
    }
    for (let index = 0; index < this.statLabels.length; index += 1) {
      const label = this.statLabels[index];
      const line = lines[index];
      if (label !== undefined && line !== undefined) {
        label.string = line;
      }
    }
    this.showRewardLine(stats.result);
    this.lastStats = stats;
    this.renderResultTitle();
    this.renderStarIcons(stats);
    this.bonusToppedUp = false;
    this.refreshBonusButton();
    this.content.active = true;
  }

  private createTitleArtNode(name: string): Node | null {
    const title = this.titleLabel;
    const parent = title?.node.parent;
    if (title === null || parent === null || parent === undefined) {
      return null;
    }
    const artNode = new Node(name);
    artNode.setParent(parent);
    artNode.setPosition(title.node.position.x, title.node.position.y, title.node.position.z);
    // 标题字切图原始比例 720×240 = 360×120 逻辑尺寸，避免按文本框拉伸变形。
    artNode.addComponent(UITransform).setContentSize(360, 120);
    artNode.active = false;
    return artNode;
  }

  /** 胜利大星级（V10-14 P1）：标题字下方三星图标行；统计行文字星级保留作回退。 */
  private buildStarIconRow(): void {
    if (this.content === null) {
      return;
    }
    const titleY = this.titleLabel?.node.position.y ?? 330;
    for (let index = 0; index < 3; index += 1) {
      const icon = new Node(`StarIcon${index + 1}`);
      icon.setParent(this.content);
      icon.setPosition((index - 1) * 54, titleY - 150, 0);
      icon.addComponent(UITransform).setContentSize(44, 44);
      applyArtSprite(icon, 'icon_star_empty', { width: 44, height: 44 });
      icon.active = false;
      this.starIcons.push(icon);
    }
  }

  private renderStarIcons(stats: BattleResultStats): void {
    for (let index = 0; index < this.starIcons.length; index += 1) {
      const icon = this.starIcons[index];
      if (icon === undefined) {
        continue;
      }
      icon.active = stats.result === 'victory';
      if (stats.result === 'victory') {
        applyArtSprite(icon, index < stats.stars ? 'icon_star_filled' : 'icon_star_empty', { width: 44, height: 44 });
      }
    }
  }

  private async loadTitleArt(artId: string, node: Node | null): Promise<void> {
    if (node === null) {
      return;
    }
    const spriteFrame = await loadSpriteFrameForButton(artId);
    if (spriteFrame === null || !node.isValid) {
      return;
    }
    const sprite = node.addComponent(Sprite);
    sprite.spriteFrame = spriteFrame;
    sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    this.renderResultTitle();
  }

  private renderResultTitle(): void {
    const stats = this.lastStats;
    const title = this.titleLabel;
    if (stats === null || title === null) {
      return;
    }
    const activeArt = stats.result === 'victory' ? this.victoryTitleArt : this.defeatTitleArt;
    const ready = activeArt?.getComponent(Sprite) !== null && activeArt !== null;
    if (this.victoryTitleArt !== null) {
      this.victoryTitleArt.active = ready && stats.result === 'victory';
    }
    if (this.defeatTitleArt !== null) {
      this.defeatTitleArt.active = ready && stats.result === 'defeat';
    }
    title.node.active = !ready;
    title.string = RESULT_TITLES[stats.result];
  }

  /**
   * 奖励明细行（V05-09）：与发放方共用 computeStageRewards 纯函数，
   * 展示数字与实际发放天然一致（库存上限钳制差异由账目日志体现，V0.5 上限下不触发）。
   */
  private showRewardLine(result: BattleResultStats['result']): void {
    if (this.rewardLabel === null) {
      return;
    }
    // 无账号服务（直接预览 BattleScene）时不展示奖励：计划未兑现，不伪装。
    if (AccountSystem.instance === null || AccountSystem.instance.accountSave === null) {
      this.rewardLabel.string = '';
      return;
    }
    // V08-03：展示当局选中关卡 × 难度乘数的发放计划（与 AccountSystem 结算同源同参）。
    const { stage, difficulty } = ActiveStage.current;
    const reward = INITIAL_GAME_CONFIG.stageRewards.find((candidate) => candidate.stageId === stage.id);
    if (reward === undefined) {
      this.rewardLabel.string = '';
      return;
    }
    const plan = computeStageRewards(reward, result, difficulty.rewardMultiplier);
    const parts: string[] = [];
    if (plan.accountXp > 0) {
      parts.push(`修行经验+${plan.accountXp}`);
    }
    for (const [resourceId, displayName] of REWARD_DISPLAY_ORDER) {
      const amount = plan.resourceDeltas[resourceId];
      if (amount !== undefined) {
        parts.push(`${displayName}+${amount}`);
      }
    }
    this.rewardLabel.string = parts.length > 0 ? `获得：${parts.join(' ')}` : '获得：无';
  }

  private readonly handleRetryClicked = (): void => {
    director.loadScene('BattleScene');
  };

  private readonly handleHomeClicked = (): void => {
    director.loadScene('HomeScene');
  };
}

function isPlacementEnabled(placementId: string): boolean {
  return INITIAL_GAME_CONFIG.ads.placements.some(
    (placement) => placement.id === placementId && placement.enabled,
  );
}
