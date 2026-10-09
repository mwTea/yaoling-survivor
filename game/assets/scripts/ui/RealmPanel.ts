import { _decorator, Color, Component, Graphics, Label, Node, UITransform, view } from 'cc';

import { bringPanelToFront, claimActivePanel, clearActivePanel, addPageBackdrop, createArtNode, createClickRegion, createLabel } from './PanelKit';
import { applyArtSprite } from './ArtLoader';

import { AccountSystem } from '../account/AccountSystem';
import {
  getWeaponDamageBonus,
  getWeaponLevel,
  getWeaponLevelCap,
  levelUpWeapon,
  WEAPON_LEVEL_UP_RESOURCE_ID,
} from '../account/WeaponGrowth';
import {
  confirmBreakthrough,
  previewBreakthrough,
  REALM_XIUWEI_RESOURCE_ID,
} from '../account/RealmProgress';
import { getAccountLevelProgress } from '../account/PlayerLeveling';
import { INITIAL_GAME_CONFIG } from '../config/GameConfig';
import { describeRealmLine, unmetText } from './PanelText';

const { ccclass, property } = _decorator;

/** 青霄剑法器 ID（V0.5 唯一可培养法器，与 ProgressionSystem.WEAPON_ID 同源）。 */
const WEAPON_ID = 'weapon_qingxiao_sword';

const SECTION_COLOR = new Color(40, 52, 66, 230);
const ACTION_COLOR = new Color(70, 96, 120, 245);
const BAR_BG = new Color(28, 36, 30, 255);
const BAR_FILL = new Color(198, 158, 84, 255);

/**
 * 修行面板（V05-11 建立，V10 布局对齐改版，按修行 v2 设计稿；内容全部代码
 * 构建，装配仅"根节点 + content 子节点"）：顶部标题与返回；中央境界名大字 +
 * 修为进度条（持有/下一层消耗）；生命上限汇总；突破区（预览常显 + 点击确认
 * 两步制）；法器培养区（青霄剑）。全部操作经领域模块事务
 * （confirmBreakthrough/levelUpWeapon）执行后即时落盘并刷新；UI 不创造规则，
 * 条件不足时按钮禁用并在预览中显示原因。操作为同步事务，重复点击按最新
 * 状态重新校验。
 */
@ccclass('RealmPanel')
export class RealmPanel extends Component {
  @property({ type: Node })
  private content: Node | null = null;

  /** 操作完成后的回调（首页资源栏刷新用，由装配方注入）。 */
  public onOperationDone: (() => void) | null = null;

  private playerLabel: Label | null = null;
  private realmTitleLabel: Label | null = null;
  private xiuweiLabel: Label | null = null;
  private hpLabel: Label | null = null;
  private breakthroughLabel: Label | null = null;
  private weaponLabel: Label | null = null;
  private statusLabel: Label | null = null;
  private breakthroughButton: ReturnType<typeof createClickRegion> | null = null;
  private weaponUpButton: ReturnType<typeof createClickRegion> | null = null;
  private barFill: Graphics | null = null;
  private barFillNode: Node | null = null;
  private barWidth = 380;
  private built = false;

