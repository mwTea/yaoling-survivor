import { _decorator, Color, Component, Graphics, Label, Node, UITransform, view } from 'cc';

import { bringPanelToFront, claimActivePanel, clearActivePanel, addPanelBackdrop, createArtNode, createClickRegion, createLabel } from './PanelKit';
import { applyArtSprite } from './ArtLoader';

import { AccountSystem } from '../account/AccountSystem';
import {
  deployBeast,
  getBeastEntry,
  getBeastLevelCap,
  levelUpBeast,
  starUpBeast,
  unlockBeast,
} from '../account/BeastRoster';
import type { BeastOpResult } from '../account/BeastRoster';
import { INITIAL_GAME_CONFIG } from '../config/GameConfig';
import type { BeastConfig } from '../config/ConfigTypes';

const { ccclass, property } = _decorator;

const CARD_COLOR = new Color(40, 52, 66, 235);
const SLOT_COLOR = new Color(52, 62, 84, 235);
const SLOT_SELECTED_COLOR = new Color(96, 128, 96, 255);
const ACTION_COLOR = new Color(70, 96, 120, 245);
const DEPLOY_COLOR = new Color(70, 110, 60, 255);

/**
 * 灵兽面板（V05-12 建立，V10 布局对齐改版，按灵兽设计稿；内容全部代码构建，
 * 装配仅"根节点 + content 子节点"）：顶部标题与返回；上部横排头像选择器
 * （选中放大高亮，点击切换）；下部选中灵兽详情大卡（名称/出战标记、等级/
 * 星级或解锁需求、技能说明、操作按钮行：解锁/升级/升星/出战）。解锁（自身
 * 灵魄）、升级（灵石）、升星（自身灵魄）、出战（单槽切换）经领域模块事务
 * 执行后即时落盘并刷新。灵魄按兽隔离（PROGRESSION.md）；未解锁灵兽的灵魄
 * 在 V0.5 无投放来源，明示"来源待开放"不做假数据（UI_IA.md 第 5 节）。
 * 操作为同步事务，重复点击按最新状态重新校验。
 */
@ccclass('BeastPanel')
export class BeastPanel extends Component {
  @property({ type: Node })
  private content: Node | null = null;

  /** 操作完成后的回调（首页资源栏刷新用，由装配方注入）。 */
  public onOperationDone: (() => void) | null = null;

  private browseIndex = 0;
  private nameLabel: Label | null = null;
  private stateLabel: Label | null = null;
  private skillLabel: Label | null = null;
  private statusLabel: Label | null = null;
  private unlockButton: ReturnType<typeof createClickRegion> | null = null;
  private levelUpButton: ReturnType<typeof createClickRegion> | null = null;
  private starUpButton: ReturnType<typeof createClickRegion> | null = null;
  private deployButton: ReturnType<typeof createClickRegion> | null = null;
  private slotRegions: Array<{ readonly region: ReturnType<typeof createClickRegion>; readonly overlay: Node }> = [];
  private deployedMarkNode: Node | null = null;
  private built = false;

  protected override start(): void {
    if (this.content === null) {
      throw new Error('[BeastPanel] missing reference: content ← 在本节点下建子节点 content 并拖入该槽');
    }
    this.build();
    this.content.active = false;
  }

  /** 打开面板并按当前存档刷新展示。 */
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
    const size = view.getVisibleSize();
    const top = size.height / 2;
    const halfWidth = size.width / 2;
    const cardWidth = size.width - 48;

    createClickRegion(content, 'Back', '← 返回', -halfWidth + 80, top - 40, 110, 42, () => this.hide(),
      new Color(52, 62, 84, 235), { normal: 'btn_back_n', pressed: 'btn_back_p' });
    createArtNode(content, 'Title', 'title_calli_beast', 0, top - 40, 240, 90);

