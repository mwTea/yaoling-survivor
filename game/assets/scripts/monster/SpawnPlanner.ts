import type { RandomSource } from '../core/RandomSource';
import type { RectangleBoundsConfig, SpawnWaveConfig, StageConfig, WeightedMonster } from '../config/ConfigTypes';

export interface SpawnRequest {
  readonly monsterId: string;
  readonly elite: boolean;
  readonly x: number;
  readonly y: number;
}

const MAX_SAFETY_RETRIES = 4;
const EMPTY_REQUESTS: readonly SpawnRequest[] = [];

/**
 * 纯 TS 刷怪规划器：按战斗时间推进波次节奏，产出出生请求。
 *
 * 调用方只用战斗 delta 驱动（暂停时 delta 为 0，节奏与计时自然冻结，
 * 恢复后不补积压）。规则：
 * - 当前时间落在某个 wave 的 [startTime, endTime) 才生成；找不到则不生成。
 * - 一次 advance 最多产出一批；超出间隔的时间不结转，单帧大 delta 或长暂停
 *   后都不会补发积压批次。
 * - 存活数达到软上限时跳过本批并重置节奏，容量恢复后按正常间隔继续。
 * - 出生点在玩家周围 [spawnMinRadius, spawnMaxRadius] 环带内，被关卡边界
 *   夹紧；若夹紧后贴近玩家碰撞范围则按序重试（消耗随机数的顺序固定，
 *   相同随机序列结果完全可复现）。
 */
export class SpawnPlanner {
  private elapsedBattleTime = 0;
  private intervalTimer = 0;
  private readonly stage: StageConfig;
  private readonly waves: readonly SpawnWaveConfig[];
  private readonly random: RandomSource;
  private readonly minSafeDistance: number;

  constructor(stage: StageConfig, waves: readonly SpawnWaveConfig[], random: RandomSource, minSafeDistance: number) {
    this.stage = stage;
    this.waves = waves;
    this.random = random;
    this.minSafeDistance = minSafeDistance;
  }

  public get elapsedTime(): number {
    return this.elapsedBattleTime;
  }

  public advance(
    deltaTime: number,
    activeCount: number,
    playerX: number,
    playerY: number,
  ): readonly SpawnRequest[] {
    if (deltaTime <= 0) {
      return EMPTY_REQUESTS;
    }
    this.elapsedBattleTime += deltaTime;

    const wave = this.findActiveWave();
    if (wave === null) {
      this.intervalTimer = 0;
      return EMPTY_REQUESTS;
    }

    this.intervalTimer += deltaTime;
    if (this.intervalTimer < wave.spawnInterval) {
      return EMPTY_REQUESTS;
    }
    this.intervalTimer = 0;

    const availableCount = this.stage.activeMonsterSoftCap - activeCount;
    if (availableCount <= 0) {
      return EMPTY_REQUESTS;
    }

    const spawnCount = Math.min(wave.batchSize, availableCount);
    const requests: SpawnRequest[] = [];
    for (let i = 0; i < spawnCount; i += 1) {
      const entry = pickWeightedMonster(wave, this.random);
      const position = pickSpawnPosition(playerX, playerY, this.stage, this.random, this.minSafeDistance);
      requests.push({ monsterId: entry.monsterId, elite: entry.elite === true, x: position.x, y: position.y });
    }
    return requests;
  }

  private findActiveWave(): SpawnWaveConfig | null {
    for (const wave of this.waves) {
      if (this.elapsedBattleTime >= wave.startTime && this.elapsedBattleTime < wave.endTime) {
        return wave;
      }
    }
    return null;
  }
}

/** 随机消耗契约：单一怪物条目不消耗随机数；多Entries恰好消耗一个。 */
function pickWeightedMonster(wave: SpawnWaveConfig, random: RandomSource): WeightedMonster {
  const firstEntry = wave.monsters[0];
  if (wave.monsters.length === 1 && firstEntry !== undefined) {
    return firstEntry;
  }

  let totalWeight = 0;
  for (const entry of wave.monsters) {
    totalWeight += entry.weight;
  }
  const roll = random.next() * totalWeight;

  let cumulativeWeight = 0;
  let lastEntry: WeightedMonster | undefined;
  for (const entry of wave.monsters) {
    cumulativeWeight += entry.weight;
    lastEntry = entry;
    if (roll < cumulativeWeight) {
      return entry;
    }
  }
  const fallback = lastEntry;
  if (fallback === undefined) {
    throw new Error(`Wave "${wave.id}" has no monster entries`);
  }
  return fallback;
}

/** 随机消耗契约：每次尝试恰好消耗两个随机数（角度、半径比例）。 */
function pickSpawnPosition(
  playerX: number,
  playerY: number,
  stage: StageConfig,
  random: RandomSource,
  minSafeDistance: number,
): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (let attempt = 0; attempt < MAX_SAFETY_RETRIES; attempt += 1) {
    const angle = random.next() * Math.PI * 2;
    const radius = stage.spawnMinRadius + random.next() * (stage.spawnMaxRadius - stage.spawnMinRadius);
    x = clamp(playerX + Math.cos(angle) * radius, stage.playArea.minX, stage.playArea.maxX);
    y = clamp(playerY + Math.sin(angle) * radius, stage.playArea.minY, stage.playArea.maxY);
    const distance = Math.hypot(x - playerX, y - playerY);
    if (distance >= minSafeDistance) {
      return { x, y };
    }
  }
  return { x, y };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
