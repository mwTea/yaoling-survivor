/** Stable battle states shared by rules and presentation adapters. */
export const BattleState = {
  Booting: 'booting',
  Running: 'running',
  LevelUpPaused: 'level_up_paused',
  Ended: 'ended',
} as const;

export type BattleState = (typeof BattleState)[keyof typeof BattleState];

