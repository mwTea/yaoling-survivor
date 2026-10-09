import { _decorator, Color, Component, director, Label, Node, UITransform, view } from 'cc';

import { AccountSystem } from '../account/AccountSystem';
import { INITIAL_GAME_CONFIG } from '../config/GameConfig';
import { getAccountLevelProgress } from '../account/PlayerLeveling';
import { isTaskClaimable } from '../account/TaskSystem';
import { listAchievementViews } from '../account/AchievementSystem';
import { getClaimableTierIndex } from '../account/LoginReward';
import { isOfferClaimable } from '../account/OfferSystem';
import { canClaimDailyResource, claimDailyResource, getAdDailyUses } from '../account/AdRewards';
import { isActivityEntryVisible } from '../account/ActivitySystem';
import { buildUnlockEvaluationState, resolveFeatureEntryState } from '../account/UnlockSystem';
import { isFeatureEnabled, isFeatureFlagId } from '../platform/FeatureFlags';
import { adResultGrantsReward, createAdAdapterProxy } from '../platform/AdAdapterUi';
import { describeRealmLine } from './PanelText';
import { TaskPanel } from './TaskPanel';
import { AchievementPanel } from './AchievementPanel';
import { CodexPanel } from './CodexPanel';
import { ShopPanel } from './ShopPanel';
import { LoginRewardPanel } from './LoginRewardPanel';
import { RewardCenterPanel } from './RewardCenterPanel';
import { createArtNode, createClickRegion, createLabel } from './PanelKit';
import { applyArtSprite } from './ArtLoader';
import { redDotService } from './RedDotService';

const { ccclass, property } = _decorator;

const CTA_COLOR = new Color(70, 110, 60, 255);
const QUICK_COLOR = new Color(52, 62, 84, 235);
const CARD_COLOR = new Color(40, 52, 66, 235);
const DOT_SIZE = 14;

/** 可打开的面板最小结构（show + onOperationDone 单槽）。 */
interface OpenablePanel {
  show(): void;
  onOperationDone: (() => void) | null;
}

interface QuickEntry {
  /** 红点源 ID（可选；与 RedDotService 数据源对应）。 */
  readonly dotId?: string;
  /** 活动门控（仅签到：activity_login_01 窗口 + 开关）。 */
  readonly activityId?: string;
  /** 解锁表功能 ID（可选；图鉴/商店卡片用）。 */
  readonly featureId?: string;
  readonly title: string;
  readonly panel: OpenablePanel | null;
}

/**
 * 首页 HUD（V05-10 建立，V10 布局对齐改版，按首页 v2 设计稿；内容全部代码
 * 构建）：顶部玩家信息（等级/境界/经验）+ 双货币（灵石/灵玉）；左列快捷入口
 * （签到/礼包/任务/成就，带红点）；中部"踏入秘境"主按钮（=开始战斗）；
 * 功能卡片（图鉴/商店，按解锁表显隐）。设计稿中的邮件/充值"+"不在 V1.0
 * 范围（阶段决策），不实现；"活动"挂件位当前唯一活动类型即签到，不重复放。
 * 数据全部来自 persist 账号服务，UI 只读展示、只回传意图。
 */
@ccclass('HomeHud')
export class HomeHud extends Component {
  @property({ type: TaskPanel })
  private taskPanel: TaskPanel | null = null;

  @property({ type: AchievementPanel })
  private achievementPanel: AchievementPanel | null = null;

  @property({ type: CodexPanel })
  private codexPanel: CodexPanel | null = null;

  @property({ type: ShopPanel })
  private shopPanel: ShopPanel | null = null;

  @property({ type: LoginRewardPanel })
  private loginRewardPanel: LoginRewardPanel | null = null;

  @property({ type: RewardCenterPanel })
  private rewardCenterPanel: RewardCenterPanel | null = null;

  /** 每日广告资源入口（V10-11，可选）：拖入首页空节点即显示；未装配不出现。 */
  @property({ type: Node })
  private dailyAdHost: Node | null = null;

