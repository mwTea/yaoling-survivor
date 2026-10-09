import type { BattleState } from './BattleState';
import type { BattleTime } from './BattleTime';

/** Converts real frame time into pausable battle-simulation time. */
export class SimulationClock implements BattleTime {
  private frameDeltaTime = 0;
  private totalElapsedTime = 0;
  private running = false;

  public get deltaTime(): number {
    return this.frameDeltaTime;
  }

  public get elapsedTime(): number {
    return this.totalElapsedTime;
  }

  public get isSimulationRunning(): boolean {
    return this.running;
  }

  public advance(realDeltaTime: number, state: BattleState): void {
    if (!Number.isFinite(realDeltaTime) || realDeltaTime < 0) {
      throw new RangeError(`realDeltaTime must be finite and non-negative, got ${realDeltaTime}`);
    }

    this.running = state === 'running';
    this.frameDeltaTime = this.running ? realDeltaTime : 0;
    this.totalElapsedTime += this.frameDeltaTime;
  }

  public reset(): void {
    this.frameDeltaTime = 0;
    this.totalElapsedTime = 0;
    this.running = false;
  }
}