  protected override start(): void {
    if (this.content === null) {
      throw new Error('[RealmPanel] missing reference: content ← 在本节点下建子节点 content 并拖入该槽');
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
    addPageBackdrop(content, 'bg_realm');
    const size = view.getVisibleSize();
    const top = size.height / 2;
    const halfWidth = size.width / 2;

    // 顶部：返回（左） + 标题（中，设计稿书法位）。
    createClickRegion(content, 'Back', '← 返回', -halfWidth + 80, top - 40, 110, 42, () => this.hide(),
      new Color(52, 62, 84, 235), { normal: 'btn_back_n', pressed: 'btn_back_p' });
    createArtNode(content, 'Title', 'title_calli_realm', 0, top - 40, 240, 90);
    // 境界徽记（V10-14 P1）：标题与境界名之间的装饰。
    createArtNode(content, 'RealmEmblem', 'realm_emblem', 0, top - 92, 100, 100);

    // 境界主展示（中央偏上）：境界名大字 + 玩家等级/经验行。
    this.realmTitleLabel = createLabel(content, 'RealmTitle', '', 0, top - 140, 32);
    this.playerLabel = createLabel(content, 'PlayerInfo', '', 0, top - 180, 17);

    // 修为进度条（持有 / 下一层消耗；圆满时满条）。
    const barY = top - 224;
    const barBg = new Node('XiuweiBarBg');
    barBg.setParent(content);
    barBg.setPosition(0, barY, 0);
    const bgTransform = barBg.addComponent(UITransform);
    bgTransform.setContentSize(this.barWidth + 8, 18);
    const bgGraphics = barBg.addComponent(Graphics);
    bgGraphics.fillColor = BAR_BG.clone();
    bgGraphics.rect(-(this.barWidth + 8) / 2, -9, this.barWidth + 8, 18);
    bgGraphics.fill();
    applyArtSprite(barBg, 'bar_bg');
    const fillNode = new Node('XiuweiBarFill');
    fillNode.setParent(barBg);
    fillNode.setPosition(-this.barWidth / 2, 0, 0);
    const fillTransform = fillNode.addComponent(UITransform);
    fillTransform.setAnchorPoint(0, 0.5);
    fillTransform.setContentSize(2, 14);
    this.barFillNode = fillNode;
    applyArtSprite(fillNode, 'bar_fill');
    this.barFill = fillNode.addComponent(Graphics);
    this.xiuweiLabel = createLabel(content, 'XiuweiText', '', 0, barY - 24, 16);

    // 生命上限汇总。
    this.hpLabel = createLabel(content, 'HpSummary', '', 0, top - 286, 18);

    // 突破区卡片。
    const breakthroughY = top - 400;
    const breakthroughCard = new Node('BreakthroughCard');
    breakthroughCard.setParent(content);
    breakthroughCard.setPosition(0, breakthroughY, 0);
    const cardTransform = breakthroughCard.addComponent(UITransform);
    cardTransform.setContentSize(size.width - 120, 170);
    const cardGraphics = breakthroughCard.addComponent(Graphics);
    cardGraphics.fillColor = SECTION_COLOR.clone();
    cardGraphics.roundRect(-(size.width - 120) / 2, -85, size.width - 120, 170, 10);
    cardGraphics.fill();
    // 分区装饰框（V10-14 P1）：盖在灰盒底色上，缺图回退。
    createArtNode(breakthroughCard, 'SectionFrame', 'section_frame', 0, 0, size.width - 120, 170);
    createLabel(breakthroughCard, 'SectionTitle', '大境界突破', 0, 62, 19);
    this.breakthroughLabel = createLabel(breakthroughCard, 'Preview', '', -40, 4, 15, size.width - 260);
    if (this.breakthroughLabel !== null) {
      this.breakthroughLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
    }
    this.breakthroughButton = createClickRegion(
      breakthroughCard, 'ConfirmBreakthrough', '确认突破', (size.width - 120) / 2 - 110, -56, 180, 44,
      () => this.handleBreakthroughClicked(),
      ACTION_COLOR.clone(),
      { normal: 'btn_primary_n', pressed: 'btn_primary_p', sliced: true },
    );

    // 法器培养区卡片。
    const weaponY = top - 560;
    const weaponCard = new Node('WeaponCard');
    weaponCard.setParent(content);
    weaponCard.setPosition(0, weaponY, 0);
    const weaponTransform = weaponCard.addComponent(UITransform);
    weaponTransform.setContentSize(size.width - 120, 130);
    const weaponGraphics = weaponCard.addComponent(Graphics);
    weaponGraphics.fillColor = SECTION_COLOR.clone();
    weaponGraphics.roundRect(-(size.width - 120) / 2, -65, size.width - 120, 130, 10);
    weaponGraphics.fill();
    createArtNode(weaponCard, 'SectionFrame', 'section_frame', 0, 0, size.width - 120, 130);
    createLabel(weaponCard, 'SectionTitle', '本命法器', 0, 42, 19);
    this.weaponLabel = createLabel(weaponCard, 'WeaponInfo', '', -40, -2, 15, size.width - 300);
    if (this.weaponLabel !== null) {
      this.weaponLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
    }
    this.weaponUpButton = createClickRegion(
      weaponCard, 'WeaponUp', '法器升级', (size.width - 120) / 2 - 110, -40, 180, 44,
      () => this.handleWeaponUpClicked(),
      ACTION_COLOR.clone(),
      { normal: 'btn_secondary_n', pressed: 'btn_secondary_p', sliced: true },
    );

    this.statusLabel = createLabel(content, 'Status', '', 0, -size.height / 2 + 96, 16, size.width - 80);
  }

  private render(): void {
    if (this.content === null || !this.content.active || this.playerLabel === null
      || this.realmTitleLabel === null || this.xiuweiLabel === null || this.hpLabel === null) {
      return;
    }
    const account = AccountSystem.instance;
    const save = account !== null ? account.accountSave : null;
    const economy = account !== null ? account.economy : null;
    if (save === null || economy === null) {
      this.playerLabel.string = '账号服务未装配';
      this.realmTitleLabel.string = '';
      this.xiuweiLabel.string = '';
      this.hpLabel.string = '';
      this.breakthroughButton?.setEnabled(false);
      this.weaponUpButton?.setEnabled(false);
      return;
    }

    const progress = getAccountLevelProgress(save, INITIAL_GAME_CONFIG.playerLevel);
    this.playerLabel.string = `修行者 Lv.${progress.level}　经验 ${progress.xp}/${progress.requiredXp ?? 'MAX'}`;
    this.realmTitleLabel.string = describeRealmLine(INITIAL_GAME_CONFIG.realms, save.realmIndex, save.subRealmIndex);

    // 修为进度：持有 / 当前置下一层消耗；圆满（无下一层）满条待突破。
    const realm = INITIAL_GAME_CONFIG.realms[save.realmIndex];
    const xiuwei = economy.getBalance(save, REALM_XIUWEI_RESOURCE_ID);
    const nextCost = realm !== undefined ? realm.subRealmCosts[save.subRealmIndex] : undefined;
    if (nextCost === undefined) {
      this.xiuweiLabel.string = `修为 ${xiuwei}（本境圆满，待突破）`;
      this.drawXiuweiBar(1);
    } else {
      this.xiuweiLabel.string = `修为 ${xiuwei}/${nextCost}`;
      this.drawXiuweiBar(Math.max(0, Math.min(1, xiuwei / nextCost)));
    }

    // 生命上限汇总：本命根基（player.maxHp）+ 已入境界累计加成。
    let realmBonus = 0;
    for (let index = 0; index <= save.realmIndex && index < INITIAL_GAME_CONFIG.realms.length; index += 1) {
      realmBonus += INITIAL_GAME_CONFIG.realms[index]?.maxHpBonus ?? 0;
    }
    const baseHp = INITIAL_GAME_CONFIG.player.maxHp;
    this.hpLabel.string = `生命上限 ${baseHp + realmBonus}（根基 ${baseHp} + 境界加成 ${realmBonus}）`;

    this.renderBreakthrough(save, economy);
    this.renderWeapon(save, economy.getBalance(save, WEAPON_LEVEL_UP_RESOURCE_ID));
  }

  private drawXiuweiBar(ratio: number): void {
    const clamped = Math.max(0, Math.min(1, ratio));
    // 切图填充走 UITransform 宽度（左锚点从条左端生长）。
    this.barFillNode?.getComponent(UITransform)?.setContentSize(Math.max(2, this.barWidth * clamped), 14);
    const fill = this.barFill;
    if (fill === null || !fill.isValid) {
      return; // 切图应用后 Graphics 已销毁，宽度由 UITransform 承担。
    }
    fill.clear();
    fill.fillColor = BAR_FILL.clone();
    fill.rect(0, -6, this.barWidth * clamped, 12);
    fill.fill();
  }

  private renderBreakthrough(save: NonNullable<AccountSystem['accountSave']>, economy: NonNullable<AccountSystem['economy']>): void {
    if (this.breakthroughLabel === null || this.breakthroughButton === null) {
      return;
    }
    const preview = previewBreakthrough(save, save, save, INITIAL_GAME_CONFIG.realms, economy);
    if (preview === null) {
      this.breakthroughLabel.string = '小境界未圆满或已是末境';
      this.breakthroughButton.setEnabled(false);
      return;
    }
    const nextRealm = INITIAL_GAME_CONFIG.realms.find((candidate) => candidate.id === preview.nextRealmId);
    const material = INITIAL_GAME_CONFIG.resources.find((candidate) => candidate.id === preview.materialId);
    const lines = [
      `突破目标：${nextRealm?.displayName ?? preview.nextRealmId}`,
      `消耗：修为 ${preview.xiuweiCost}（持有 ${preview.xiuweiBalance}）、${material?.displayName ?? preview.materialId} ${preview.materialCost}（持有 ${preview.materialBalance}）`,
      `门槛：修行者 Lv.${preview.requiredPlayerLevel}（当前 Lv.${preview.playerLevel}）　收益：生命上限 +${preview.nextTotalMaxHpBonus}`,
      `未满足：${unmetText(preview.unmet)}`,
    ];
    this.breakthroughLabel.string = lines.join('\n');
    this.breakthroughButton.setEnabled(preview.canBreakthrough);
  }

  private renderWeapon(save: NonNullable<AccountSystem['accountSave']>, lingshi: number): void {
    if (this.weaponLabel === null || this.weaponUpButton === null) {
      return;
    }
    const growth = INITIAL_GAME_CONFIG.weaponGrowth.find((candidate) => candidate.weaponId === WEAPON_ID);
    if (growth === undefined) {
      this.weaponLabel.string = '法器培养配置缺失';
      this.weaponUpButton.setEnabled(false);
      return;
    }
    const level = getWeaponLevel(save, WEAPON_ID);
    const cap = getWeaponLevelCap(growth, save.playerLevel);
    const bonus = getWeaponDamageBonus(growth, level);
    const cost = growth.levelUpCosts[level - 1];
    const capHint = cap < growth.maxLevel ? `上限 ${cap}（受玩家等级钳制）` : `上限 ${cap}`;
    this.weaponLabel.string = cost === undefined
      ? `青霄剑 Lv.${level}（${capHint}）　攻击加成 +${bonus}　已达到最高等级`
      : `青霄剑 Lv.${level}（${capHint}）　攻击加成 +${bonus}\n下一级：灵石 ${cost}（持有 ${lingshi}）`;
    this.weaponUpButton.setEnabled(level < cap);
  }

  private readonly handleBreakthroughClicked = (): void => {
    const account = AccountSystem.instance;
    const save = account !== null ? account.accountSave : null;
    const economy = account !== null ? account.economy : null;
    if (save === null || economy === null || account === null) {
      return;
    }
    const now = account.time.now();
    const outcome = confirmBreakthrough(
      save, save, save, INITIAL_GAME_CONFIG.realms, economy,
      { txId: `breakthrough_${now}`, at: now },
    );
    if (outcome.ok) {
      const realm = INITIAL_GAME_CONFIG.realms[outcome.newRealmIndex];
      this.setStatus(`突破成功！已入${realm?.displayName ?? '新境界'}，生命上限提升（下一局生效）`);
    } else {
      this.setStatus(`突破失败：${describeBreakthroughFailure(outcome.reason)}`);
    }
    account.persistSave();
    this.render();
    this.onOperationDone?.();
  };

  private readonly handleWeaponUpClicked = (): void => {
    const account = AccountSystem.instance;
    const save = account !== null ? account.accountSave : null;
    const economy = account !== null ? account.economy : null;
    if (save === null || economy === null || account === null) {
      return;
    }
    const now = account.time.now();
    const outcome = levelUpWeapon(
      save, save, save, INITIAL_GAME_CONFIG.weaponGrowth, economy, WEAPON_ID,
      { txId: `weapon_up_${now}`, at: now },
    );
    if (outcome.ok) {
      this.setStatus(`青霄剑升至 Lv.${outcome.newLevel}（下一局生效）`);
    } else {
      this.setStatus(`升级失败：${describeWeaponFailure(outcome.reason)}`);
    }
    account.persistSave();
    this.render();
    this.onOperationDone?.();
  };

  private setStatus(text: string): void {
    if (this.statusLabel !== null) {
      this.statusLabel.string = text;
    }
  }
}

function describeBreakthroughFailure(reason: string): string {
  switch (reason) {
    case 'condition_unmet':
      return '条件未满足（见预览）';
    case 'economy_rejected':
      return '修为或妖丹不足';
    case 'no_breakthrough_available':
      return '已是末境';
    default:
      return '境界状态异常';
  }
}

function describeWeaponFailure(reason: string): string {
  switch (reason) {
    case 'at_max_level':
      return '已达最高等级';
    case 'player_level_cap':
      return '需先提升玩家等级';
    case 'economy_rejected':
      return '灵石不足';
    default:
      return '法器状态异常';
  }
}
