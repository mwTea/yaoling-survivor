import { _decorator, Color, Component, Label, Node, view } from 'cc';

import { AccountSystem } from '../account/AccountSystem';
import { INITIAL_GAME_CONFIG } from '../config/GameConfig';
import { isDefeated, isSeen } from '../account/CodexSystem';
import { isStageCleared } from '../account/StageProgress';
import { addPanelBackdrop, bringPanelToFront, claimActivePanel, clearActivePanel, createClickRegion, createLabel } from './PanelKit';

const { ccclass, property } = _decorator;

const TAB_COLOR = new Color(60, 70, 96, 255);
const TAB_ACTIVE_COLOR = new Color(96, 110, 140, 255);
const MAX_ROWS = 5;

type CodexTab = 'weapons' | 'beasts' | 'monsters' | 'bosses' | 'chapters';

const TABS: ReadonlyArray<readonly [CodexTab, string]> = [
  ['weapons', '法器'],
  ['beasts', '灵兽'],
  ['monsters', '怪物'],
  ['bosses', 'Boss'],
  ['chapters', '章节'],
];

/**
 * 图鉴页（V08-11，灰盒）：法器/灵兽/怪物/Boss/章节五页签。
 * 条目三态：未见面具（？？？，不泄露任何数值）/已见剪影/已解锁详情——
 * V0.8 的解锁来源唯一为战斗击败（monsterDied → killCounts → 存档图鉴域，
 * V08-11 结算点写入），"已见剪影"态当前不会出现（预留），如实记录。
 * 详情数值全部来自配置（无假数据）；章节条目按关卡通关派生点亮。
 */
@ccclass('CodexPanel')
export class CodexPanel extends Component {
  @property({ type: Node })
  private content: Node | null = null;

  /** 操作完成后的回调（保持面板约定；图鉴无写操作，当前不触发）。 */
  public onOperationDone: (() => void) | null = null;

  private activeTab: CodexTab = 'monsters';
  private tabRegions: Partial<Record<CodexTab, ReturnType<typeof createClickRegion>>> = {};
  private rowRegions: ReturnType<typeof createClickRegion>[] = [];
  private statusLabel: Label | null = null;
  private built = false;