  private playerLabel: Label | null = null;
  private resourceLabel: Label | null = null;
  private dailyAdLabel: Label | null = null;
  private readonly dotBadges = new Map<string, Node>();
  private readonly wrappedPanels = new Set<OpenablePanel>();
  private readonly unknownFeatureWarned = new Set<string>();
  private quickNodes: Array<{ readonly root: Node }> = [];
  private cardNodes: Array<{ readonly root: Node }> = [];
  private dailyAdPending = false;
  private built = false;
  private unsubscribeDots: (() => void) | null = null;
  private homeBg: Node | null = null;
  private avatarFrame: Node | null = null;
  private enterStageRoot: Node | null = null;
  private homeTitleArt: Node | null = null;

  protected override start(): void {
    this.build();
    this.refresh();
  }

  protected override onEnable(): void {
    // 返回首页重算（解锁变化/领取后的红点与余额）。
    this.rebuildQuickAndCards();
    this.refresh();
    this.unsubscribeDots = redDotService.onChange(() => this.refresh());
    view.on('canvas-resize', this.handleCanvasResize, this);
    redDotService.refresh();
    this.updateBadges();
  }

  protected override onDisable(): void {
    view.off('canvas-resize', this.handleCanvasResize, this);
    this.unsubscribeDots?.();
    this.unsubscribeDots = null;
  }

  private build(): void {
    if (this.built) {
      return;
    }
    this.built = true;
    const size = view.getVisibleSize();
    const halfWidth = size.width / 2;
    const top = size.height / 2;
    // 纵向布局用可见高度比例（fitWidth 下可见高度随窗口/机型变化，
    // 绝对坐标会溢出——本轮修复左列被顶出屏幕的根因）。
    const H = size.height;

    // 全屏背景（V10-14）：置于本节点最底层（后续兄弟节点渲染在其上）。
    const bgNode = new Node('HomeBg');
    this.homeBg = bgNode;
    bgNode.setParent(this.node);
    bgNode.setSiblingIndex(0);
    const bgTransform = bgNode.addComponent(UITransform);
    bgTransform.setContentSize(size.width, size.height);
    applyArtSprite(bgNode, 'bg_home');

    // 顶部左：头像框 + 玩家信息（两行：Lv+境界 / 经验进度）。
    const avatarNode = new Node('AvatarFrame');
    this.avatarFrame = avatarNode;
    avatarNode.setParent(this.node);
    avatarNode.setPosition(-halfWidth + 50, top - Math.max(54, H * 0.065), 0);
    const avatarTransform = avatarNode.addComponent(UITransform);
    avatarTransform.setContentSize(84, 84);
    applyArtSprite(avatarNode, 'icon_avatar_frame');
    const profileTextWidth = Math.min(260, Math.max(180, size.width * 0.36));
    this.playerLabel = createLabel(this.node, 'PlayerInfo', '', -halfWidth + 150, top - Math.max(24, H * 0.028), 18, profileTextWidth);
    if (this.playerLabel !== null) {
      this.playerLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
    }
    // 顶部中：书法标题（V10-14 P1），置于顶部信息行之下避免重叠。
    this.homeTitleArt = createArtNode(
      this.node, 'HomeTitleArt', 'title_calli_home',
      0, top - Math.max(64, H * 0.075), 240, 90,
    );

    // 顶部右：双货币（灵石/灵玉；充值"+"不在范围）。
    const resourceTextWidth = Math.min(240, Math.max(170, size.width * 0.32));
    this.resourceLabel = createLabel(
      this.node,
      'Resources',
      '',
      halfWidth - resourceTextWidth - 16,
      top - Math.max(24, H * 0.03),
      16,
      resourceTextWidth,
    );
    if (this.resourceLabel !== null) {
      this.resourceLabel.horizontalAlign = Label.HorizontalAlign.RIGHT;
    }

    // 中下部：踏入秘境主按钮（设计稿约 62% 高度；行为 = 原开始战斗）。
    const enterStage = createClickRegion(
      this.node, 'EnterStage', '踏入秘境', 0, -H * 0.14, 300, 84,
      () => director.loadScene('BattleScene'),
      CTA_COLOR.clone(),
      { normal: 'btn_enter_n', pressed: 'btn_enter_p' },
    );
    // 金框切图中间为米色留白：文字用深褐小号，压在留白带上（书法字体随资源接入）。
    enterStage.label.fontSize = 30;
    enterStage.label.color = new Color(0x5a, 0x38, 0x1c, 0xff);
    this.enterStageRoot = enterStage.root;

    this.registerRedDotSources();
    this.rebuildQuickAndCards();
    this.buildDailyAdEntry();
  }

