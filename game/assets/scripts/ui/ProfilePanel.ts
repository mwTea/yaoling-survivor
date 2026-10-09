import { _decorator, Color, Component, Label, Node, view } from 'cc';

import { AccountSystem } from '../account/AccountSystem';
import { DEFAULT_ACCOUNT_SETTINGS, MAX_RECENT_TRANSACTIONS } from '../account/AccountSave';
import type { SettingsSaveState } from '../account/AccountSave';
import { applyRuntimeSettings } from '../platform/SettingsRuntime';
import { describeRealmLine } from './PanelText';
import { INITIAL_GAME_CONFIG } from '../config/GameConfig';
import { addPanelBackdrop, bringPanelToFront, claimActivePanel, clearActivePanel, createArtNode, createClickRegion, createLabel } from './PanelKit';

const { ccclass, property } = _decorator;

const VOLUME_STEP = 10;
const QUALITY_LABELS: readonly string[] = ['自动', '流畅', '高清'];

/**
 * 我的页（V08-06，V10-06 扩展设置区，灰盒）：账号概要（等级/境界/存档时间戳）、
 * 存档 schema 版本、最近事务计数、清档重开（两步确认），以及设置区——
 * BGM/音效音量（步进 10）、震动开关、画质档位、协议版本展示与恢复默认。
 * 设置改动写存档设置域 → persistSave → applyRuntimeSettings 实时生效
 * （音量/震动/画质帧率），重启后由启动装配恢复；默认值取
 * AccountSave.DEFAULT_ACCOUNT_SETTINGS（单一真相，UI 无硬编码）。
 * 内容全部代码构建（PanelKit），场景装配仅需根节点 + content 子节点。
 */
@ccclass('ProfilePanel')
export class ProfilePanel extends Component {
  @property({ type: Node })
  private content: Node | null = null;

  /** 操作完成后的回调（首页资源栏刷新用）。 */
  public onOperationDone: (() => void) | null = null;

  private overviewLabel: Label | null = null;
  private schemaLabel: Label | null = null;
  private txLabel: Label | null = null;
  private statusLabel: Label | null = null;
  private resetRegion: ReturnType<typeof createClickRegion> | null = null;
  private resetArmed = false;
  private built = false;
  private bgmValueLabel: Label | null = null;
  private sfxValueLabel: Label | null = null;
  private vibrationButton: ReturnType<typeof createClickRegion> | null = null;
  private qualityButton: ReturnType<typeof createClickRegion> | null = null;

  protected override start(): void {
    if (this.content === null) {
      throw new Error('[ProfilePanel] missing reference: content ← 在本节点下建子节点 content 并拖入该槽');
    }
    this.build();
    this.content.active = false;
  }

  public show(): void {
    if (this.content === null) {
      return;
    }
    this.resetArmed = false;
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
    const top = visibleSize.height / 2;
    const halfWidth = visibleSize.width / 2;

    createArtNode(content, 'Title', 'title_calli_profile', 0, top - 40, 240, 90);
    this.overviewLabel = createLabel(content, 'Overview', '', -halfWidth + 60, top - 100, 20, visibleSize.width - 120);
    this.schemaLabel = createLabel(content, 'Schema', '', -halfWidth + 60, top - 220, 20, visibleSize.width - 120);
    this.txLabel = createLabel(content, 'Transactions', '', -halfWidth + 60, top - 300, 18, visibleSize.width - 120);

    // —— 设置区（V10-06）——
    createLabel(content, 'SettingsTitle', '设置', -halfWidth + 60, top - 355, 20);
    this.buildVolumeRow(content, 'Bgm', 'BGM 音量', top - 410);
    this.buildVolumeRow(content, 'Sfx', '音效音量', top - 460);
    this.vibrationButton = createClickRegion(
      content, 'VibrationToggle', '震动：开', 60, top - 510, 200, 42,
      () => this.handleVibrationToggled(),
      new Color(70, 90, 120, 255),
    );
    this.qualityButton = createClickRegion(
      content, 'QualityCycle', '画质：自动', 60, top - 560, 200, 42,
      () => this.handleQualityCycled(),
      new Color(70, 90, 120, 255),
    );
    createLabel(content, 'Agreement', '', -halfWidth + 60, top - 610, 16, visibleSize.width - 120);

    this.resetRegion = createClickRegion(
      content, 'ResetAccount', '清档重开', -140, -visibleSize.height / 2 + 110, 200, 46,
      () => this.handleResetClicked(),
      new Color(130, 60, 50, 255),
    );
    createClickRegion(
      content, 'RestoreDefaults', '恢复默认设置', 140, -visibleSize.height / 2 + 110, 200, 46,
      () => this.handleRestoreDefaultsClicked(),
      new Color(70, 90, 120, 255),
    );
    createClickRegion(content, 'Close', '关闭', halfWidth - 64, top - 40, 96, 44, () => {
      this.hide();
    });
    this.statusLabel = createLabel(content, 'Status', '', 0, -visibleSize.height / 2 + 60, 16);
  }

  private buildVolumeRow(content: Node, name: string, title: string, y: number): void {
    const titleLabel = createLabel(content, `${name}Title`, title, -view.getVisibleSize().width / 2 + 60, y, 18);
    titleLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
    const field = name === 'Bgm' ? 'bgmVolume' : 'sfxVolume';
    createClickRegion(
      content, `${name}Minus`, '−', 60, y, 56, 42,
      () => this.handleVolumeChanged(field, -VOLUME_STEP),
      new Color(70, 76, 104, 255),
    );
    const valueLabel = createLabel(content, `${name}Value`, '100', 150, y, 18);
    createClickRegion(
      content, `${name}Plus`, '＋', 240, y, 56, 42,
      () => this.handleVolumeChanged(field, VOLUME_STEP),
      new Color(70, 76, 104, 255),
    );
    if (name === 'Bgm') {
      this.bgmValueLabel = valueLabel;
    } else {
      this.sfxValueLabel = valueLabel;
    }
  }

