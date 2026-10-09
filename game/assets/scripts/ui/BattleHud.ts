import { _decorator, Component, Label, Node, ProgressBar, Sprite, UITransform, Vec3, view } from 'cc';

import { BattleController } from '../battle/BattleController';
import { INITIAL_GAME_CONFIG } from '../config/GameConfig';
import { PlayerAgent } from '../player/PlayerAgent';
import { ProgressionSystem } from '../progression/ProgressionSystem';
import { applyArtSprite, loadSpriteFrameForButton } from './ArtLoader';

const { ccclass, property } = _decorator;

/**
 * 战斗 HUD：生命/等级/经验进度条/战斗计时。数值只在变化时写回
 * Label/ProgressBar，避免每帧字符串分配；经验与计时读取战斗时间门，
 * 升级暂停期间计时冻结。
 */
@ccclass('BattleHud')
export class BattleHud extends Component {
  @property({ type: BattleController })
  private battleController: BattleController | null = null;

  @property({ type: PlayerAgent })
  private playerAgent: PlayerAgent | null = null;

  @property({ type: ProgressionSystem })
  private progressionSystem: ProgressionSystem | null = null;

  @property({ type: Label })
  private hpLabel: Label | null = null;

  @property({ type: Label })
  private levelLabel: Label | null = null;

  @property({ type: Label })
  private timeLabel: Label | null = null;

  @property({ type: ProgressBar })
  private xpProgressBar: ProgressBar | null = null;

  private readonly playerMaxHp = INITIAL_GAME_CONFIG.player.maxHp;
  private battleBg: Node | null = null;
  private renderedHpText = '';
  private renderedLevel = -1;
  private renderedSeconds = -1;
  private renderedXpPermille = -1;

  protected override onLoad(): void {
    if (this.battleController === null) {
      throw new Error('[BattleHud] missing reference: battleController ← 把 Systems 节点拖入该属性槽');
    }
    if (this.progressionSystem === null) {
      throw new Error('[BattleHud] missing reference: progressionSystem ← 把 Systems 节点拖入该属性槽');
    }
  }

  protected override onEnable(): void {
    view.on('canvas-resize', this.layoutHud, this);
  }

  protected override start(): void {
    this.buildBattleBackground();
    this.applyXpBarArt();
    this.layoutHud();
  }

  /** 战斗背景（V10-14 P1）：可平铺纹理垫在整个战斗世界之下（Canvas 首个子节点）。 */
  private buildBattleBackground(): void {
    const parent = this.node.parent;
    if (parent === null) {
      return;
    }
    const size = view.getVisibleSize();
    const bg = new Node('BattleBackground');
    bg.setParent(parent);
    bg.setSiblingIndex(0);
    const transform = bg.addComponent(UITransform);
    transform.setContentSize(size.width, size.height);
    applyArtSprite(bg, 'bg_battle', { tiled: true });
    this.battleBg = bg;
  }

  /** 经验条切图（V10-14 P1）：底/填充换图，缺图保留场景灰盒。 */
  private applyXpBarArt(): void {
    const bar = this.xpProgressBar;
    if (bar === null) {
      return;
    }
    applyArtSprite(bar.node, 'bar_bg', { sliced: true });
    const fill = bar.barSprite;
    if (fill === null) {
      return;
    }
    void loadSpriteFrameForButton('bar_fill').then((frame) => {
      if (frame !== null && fill.isValid) {
        fill.spriteFrame = frame;
        fill.sizeMode = Sprite.SizeMode.CUSTOM;
      }
    });
  }

  protected override onDisable(): void {
    view.off('canvas-resize', this.layoutHud, this);
  }

  protected override update(): void {
    if (this.battleController === null || this.progressionSystem === null) {
      return;
    }

    // 上限取运行态（含境界 maxHp 加成）：否则突破后出现 25/20 的假溢出。
    const maxHp = this.playerAgent?.maxHp ?? this.playerMaxHp;
    const currentHp = this.playerAgent?.currentHp ?? maxHp;
    const hpText = `HP ${currentHp}/${maxHp}`;
    if (this.hpLabel !== null && hpText !== this.renderedHpText) {
      this.hpLabel.string = hpText;
      this.renderedHpText = hpText;
    }

    const level = this.progressionSystem.level;
    if (this.levelLabel !== null && level !== this.renderedLevel) {
      this.levelLabel.string = `Lv.${level}`;
      this.renderedLevel = level;
    }

    const elapsedSeconds = Math.floor(this.battleController.battleElapsedTime);
    if (this.timeLabel !== null && elapsedSeconds !== this.renderedSeconds) {
      const minutes = Math.floor(elapsedSeconds / 60);
      const seconds = elapsedSeconds % 60;
      this.timeLabel.string = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
      this.renderedSeconds = elapsedSeconds;
    }

    const xpPermille = Math.floor(this.progressionSystem.progressRatio * 1000);
    if (this.xpProgressBar !== null && xpPermille !== this.renderedXpPermille) {
      this.xpProgressBar.progress = xpPermille / 1000;
      this.renderedXpPermille = xpPermille;
    }
  }

  private readonly layoutHud = (): void => {
    const size = view.getVisibleSize();
    const halfWidth = size.width / 2;
    const top = size.height / 2;
    this.battleBg?.getComponent(UITransform)?.setContentSize(size.width, size.height);
    this.placeLabel(this.hpLabel, -halfWidth + 28, top - 34, 'left');
    this.placeLabel(this.levelLabel, 0, top - 34, 'center');
    this.placeLabel(this.timeLabel, halfWidth - 28, top - 34, 'right');
    if (this.xpProgressBar !== null) {
      this.xpProgressBar.node.setPosition(0, top - 76, this.xpProgressBar.node.position.z);
      const transform = this.xpProgressBar.getComponent(UITransform);
      if (transform !== null) {
        transform.width = Math.min(360, size.width - 48);
      }
    }
  };

  private placeLabel(label: Label | null, x: number, y: number, align: 'left' | 'center' | 'right'): void {
    if (label === null) {
      return;
    }
    label.node.setPosition(new Vec3(x, y, label.node.position.z));
    const transform = label.getComponent(UITransform);
    if (transform !== null) {
      transform.setAnchorPoint(align === 'left' ? 0 : align === 'right' ? 1 : 0.5, 0.5);
    }
    label.horizontalAlign = align === 'left'
      ? Label.HorizontalAlign.LEFT
      : align === 'right'
        ? Label.HorizontalAlign.RIGHT
        : Label.HorizontalAlign.CENTER;
  }
}
