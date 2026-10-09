import { _decorator, Color, Component, Label, Node, view } from 'cc';

import { AccountSystem } from '../account/AccountSystem';
import { INITIAL_GAME_CONFIG } from '../config/GameConfig';
import type { TaskConfig, TaskPeriod } from '../config/ConfigTypes';
import { addAccountXp } from '../account/PlayerLeveling';
import {
  claimTaskReward,
  getTaskProgress,
  isTaskClaimable,
} from '../account/TaskSystem';
import type { TaskPeriodKeys } from '../account/TaskSystem';
import { addPanelBackdrop, bringPanelToFront, claimActivePanel, clearActivePanel, createClickRegion, createLabel } from './PanelKit';

const { ccclass, property } = _decorator;

const CLAIMABLE_COLOR = new Color(70, 110, 60, 255);
const CLAIMED_COLOR = new Color(45, 45, 45, 220);
const DEFAULT_COLOR = new Color(70, 70, 70, 255);

const PERIOD_SECTIONS: ReadonlyArray<readonly [TaskPeriod, string]> = [
  ['main', '主线'],
  ['daily', '每日（跨日刷新）'],
  ['weekly', '每周（周一刷新）'],
];

/**
 * 任务页（V08-09，灰盒）：主线/每日/每周三组任务行（进度/目标/领取态），
 * 可领取高亮，点击行领取（任务领取事务：经济入账 + 账号经验 + 领取记录）。
 * 进度由结算（V08-09 接线 applyBattleStatsToTasks）与经济 spend 钩子累计；
 * 周期 key 经 AccountSystem.time 计算（跨日/跨周自动刷新）。
 * 内容全部代码构建（PanelKit），场景装配仅需根节点 + content 子节点。
 */
@ccclass('TaskPanel')
export class TaskPanel extends Component {
  @property({ type: Node })
  private content: Node | null = null;

  /** 操作完成后的回调（首页资源栏刷新用）。 */
  public onOperationDone: (() => void) | null = null;

  private statusLabel: Label | null = null;
  private rows: Array<{
    readonly task: TaskConfig;
    readonly region: ReturnType<typeof createClickRegion>;
  }> = [];
  private built = false;

  protected override start(): void {
    if (this.content === null) {
      throw new Error('[TaskPanel] missing reference: content ← 在本节点下建子节点 content 并拖入该槽');
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
    addPanelBackdrop(content, { frameArt: 'panel_task', frameWidth: 640, frameHeight: 900, frameAnchorTop: true });
    const visibleSize = view.getVisibleSize();
    const width = visibleSize.width;
    const height = visibleSize.height;
    const top = height / 2;
    const rowWidth = width - 220;
    const rowHeight = Math.min(38, Math.floor((height - 240) / 16));

    createLabel(content, 'Title', '任务', 0, top - 34, 24);
    createClickRegion(content, 'Close', '关闭', width / 2 - 60, top - 34, 92, 42, () => {
      this.hide();
    });

    let cursorY = top - 78;
    for (const [period, sectionTitle] of PERIOD_SECTIONS) {
      createLabel(content, `Section_${period}`, sectionTitle, -width / 2 + 60, cursorY, 16, 300);
      cursorY -= rowHeight + 4;
      for (const task of INITIAL_GAME_CONFIG.tasks) {
        if (task.period !== period) {
          continue;
        }
        const region = createClickRegion(
          content,
          `Task_${task.id}`,
          task.displayName,
          -width / 2 + 110 + rowWidth / 2,
          cursorY - rowHeight / 2,
          rowWidth,
          rowHeight,
          () => this.handleRowClicked(task),
          DEFAULT_COLOR.clone(),
        );
        this.rows.push({ task, region });
        cursorY -= rowHeight + 4;
      }
    }

    this.statusLabel = createLabel(content, 'Status', '点击绿色行领取奖励', 0, bottom(visibleSize.height) + 46, 15);
  }

  private render(): void {
    if (this.content === null || !this.content.active) {
      return;
    }
    const account = AccountSystem.instance;
    const save = account?.accountSave ?? null;
    if (account === null || save === null) {
      for (const row of this.rows) {
        row.region.label.string = '账号服务未装配';
        row.region.setEnabled(false);
      }
      return;
    }
    const keys = this.periodKeys(account);
    for (const row of this.rows) {
      const progress = getTaskProgress(save, INITIAL_GAME_CONFIG, row.task.id, keys);
      const claimable = isTaskClaimable(save, INITIAL_GAME_CONFIG, row.task.id, keys);
      if (progress.claimed) {
        row.region.label.string = `${row.task.displayName}　✓ 已领取`;
        row.region.setLook(CLAIMED_COLOR);
      } else if (claimable) {
        row.region.label.string = `${row.task.displayName}　${progress.progress}/${progress.target}　● 可领取（点击领取）`;
        row.region.setLook(CLAIMABLE_COLOR);
      } else {
        row.region.label.string = `${row.task.displayName}　${progress.progress}/${progress.target}　${row.task.description}`;
        row.region.setLook(DEFAULT_COLOR);
      }
    }
  }

  private handleRowClicked(task: TaskConfig): void {
    const account = AccountSystem.instance;
    const save = account?.accountSave ?? null;
    const economy = account?.economy ?? null;
    if (account === null || save === null || economy === null) {
      return;
    }
    const keys = this.periodKeys(account);
    const outcome = claimTaskReward(save, INITIAL_GAME_CONFIG, economy, { addAccountXp }, task.id, keys, {
      txId: `task_claim_${account.time.now()}`,
      at: account.time.now(),
    });
    if (outcome.ok) {
      const resourceText = Object.keys(outcome.resources)
        .map((resourceId) => `${resourceId} +${outcome.resources[resourceId]}`)
        .join('　');
      this.setStatus(`已领取「${task.displayName}」：${resourceText || '无资源'}　修行经验 +${outcome.accountXp}`);
    } else {
      this.setStatus(`领取失败：${describeClaimFailure(outcome.reason)}`);
    }
    account.persistSave();
    this.render();
    this.onOperationDone?.();
  }

  private periodKeys(account: AccountSystem): TaskPeriodKeys {
    return { dayKey: account.time.dayKey(), weekKey: account.time.weekKey() };
  }

  private setStatus(text: string): void {
    if (this.statusLabel !== null) {
      this.statusLabel.string = text;
    }
  }
}

function describeClaimFailure(reason: string): string {
  switch (reason) {
    case 'not_completed':
      return '任务尚未完成';
    case 'already_claimed':
      return '已领取过';
    case 'grant_rejected':
      return '资源发放被拒绝';
    case 'xp_rejected':
      return '账号经验结算失败';
    case 'unknown_task':
      return '任务不存在';
    default:
      return '状态异常';
  }
}

function bottom(height: number): number {
  return -height / 2;
}