  /** 预览器与浏览器窗口比例不同；画布尺寸变化后重排首页的屏幕锚定元素。 */
  private handleCanvasResize(): void {
    if (!this.built) {
      return;
    }
    const size = view.getVisibleSize();
    const halfWidth = size.width / 2;
    const top = size.height / 2;
    const height = size.height;

    if (this.homeBg !== null) {
      this.homeBg.getComponent(UITransform)?.setContentSize(size.width, size.height);
    }
    this.avatarFrame?.setPosition(-halfWidth + 50, top - Math.max(54, height * 0.065), 0);
    const profileTextWidth = Math.min(260, Math.max(180, size.width * 0.36));
    this.playerLabel?.node.setPosition(-halfWidth + 150, top - Math.max(24, height * 0.028), 0);
    this.playerLabel?.getComponent(UITransform)?.setContentSize(profileTextWidth, 52);
    const resourceTextWidth = Math.min(240, Math.max(170, size.width * 0.32));
    this.resourceLabel?.node.setPosition(
      halfWidth - resourceTextWidth - 16,
      top - Math.max(24, height * 0.03),
      0,
    );
    this.resourceLabel?.getComponent(UITransform)?.setContentSize(resourceTextWidth, 40);
    this.enterStageRoot?.setPosition(0, -height * 0.14, 0);
    this.homeTitleArt?.setPosition(0, top - Math.max(64, height * 0.075), 0);
    this.positionDailyAdEntry();
    this.rebuildQuickAndCards();
  }

  private buildQuickEntries(): QuickEntry[] {
    return [
      { dotId: 'login_reward', activityId: 'activity_login_01', title: '签到', panel: this.loginRewardPanel },
      { dotId: 'reward_center', title: '礼包', panel: this.rewardCenterPanel },
      { dotId: 'tasks', title: '任务', panel: this.taskPanel },
      { dotId: 'achievements', title: '成就', panel: this.achievementPanel },
    ];
  }

  private buildCardEntries(): QuickEntry[] {
    return [
      { featureId: 'codex', title: '图鉴', panel: this.codexPanel },
      { featureId: 'shop', title: '商店', panel: this.shopPanel },
    ];
  }

  /** 重建快捷入口与卡片（冷路径：解锁/活动窗口变化时；销毁重建无每帧成本）。 */
  private rebuildQuickAndCards(): void {
    if (!this.built) {
      return;
    }
    for (const node of [...this.quickNodes, ...this.cardNodes]) {
      node.root.removeFromParent();
      node.root.destroy();
    }
    this.quickNodes = [];
    this.cardNodes = [];
    this.dotBadges.clear();

    const size = view.getVisibleSize();
    const top = size.height / 2;
    const H = size.height;
    // 左列快捷入口：竖排圆形图标（设计稿左列挂件位），文字在图标下方。
    const quickVisible = this.buildQuickEntries().filter((entry) => this.isEntryVisible(entry));
    quickVisible.forEach((entry, index) => {
      const region = createClickRegion(
        this.node, `Quick_${entry.title}`, entry.title,
        -size.width / 2 + 92, top - H * 0.2 - index * H * 0.085,
        96, 96,
        () => this.handleEntryClicked(entry),
        QUICK_COLOR.clone(),
        { normal: quickArt(entry.title) },
      );
      region.label.fontSize = 15;
      region.label.lineHeight = 17;
      region.label.node.setPosition(0, -34, 0);
      this.quickNodes.push({ root: region.root });
      if (entry.dotId !== undefined) {
        this.dotBadges.set(entry.dotId, this.createDotBadge(region.root));
      }
      this.wrapPanelOperation(entry.panel);
    });

    // 功能卡片：CTA 下方两卡（图鉴/商店，按解锁表显隐；设计稿约 72% 高度）。
    const cardVisible = this.buildCardEntries().filter((entry) => this.isEntryVisible(entry));
    const cardSpacing = 320;
    const cardStartX = -((cardVisible.length - 1) * cardSpacing) / 2;
    cardVisible.forEach((entry, index) => {
      const region = createClickRegion(
        this.node, `Card_${entry.title}`, entry.title,
        cardStartX + index * cardSpacing, -H * 0.335,
        300, 96,
        () => this.handleEntryClicked(entry),
        CARD_COLOR.clone(),
        { normal: entry.title === '图鉴' ? 'card_codex' : 'card_shop' },
      );
      region.label.fontSize = 22;
      this.cardNodes.push({ root: region.root });
      this.wrapPanelOperation(entry.panel);
    });
    this.updateBadges();
  }

