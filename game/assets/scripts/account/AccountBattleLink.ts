import { _decorator, Component } from 'cc';

import { BattleController } from '../battle/BattleController';
import { ActiveStage } from '../battle/ActiveStage';
import { INITIAL_GAME_CONFIG } from '../config/GameConfig';
import { AccountSystem } from '../account/AccountSystem';
import { resolveStageSelection } from './StageProgress';

const { ccclass, property } = _decorator;

/**
 * 战斗场景 ↔ 账号服务绑定（V05-10，V08-03 扩展装配职责）：onLoad 按账号存档的
 * 选中关卡装配 ActiveStage（onLoad 全部先于 start，保证各战斗系统 start 读取时
 * 快照就绪；无账号服务时 ActiveStage 自行回退 initialStageId 默认关）；
 * battleFinished 转发给 persist 节点上的 AccountSystem.handleSettlement（订阅
 * onEnable/onDisable 成对解除，随场景销毁）。快照注入不在此处——由
 * ProgressionSystem.onLoad 拉取。直接预览 BattleScene（无 HomeScene persist 节点）
 * 时仅提示并保持 V0.1 行为：战斗可玩、不结算不落账。
 */
@ccclass('AccountBattleLink')
export class AccountBattleLink extends Component {
  @property({ type: BattleController })
  private battleController: BattleController | null = null;

  private account: AccountSystem | null = null;
  private unsubscribeFinished: (() => void) | null = null;

  protected override onLoad(): void {
    if (this.battleController === null) {
      throw new Error('[AccountBattleLink] missing reference: battleController ← 把 Systems 节点拖入该属性槽');
    }
    this.account = AccountSystem.instance;
    const save = this.account?.accountSave ?? null;
    if (save === null) {
      console.log('[AccountBattleLink] no account service (direct BattleScene preview): settlement disabled');
      return;
    }
    // V08-03：按账号存档选中状态装配当局关卡（未知引用快速失败，不静默回退）。
    const selection = resolveStageSelection(INITIAL_GAME_CONFIG, save.stageSelection);
    const stage = INITIAL_GAME_CONFIG.stages.find((candidate) => candidate.id === selection.stageId);
    if (stage === undefined) {
      throw new Error(`[AccountBattleLink] Selected stage not found: ${selection.stageId}`);
    }
    const difficulty = stage.difficulties.find((candidate) => candidate.id === selection.difficultyId);
    if (difficulty === undefined) {
      throw new Error(`[AccountBattleLink] Selected difficulty not found: ${selection.difficultyId}`);
    }
    ActiveStage.configure(stage, difficulty);
  }

  protected override onEnable(): void {
    if (this.battleController === null) {
      return;
    }
    this.unsubscribeFinished = this.battleController.events.on('battleFinished', (payload) => {
      this.account?.handleSettlement(payload.result, payload.stats);
    });
  }

  protected override onDisable(): void {
    this.unsubscribeFinished?.();
    this.unsubscribeFinished = null;
    ActiveStage.reset();
  }
}
