import type { BattleState } from './BattleState';

export type BattleStateListener = (previous: BattleState, current: BattleState) => void;

const ALLOWED_TRANSITIONS: Readonly<Record<BattleState, readonly BattleState[]>> = {
  booting: ['running', 'ended'],
  running: ['level_up_paused', 'ended'],
  level_up_paused: ['running', 'ended'],
  ended: [],
};

export class BattleStateTransitionError extends Error {
  public constructor(previous: BattleState, next: BattleState) {
    super(`Illegal battle state transition: ${previous} -> ${next}`);
    this.name = 'BattleStateTransitionError';
  }
}

/** Owns the only legal transition path for one battle run. */
export class BattleSession {
  private currentState: BattleState = 'booting';
  private readonly listeners = new Set<BattleStateListener>();

  public get state(): BattleState {
    return this.currentState;
  }

  public get isSimulationRunning(): boolean {
    return this.currentState === 'running';
  }

  public start(): void {
    this.transitionTo('running');
  }

  public pauseForLevelUp(): void {
    this.transitionTo('level_up_paused');
  }

  public resumeAfterLevelUp(): void {
    this.transitionTo('running');
  }

  public end(): void {
    this.transitionTo('ended');
  }

  public subscribe(listener: BattleStateListener): () => void {
    this.listeners.add(listener);
    return (): void => {
      this.listeners.delete(listener);
    };
  }

  public dispose(): void {
    this.listeners.clear();
  }

  private transitionTo(next: BattleState): void {
    const previous = this.currentState;
    if (ALLOWED_TRANSITIONS[previous].indexOf(next) < 0) {
      throw new BattleStateTransitionError(previous, next);
    }

    this.currentState = next;
    for (const listener of Array.from(this.listeners)) {
      listener(previous, next);
    }
  }
}