  private handleEntryClicked(entry: QuickEntry): void {
    entry.panel?.show();
    redDotService.refresh();
    this.updateBadges();
  }

  /** 入口可见性：面板未装配不显示 → 活动门控（签到）→ 解锁表（卡片）→ 恒可见。 */
  private isEntryVisible(entry: QuickEntry): boolean {
    if (entry.panel === null) {
      return false;
    }
    if (entry.activityId !== undefined) {
      const account = AccountSystem.instance;
      const dayKey = account !== null ? account.time.dayKey() : '';
      return isActivityEntryVisible(INITIAL_GAME_CONFIG, entry.activityId, dayKey, {
        isFlagEnabled: (flag) => isFeatureFlagId(flag) && isFeatureEnabled(flag),
        hasUnclaimed: (activity) => {
          const save = AccountSystem.instance?.accountSave ?? null;
          if (save === null || activity.type !== 'login') {
            return false;
          }
          return save.loginReward.claimedTier < INITIAL_GAME_CONFIG.loginRewards.totalDays;
        },
      });
    }
    if (entry.featureId !== undefined) {
      const state = this.resolveFeatureState(entry.featureId);
      return state !== null && state.kind !== 'hidden';
    }
    return true;
  }

  private resolveFeatureState(featureId: string): ReturnType<typeof resolveFeatureEntryState> {
    const account = AccountSystem.instance;
    const save = account?.accountSave ?? null;
    if (account === null || save === null) {
      return null;
    }
    const state = resolveFeatureEntryState(
      INITIAL_GAME_CONFIG,
      buildUnlockEvaluationState(save, account.time.now()),
      featureId,
      { isFlagEnabled: (flag) => isFeatureFlagId(flag) && isFeatureEnabled(flag) },
    );
    if (state === null && !this.unknownFeatureWarned.has(featureId)) {
      this.unknownFeatureWarned.add(featureId);
      console.warn(`[HomeHud] feature "${featureId}" is not bound in unlocks table`);
    }
    return state;
  }

  /** 面板操作（领取/购买）后刷新红点与首页数据（onOperationDone 单槽只包装一次）。 */
  private wrapPanelOperation(panel: OpenablePanel | null): void {
    if (panel === null || this.wrappedPanels.has(panel)) {
      return;
    }
    this.wrappedPanels.add(panel);
    const previous = panel.onOperationDone;
    panel.onOperationDone = (): void => {
      if (previous !== null) {
        previous();
      }
      redDotService.refresh();
      this.refresh();
    };
  }

