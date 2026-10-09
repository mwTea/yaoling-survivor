import { _decorator, Component, director } from 'cc';

import { INITIAL_GAME_CONFIG } from '../config/GameConfig';
import { AccountStore, MAX_RECENT_TRANSACTIONS } from './AccountSave';
import type { AccountSaveData, StageSelectionSave } from './AccountSave';
import { EconomyService } from '../economy/Economy';
import { addAccountXp } from './PlayerLeveling';
import { autoPromoteSubRealms } from './RealmProgress';
import { applyStageRewards, computeStageRewards } from './SettlementRewards';
import { ActiveStage } from '../battle/ActiveStage';
import {
  isDifficultyUnlocked,
  recordStageOutcome,
  resolveStageSelection,
  syncUnlockedChapters,
} from './StageProgress';
import { applyBattleStatsToTasks, applyTaskSpend } from './TaskSystem';
import { applyAchievementEvent } from './AchievementSystem';
import { recordCodexKills } from './CodexSystem';
import { advanceLoginDay } from './LoginReward';
import { syncActivityInstances } from './ActivitySystem';
import type { BattleResult, BattleResultStats } from '../core/BattleEvents';
import type { BattleLoadoutSnapshot } from './LoadoutBuilder';
import { CocosStorageAdapter } from '../platform/CocosStorageAdapter';
import { applyRuntimeSettings } from '../platform/SettingsRuntime';
import { trackAnalytics } from '../platform/AnalyticsService';
import { createIdentityAdapter } from '../platform/WechatIdentityAdapter';
import { syncServerTime } from '../platform/ServerTimeSync';
import { CloudSaveController } from '../platform/CloudSaveController';
import type { CloudSaveStatus } from '../platform/CloudSaveController';
import { createCloudSaveAdapter } from '../platform/WechatCloudSaveAdapter';
import { parseAccountSave, serializeAccountSave, ACCOUNT_SAVE_SCHEMA_VERSION } from './AccountSave';
import { applyLoginResult } from '../platform/IdentityAdapter';
import type { IdentityAdapter, IdentityResult } from '../platform/IdentityAdapter';
import { TimeService } from '../platform/TimeService';

const { ccclass, property } = _decorator;

/**
 * 账号系统（V05-09 起，V05-10 迁移为跨场景常驻装配）：持有账号存取（AccountStore）、
 * 经济事务（EconomyService）与工作存档状态，是 battleFinished 的唯一结算消费方，
 * 结算后立即落盘。挂在 HomeScene 的 AccountRoot 根节点并勾选 persistent
 * （addPersistRootNode 跨场景常驻）；战斗场景经 `AccountSystem.instance` 只读访问，
 * 快照注入由 ProgressionSystem.onLoad 拉取（onLoad 先于一切 start，顺序确定）。
 * 战斗全程不回写账号——唯一账号写入点是本系统的结算消费与培养操作（V05-11/V05-12）。
 * 直接预览 BattleScene（无 HomeScene）时 instance 为 null：战斗保持 V0.1 行为，
 * 不结算不落账（由 AccountBattleLink 提示）。
 */
@ccclass('AccountSystem')
export class AccountSystem extends Component {
  /** 勾选后本节点成为跨场景常驻根节点（HomeScene 装配使用）。 */
  @property
  private persistent = false;

  private store: AccountStore | null = null;
  private economyService: EconomyService | null = null;
  private save: AccountSaveData | null = null;
  private identityAdapter: IdentityAdapter | null = null;
  private cloudSave: CloudSaveController | null = null;
  private identityLoginPending = false;
  /** 身份域 guestId 生成的可替换随机源（测试/复现注入点）。 */
  private identityRandom: () => number = Math.random;

  /** 时间服务（V08-07 装配注入；V0.8 为本地时间实现，V1.0 换服务器实现接口不变）。 */
  public readonly time: TimeService = new TimeService();

  /** 跨场景访问点（persist 装配后全局唯一）；节点销毁时清空。 */
  public static instance: AccountSystem | null = null;

