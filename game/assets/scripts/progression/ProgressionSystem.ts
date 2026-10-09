import { _decorator, Component } from 'cc';

import { BattleController } from '../battle/BattleController';
import { INITIAL_GAME_CONFIG } from '../config/GameConfig';
import type { WeaponConfig } from '../config/ConfigTypes';
import { AccountSystem } from '../account/AccountSystem';
import { buildBattleLoadout } from '../account/LoadoutBuilder';
import { EMPTY_BATTLE_LOADOUT } from '../account/LoadoutBuilder';
import type { BattleLoadoutSnapshot } from '../account/LoadoutBuilder';
import { PlayerCombatStats } from '../combat/PlayerCombatStats';
import { createSystemRandomSource } from '../core/RandomSource';
import { GongfaRuntime } from './GongfaRuntime';
import { ProgressionService } from './ProgressionService';
import { TreasureRuntime } from './TreasureRuntime';
import type { LevelUpChoice } from './ProgressionService';
import { UpgradeService } from './UpgradeService';
import { trackAnalytics } from '../platform/AnalyticsService';
import { adResultGrantsReward, createAdAdapterProxy } from '../platform/AdAdapterUi';

const { ccclass, property } = _decorator;

const WEAPON_ID = 'weapon_qingxiao_sword';

/**
 * 进度编排系统：经验事件 → ProgressionService；升级选择服务时暂停战局并发布
 * levelUpRequested；面板只回传 option ID，经 chooseOption 校验后应用效果、发布
 * levelUpResolved；全部待处理等级完成后才恢复战斗。首个合法选择唯一生效
 * （处理期间锁定输入）。
 */
@ccclass('ProgressionSystem')
export class ProgressionSystem extends Component {
  @property({ type: BattleController })
  private battleController: BattleController | null = null;

  private readonly upgradeService = new UpgradeService(INITIAL_GAME_CONFIG.upgrades);
  private readonly gongfaRuntime = new GongfaRuntime(INITIAL_GAME_CONFIG.gongfas);
  private readonly treasureRuntime = new TreasureRuntime(INITIAL_GAME_CONFIG.treasures);
  private progression: ProgressionService | null = null;
  private combatStats: PlayerCombatStats | null = null;
  private loadoutSnapshot: BattleLoadoutSnapshot = EMPTY_BATTLE_LOADOUT;
  private loadoutApplied = false;
  private readonly systemRandom = createSystemRandomSource();
  private unsubscribeChoice: (() => void) | null = null;
  private unsubscribeExperience: (() => void) | null = null;
  private acceptsChoiceInput = false;

  protected override onLoad(): void {
    if (this.battleController === null) {
      throw new Error('[ProgressionSystem] missing reference: battleController ← 把 Systems 节点拖入该属性槽');
    }
    const weaponConfig: WeaponConfig | undefined = INITIAL_GAME_CONFIG.weapons.find(
      (candidate) => candidate.id === WEAPON_ID,
    );
    if (weaponConfig === undefined) {
      throw new Error(`[ProgressionSystem] Weapon not found: ${WEAPON_ID}`);
    }
    this.combatStats = new PlayerCombatStats(weaponConfig);
    this.progression = new ProgressionService(
      INITIAL_GAME_CONFIG.levelCurve,
      [...INITIAL_GAME_CONFIG.upgrades, ...INITIAL_GAME_CONFIG.gongfas, ...INITIAL_GAME_CONFIG.treasures],
      this.systemRandom,
    );
    this.pullAccountLoadout();
  }

  /**
   * 从 persist 账号服务拉取出战快照（V05-10 接线）：onLoad 先于一切 start，
   * 保证 PlayerAgent.start 读取 maxHp 加成时快照已生效。直接预览 BattleScene
   * （无 HomeScene）时 instance 为 null，注入空快照（V0.1 行为）。
   */
  private pullAccountLoadout(): void {
    const accountSave = AccountSystem.instance?.accountSave;
    if (accountSave !== undefined && accountSave !== null) {
      this.applyLoadout(buildBattleLoadout(accountSave, INITIAL_GAME_CONFIG));
    }
  }

  protected override onEnable(): void {
    if (this.battleController === null || this.progression === null) {
      return;
    }
    this.unsubscribeExperience = this.battleController.events.on('experienceCollected', (payload) => {
      this.progression?.addExperience(payload.amount);
    });
    this.unsubscribeChoice = this.progression.onLevelUpChoice((choice) => {
      this.handleChoiceServed(choice);
    });
  }

  protected override onDisable(): void {
    this.unsubscribeExperience?.();
    this.unsubscribeExperience = null;
    this.unsubscribeChoice?.();
    this.unsubscribeChoice = null;
  }

  /** 武器在 start 中读取；onLoad 已创建，组件加载顺序安全。 */
  public get stats(): PlayerCombatStats | null {
    return this.combatStats;
  }

  /** 当局功法运行态；剑气发射器等系统读取派生数量。 */
  public get gongfa(): GongfaRuntime {
    return this.gongfaRuntime;
  }