  /** 读取账号服务并刷新顶部信息/货币与每日广告入口。 */
  public refresh(): void {
    const account = AccountSystem.instance;
    const save = account !== null ? account.accountSave : null;
    const economy = account !== null ? account.economy : null;
    if (account === null || save === null || economy === null) {
      if (this.playerLabel !== null) {
        this.playerLabel.string = '账号服务未装配';
      }
      if (this.resourceLabel !== null) {
        this.resourceLabel.string = '';
      }
      return;
    }
    const progress = getAccountLevelProgress(save, INITIAL_GAME_CONFIG.playerLevel);
    if (this.playerLabel !== null) {
      this.playerLabel.string =
        `Lv.${progress.level}　${describeRealmLine(INITIAL_GAME_CONFIG.realms, save.realmIndex, save.subRealmIndex)}
` +
        `经验 ${progress.xp}/${progress.requiredXp ?? 'MAX'}`;
    }
    if (this.resourceLabel !== null) {
      this.resourceLabel.string =
        `灵石 ${economy.getBalance(save, 'res_lingshi')}　灵玉 ${economy.getBalance(save, 'res_lingyu')}`;
    }
    this.refreshDailyAdEntry();
  }

  // —— 每日广告资源入口（V10-11，随布局改版并入本组件） ——

  private buildDailyAdEntry(): void {
    const host = this.dailyAdHost;
    if (host === null) {
      return;
    }
    // Pin the resource strip to the upper quarter of the visible area. A fixed
    // scene Y placed it near the header on tall Creator previews and too high
    // relative to the page on wider browser previews.
    host.getComponent(UITransform)?.setContentSize(320, 52);
    this.positionDailyAdEntry();
    // 底条切图（V10-14）：先加背景子节点，再加文字子节点（后者渲染在上）。
    const bgNode = new Node('DailyAdBg');
    bgNode.setParent(host);
    const bgTransform = bgNode.addComponent(UITransform);
    bgTransform.setContentSize(320, 52);
    applyArtSprite(bgNode, 'daily_ad_bg', { sliced: true });
    const labelNode = new Node('DailyAdText');
    labelNode.setParent(host);
    const label = labelNode.addComponent(Label);
    label.fontSize = 16;
    label.string = '';
    this.dailyAdLabel = label;
    host.on('touch-end', () => void this.handleDailyAdClicked());
    this.refreshDailyAdEntry();
  }

  private positionDailyAdEntry(): void {
    if (this.dailyAdHost === null) {
      return;
    }
    const visibleSize = view.getVisibleSize();
    this.dailyAdHost.setPosition(
      this.dailyAdHost.position.x,
      visibleSize.height * 0.25,
      this.dailyAdHost.position.z,
    );
  }

  private isAdPlacementEnabled(placementId: string): boolean {
    return INITIAL_GAME_CONFIG.ads.placements.some(
      (placement) => placement.id === placementId && placement.enabled,
    );
  }

  private refreshDailyAdEntry(): void {
    const label = this.dailyAdLabel;
    if (label === null) {
      return;
    }
    const account = AccountSystem.instance;
    const save = account?.accountSave ?? null;
    if (account === null || save === null) {
      label.string = '';
      return;
    }
    const config = INITIAL_GAME_CONFIG.ads.dailyResource;
    const check = canClaimDailyResource(
      save, config, account.time.dayKey(), Math.floor(account.time.now() / 60_000),
      (placementId) => this.isAdPlacementEnabled(placementId),
    );
    if (!check.ok) {
      label.string =
        check.reason === 'per_day_limit'
          ? `每日灵石（今日已领 ${getAdDailyUses(save, config.placementId, account.time.dayKey())}/${config.maxPerDay}）`
          : '';
      return;
    }
    const lingshi = config.resources['res_lingshi'] ?? 0;
    label.string = `看广告领灵石+${lingshi}（今日 ${check.remainingToday} 次）`;
  }