  protected override start(): void {
    if (this.content === null) {
      throw new Error('[CodexPanel] missing reference: content ← 在本节点下建子节点 content 并拖入该槽');
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

    createLabel(content, 'Title', '图鉴', 0, top - 34, 24);
    createClickRegion(content, 'Close', '关闭', width / 2 - 60, top - 34, 92, 42, () => {
      this.hide();
    });

    // 页签行。
    TABS.forEach(([tabId, title], index) => {
      const region = createClickRegion(
        content,
        `Tab_${tabId}`,
        title,
        -width / 2 + 70 + index * 110,
        top - 92,
        100,
        40,
        () => {
          this.activeTab = tabId;
          this.render();
        },
        TAB_COLOR.clone(),
      );
      this.tabRegions[tabId] = region;
    });

    // 条目行（固定 5 行池，按页签复用）。
    const rowWidth = width - 200;
    const rowHeight = Math.min(64, Math.floor((height - 260) / MAX_ROWS));
    for (let index = 0; index < MAX_ROWS; index += 1) {
      const region = createClickRegion(
        content,
        `Row${index + 1}`,
        '',
        -width / 2 + 100 + rowWidth / 2,
        top - 150 - index * (rowHeight + 8) - rowHeight / 2,
        rowWidth,
        rowHeight,
        () => undefined,
        new Color(70, 70, 70, 255),
      );
      region.label.fontSize = 15;
      region.label.lineHeight = 20;
      this.rowRegions.push(region);
    }

    this.statusLabel = createLabel(content, 'Status', '', 0, -height / 2 + 26, 15);
  }

  private render(): void {
    if (this.content === null || !this.content.active) {
      return;
    }
    const account = AccountSystem.instance;
    const save = account?.accountSave ?? null;
    if (account === null || save === null) {
      this.setStatus('账号服务未装配');
      return;
    }

    for (const [tabId] of TABS) {
      const region = this.tabRegions[tabId];
      if (region !== undefined) {
        region.setLook(tabId === this.activeTab ? TAB_ACTIVE_COLOR : TAB_COLOR);
      }
    }

    for (const region of this.rowRegions) {
      region.root.active = false;
    }

    switch (this.activeTab) {
      case 'weapons':
        this.renderWeapons(save.weaponLevels);
        break;
      case 'beasts':
        this.renderBeasts(save.beasts);
        break;
      case 'monsters':
        this.renderEntries(
          INITIAL_GAME_CONFIG.monsters.map((monster) => ({ id: monster.id, text: this.monsterText(monster.id) })),
        );
        break;
      case 'bosses':
        this.renderEntries(
          INITIAL_GAME_CONFIG.bosses.map((boss) => ({ id: boss.id, text: this.bossText(boss.id) })),
        );
        break;
      case 'chapters':
        this.renderChapters(save);
        break;
      default:
        break;
    }
  }

  private monsterText(monsterId: string): string {
    const monster = INITIAL_GAME_CONFIG.monsters.find((candidate) => candidate.id === monsterId);
    if (monster === undefined) {
      return `配置缺失：${monsterId}`;
    }
    const account = AccountSystem.instance;
    const save = account?.accountSave ?? null;
    if (save !== null && isDefeated(save, monsterId)) {
      return `${monster.displayName}　HP ${monster.maxHp}　速度 ${monster.moveSpeed}　接触伤害 ${monster.contactDamage}　经验 ${monster.xpValue}`;
    }
    if (save !== null && isSeen(save, monsterId)) {
      return `${monster.displayName}　（已遭遇）`;
    }
    return '？？？　（尚未遭遇）';
  }

  private bossText(bossId: string): string {
    const boss = INITIAL_GAME_CONFIG.bosses.find((candidate) => candidate.id === bossId);
    if (boss === undefined) {
      return `配置缺失：${bossId}`;
    }
    const account = AccountSystem.instance;
    const save = account?.accountSave ?? null;
    if (save !== null && isDefeated(save, bossId)) {
      return `${boss.displayName}　HP ${boss.maxHp}　召唤 ${boss.spawnTime}s　接触伤害 ${boss.contactDamage}　弹幕 ${boss.radialBurst.count} 发`;
    }
    return '？？？　（尚未击败）';
  }

  private renderWeapons(weaponLevels: Record<string, number>): void {
    const rows = INITIAL_GAME_CONFIG.weapons.map((weapon) => {
      const level = weaponLevels[weapon.id] ?? 1;
      const growth = INITIAL_GAME_CONFIG.weaponGrowth.find((candidate) => candidate.weaponId === weapon.id);
      const bonus = growth !== undefined ? growth.damagePerLevel * (level - 1) : 0;
      return { id: weapon.id, text: `${weapon.displayName}　Lv.${level}　攻击加成 +${bonus}` };
    });
    this.renderEntries(rows);
  }

  private renderBeasts(beasts: Record<string, { unlocked: boolean; level: number; star: number }>): void {
    const rows = INITIAL_GAME_CONFIG.beasts.map((beast) => {
      const entry = beasts[beast.id];
      const unlocked = entry !== undefined ? entry.unlocked : beast.unlockSoulCost === 0;
      if (unlocked) {
        const level = entry?.level ?? 1;
        const star = entry?.star ?? 0;
        return { id: beast.id, text: `${beast.displayName}　Lv.${level} ★${star}　${beast.skillDescription}` };
      }
      return { id: beast.id, text: `${beast.displayName}　🔒 未解锁（需 ${beast.displayName}灵魄 ×${beast.unlockSoulCost}）` };
    });
    this.renderEntries(rows);
  }

  private renderChapters(save: NonNullable<AccountSystem['accountSave']>): void {
    const rows = INITIAL_GAME_CONFIG.chapters.map((chapter) => {
      const cleared = chapter.stageIds.filter((stageId) => isStageCleared(save, stageId)).length;
      const lit = cleared >= chapter.stageIds.length;
      return {
        id: chapter.id,
        text: `${chapter.displayName}　${cleared}/${chapter.stageIds.length} 通关　${lit ? '◆ 已点亮' : '（未点亮）'}`,
      };
    });
    this.renderEntries(rows);
  }

  private renderEntries(rows: ReadonlyArray<{ readonly id: string; readonly text: string }>): void {
    rows.forEach((row, index) => {
      const region = this.rowRegions[index];
      if (region === undefined) {
        return;
      }
      region.root.active = true;
      region.label.string = row.text;
    });
    this.setStatus(rows.length > this.rowRegions.length ? `（条目超出显示池：${rows.length} 项）` : '');
  }

  private setStatus(text: string): void {
    if (this.statusLabel !== null) {
      this.statusLabel.string = text;
    }
  }
}
