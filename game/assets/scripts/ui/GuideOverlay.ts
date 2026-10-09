import { _decorator, Color, Component, Graphics, Label, Node, UITransform, view } from 'cc';

import { AccountSystem } from '../account/AccountSystem';
import { getActiveGuideStep, isGuideStepBlocking, skipActiveGuideStep } from '../account/GuideSystem';
import type { GuideStepConfig } from '../config/ConfigTypes';
import { INITIAL_GAME_CONFIG } from '../config/GameConfig';
import { createClickRegion, createLabel } from './PanelKit';
import { onGuideStateChanged, resolveAnchorPosition } from './GuideEvents';

// GuideAnchor 组件已拆分至 ui/GuideAnchor.ts（Cocos 约束每文件一个 Component）。
const { ccclass, property } = _decorator;

const MASK_COLOR = new Color(10, 10, 16, 120);
const RING_COLOR = new Color(255, 214, 90, 255);
const BUBBLE_COLOR = new Color(24, 28, 44, 235);
const STRONG_BUBBLE_COLOR = new Color(46, 34, 16, 245);
const RING_RADIUS = 90;
const BUBBLE_WIDTH = 460;
const BUBBLE_HEIGHT = 96;

/**
 * 新手引导表现层（V10-04，PanelKit 灰盒；正式美术随 V10-14 替换）：
 * - 每个场景挂一个本组件（节点须为 Canvas 下全屏节点）；事件驱动刷新
 *   （GuideEvents 通知 + onEnable），无每帧扫描。
 * - strong 步骤：半屏聚焦遮罩 + 锚点高亮环 + 强调气泡（视觉聚焦，
 *   不拦截触摸——移动强引导要求摇杆可用，三选一/结算的"阻塞"由玩法
 *   固有暂停与完成事件保证，不冻结 UI 输入）。
 * - weak/info 步骤：无遮罩，气泡 + 跳过按钮（仅 skippable 步骤显示，
 *   跳过经 GuideSystem 状态机落存档）。
 * - 老档（脚本完结）零引导痕迹：无活跃步骤时整层隐藏。
 */
@ccclass('GuideOverlay')
export class GuideOverlay extends Component {
  /** 本遮罩层服务的场景（'battle' / 'home'；空串 = 不过滤，显示全部活跃步骤）。
   *  装配约定：战斗遮罩填 battle、首页遮罩填 home——战斗步骤不上首页。 */
  @property
  public sceneScope = '';

  private maskGraphics: Graphics | null = null;
  private ringGraphics: Graphics | null = null;
  private bubbleRoot: Node | null = null;
  private bubbleLabel: Label | null = null;
  private skipRegion: ReturnType<typeof createClickRegion> | null = null;
  private unsubscribeGuide: (() => void) | null = null;
  private currentAnchorId: string | null = null;
  private ringVisible = false;
  private space: UITransform | null = null;

  protected override start(): void {
    this.buildVisuals();
    this.unsubscribeGuide = onGuideStateChanged(() => this.refresh());
    this.refresh();
  }

  protected override onEnable(): void {
    this.refresh();
  }

  protected override onDestroy(): void {
    this.unsubscribeGuide?.();
    this.unsubscribeGuide = null;
  }

  private buildVisuals(): void {
    const transform = this.node.getComponent(UITransform) ?? this.node.addComponent(UITransform);
    const size = view.getVisibleSize();
    transform.setContentSize(size.width, size.height);

    const maskNode = new Node('GuideMask');
    maskNode.setParent(this.node);
    const maskTransform = maskNode.addComponent(UITransform);
    maskTransform.setContentSize(size.width, size.height);
    this.maskGraphics = maskNode.addComponent(Graphics);

    const ringNode = new Node('GuideRing');
    ringNode.setParent(this.node);
    this.ringGraphics = ringNode.addComponent(Graphics);

    const bubbleRoot = new Node('GuideBubble');
    bubbleRoot.setParent(this.node);
    const bubbleTransform = bubbleRoot.addComponent(UITransform);
    bubbleTransform.setContentSize(BUBBLE_WIDTH, BUBBLE_HEIGHT);
    const bubbleGraphics = bubbleRoot.addComponent(Graphics);
    bubbleGraphics.fillColor = BUBBLE_COLOR.clone();
    bubbleGraphics.roundRect(-BUBBLE_WIDTH / 2, -BUBBLE_HEIGHT / 2, BUBBLE_WIDTH, BUBBLE_HEIGHT, 12);
    bubbleGraphics.fill();
    this.bubbleLabel = createLabel(bubbleRoot, 'GuideText', '', 0, 0, 16);
    this.bubbleRoot = bubbleRoot;

    this.skipRegion = createClickRegion(
      this.node,
      'GuideSkip',
      '跳过',
      size.width / 2 - 70,
      -size.height / 2 + 60,
      96,
      40,
      () => this.handleSkipClicked(),
      new Color(70, 76, 104, 255),
    );
    this.node.active = false;
  }

