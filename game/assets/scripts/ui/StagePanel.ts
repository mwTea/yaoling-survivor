import { _decorator, Color, Component, director, Label, Node, UITransform, view } from 'cc';

import { AccountSystem } from '../account/AccountSystem';
import { INITIAL_GAME_CONFIG } from '../config/GameConfig';
import type { StageConfig, StageDifficultyConfig } from '../config/ConfigTypes';
import { addAccountXp } from '../account/PlayerLeveling';
import {
  claimFirstClearMilestone,
  claimStarTierMilestone,
  getClaimableStarTiers,
  getHighestStars,
  isFirstClearClaimed,
  isDifficultyUnlocked,
  isStageCleared,
  isStageUnlocked,
} from '../account/StageProgress';
import { addPanelBackdrop, bringPanelToFront, claimActivePanel, clearActivePanel, createArtNode, createClickRegion, createLabel } from './PanelKit';
import { applyArtSprite } from './ArtLoader';

const { ccclass, property } = _decorator;

const SELECTED_ROW_COLOR = new Color(90, 130, 90, 255);
const DEFAULT_ROW_COLOR = new Color(70, 70, 70, 255);

interface StageRow {
  stageId: string;
  readonly region: ReturnType<typeof createClickRegion>;
  readonly selectedFrame: Node;
  readonly stateIcons: {
    readonly normal: Node;
    readonly selected: Node;
    readonly locked: Node;
    readonly cleared: Node;
  };
}

interface DifficultyButton {
  readonly difficultyId: string;
  readonly region: ReturnType<typeof createClickRegion>;
}

/**
 * 关卡选择页（V08-05，灰盒）：章节切换 → 关卡列表（星级/锁定条件/通关状态）→
 * 选中关卡的难度选择、奖励与里程碑预览、开战。内容全部由代码构建（PanelKit），
 * 场景装配只需"StagePanel 根 + content 子节点"两个节点。选中状态经
 * AccountSystem.setStageSelection 校验并持久化（解锁链判定在领域层）；
 * 首通/星级累计奖励经 StageProgress 领取事务（经济事务 + 账号经验 + 落盘）。
 * 可领取状态即 V08-16 红点系统的数据源（预留查询接口已就绪）。
 */
@ccclass('StagePanel')
export class StagePanel extends Component {
  @property({ type: Node })
  private content: Node | null = null;

  /** 操作完成后的回调（首页资源栏刷新用，由 HomeHud 装配时注入）。 */
  public onOperationDone: (() => void) | null = null;

  private chapterIndex = 0;
  private selectedStageId: string | null = null;
  private selectedDifficultyId: string | null = null;
  private chapterLabel: Label | null = null;
  private detailLabel: Label | null = null;
  private statusLabel: Label | null = null;
  private stageRows: StageRow[] = [];
  private difficultyButtons: DifficultyButton[] = [];
  private firstClearButton: ReturnType<typeof createClickRegion> | null = null;
  private starClaimButton: ReturnType<typeof createClickRegion> | null = null;
  private battleButton: ReturnType<typeof createClickRegion> | null = null;
  private built = false;

  protected override start(): void {
    if (this.content === null) {
      throw new Error('[StagePanel] missing reference: content ← 在本节点下建子节点 content 并拖入该槽');
    }
    this.build();
    this.content.active = false;
  }

  /** 打开面板并按当前存档刷新。 */
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

  private get chapter() {
    const chapter = INITIAL_GAME_CONFIG.chapters[this.chapterIndex];
    if (chapter === undefined) {
      throw new Error(`[StagePanel] chapter index out of range: ${this.chapterIndex}`);
    }
    return chapter;
  }

  /** 全量构建静态结构（一次）；动态内容每帧 render 刷新。 */
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
    const bottom = -height / 2;

    // 顶栏（v2 稿）：返回（左）+ 标题（中）；章节切换条紧随其下（◀ 章名 ▶）。
    createClickRegion(content, 'Back', '← 返回', -width / 2 + 80, top - 36, 110, 42, () => {
      this.hide();
    }, undefined, { normal: 'btn_back_n', pressed: 'btn_back_p' });
    createArtNode(content, 'Title', 'title_calli_stage', 0, top - 36, 240, 90);
    this.chapterLabel = createLabel(content, 'Chapter', '', 0, top - 82, 19);