  private async handleDailyAdClicked(): Promise<void> {
    const account = AccountSystem.instance;
    const save = account?.accountSave ?? null;
    if (account === null || save === null || this.dailyAdPending) {
      return;
    }
    const config = INITIAL_GAME_CONFIG.ads.dailyResource;
    const check = canClaimDailyResource(
      save, config, account.time.dayKey(), Math.floor(account.time.now() / 60_000),
      (placementId) => this.isAdPlacementEnabled(placementId),
    );
    if (!check.ok) {
      this.refreshDailyAdEntry();
      return;
    }
    this.dailyAdPending = true;
    let result: 'rewarded' | 'closed_early' | 'failed';
    try {
      result = await createAdAdapterProxy().show(config.placementId);
    } catch {
      result = 'failed';
    }
    this.dailyAdPending = false;
    if (!adResultGrantsReward(result)) {
      if (this.dailyAdLabel !== null) {
        this.dailyAdLabel.string = '未完整观看，未扣除次数，可重试';
      }
      return;
    }
    const outcome = claimDailyResource(
      save,
      config,
      {
        grant: (state, request) =>
          account.economy?.grant(state, request) ?? { ok: false, reason: 'unknown_resource', detail: 'no_economy' },
      },
      { txId: `ad_daily_${account.time.now()}`, at: account.time.now() },
      account.time.dayKey(),
      Math.floor(account.time.now() / 60_000),
    );
    if (outcome.ok) {
      account.persistSave();
      this.refresh();
      console.log(`[HomeHud] daily ad resource granted: ${JSON.stringify(outcome.appliedResources)}`);
    } else if (this.dailyAdLabel !== null) {
      this.dailyAdLabel.string = `领取失败：${outcome.failureDetail}`;
    }
    this.refreshDailyAdEntry();
  }

  // —— 红点（数据源注册 + 角标显隐；V08-16 语义随入口迁至本组件） ——

  private registerRedDotSources(): void {
    redDotService.registerSource('tasks', () => {
      const account = AccountSystem.instance;
      const save = account?.accountSave ?? null;
      if (account === null || save === null) {
        return false;
      }
      const keys = { dayKey: account.time.dayKey(), weekKey: account.time.weekKey() };
      return INITIAL_GAME_CONFIG.tasks.some((task) => isTaskClaimable(save, INITIAL_GAME_CONFIG, task.id, keys));
    });
    redDotService.registerSource('achievements', () => {
      const save = AccountSystem.instance?.accountSave ?? null;
      return save !== null && listAchievementViews(save, INITIAL_GAME_CONFIG).some((view) => view.claimable);
    });
    redDotService.registerSource('login_reward', () => {
      const save = AccountSystem.instance?.accountSave ?? null;
      return save !== null && getClaimableTierIndex(save, INITIAL_GAME_CONFIG) !== null;
    });
    // 礼包红点 = 四源 OR（独立聚合，不递归读取其他红点状态）。
    redDotService.registerSource('reward_center', () => {
      const account = AccountSystem.instance;
      const save = account?.accountSave ?? null;
      if (account === null || save === null) {
        return false;
      }
      const keys = { dayKey: account.time.dayKey(), weekKey: account.time.weekKey() };
      if (INITIAL_GAME_CONFIG.tasks.some((task) => isTaskClaimable(save, INITIAL_GAME_CONFIG, task.id, keys))) {
        return true;
      }
      if (listAchievementViews(save, INITIAL_GAME_CONFIG).some((view) => view.claimable)) {
        return true;
      }
      if (getClaimableTierIndex(save, INITIAL_GAME_CONFIG) !== null) {
        return true;
      }
      return INITIAL_GAME_CONFIG.offers.some((offer) => isOfferClaimable(save, INITIAL_GAME_CONFIG, offer.id));
    });
  }

  private createDotBadge(root: Node): Node {
    const badge = new Node('RedDot');
    badge.setParent(root);
    const transform = badge.addComponent(UITransform);
    transform.setContentSize(DOT_SIZE, DOT_SIZE);
    applyArtSprite(badge, 'icon_reddot', { width: DOT_SIZE, height: DOT_SIZE });
    badge.setPosition(30, 16, 0);
    badge.active = false;
    return badge;
  }

  private updateBadges(): void {
    for (const [dotId, badge] of this.dotBadges) {
      badge.active = redDotService.isLit(dotId);
    }
  }
}

/** 快捷入口图标 artId（V10-14；新入口在此登记）。 */
function quickArt(title: string): string {
  switch (title) {
    case '签到':
      return 'icon_quick_sign';
    case '礼包':
      return 'icon_quick_gift';
    case '任务':
      return 'icon_quick_task';
    case '成就':
      return 'icon_quick_achieve';
    default:
      return 'icon_quick_task';
  }
}
