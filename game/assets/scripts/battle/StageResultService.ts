import { _decorator, Component } from 'cc';

import { ActiveStage } from './ActiveStage';
import { evaluateStageStars } from './StarEvaluator';
import type { StarCondition } from '../config/ConfigTypes';
import type { BattleResult } from './StageResultRecorder';
import { StageResultRecorder } from './StageResultRecorder';
import { BattleController } from './BattleController';
import { ProgressionSystem } from '../progression/ProgressionSystem';

const { ccclass, property } = _decorator;

/**
 * 战局终局服务：计时达标（stage.duration）判胜利、playerDied 判失败；
 * 首个终局生效（幂等），发布一次 battleFinished 并确保战局 Ended。
 * 事件订阅在 onEnable/onDisable 成对解除。
 */
@ccclass('StageResultService')
export class StageResultService extends Component {
  @property({ type: BattleController })
  private battleController: BattleController | null = null;

  @property({ type: ProgressionSystem })
  private progressionSystem: ProgressionSystem | null = null;

  private readonly recorder = new StageResultRecorder();
  private stageDurationSeconds = 0;
  private bossId: string | null = null;
  private hasFinished = false;
  private unsubscribeDied: (() => void) | null = null;
  private unsubscribeExperience: (() => void) | null = null;
  private unsubscribePlayerDied: (() => void) | null = null;
  private unsubscribeHpChanged: (() => void) | null = null;
  /** 星级条件追踪（V08-04）：受击计数 + 结算时剩余生命快照（未受伤视为满血）。 */
  private starConditions: readonly StarCondition[] = [];
  private hitTakenCount = 0;
  private lastHp = -1;
  private lastMaxHp = -1;

  protected override start(): void {
    if (this.battleController === null) {
      throw new Error('[StageResultService] missing reference: battleController ← 把 Systems 节点拖入该属性槽');
    }
    if (this.progressionSystem === null) {
      throw new Error('[StageResultService] missing reference: progressionSystem ← 把 Systems 节点拖入该属性槽');
    }
    // V08-03：时长与胜利 Boss 来自当局选中关卡（无 Boss 关存活到时长即胜利）。
    const { stage } = ActiveStage.current;
    this.stageDurationSeconds = stage.duration;
    this.bossId = stage.bossId;
    this.starConditions = stage.starConditions;
  }

  protected override onEnable(): void {
    if (this.battleController === null) {
      return;
    }
    this.unsubscribeDied = this.battleController.events.on('monsterDied', (payload) => {
      this.recorder.onMonsterDied(payload.monsterId);
      if (this.bossId !== null && payload.monsterId === this.bossId) {
        this.finish('victory');
      }
    });
    this.unsubscribeExperience = this.battleController.events.on('experienceCollected', (payload) => {
      this.recorder.onExperienceCollected(payload.amount);
    });
    this.unsubscribePlayerDied = this.battleController.events.on('playerDied', () => {
      this.finish('defeat');
    });
    this.unsubscribeHpChanged = this.battleController.events.on('playerHpChanged', (payload) => {
      if (payload.cause === 'damage') {
        this.hitTakenCount += 1;
      }
      this.lastHp = payload.hp;
      this.lastMaxHp = payload.maxHp;
    });
  }

  protected override onDisable(): void {
    this.unsubscribeDied?.();
    this.unsubscribeDied = null;
    this.unsubscribeExperience?.();
    this.unsubscribeExperience = null;
    this.unsubscribePlayerDied?.();
    this.unsubscribePlayerDied = null;
    this.unsubscribeHpChanged?.();
    this.unsubscribeHpChanged = null;
  }

  protected override update(): void {
    if (this.battleController === null || this.hasFinished) {
      return;
    }
    const battleController = this.battleController;
    if (battleController.isSimulationRunning && battleController.battleElapsedTime >= this.stageDurationSeconds) {
      this.finish('victory');
    }
  }

  private finish(result: BattleResult): void {
    if (this.hasFinished || this.battleController === null || this.progressionSystem === null) {
      return;
    }
    this.hasFinished = true;

    const battleController = this.battleController;
    // 三星评定（V08-04）：条件集来自当局关卡；剩余生命取最后已知快照（未受伤=满血）。
    const hpRatio = this.lastMaxHp > 0
      ? Math.min(1, Math.max(0, this.lastHp / this.lastMaxHp))
      : 1;
    const evaluation = evaluateStageStars(this.starConditions, {
      victory: result === 'victory',
      elapsedSeconds: battleController.battleElapsedTime,
      hitTakenCount: this.hitTakenCount,
      hpRatio,
    });
    const stats = this.recorder.finish(
      result,
      battleController.battleElapsedTime,
      this.progressionSystem.level,
      evaluation.stars,
      evaluation.details,
    );
    if (battleController.state !== 'ended') {
      battleController.endBattle();
    }
    battleController.events.emit('battleFinished', { result, stats });
    console.log(
      `[StageResultService] ${result}: time=${stats.elapsedSeconds}s kills=${stats.killCount} ` +
        `xp=${stats.xpCollected} level=${stats.levelReached} stars=${stats.stars}`,
    );
  }
}