  /** 事件驱动刷新：读取账号存档引导域，重画遮罩/气泡/跳过按钮。 */
  private refresh(): void {
    if (this.maskGraphics === null || this.ringGraphics === null || this.bubbleRoot === null) {
      return;
    }
    const account = AccountSystem.instance;
    const save = account?.accountSave ?? null;
    const activeStep = save !== null ? getActiveGuideStep(INITIAL_GAME_CONFIG.guide, save.guide) : null;
    // 场景过滤：战斗步骤不上首页、培养步骤不进战斗（scene 字段配置驱动）。
    const step =
      activeStep !== null && (this.sceneScope.length === 0 || activeStep.scene === this.sceneScope)
        ? activeStep
        : null;
    if (step === null) {
      this.node.active = false;
      this.currentAnchorId = null;
      this.ringVisible = false;
      return;
    }
    this.node.active = true;
    this.currentAnchorId = step.anchorId;
    this.space = this.node.getComponent(UITransform);

    const space = this.space;
    const anchor = space !== null ? resolveAnchorPosition(step.anchorId, space) : null;
    this.ringVisible = anchor !== null;
    const focus = anchor ?? { x: 0, y: 0 };
    this.drawMaskAndRing(step, anchor !== null, focus.x, focus.y);
    this.drawBubble(step, anchor !== null ? focus.y + RING_RADIUS + 70 : 0);
    if (this.skipRegion !== null) {
      this.skipRegion.root.active = step.skippable;
    }
  }

  /** 高亮环跟随（仅遮罩可见时执行）：玩家等实体锚点移动时环保持贴附。 */
  protected override update(): void {
    if (!this.node.active || !this.ringVisible || this.currentAnchorId === null || this.ringGraphics === null || this.space === null) {
      return;
    }
    const position = resolveAnchorPosition(this.currentAnchorId, this.space);
    if (position !== null) {
      this.ringGraphics.node.setPosition(position.x, position.y, 0);
    }
  }

  private drawMaskAndRing(step: GuideStepConfig, hasAnchor: boolean, focusX: number, focusY: number): void {
    const mask = this.maskGraphics;
    const ring = this.ringGraphics;
    if (mask === null || ring === null) {
      return;
    }
    const size = view.getVisibleSize();
    mask.clear();
    if (isGuideStepBlocking(step)) {
      mask.fillColor = MASK_COLOR;
      mask.rect(-size.width / 2, -size.height / 2, size.width, size.height);
      mask.fill();
    }
    ring.clear();
    // 无锚点（如动态实体经验灵珠）只保留居中气泡，不画空环。
    if (!hasAnchor) {
      ring.node.active = false;
      return;
    }
    ring.node.active = true;
    ring.lineWidth = 6;
    ring.strokeColor = RING_COLOR;
    // 环画在本地原点，节点定位到锚点（避免双重偏移）。
    ring.circle(0, 0, RING_RADIUS);
    ring.stroke();
    ring.node.setPosition(focusX, focusY, 0);
  }

  private drawBubble(step: GuideStepConfig, bubbleY: number): void {
    const bubbleRoot = this.bubbleRoot;
    const label = this.bubbleLabel;
    if (bubbleRoot === null || label === null) {
      return;
    }
    bubbleRoot.setPosition(0, bubbleY, 0);
    label.string = `${step.displayName}：${step.description}`;
    const graphics = bubbleRoot.getComponent(Graphics);
    if (graphics !== null) {
      graphics.fillColor = isGuideStepBlocking(step) ? STRONG_BUBBLE_COLOR.clone() : BUBBLE_COLOR.clone();
      graphics.roundRect(-BUBBLE_WIDTH / 2, -BUBBLE_HEIGHT / 2, BUBBLE_WIDTH, BUBBLE_HEIGHT, 12);
      graphics.fill();
    }
  }

  /** 跳过（仅 skippable 步骤展示该按钮；状态机拒绝非可跳过步骤）。 */
  private handleSkipClicked(): void {
    const account = AccountSystem.instance;
    const save = account?.accountSave ?? null;
    if (account === null || save === null) {
      return;
    }
    const result = skipActiveGuideStep(INITIAL_GAME_CONFIG.guide, save.guide);
    if (result.ok) {
      account.persistSave();
      console.log(`[GuideOverlay] step skipped: ${result.skippedStepId}`);
    }
    this.refresh();
  }
}