  /** 当局法宝运行态；触发方读取派生数值。 */
  public get treasure(): TreasureRuntime {
    return this.treasureRuntime;
  }

  /** 当前生效的出战快照；未注入时为空快照（无局外加成）。 */
  public get loadout(): BattleLoadoutSnapshot {
    return this.loadoutSnapshot;
  }

  /**
   * 注入出战快照（V05-07）：一次性把局外培养加成写入战斗运行态
   * （法器伤害加成、境界 maxHp 加成）；重复调用只生效一次，防止加成叠加。
   * 账号服务（V05-10 起）在战局开始前调用；战斗全程不回写账号。
   */
  public applyLoadout(loadout: BattleLoadoutSnapshot): void {
    if (this.loadoutApplied || this.combatStats === null) {
      return;
    }
    this.loadoutApplied = true;
    this.loadoutSnapshot = loadout;
    this.combatStats.addSwordDamage(loadout.weaponDamageBonus);
    this.combatStats.addMaxHpBonus(loadout.maxHpBonus);
  }

  public get level(): number {
    return this.progression?.level ?? 1;
  }

  /** 当前等级区间内的经验进度 [0, 1]；满级恒为 1。 */
  public get progressRatio(): number {
    return this.progression?.progressRatio ?? 0;
  }

  public get hasPendingLevelUp(): boolean {
    return this.progression?.hasPendingLevelUp ?? false;
  }

  /**
   * 面板回传选项 ID 的唯一入口。处理期间锁定（防连点），首个合法选择唯一生效；
   * 非法 ID 或无待处理选择返回 false。
   */
  /**
   * 换一批编排（V10-11 追加广告位）：面板按钮 → 激励广告 → 发奖（重抽候选 +
   * 每日审计 + 广告埋点）。每局次数运行态限制；广告失败/中途关闭不扣次数、
   * 面板保持待选。无待处理选择/超次数时拒绝。
   */
  public rerollsUsedThisBattle = 0;

  public get remainingRerolls(): number {
    return Math.max(0, INITIAL_GAME_CONFIG.ads.reroll.maxPerBattle - this.rerollsUsedThisBattle);
  }

  public async handleRerollRequested(): Promise<boolean> {
    if (this.progression === null || this.progression.currentChoice === null) {
      return false;
    }
    if (this.remainingRerolls <= 0) {
      return false;
    }
    let result: 'rewarded' | 'closed_early' | 'failed';
    try {
      result = await createAdAdapterProxy().show(INITIAL_GAME_CONFIG.ads.reroll.placementId);
    } catch {
      result = 'failed';
    }
    if (!adResultGrantsReward(result)) {
      return false;
    }
    const rerolled = this.progression.rerollCurrentChoice();
    if (rerolled === null) {
      return false;
    }
    this.rerollsUsedThisBattle += 1;
    // 每日审计（offerClaims 计数模式）；每局上限为运行态，不入存档。
    const account = AccountSystem.instance;
    if (account !== null && account.accountSave !== null && account.economy !== null) {
      const dayKey = account.time.dayKey();
      const key = `ad_${INITIAL_GAME_CONFIG.ads.reroll.placementId}_${dayKey}`;
      const save = account.accountSave;
      const current = save.offerClaims[key];
      save.offerClaims[key] = { claimCount: (current !== undefined ? current.claimCount : 0) + 1 };
      account.persistSave();
    }
    return true;
  }

  public chooseOption(optionId: string): boolean {
    if (!this.acceptsChoiceInput || this.progression === null || this.combatStats === null) {
      return false;
    }
    const battleController = this.battleController;
    if (battleController === null) {
      return false;
    }
    const choice = this.progression.currentChoice;
    if (choice === null || choice.optionIds.indexOf(optionId) < 0) {
      return false;
    }

    this.acceptsChoiceInput = false;
    const level = choice.level;
    this.progression.resolveLevelUp(optionId);
    if (INITIAL_GAME_CONFIG.gongfas.some((candidate) => candidate.id === optionId)) {
      this.gongfaRuntime.addStack(optionId, this.combatStats);
    } else if (INITIAL_GAME_CONFIG.treasures.some((candidate) => candidate.id === optionId)) {
      this.treasureRuntime.addStack(optionId);
    } else {
      this.upgradeService.applyEffects(this.combatStats, optionId);
    }
    // Build 选择埋点（V10-12，LIVEOPS §6）。
    trackAnalytics('build_option_chosen', { level, optionId });
    battleController.events.emit('levelUpResolved', { level, optionId });
    if (!this.progression.hasPendingLevelUp && battleController.state === 'level_up_paused') {
      battleController.resumeAfterLevelUp();
    }
    return true;
  }

  private handleChoiceServed(choice: LevelUpChoice): void {
    const battleController = this.battleController;
    if (battleController === null) {
      return;
    }
    if (battleController.state === 'running') {
      battleController.pauseForLevelUp();
    }
    this.acceptsChoiceInput = true;
    battleController.events.emit('levelUpRequested', {
      level: choice.level,
      optionIds: [...choice.optionIds],
    });
  }
}
