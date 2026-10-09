import { _decorator, Component } from 'cc';

import { assertValidGameConfig, INITIAL_GAME_CONFIG } from '../config';
import { BattleEventBus } from '../core/BattleEventBus';
import { ActiveStage } from './ActiveStage';
import { AccountSystem } from '../account/AccountSystem';
import { trackAnalytics } from '../platform/AnalyticsService';
import {
  BattleSession,
  type BattleState,
  type BattleStateListener,
  SimulationClock,
} from '../core';

const { ccclass } = _decorator;

@ccclass('BattleController')
export class BattleController extends Component {
  private readonly session = new BattleSession();
  private readonly clock = new SimulationClock();
  private readonly eventBus = new BattleEventBus();

  /** 战局级跨模块事件总线；订阅方负责成对解除，场景销毁时统一清理。 */
  public get events(): BattleEventBus {
    return this.eventBus;
  }

  public get state(): BattleState {
    return this.session.state;
  }

  public get battleDeltaTime(): number {
    return this.clock.deltaTime;
  }

  public get battleElapsedTime(): number {
    return this.clock.elapsedTime;
  }

  public get isSimulationRunning(): boolean {
    return this.clock.isSimulationRunning;
  }

  protected override onLoad(): void {
    assertValidGameConfig(INITIAL_GAME_CONFIG);
    this.session.subscribe(this.handleStateChanged);
  }

  private readonly handleStateChanged = (previous: BattleState, current: BattleState): void => {
    this.eventBus.emit('battleStateChanged', { previous, current });
  };

  protected override start(): void {
    this.session.start();
    // 开局埋点（V10-12，LIVEOPS §6）：stage/difficulty/loadout 概要。
    const { stage, difficulty } = ActiveStage.current;
    const account = AccountSystem.instance;
    trackAnalytics('battle_started', {
      stageId: stage.id,
      difficultyId: difficulty.id,
      playerLevel: account?.accountSave?.playerLevel ?? 1,
      realmIndex: account?.accountSave?.realmIndex ?? 0,
      deployedBeastId: account?.accountSave?.deployedBeastId ?? '',
    });
  }

  protected override update(realDeltaTime: number): void {
    this.clock.advance(realDeltaTime, this.session.state);
  }

  protected override onDestroy(): void {
    if (this.session.state !== 'ended') {
      this.session.end();
    }
    this.session.dispose();
    this.clock.reset();
    this.eventBus.dispose();
  }

  public subscribeToState(listener: BattleStateListener): () => void {
    return this.session.subscribe(listener);
  }

  public pauseForLevelUp(): void {
    this.session.pauseForLevelUp();
  }

  public resumeAfterLevelUp(): void {
    this.session.resumeAfterLevelUp();
  }

  public endBattle(): void {
    this.session.end();
  }
}