    // 上部：横排头像选择器（设计稿选中放大高亮的灰盒近似：选中色区分）。
    const beasts = INITIAL_GAME_CONFIG.beasts;
    const slotSpacing = 118;
    const slotStartX = -((beasts.length - 1) * slotSpacing) / 2;
    beasts.forEach((beast, index) => {
      const region = createClickRegion(
        content, `Slot_${beast.id}`, beast.displayName,
        slotStartX + index * slotSpacing, top - 150,
        104, 72,
        () => {
          this.browseIndex = index;
          this.render();
        },
        SLOT_COLOR.clone(),
      );
      applyArtSprite(region.root, 'slot_beast');
      region.label.fontSize = 12;
      region.label.lineHeight = 14;
      region.label.node.setPosition(0, -26, 0);
      const avatar = new Node('BeastPortrait');
      avatar.setParent(region.root);
      avatar.setPosition(0, 10, 0);
      avatar.addComponent(UITransform).setContentSize(52, 52);
      const avatarArt = beastAvatarArt(beast.id);
      if (avatarArt !== null) {
        applyArtSprite(avatar, avatarArt, { width: 52, height: 52 });
      }
      // 选中槽高亮（V10-14 P1）：slot_beast_selected 与槽位同尺寸，切换时显隐。
      const overlay = new Node('SelectedFrame');
      overlay.setParent(region.root);
      const overlayTransform = overlay.addComponent(UITransform);
      overlayTransform.setContentSize(104, 72);
      applyArtSprite(overlay, 'slot_beast_selected');
      overlay.active = false;
      this.slotRegions.push({ region, overlay });
    });

    // 下部：详情大卡。
    const card = new Node('BeastDetailCard');
    card.setParent(content);
    card.setPosition(0, top - 400, 0);
    const transform = card.addComponent(UITransform);
    transform.setContentSize(cardWidth, 360);
    const graphics = card.addComponent(Graphics);
    graphics.fillColor = CARD_COLOR.clone();
    graphics.roundRect(-cardWidth / 2, -180, cardWidth, 360, 12);
    graphics.fill();

    this.nameLabel = createLabel(card, 'Name', '', 0, 128, 24);
    // 出战标记（V10-14 P1）：名称行右侧小图，render 按出战灵兽切换。
    this.deployedMarkNode = new Node('DeployedMark');
    this.deployedMarkNode.setParent(card);
    this.deployedMarkNode.setPosition(cardWidth / 2 - 60, 128, 0);
    this.deployedMarkNode.addComponent(UITransform).setContentSize(64, 32);
    applyArtSprite(this.deployedMarkNode, 'icon_deployed', { width: 64, height: 32 });
    this.deployedMarkNode.active = false;
    this.stateLabel = createLabel(card, 'State', '', 0, 88, 18);
    createLabel(card, 'SkillTitle', '技能', -cardWidth / 2 + 28, 48, 16);
    this.skillLabel = createLabel(card, 'SkillDesc', '', -cardWidth / 2 + 28, 20, 15, cardWidth - 56);
    if (this.skillLabel !== null) {
      this.skillLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
    }

    // 两列两行自适应操作区，避免四个按钮在窄屏上挤出详情卡。
    const actionWidth = Math.min(220, (cardWidth - 48) / 2);
    const actionX = actionWidth / 2 + 12;
    const actions: Array<[string, () => void, Color, string]> = [
      ['解锁', () => this.handleUnlockClicked(), ACTION_COLOR, 'btn_secondary_n'],
      ['升级', () => this.handleLevelUpClicked(), ACTION_COLOR, 'btn_secondary_n'],
      ['升星', () => this.handleStarUpClicked(), ACTION_COLOR, 'btn_secondary_n'],
      ['出战', () => this.handleDeployClicked(), DEPLOY_COLOR, 'btn_primary_n'],
    ];
    actions.forEach(([title, handler, color, artNormal], index) => {
      const region = createClickRegion(
        card, `Action_${title}`, title,
        index % 2 === 0 ? -actionX : actionX,
        index < 2 ? -88 : -144,
        actionWidth, 46,
        handler,
        color.clone(),
        { normal: artNormal, pressed: `${artNormal.replace('_n', '')}_p`, sliced: true },
      );
      if (title === '解锁') {
        this.unlockButton = region;
      } else if (title === '升级') {
        this.levelUpButton = region;
      } else if (title === '升星') {
        this.starUpButton = region;
      } else {
        this.deployButton = region;
      }
    });

