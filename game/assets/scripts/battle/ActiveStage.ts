import type { StageConfig, StageDifficultyConfig } from '../config/ConfigTypes';
import { INITIAL_GAME_CONFIG } from '../config/GameConfig';

/**
 * 当局关卡运行态（V08-03 战斗装配）：战斗场景内所有系统读取同一份
 * "选中关卡 + 难度档"快照，替代各自直读 `initialStageId` 的旧入口。
 *
 * - `configure` 由账号链路（AccountBattleLink.onLoad）按账号存档的选中状态调用，
 *   onLoad 全部先于 start 执行，因此各系统在 start() 里读取时快照已就绪。
 * - 未配置（直接预览 BattleScene、无账号服务）时回退 `initialStageId` 关卡 +
 *   其首个难度档，保持 V0.1/V0.5 直预览行为。
 * - 配置来自启动期已校验的只读配置，本类不持有可变游戏状态。
 */
export class ActiveStage {
  private static stage: StageConfig | null = null;
  private static difficulty: StageDifficultyConfig | null = null;

  /** 装配当局关卡（须传入已校验配置中的引用）；重复配置以最后一次为准。 */
  public static configure(stage: StageConfig, difficulty: StageDifficultyConfig): void {
    ActiveStage.stage = stage;
    ActiveStage.difficulty = difficulty;
  }

  /** 战斗场景卸载时清空，避免跨局残留（下次进入由装配重新配置）。 */
  public static reset(): void {
    ActiveStage.stage = null;
    ActiveStage.difficulty = null;
  }

  public static get current(): { stage: StageConfig; difficulty: StageDifficultyConfig } {
    if (ActiveStage.stage === null || ActiveStage.difficulty === null) {
      const fallbackStage = INITIAL_GAME_CONFIG.stages.find(
        (candidate) => candidate.id === INITIAL_GAME_CONFIG.initialStageId,
      );
      if (fallbackStage === undefined) {
        throw new Error(
          `[ActiveStage] Initial stage not found: ${INITIAL_GAME_CONFIG.initialStageId}`,
        );
      }
      const fallbackDifficulty = fallbackStage.difficulties[0];
      if (fallbackDifficulty === undefined) {
        throw new Error(`[ActiveStage] Stage "${fallbackStage.id}" has no difficulty tier`);
      }
      return { stage: fallbackStage, difficulty: fallbackDifficulty };
    }
    return { stage: ActiveStage.stage, difficulty: ActiveStage.difficulty };
  }
}