  protected override onLoad(): void {
    if (AccountSystem.instance !== null && AccountSystem.instance !== this) {
      // persist 实例已存在（从战斗场景返回首页时，场景内 AccountRoot 副本再次实例化）：
      // 销毁副本保持单例，存档状态仍归 persist 实例所有。
      this.node.destroy();
      return;
    }
    AccountSystem.instance = this;
    if (this.persistent) {
      director.addPersistRootNode(this.node);
    }
    this.store = new AccountStore(new CocosStorageAdapter(), () => this.time.now());
    this.economyService = new EconomyService(INITIAL_GAME_CONFIG.resources, {
      txLogCapacity: MAX_RECENT_TRANSACTIONS,
      // 任务"消耗资源"条件接线（V08-09）：经济 spend 原子生效后映射为任务进度
      // （仅改写 taskBuckets，不经经济事务；落盘随调用方 persistSave/结算）。
      onSpend: (state, deltas) => {
        if (this.save === null) {
          return;
        }
        const keys = { dayKey: this.time.dayKey(), weekKey: this.time.weekKey() };
        for (const resourceId of Object.keys(deltas)) {
          const amount = deltas[resourceId] ?? 0;
          applyTaskSpend(this.save, INITIAL_GAME_CONFIG, resourceId, amount, keys);
          // 成就（V08-10）与任务共用同一消耗事件源（spendResource 条件）。
          applyAchievementEvent(this.save, INITIAL_GAME_CONFIG, 'spendResource', amount, resourceId);
        }
      },
    });
    this.save = this.store.load();
    if (this.store.lastResetReason !== null) {
      console.log(`[AccountSystem] account save reset (${this.store.lastResetReason}), fresh save created`);
    }
    // 设置域运行时应用（V10-06）：音量/震动/画质档位随存档启动生效
    // （AudioService 未装配时其 onLoad 兜底自读设置域）。
    applyRuntimeSettings(this.save.settings);
    // 身份登录（V10-07）：适配层失败自动访客兜底；可经 retryIdentityLogin 重试。
    this.identityAdapter = createIdentityAdapter();
    void this.attemptIdentityLogin();
    // 30 日累计登录（V08-14）：会话启动按 dayKey 推进（每自然日最多 +1、幂等）。
    if (advanceLoginDay(this.save, this.time.dayKey())) {
      this.store.save(this.save);
      console.log(`[AccountSystem] login day advanced: totalDays=${this.save.loginReward.totalDays}`);
    }
    // 活动实例同步（V08-16）：窗口状态 + 关闭未领取处理记录（登录活动复用 LoginReward 判定）。
    const workingSave = this.save;
    const activityChanges = syncActivityInstances(workingSave, INITIAL_GAME_CONFIG, this.time.dayKey(), {
      isFlagEnabled: (flag) => flag === 'login_reward',
      hasUnclaimed: (activity) =>
        activity.type === 'login' && workingSave.loginReward.claimedTier < INITIAL_GAME_CONFIG.loginRewards.totalDays,
    });
    if (activityChanges.length > 0) {
      this.store.save(this.save);
      console.log(`[AccountSystem] activity instances synced: ${activityChanges.join(', ')}`);
    }
    console.log(
      `[AccountSystem] loaded: playerLevel=${this.save.playerLevel} realmIndex=${this.save.realmIndex} ` +
        `lingshi=${this.economyService.getBalance(this.save, 'res_lingshi')}`,
    );
  }

  protected override onDestroy(): void {
    if (AccountSystem.instance === this) {
      AccountSystem.instance = null;
    }
  }

  /** 当前工作存档（调用方不得直接改写；培养操作经领域模块事务后调用 persistSave 落盘）。 */
  public get accountSave(): AccountSaveData | null {
    return this.save;
  }

  public get economy(): EconomyService | null {
    return this.economyService;
  }

  /** 立即落盘（培养/出战等关键操作后调用；结算路径内部已含保存）。 */
  public persistSave(): void {
    if (this.store !== null && this.save !== null) {
      this.store.save(this.save);
      // 云同步（V10-09）：关键事务后节流上传；失败不阻断（本地已落盘）。
      void this.cloudSave?.onLocalSave().catch(() => {
        console.warn('[AccountSystem] cloud save upload failed (kept playing locally)');
      });
    }
  }

  /** 云同步状态（V10-09，"我的"页展示用）；控制器未建（未登录）为 null。 */
  public get cloudSaveStatus(): { status: CloudSaveStatus; detail: string } | null {
    if (this.cloudSave === null) {
      return null;
    }
    return { status: this.cloudSave.currentStatus, detail: this.cloudSave.detail };
  }

  /** 当前选中关卡（存档原值；null = 未选择，开战时默认第一关）。 */
  public getStageSelection(): StageSelectionSave | null {
    return this.save?.stageSelection ?? null;
  }

  /** 身份域只读快照（V10-09 云存档以 openid 建档；UI 展示登录态用）。 */
  public get identity(): { localGuestId: string; wxOpenId: string; lastLoginAt: number } | null {
    if (this.save === null) {
      return null;
    }
    const { localGuestId, wxOpenId, lastLoginAt } = this.save.identity;
    return { localGuestId, wxOpenId, lastLoginAt };
  }