    this.statusLabel = createLabel(content, 'Status', '', -halfWidth + 40, -size.height / 2 + 160, 15, size.width - 80);
  }

  private render(): void {
    if (this.content === null || !this.content.active
      || this.nameLabel === null || this.stateLabel === null || this.skillLabel === null
      || this.unlockButton === null || this.levelUpButton === null
      || this.starUpButton === null || this.deployButton === null) {
      return;
    }
    const beast = INITIAL_GAME_CONFIG.beasts[this.browseIndex];
    if (beast === undefined) {
      return;
    }
    // 选择器高亮：选中槽叠金框 + 亮色，其余默认。
    this.slotRegions.forEach((slot, index) => {
      const selected = index === this.browseIndex;
      slot.region.setLook(selected ? SLOT_SELECTED_COLOR.clone() : SLOT_COLOR.clone());
      slot.overlay.active = selected;
    });

    const account = AccountSystem.instance;
    const save = account !== null ? account.accountSave : null;
    if (save === null) {
      this.nameLabel.string = '账号服务未装配';
      if (this.deployedMarkNode !== null) {
        this.deployedMarkNode.active = false;
      }
      this.stateLabel.string = '';
      this.skillLabel.string = '';
      this.unlockButton.setEnabled(false);
      this.levelUpButton.setEnabled(false);
      this.starUpButton.setEnabled(false);
      this.deployButton.setEnabled(false);
      return;
    }

    const entry = getBeastEntry(save, beast);
    this.nameLabel.string = entry.unlocked
      ? beast.displayName
      : `${beast.displayName}（未解锁）`;
    this.skillLabel.string = beast.skillDescription;
    // 出战标记（V10-14 P1）：出战灵兽在名称行右侧亮出小图。
    if (this.deployedMarkNode !== null) {
      this.deployedMarkNode.active = entry.unlocked && save.deployedBeastId === beast.id;
    }

    if (!entry.unlocked) {
      const soulName = this.resourceName(beast.soulResourceId);
      const sourceNote = beast.unlockSoulCost > 0 ? '\n灵魄来源：待开放（V0.8 关卡扩充）' : '';
      this.stateLabel.string = `解锁：需 ${soulName} ×${beast.unlockSoulCost}${sourceNote}`;
      this.unlockButton.setEnabled(true);
      this.levelUpButton.setEnabled(false);
      this.starUpButton.setEnabled(false);
      this.deployButton.setEnabled(false);
      return;
    }

    const cap = getBeastLevelCap(beast, save.playerLevel);
    const starCap = beast.starUpCosts.length;
    this.stateLabel.string = `Lv.${entry.level}（上限 ${cap}）　${entry.star} 星（上限 ${starCap}）`;
    this.unlockButton.setEnabled(false);
    this.levelUpButton.setEnabled(entry.level < cap);
    this.starUpButton.setEnabled(entry.star < starCap);
    this.deployButton.setEnabled(true);
  }

  private readonly handleUnlockClicked = (): void => {
    const beast = this.currentBeast();
    if (beast === undefined) {
      return;
    }
    const outcome = this.runOp((account, save, economy, request) =>
      unlockBeast(save, save, INITIAL_GAME_CONFIG.beasts, economy, beast.id, request));
    if (outcome !== null) {
      this.setStatus(outcome.ok ? `解锁成功：${beast.displayName}` : `解锁失败：${describeBeastFailure(outcome.reason, beast)}`);
    }
  };

  private readonly handleLevelUpClicked = (): void => {
    const beast = this.currentBeast();
    if (beast === undefined) {
      return;
    }
    const outcome = this.runOp((account, save, economy, request) =>
      levelUpBeast(save, save, save, INITIAL_GAME_CONFIG.beasts, economy, beast.id, request));
    if (outcome !== null && outcome.ok) {
      this.setStatus(`升级成功：Lv.${outcome.entry.level}`);
    } else if (outcome !== null) {
      this.setStatus(`升级失败：${describeBeastFailure(outcome.reason, beast)}`);
    }
  };

  private readonly handleStarUpClicked = (): void => {
    const beast = this.currentBeast();
    if (beast === undefined) {
      return;
    }
    const outcome = this.runOp((account, save, economy, request) =>
      starUpBeast(save, save, INITIAL_GAME_CONFIG.beasts, economy, beast.id, request));
    if (outcome !== null && outcome.ok) {
      this.setStatus(`升星成功：${outcome.entry.star} 星`);
    } else if (outcome !== null) {
      this.setStatus(`升星失败：${describeBeastFailure(outcome.reason, beast)}`);
    }
  };

  private readonly handleDeployClicked = (): void => {
    const beast = this.currentBeast();
    if (beast === undefined) {
      return;
    }
    const account = AccountSystem.instance;
    const save = account !== null ? account.accountSave : null;
    if (account === null || save === null) {
      return;
    }
    const outcome = deployBeast(save, INITIAL_GAME_CONFIG.beasts, beast.id);
    if (outcome.ok) {
      this.setStatus(`出战灵兽：${beast.displayName}（下一局生效）`);
    } else {
      this.setStatus(`出战失败：${describeBeastFailure(outcome.reason, beast)}`);
    }
    account.persistSave();
    this.render();
    this.onOperationDone?.();
  };

  private currentBeast(): BeastConfig | undefined {
    return INITIAL_GAME_CONFIG.beasts[this.browseIndex];
  }

  /** 通用事务执行：操作 → 落盘 → 刷新（成败都刷新；无账号服务返回 null）。 */
  private runOp(
    operation: (
      account: AccountSystem,
      save: NonNullable<AccountSystem['accountSave']>,
      economy: NonNullable<AccountSystem['economy']>,
      request: { txId: string; at: number },
    ) => BeastOpResult,
  ): BeastOpResult | null {
    const account = AccountSystem.instance;
    const save = account !== null ? account.accountSave : null;
    const economy = account !== null ? account.economy : null;
    if (account === null || save === null || economy === null) {
      return null;
    }
    const now = account.time.now();
    const outcome = operation(account, save, economy, { txId: `beast_op_${now}`, at: now });
    account.persistSave();
    this.render();
    this.onOperationDone?.();
    return outcome;
  }

  private setStatus(text: string): void {
    if (this.statusLabel !== null) {
      this.statusLabel.string = text;
    }
  }

  private resourceName(resourceId: string): string {
    const config = INITIAL_GAME_CONFIG.resources.find((candidate) => candidate.id === resourceId);
    return config?.displayName ?? resourceId;
  }
}

function beastAvatarArt(beastId: string): string | null {
  switch (beastId) {
    case 'beast_qinglong': return 'avatar_beast_qinglong';
    case 'beast_baihu': return 'avatar_beast_baihu';
    case 'beast_zhuque': return 'avatar_beast_zhuque';
    case 'beast_xuanwu': return 'avatar_beast_xuanwu';
    case 'beast_jiuweihu': return 'avatar_beast_jiuweihu';
    default: return null;
  }
}

function describeBeastFailure(reason: string | undefined, beast: BeastConfig | undefined): string {
  const soulName = beast !== undefined
    ? INITIAL_GAME_CONFIG.resources.find((candidate) => candidate.id === beast.soulResourceId)?.displayName ?? beast.soulResourceId
    : '灵魄';
  switch (reason) {
    case 'not_unlocked':
      return '该灵兽尚未解锁';
    case 'already_unlocked':
      return '已解锁';
    case 'at_max_level':
      return '已达最高等级';
    case 'player_level_cap':
      return '需先提升玩家等级';
    case 'at_max_star':
      return '已达最高星级';
    case 'economy_rejected':
      return `灵石或${soulName}不足`;
    case 'unknown_beast':
      return '灵兽不存在';
    default:
      return '状态异常';
  }
}