  private render(): void {
    if (this.content === null || !this.content.active
      || this.overviewLabel === null || this.schemaLabel === null || this.txLabel === null) {
      return;
    }
    const account = AccountSystem.instance;
    const save = account?.accountSave ?? null;
    if (account === null || save === null) {
      this.overviewLabel.string = '账号服务未装配';
      this.schemaLabel.string = '';
      this.txLabel.string = '';
      this.resetRegion?.setEnabled(false);
      return;
    }
    this.overviewLabel.string = [
      `修行者 Lv.${save.playerLevel}　${describeRealmLine(INITIAL_GAME_CONFIG.realms, save.realmIndex, save.subRealmIndex)}`,
      `创建于 ${save.createdAt}　最近保存 ${save.lastSavedAt}`,
    ].join('\n');
    const cloud = account.cloudSaveStatus;
    const cloudText =
      cloud === null
        ? '未登录（无云同步）'
        : cloud.status === 'uploaded'
          ? '已上传云端'
          : cloud.status === 'downloaded'
            ? '已从云端恢复'
            : cloud.status === 'in_sync'
              ? '云端一致'
              : cloud.status === 'conflict'
                ? `冲突待处理（${cloud.detail}）`
                : cloud.status === 'upload_failed'
                  ? '上传失败（本地继续玩，恢复后补同步）'
                  : '未启用';
    this.schemaLabel.string = `存档 schema 版本：v${save.schemaVersion}　云同步：${cloudText}`;
    const latest = save.recentTransactions[save.recentTransactions.length - 1];
    this.txLabel.string = `最近事务：${save.recentTransactions.length}/${MAX_RECENT_TRANSACTIONS} 条` +
      (latest !== undefined ? `（最新：${latest.kind}）` : '');
    this.resetRegion?.setEnabled(true);
    this.renderSettings(save.settings);
  }

  private renderSettings(settings: SettingsSaveState): void {
    if (this.bgmValueLabel !== null) {
      this.bgmValueLabel.string = `${settings.bgmVolume}`;
    }
    if (this.sfxValueLabel !== null) {
      this.sfxValueLabel.string = `${settings.sfxVolume}`;
    }
    this.vibrationButton?.label && (this.vibrationButton.label.string = `震动：${settings.vibrationEnabled ? '开' : '关'}`);
    const quality = QUALITY_LABELS[settings.qualityTier] ?? QUALITY_LABELS[0];
    if (this.qualityButton !== null) {
      this.qualityButton.label.string = `画质：${quality ?? '自动'}`;
    }
    const agreementLabel = this.content?.getChildByName('Agreement')?.getComponent(Label);
    if (agreementLabel !== null && agreementLabel !== undefined) {
      agreementLabel.string =
        settings.agreementVersion > 0
          ? `协议版本：v${settings.agreementVersion}（已确认）`
          : '协议版本：未确认（首次发布合规流确认）';
    }
  }

  /** 设置变更统一路径：写存档 → 落盘 → 运行时实时生效 → 刷新展示。 */
  private commitSettings(mutate: (settings: SettingsSaveState) => void): boolean {
    const account = AccountSystem.instance;
    const save = account?.accountSave ?? null;
    if (account === null || save === null) {
      this.setStatus('账号服务未装配，无法修改设置');
      return false;
    }
    mutate(save.settings);
    account.persistSave();
    applyRuntimeSettings(save.settings);
    this.renderSettings(save.settings);
    this.onOperationDone?.();
    return true;
  }

  private handleVolumeChanged(field: 'bgmVolume' | 'sfxVolume', delta: number): void {
    this.commitSettings((settings) => {
      const next = Math.min(100, Math.max(0, settings[field] + delta));
      settings[field] = next;
    });
  }

  private handleVibrationToggled(): void {
    this.commitSettings((settings) => {
      settings.vibrationEnabled = !settings.vibrationEnabled;
    });
  }

  private handleQualityCycled(): void {
    this.commitSettings((settings) => {
      settings.qualityTier = (settings.qualityTier + 1) % 3;
    });
  }

  private handleRestoreDefaultsClicked(): void {
    const ok = this.commitSettings((settings) => {
      Object.assign(settings, DEFAULT_ACCOUNT_SETTINGS);
    });
    if (ok) {
      this.setStatus('已恢复默认设置');
    }
  }

  private handleResetClicked(): void {
    const account = AccountSystem.instance;
    if (account === null || account.accountSave === null) {
      this.setStatus('账号服务未装配，无法清档');
      return;
    }
    if (!this.resetArmed) {
      this.resetArmed = true;
      this.setStatus('⚠ 将清空全部进度并开新档——再次点击确认');
      return;
    }
    this.resetArmed = false;
    if (account.resetAccount()) {
      this.setStatus('已清档：全新存档已生效');
      this.render();
      this.onOperationDone?.();
    } else {
      this.setStatus('清档失败：账号服务未就绪');
    }
  }

  private setStatus(text: string): void {
    if (this.statusLabel !== null) {
      this.statusLabel.string = text;
    }
  }
}
