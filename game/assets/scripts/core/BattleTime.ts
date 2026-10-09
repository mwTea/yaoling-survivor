/** Read-only simulation time exposed to battle systems. */
export interface BattleTime {
  readonly deltaTime: number;
  readonly elapsedTime: number;
  readonly isSimulationRunning: boolean;
}