  /**
   * 发起登录（onLoad 自动一次；失败后可经本方法重试）。并发重入被忽略；
   * 结果经 applyLoginResult 落档（成功写 openid/lastLoginAt，失败访客兜底），
   * 有变化即落盘。不抛错、不阻断任何玩法路径。
   */
  public retryIdentityLogin(): void {
    void this.attemptIdentityLogin();
  }

  private async attemptIdentityLogin(): Promise<void> {
    if (this.identityAdapter === null || this.save === null || this.identityLoginPending) {
      return;
    }
    this.identityLoginPending = true;
    let result: IdentityResult;
    try {
      result = await this.identityAdapter.login();
    } catch (error) {
      // 适配器约定不抛错；兜底再防一层（降级访客）。
      result = { ok: false, kind: 'guest', openid: '', detail: `identity_adapter_threw: ${String(error)}` };
    }
    this.identityLoginPending = false;
    if (this.save === null) {
      return;
    }
    const outcome = applyLoginResult(this.save, result, this.time.now(), this.identityRandom);
    if (outcome.changed) {
      this.store?.save(this.save);
    }
    if (outcome.mode === 'wx') {
      console.log(`[AccountSystem] identity login ok (openid=${this.save.identity.wxOpenId})`);
    } else {
      console.warn(`[AccountSystem] identity login failed, guest mode (${outcome.detail}); retry via retryIdentityLogin()`);
    }
    // 云存档（V10-09）：openid 就绪后建控制器并启动同步（下载/上传/冲突判定）。
    if (this.cloudSave === null && this.store !== null) {
      this.cloudSave = new CloudSaveController({
        adapter: createCloudSaveAdapter(),
        store: this.store,
        time: this.time,
        getOpenid: () => this.save?.identity.wxOpenId ?? '',
        currentSchemaVersion: ACCOUNT_SAVE_SCHEMA_VERSION,
        serialize: serializeAccountSave,
        parse: (raw) => {
          const parsed = parseAccountSave(raw);
          return parsed.ok ? { ok: true, data: parsed.data } : { ok: false };
        },
      });
    }
    if (this.cloudSave !== null) {
      void this.cloudSave.syncOnStartup().catch(() => {
        console.warn('[AccountSystem] cloud save startup sync failed (kept playing locally)');
      });
    }
    // 服务器校时（V10-08）：登录链路后同步一次；失败保持本地容错（TimeService 降级态）。
    const synced = await syncServerTime(this.time);
    if (synced) {
      console.log(`[AccountSystem] server time synced (offset=${this.time.serverOffsetMs}ms, status=${this.time.timeStatus})`);
    } else {
      console.warn('[AccountSystem] server time sync unavailable, local clock fallback (degraded)');
    }
  }

  /**
   * 显式清档（V08-06 我的页，二次确认由 UI 负责）：走 AccountStore 重置路径
   * 落盘全新存档并替换工作状态；返回 false 表示服务未就绪。
   */
  public resetAccount(): boolean {
    if (this.store === null || this.save === null) {
      return false;
    }
    this.save = this.store.resetToNewSave();
    // 清档后设置域恢复默认并实时生效（V10-06）。
    applyRuntimeSettings(this.save.settings);
    console.log('[AccountSystem] account reset: fresh save created');
    return true;
  }

  /**
   * 设置选中关卡（V08-05 选关页入口；经账号服务持久化，跨场景生效）。
   * 未知关卡/难度或未解锁时拒绝并返回原因，不落盘。
   */
  public setStageSelection(stageId: string, difficultyId: string): { ok: boolean; reason: string | null } {
    if (this.save === null) {
      return { ok: false, reason: 'no_account' };
    }
    try {
      if (!isDifficultyUnlocked(INITIAL_GAME_CONFIG, this.save, stageId, difficultyId)) {
        return { ok: false, reason: 'locked' };
      }
    } catch (error) {
      // 未知 stageId/difficultyId 快速失败为 false 而非崩溃（UI 输入口）。
      console.warn(`[AccountSystem] setStageSelection rejected: ${String(error)}`);
      return { ok: false, reason: 'unknown_selection' };
    }
    this.save.stageSelection = { stageId, difficultyId };
    this.persistSave();
    console.log(`[AccountSystem] stage selection: ${stageId} @ ${difficultyId}`);
    return { ok: true, reason: null };
  }