    createClickRegion(content, 'PrevChapter', '◀', -170, top - 82, 52, 38, () => {
      this.switchChapter(-1);
    }, undefined, { normal: 'btn_arrow_left_n', pressed: 'btn_arrow_left_p' });
    createClickRegion(content, 'NextChapter', '▶', 170, top - 82, 52, 38, () => {
      this.switchChapter(1);
    }, undefined, { normal: 'btn_arrow_right_n', pressed: 'btn_arrow_right_p' });

    // 蜿蜒路径装饰（V10-14 P1）：垫在关卡行下层（先创建，行渲染在其上）。
    createArtNode(content, 'PathDeco', 'deco_path', 0, top - 232, 120, 320);

    // 关卡行（每章 4 关，蜿蜒路径式左右错位；行点击 = 选中该关）。
    for (let index = 0; index < 4; index += 1) {
      const y = top - 140 - index * 58;
      const pathX = index % 2 === 0 ? -110 : 110;
      const region = createClickRegion(content, `StageRow${index + 1}`, '', pathX, y, 320, 46, () => {
        const row = this.stageRows[index];
        const stageId = row?.stageId;
        if (stageId !== undefined) {
          this.selectedStageId = stageId;
          if (!this.isDifficultyAvailable(this.selectedDifficultyId)) {
            const stage = INITIAL_GAME_CONFIG.stages.find((candidate) => candidate.id === stageId);
            this.selectedDifficultyId = stage?.difficulties[0]?.id ?? null;
          }
          this.render();
        }
      }, DEFAULT_ROW_COLOR.clone());
      region.label.node.setPosition(24, 0, 0);
      const stateIcons = {
        normal: this.createStageStateIcon(region.root, 'node_stage_n'),
        selected: this.createStageStateIcon(region.root, 'node_stage_selected'),
        locked: this.createStageStateIcon(region.root, 'node_stage_locked'),
        cleared: this.createStageStateIcon(region.root, 'node_stage_cleared'),
      };
      [stateIcons.normal, stateIcons.selected, stateIcons.locked, stateIcons.cleared]
        .forEach((icon) => icon.setPosition(-132, 0, 0));
      // 选中金框（V10-14）：子节点叠加，render 控制显隐。
      const selectedFrame = new Node('SelectedFrame');
      selectedFrame.setParent(region.root);
      const frameTransform = selectedFrame.addComponent(UITransform);
      frameTransform.setContentSize(330, 56);
      applyArtSprite(selectedFrame, 'frame_selected', { sliced: true });
      selectedFrame.active = false;
      this.stageRows.push({ stageId: '', region, selectedFrame, stateIcons });
    }

    this.detailLabel = createLabel(content, 'Detail', '', -width / 2 + 36, top - 370, 15, width - 72);
    const footerButtonWidth = Math.min(210, (width - 48) / 2);
    const claimOffset = footerButtonWidth / 2 + 12;
    const difficultyWidth = Math.min(118, (width - 64) / 3);
    const difficultySpacing = difficultyWidth + 12;
    const difficultyStartX = -difficultySpacing;
    createLabel(content, 'DifficultyTitle', '难度', 0, bottom + 270, 16);

    const difficulties = INITIAL_GAME_CONFIG.stages[0]?.difficulties ?? [];
    difficulties.forEach((difficulty, index) => {
      const region = createClickRegion(
        content,
        `Difficulty${index}`,
        difficulty.displayName,
        difficultyStartX + index * difficultySpacing,
        bottom + 236,
        difficultyWidth,
        40,
        () => {
          const difficultyId = this.difficultyButtons[index]?.difficultyId;
          if (difficultyId !== undefined) {
            this.selectedDifficultyId = difficultyId;
            this.render();
          }
        },
        undefined,
        { normal: 'btn_secondary_n', pressed: 'btn_secondary_p', sliced: true },
      );
      this.difficultyButtons.push({ difficultyId: difficulty.id, region });
    });

