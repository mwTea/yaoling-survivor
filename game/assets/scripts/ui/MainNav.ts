import { _decorator, Color, Component, Graphics, Node, UITransform, view } from 'cc';

import { isFeatureEnabled, isFeatureFlagId } from '../platform/FeatureFlags';
import { AccountSystem } from '../account/AccountSystem';
import { buildUnlockEvaluationState, resolveFeatureEntryState } from '../account/UnlockSystem';
import { INITIAL_GAME_CONFIG } from '../config/GameConfig';
import { RealmPanel } from './RealmPanel';
import { BeastPanel } from './BeastPanel';
import { StagePanel } from './StagePanel';
import { ProfilePanel } from './ProfilePanel';
import { createClickRegion, getActivePanel } from './PanelKit';
import { applyArtSprite } from './ArtLoader';
import { redDotService } from './RedDotService';

const { ccclass, property } = _decorator;

const TAB_COLOR = new Color(46, 56, 78, 235);
const TABBAR_COLOR = new Color(12, 14, 20, 200);
const TAB_ACTIVE_COLOR = new Color(70, 96, 120, 245);

/** 可打开的面板最小结构（各面板均实现 show() 与 onOperationDone 单槽）。 */
interface OpenablePanel {
  show(): void;
  onOperationDone: (() => void) | null;
}

interface TabEntry {
  /** 绑定解锁表的功能 ID（可选；未绑定 = 恒可见）。 */
  readonly featureId?: string;
  readonly title: string;
  /** 页签切图 ID 前缀（tab_home → tab_home_n/_p；V10-14）。 */
  readonly art: string;
  /** null = 首页页签（行为：关闭当前打开的面板，回到首页态）。 */
  readonly panel: OpenablePanel | null;
}

/**
 * 底部主导航（V08-06 建立，V10 布局对齐改版）：按首页 v2 设计稿的五页签
 * ——首页（关闭面板回到首页态）/关卡/灵兽/修行/我的。灵兽/修行按解锁表
 * （V10-02：通关第 1 关）显隐；解锁状态变化（结算返回首页）时重建（冷路径）。
 * 快捷入口（签到/礼包/任务/成就）与功能卡片（图鉴/商店）归 HomeHud；
 * 红点角标归各入口宿主，本组件只保留"面板操作后刷新红点"的联动包装。
 */
@ccclass('MainNav')
export class MainNav extends Component {
  @property({ type: StagePanel })
  private stagePanel: StagePanel | null = null;

  @property({ type: RealmPanel })
  private realmPanel: RealmPanel | null = null;

  @property({ type: BeastPanel })
  private beastPanel: BeastPanel | null = null;

  @property({ type: ProfilePanel })
  private profilePanel: ProfilePanel | null = null;

  private readonly wrappedPanels = new Set<OpenablePanel>();
  private readonly unknownFeatureWarned = new Set<string>();
  private tabNodes: Array<{ readonly entry: TabEntry; readonly root: Node }> = [];
  private tabBarBg: Node | null = null;

  protected override start(): void {
    this.rebuildTabs();
  }

  protected override onEnable(): void {
    view.on('canvas-resize', this.handleCanvasResize, this);
    // 从战斗返回首页时重算（通关首关后灵兽/修行页签出现）。
    if (this.tabNodes.length > 0) {
      this.rebuildTabs();
    }
  }

  protected override onDisable(): void {
    view.off('canvas-resize', this.handleCanvasResize, this);
  }

  private handleCanvasResize(): void {
    if (this.tabNodes.length > 0) {
      this.rebuildTabs();
    }
  }

  private buildTabEntries(): TabEntry[] {
    return [
      { title: '首页', art: 'tab_home', panel: null },
      { featureId: 'stage_select', title: '关卡', art: 'tab_stage', panel: this.stagePanel },
      { featureId: 'beast', title: '灵兽', art: 'tab_beast', panel: this.beastPanel },
      { featureId: 'realm', title: '修行', art: 'tab_realm', panel: this.realmPanel },
      { title: '我的', art: 'tab_profile', panel: this.profilePanel },
    ];
  }