  /**
   * 结算消费（battleFinished 的唯一入口，由战斗场景的 AccountBattleLink 转发）：
   * 按当局选中关卡取奖励配置 → 难度奖励乘数折算（比例规则不变）→ 资源单事务 →
   * 账号经验 → 小境界自动推进 → 记录关卡进度（通关/星级历史只进不退）→
   * 同步章节解锁 → 落盘。幂等由上游事件单局仅发布一次保证（V01-02 StageResultService）。
   */
  public handleSettlement(result: BattleResult, stats?: BattleResultStats): void {
    if (this.store === null || this.economyService === null || this.save === null) {
      return;
    }
    // 战斗已结束才进入本方法：读取 ActiveStage 的当局关卡（与战斗一致，非当前选择）。
    const { stage, difficulty } = ActiveStage.current;
    const reward = INITIAL_GAME_CONFIG.stageRewards.find((candidate) => candidate.stageId === stage.id);
    if (reward === undefined) {
      console.warn(`[AccountSystem] 关卡 ${stage.id} 缺少 StageRewardConfig，跳过结算奖励发放`);
      return;
    }
    const plan = computeStageRewards(reward, result, difficulty.rewardMultiplier);
    const outcome = applyStageRewards(
      this.save,
      { playerLevel: INITIAL_GAME_CONFIG.playerLevel, realms: INITIAL_GAME_CONFIG.realms },
      plan,
      { addAccountXp, autoPromoteSubRealms, economy: this.economyService },
      { txId: `settlement_${result}_${this.time.now()}`, at: this.time.now() },
    );
    // 图鉴（V08-11）：击杀分布写入"已见/已击败"（战斗遭遇的唯一记录来源）。
    recordCodexKills(this.save, stats?.killCounts ?? {});
    // 任务进度（V08-09）与成就进度（V08-10）：由 battleFinished 统计一次性应用
    // （战斗中不回写账号；成就无周期，永久累计）。
    if (stats !== undefined) {
      applyBattleStatsToTasks(this.save, INITIAL_GAME_CONFIG, stats, {
        dayKey: this.time.dayKey(),
        weekKey: this.time.weekKey(),
      });
      const killUps = stats.killCount;
      if (killUps > 0) {
        applyAchievementEvent(this.save, INITIAL_GAME_CONFIG, 'killCount', killUps, null);
      }
      if (stats.xpCollected > 0) {
        applyAchievementEvent(this.save, INITIAL_GAME_CONFIG, 'collectXp', stats.xpCollected, null);
      }
      const levelUps = Math.max(0, stats.levelReached - 1);
      if (levelUps > 0) {
        applyAchievementEvent(this.save, INITIAL_GAME_CONFIG, 'levelUpCount', levelUps, null);
      }
      if (result === 'victory') {
        applyAchievementEvent(this.save, INITIAL_GAME_CONFIG, 'clearCount', 1, null);
      }
    }
    recordStageOutcome(this.save, stage.id, difficulty.id, {
      cleared: result === 'victory',
      stars: stats?.stars ?? 0,
    });
    // 埋点（V10-12）：结算/失败原因/资源产消快照（LIVEOPS §6）。
    trackAnalytics('battle_finished', {
      result,
      stageId: stage.id,
      difficultyId: difficulty.id,
      elapsedSeconds: stats?.elapsedSeconds ?? 0,
      killCount: stats?.killCount ?? 0,
      xpCollected: stats?.xpCollected ?? 0,
      levelReached: stats?.levelReached ?? 1,
      stars: stats?.stars ?? 0,
    });
    if (result !== 'victory') {
      trackAnalytics('battle_defeat_reason', { result, stageId: stage.id });
    }
    const snapshot: Record<string, number> = { playerLevel: this.save.playerLevel };
    for (const key of Object.keys(this.save.balances)) {
      snapshot[key] = this.save.balances[key] ?? 0;
    }
    trackAnalytics('resource_snapshot', snapshot);
    const newlyUnlocked = syncUnlockedChapters(INITIAL_GAME_CONFIG, this.save);
    this.store.save(this.save);
    if (newlyUnlocked.length > 0) {
      console.log(`[AccountSystem] chapters unlocked: ${newlyUnlocked.join(', ')}`);
    }
    if (!outcome.ok) {
      console.warn(`[AccountSystem] settlement ${result} partial failure: ${outcome.failureDetail}`);
      return;
    }
    console.log(
      `[AccountSystem] settlement ${result} @ ${stage.id}/${difficulty.id}: accountXp+${outcome.accountXpGranted} ` +
        `(Lv.${outcome.newLevel}), resources=${JSON.stringify(outcome.appliedResources)}, ` +
        `subRealmPromotions=${outcome.subRealmPromotions}`,
    );
  }
}