    this.firstClearButton = createClickRegion(
      content, 'FirstClearClaim', '领取首通', -claimOffset, bottom + 190, footerButtonWidth, 42,
      () => this.claimFirstClear(),
      new Color(110, 90, 50, 255),
      { normal: 'btn_secondary_n', pressed: 'btn_secondary_p', sliced: true },
    );
    this.starClaimButton = createClickRegion(
      content, 'StarClaim', '领取星级', claimOffset, bottom + 190, footerButtonWidth, 42,
      () => this.claimStarTier(),
      new Color(110, 90, 50, 255),
      { normal: 'btn_secondary_n', pressed: 'btn_secondary_p', sliced: true },
    );

    this.battleButton = createClickRegion(
      content, 'Battle', '开 战', 0, bottom + 145, Math.min(240, width - 48), 52,
      () => this.startBattle(),
      new Color(60, 110, 60, 255),
      { normal: 'btn_primary_n', pressed: 'btn_primary_p', sliced: true },
    );
    const statusY = Math.min(top - 470, bottom + 318);
    this.statusLabel = createLabel(content, 'Status', '', -width / 2 + 36, statusY, 15, width - 72);
  }

  private switchChapter(delta: number): void {
    const next = this.chapterIndex + delta;
    if (next < 0 || next >= INITIAL_GAME_CONFIG.chapters.length) {
      this.setStatus(delta < 0 ? '已经是第一章' : '已经是最后一章');
      return;
    }
    this.chapterIndex = next;
    this.selectedStageId = null;
    this.selectedDifficultyId = null;
    this.render();
  }

  private isDifficultyAvailable(difficultyId: string | null): boolean {
    if (difficultyId === null || this.selectedStageId === null) {
      return false;
    }
    const stage = INITIAL_GAME_CONFIG.stages.find((candidate) => candidate.id === this.selectedStageId);
    return stage?.difficulties.some((candidate) => candidate.id === difficultyId) ?? false;
  }

  private getSelectedStage(): StageConfig | null {
    if (this.selectedStageId === null) {
      return null;
    }
    return INITIAL_GAME_CONFIG.stages.find((candidate) => candidate.id === this.selectedStageId) ?? null;
  }

  private render(): void {
    if (this.content === null || !this.content.active || this.chapterLabel === null || this.detailLabel === null) {
      return;
    }
    const account = AccountSystem.instance;
    const save = account?.accountSave ?? null;
    if (save === null || account === null) {
      this.chapterLabel.string = '账号服务未装配';
      this.detailLabel.string = '';
      return;
    }

    const chapter = this.chapter;
    const unlocked = INITIAL_GAME_CONFIG.chapters.some(
      (candidate, index) => candidate.id === chapter.id,
    ) && this.isChapterUnlocked(account, chapter.id);
    this.chapterLabel.string = `第 ${this.chapterIndex + 1}/${INITIAL_GAME_CONFIG.chapters.length} 章 ${chapter.displayName}` +
      (unlocked ? '' : '（未解锁）');

    // 关卡行渲染。
    chapter.stageIds.forEach((stageId, index) => {
      const row = this.stageRows[index];
      if (row === undefined) {
        return;
      }
      row.stageId = stageId;
      const stage = INITIAL_GAME_CONFIG.stages.find((candidate) => candidate.id === stageId);
      if (stage === undefined) {
        row.region.label.string = `配置缺失：${stageId}`;
        return;
      }
      const stageUnlocked = isStageUnlocked(INITIAL_GAME_CONFIG, save, stageId);
      const stars = getHighestStars(save, stageId, this.bestDifficultyId(stage));
      const clearedText = isStageCleared(save, stageId) ? '已通关' : '未通关';
      const selection = this.selectedStageId === stageId ? '▶ ' : '';
      row.region.label.string = stageUnlocked
        ? `${selection}${stage.displayName}　★${stars}/3　${clearedText}`
        : `${selection}${stage.displayName}`;
      row.region.root.active = true;
      row.selectedFrame.active = this.selectedStageId === stageId;
      const cleared = isStageCleared(save, stageId);
      row.stateIcons.normal.active = stageUnlocked && !row.selectedFrame.active && !cleared;
      row.stateIcons.selected.active = stageUnlocked && row.selectedFrame.active && !cleared;
      row.stateIcons.locked.active = !stageUnlocked;
      row.stateIcons.cleared.active = stageUnlocked && cleared;
    });

    // 选中关卡的详情、难度、里程碑与开战渲染。
    this.renderDetail(account);
  }

  private createStageStateIcon(parent: Node, artId: string): Node {
    const icon = new Node(`StageState_${artId}`);
    icon.setParent(parent);
    icon.addComponent(UITransform).setContentSize(44, 44);
    applyArtSprite(icon, artId, { width: 44, height: 44 });
    icon.active = false;
    return icon;
  }

  private bestDifficultyId(stage: StageConfig): string {
    return stage.difficulties[0]?.id ?? '';
  }

  private isChapterUnlocked(account: AccountSystem, chapterId: string): boolean {
    // 章节解锁判定复用领域层：存档 unlockedChapterIds 为增量镜像，实时判定走解锁链。
    const save = account.accountSave;
    if (save === null) {
      return false;
    }
    const chapter = INITIAL_GAME_CONFIG.chapters.find((candidate) => candidate.id === chapterId);
    if (chapter === undefined) {
      return false;
    }
    if (chapter.requiredChapterId === null) {
      return true;
    }
    const required = INITIAL_GAME_CONFIG.chapters.find((candidate) => candidate.id === chapter.requiredChapterId);
    if (required === undefined) {
      return false;
    }
    return required.stageIds.every((stageId) => isStageCleared(save, stageId));
  }

  private renderDetail(account: AccountSystem): void {
    const save = account.accountSave;
    if (save === null || this.detailLabel === null) {
      return;
    }
    const stage = this.getSelectedStage();
    if (stage === null) {
      this.detailLabel.string = '点击上方关卡查看详情';
      this.setClaimButtons(false, false);
      this.battleButton?.setEnabled(false);
      this.difficultyButtons.forEach((button) => button.region.setEnabled(false));
      return;
    }
    const difficulty = this.resolveSelectedDifficulty(stage);
    const difficultyUnlocked = difficulty !== null
      && isDifficultyUnlocked(INITIAL_GAME_CONFIG, save, stage.id, difficulty.id);
    const stageUnlocked = isStageUnlocked(INITIAL_GAME_CONFIG, save, stage.id);

    const reward = INITIAL_GAME_CONFIG.stageRewards.find((candidate) => candidate.stageId === stage.id);
    const lines: string[] = [];
    if (!stageUnlocked) {
      lines.push('🔒 未解锁：需先通关同章前一关（或前置章节）');
    } else {
      lines.push('✓ 已解锁');
    }
    if (difficulty !== null) {
      lines.push(
        `当前难度：${difficulty.displayName}（敌人 HP×${difficulty.hpMultiplier} 伤害×${difficulty.contactDamageMultiplier}，` +
        `奖励×${difficulty.rewardMultiplier}）${difficultyUnlocked ? '' : '　🔒 需上一难度≥1星'}`,
      );
    }
    if (reward !== undefined) {
      const multiplier = difficulty?.rewardMultiplier ?? 1;
      lines.push(
        `胜利奖励：经验 ${Math.floor(reward.accountXp * multiplier)}　灵石 ${Math.floor((reward.resources.res_lingshi ?? 0) * multiplier)}` +
        `　修为 ${Math.floor((reward.resources.res_xiuwei ?? 0) * multiplier)}`,
      );
    }
    const milestone = stage.milestoneRewards;
    lines.push(
      `首通奖励：经验 ${Math.floor(milestone.firstClear.accountXp * (difficulty?.rewardMultiplier ?? 1))}` +
      `　灵石 ${Math.floor((milestone.firstClear.resources.res_lingshi ?? 0) * (difficulty?.rewardMultiplier ?? 1))}`,
    );
    this.detailLabel.string = lines.join('\n');

    // 难度按钮可用态。
    this.difficultyButtons.forEach((button) => {
      const available = stage.difficulties.some((candidate) => candidate.id === button.difficultyId);
      button.region.setEnabled(available && difficultyUnlocked);
    });

    // 领取按钮与开战。
    const canClaimFirst = difficultyUnlocked
      && isStageCleared(save, stage.id)
      && !isFirstClearClaimed(save, stage.id, difficulty?.id ?? '');
    const claimableTiers = difficultyUnlocked ? getClaimableStarTiers(save, stage.id, difficulty?.id ?? '') : 0;
    this.setClaimButtons(canClaimFirst, claimableTiers > 0, claimableTiers);
    this.battleButton?.setEnabled(stageUnlocked && difficultyUnlocked);
  }

  private resolveSelectedDifficulty(stage: StageConfig): StageDifficultyConfig | null {
    if (this.selectedDifficultyId !== null) {
      const found = stage.difficulties.find((candidate) => candidate.id === this.selectedDifficultyId);
      if (found !== undefined) {
        return found;
      }
    }
    return stage.difficulties[0] ?? null;
  }

  private setClaimButtons(first: boolean, star: boolean, tiers = 0): void {
    if (this.firstClearButton !== null) {
      this.firstClearButton.setEnabled(first);
    }
    if (this.starClaimButton !== null) {
      this.starClaimButton.label.string = tiers > 0 ? `领取星级奖励（余 ${tiers} 档）` : '领取星级奖励';
      this.starClaimButton.setEnabled(star);
    }
  }

  private claimFirstClear(): void {
    this.executeClaim((save, economy, stageId, difficultyId, request) =>
      claimFirstClearMilestone(save, INITIAL_GAME_CONFIG, economy, { addAccountXp }, stageId, difficultyId, request));
  }

  private claimStarTier(): void {
    this.executeClaim((save, economy, stageId, difficultyId, request) =>
      claimStarTierMilestone(save, INITIAL_GAME_CONFIG, economy, { addAccountXp }, stageId, difficultyId, request));
  }

  private executeClaim(
    run: (
      save: NonNullable<AccountSystem['accountSave']>,
      economy: NonNullable<AccountSystem['economy']>,
      stageId: string,
      difficultyId: string,
      request: { txId: string; at: number },
    ) => { ok: boolean; reason?: string; accountXp?: number },
  ): void {
    const account = AccountSystem.instance;
    const save = account?.accountSave ?? null;
    const economy = account?.economy ?? null;
    const stage = this.getSelectedStage();
    const difficulty = stage !== null ? this.resolveSelectedDifficulty(stage) : null;
    if (save === null || economy === null || account === null || stage === null || difficulty === null) {
      return;
    }
    const now = account.time.now();
    const outcome = run(save, economy, stage.id, difficulty.id, {
      txId: `milestone_${now}`,
      at: now,
    });
    if (outcome.ok) {
      this.setStatus(`领取成功：经验 +${outcome.accountXp ?? 0}`);
    } else {
      this.setStatus(`领取失败：${describeClaimFailure(outcome.reason ?? '')}`);
    }
    account.persistSave();
    this.render();
    this.onOperationDone?.();
  }

  private startBattle(): void {
    const account = AccountSystem.instance;
    const save = account?.accountSave ?? null;
    const stage = this.getSelectedStage();
    const difficulty = stage !== null ? this.resolveSelectedDifficulty(stage) : null;
    if (save === null || stage === null || difficulty === null) {
      this.setStatus('无法开战：账号服务或关卡选择缺失');
      return;
    }
    if (account === null) {
      this.setStatus('无法开战：账号服务未装配');
      return;
    }
    const outcome = account.setStageSelection(stage.id, difficulty.id);
    if (!outcome.ok) {
      this.setStatus(`无法开战：${describeSelectionFailure(outcome.reason)}`);
      return;
    }
    director.loadScene('BattleScene');
  }

  private setStatus(text: string): void {
    if (this.statusLabel !== null) {
      this.statusLabel.string = text;
    }
  }
}

function describeClaimFailure(reason: string): string {
  switch (reason) {
    case 'not_cleared':
      return '尚未通关（或无可领档位）';
    case 'already_claimed':
      return '已经领取过';
    case 'no_reward_config':
      return '奖励配置缺失';
    case 'grant_rejected':
      return '资源发放被拒绝';
    case 'xp_rejected':
      return '账号经验结算失败';
    case 'unknown_stage':
    case 'unknown_difficulty':
      return '关卡或难度不存在';
    default:
      return '状态异常';
  }
}

function describeSelectionFailure(reason: string | null): string {
  switch (reason) {
    case 'locked':
      return '该关卡或难度未解锁';
    case 'unknown_selection':
      return '关卡或难度不存在';
    case 'no_account':
      return '账号服务未装配';
    default:
      return '选择状态异常';
  }
}