  /** 重建页签（冷路径）：按当前解锁/开关状态过滤并重排。 */
  private rebuildTabs(): void {
    this.tabBarBg?.removeFromParent();
    this.tabBarBg?.destroy();
    this.tabBarBg = null;
    for (const tab of this.tabNodes) {
      tab.root.removeFromParent();
      tab.root.destroy();
    }
    this.tabNodes = [];

    // 首页页签（panel 为 null，行为=关闭面板）恒显示；其余页签需面板已装配
    // 且按解锁表可见（灵兽/修行通关第 1 关后出现）。
    const entries = this.buildTabEntries().filter(
      (entry) => entry.panel === null || this.isTabVisible(entry),
    );
    const visibleSize = view.getVisibleSize();
    // 导航条底图（V10-14）：半透明条垫在页签下层，缺图回退纯色。
    const barBg = new Node('TabBarBg');
    this.tabBarBg = barBg;
    barBg.setParent(this.node);
    barBg.setPosition(0, -visibleSize.height / 2 + 70, 0);
    const barTransform = barBg.addComponent(UITransform);
    barTransform.setContentSize(visibleSize.width, 140);
    const barGraphics = barBg.addComponent(Graphics);
    barGraphics.fillColor = TABBAR_COLOR.clone();
    barGraphics.rect(-visibleSize.width / 2, -70, visibleSize.width, 140);
    barGraphics.fill();
    applyArtSprite(barBg, 'tabbar_bg', { sliced: true });

    const spacing = Math.min(150, (visibleSize.width - 40) / Math.max(1, entries.length));
    const startX = -((entries.length - 1) * spacing) / 2;
    const tabY = -visibleSize.height / 2 + 70;
    entries.forEach((entry, index) => {
      const region = createClickRegion(
        this.node,
        `Tab_${entry.title}`,
        entry.title,
        startX + index * spacing,
        tabY,
        Math.min(110, spacing - 14),
        96,
        () => this.handleTabClicked(entry),
        TAB_COLOR.clone(),
        { normal: `${entry.art}_n`, pressed: `${entry.art}_p` },
      );
      // 图标式页签：文字缩小移到图下方。
      region.label.fontSize = 15;
      region.label.lineHeight = 17;
      region.label.node.setPosition(0, -38, 0);
      this.tabNodes.push({ entry, root: region.root });
      const panel = entry.panel;
      // 面板操作（领取/购买）后刷新红点与首页数据（onOperationDone 单槽只包装一次）。
      if (panel !== null && !this.wrappedPanels.has(panel)) {
        this.wrappedPanels.add(panel);
        const previous = panel.onOperationDone;
        panel.onOperationDone = (): void => {
          if (previous !== null) {
            previous();
          }
          redDotService.refresh();
        };
      }
    });
  }

  private handleTabClicked(entry: TabEntry): void {
    if (entry.panel === null) {
      // 首页页签：关闭当前打开的面板，回到首页态。
      getActivePanel()?.hide();
      return;
    }
    entry.panel.show();
    redDotService.refresh();
  }

  private isTabVisible(entry: TabEntry): boolean {
    if (entry.featureId === undefined) {
      return true;
    }
    return this.resolveFeatureState(entry.featureId) !== null
      ? this.resolveFeatureState(entry.featureId)?.kind !== 'hidden'
      : false;
  }

  /** 解锁表查询（账号未就绪/未知 featureId 按安全隐藏 + 一次性告警）。 */
  private resolveFeatureState(featureId: string): ReturnType<typeof resolveFeatureEntryState> {
    const account = AccountSystem.instance;
    const save = account?.accountSave ?? null;
    if (account === null || save === null) {
      this.warnUnknownFeatureOnce(`feature "${featureId}" skipped: account service not ready`);
      return null;
    }
    const state = resolveFeatureEntryState(
      INITIAL_GAME_CONFIG,
      buildUnlockEvaluationState(save, account.time.now()),
      featureId,
      { isFlagEnabled: (flag) => isFeatureFlagId(flag) && isFeatureEnabled(flag) },
    );
    if (state === null) {
      this.warnUnknownFeatureOnce(`feature "${featureId}" is not bound in unlocks table`);
    }
    return state;
  }

  private warnUnknownFeatureOnce(message: string): void {
    if (this.unknownFeatureWarned.has(message)) {
      return;
    }
    this.unknownFeatureWarned.add(message);
    console.warn(`[MainNav] ${message}`);
  }
}
