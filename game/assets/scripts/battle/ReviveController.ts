import { _decorator, Component } from 'cc';

import { AccountSystem } from '../account/AccountSystem';
import { BattleController } from './BattleController';
import { ActiveStage } from './ActiveStage';
import { INITIAL_GAME_CONFIG } from '../config/GameConfig';
import {
  canOfferRevive,
  computeReviveRestore,
  getDailyAdUses,
  recordReviveUse,
} from './ReviveFlow';
import type { ReviveBattleRuntime } from './ReviveFlow';
import { PlayerAgent } from '../player/PlayerAgent';
import { adResultGrantsReward, createAdAdapterProxy } from '../platform/AdAdapterUi';
import type { AdAdapter } from '../platform/AdAdapter';
import { ReviveOfferPanel } from '../ui/ReviveOfferPanel';

const { ccclass, property } = _decorator;

/**
 * 战斗复活控制器（V10-10）：把死亡时刻路由为"复活要约"或"接受死亡"。
 * - 死亡门（注入 PlayerAgent.deathReviveGate，onDisable 成对清除，默认 null
 *   保持原行为）：不可提供（每局/每日次数用尽、投放关闭、不可用关卡）时立即
 *   acceptDeath；可提供时复用升级暂停语义（running → level_up_paused，模拟
 *   冻结、UI 可用）弹出复活要约。
 * - 广告发奖凭证：adResultGrantsReward（仅完整观看 rewarded 发奖）——发奖才
 *   recordReviveUse（每局运行态 + 每日存档审计）并 revive（回复比例 + 无敌秒）；
 *   中途关闭/失败不发奖不扣次数、不自动连播（要约保留由玩家重选）。
 * - 放弃 → acceptDeath（playerDied + endBattle，与原死亡行为一致）。
 * - 模拟适配器在 Creator 内发奖时日志带【模拟广告】标记。
 */
@ccclass('ReviveController')
export class ReviveController extends Component {
  @property({ type: BattleController })
  private battleController: BattleController | null = null;

  @property({ type: PlayerAgent })
  private playerAgent: PlayerAgent | null = null;

  @property({ type: ReviveOfferPanel })
  private revivePanel: ReviveOfferPanel | null = null;

  private readonly runtime: ReviveBattleRuntime = { usedThisBattle: 0 };
  private adAdapter: AdAdapter | null = null;
  private adShowing = false;

  protected override start(): void {
    if (this.battleController === null) {
      throw new Error('[ReviveController] missing reference: battleController ← 把 Systems 节点拖入该属性槽');
    }
    if (this.playerAgent === null) {
      throw new Error('[ReviveController] missing reference: playerAgent ← 把 Player 节点拖入该属性槽');
    }
    if (this.revivePanel === null) {
      throw new Error('[ReviveController] missing reference: revivePanel ← 把复活要约面板拖入该属性槽');
    }
    this.adAdapter = createAdAdapterProxy();
    this.playerAgent.deathReviveGate = (context) => this.handlePlayerDeath(context);
  }

  protected override onDisable(): void {
    if (this.playerAgent !== null) {
      this.playerAgent.deathReviveGate = null;
    }
    this.revivePanel?.hide();
  }

  private handlePlayerDeath(context: {
    readonly revive: (hpAmount: number, invulnerableSeconds: number) => void;
    readonly acceptDeath: () => void;
  }): void {
    const account = AccountSystem.instance;
    const save = account?.accountSave ?? null;
    if (account === null || save === null) {
      context.acceptDeath();
      return;
    }
    const config = INITIAL_GAME_CONFIG.ads.revive;
    const dayKey = account.time.dayKey();
    const stageId = ActiveStage.current.stage.id;
    const check = canOfferRevive(save, this.runtime, config, dayKey, stageId, (placementId) =>
      isPlacementEnabled(placementId),
    );
    if (!check.ok) {
      context.acceptDeath();
      return;
    }
    // 复用升级暂停语义：模拟冻结、UI 可用（battleSession 合法转换）。
    this.battleController?.pauseForLevelUp();
    const remainingToday = Math.max(0, config.maxPerDay - getDailyAdUses(save, config.placementId, dayKey));
    this.revivePanel?.show(remainingToday, {
      onWatch: () => void this.handleWatchAd(context),
      onGiveUp: () => this.handleGiveUp(context),
    });
  }

  private async handleWatchAd(context: {
    readonly revive: (hpAmount: number, invulnerableSeconds: number) => void;
    readonly acceptDeath: () => void;
  }): Promise<void> {
    if (this.adAdapter === null || this.adShowing) {
      return;
    }
    this.adShowing = true;
    this.revivePanel?.setAdPending(true);
    let result: 'rewarded' | 'closed_early' | 'failed';
    try {
      result = await this.adAdapter.show(INITIAL_GAME_CONFIG.ads.revive.placementId);
    } catch {
      result = 'failed';
    }
    this.adShowing = false;
    this.revivePanel?.setAdPending(false);

    if (!adResultGrantsReward(result)) {
      // 中途关闭/失败：不发奖、不扣次数、不自动连播（要约保留由玩家重选）。
      this.revivePanel?.showRetryMessage(result);
      return;
    }
    const account = AccountSystem.instance;
    const save = account?.accountSave ?? null;
    const config = INITIAL_GAME_CONFIG.ads.revive;
    if (account !== null && save !== null) {
      recordReviveUse(save, this.runtime, config, config.placementId, account.time.dayKey());
      account.persistSave();
    }
    const maxHp = this.playerAgent?.maxHp ?? INITIAL_GAME_CONFIG.player.maxHp;
    const restore = computeReviveRestore(config, maxHp);
    context.revive(restore.hp, restore.invulnerableSeconds);
    this.battleController?.resumeAfterLevelUp();
    this.revivePanel?.hide();
    console.log(`[ReviveController] revived: hp+${restore.hp}, invuln=${restore.invulnerableSeconds}s, result=${result}`);
  }

  private handleGiveUp(context: {
    readonly acceptDeath: () => void;
  }): void {
    this.revivePanel?.hide();
    context.acceptDeath();
  }
}

function isPlacementEnabled(placementId: string): boolean {
  return INITIAL_GAME_CONFIG.ads.placements.some(
    (placement) => placement.id === placementId && placement.enabled,
  );
}
