/**
 * 战斗复活流程纯逻辑（V10-10，GAME_LOOP §6）。
 *
 * 单文件叶子模块（零跨文件值导入，仅类型导入，可被 node 纯逻辑测试直接加载）：
 * - 可提供判定：投放开关 → 每局次数（战斗运行态）→ 每日次数（存档审计）→
 *   不可用关卡；顺序固定，供复活 UI 与死亡门共用。
 * - 次数入存档审计（V10-01 schema v3 的 offerClaims 计数模式，定案记录）：
 *   键 `ad_<placementId>_<dayKey>`、claimCount = 当日已用次数；写入时清理同
 *   投放的其他日键（容量有界）。广告未发奖（closed_early/failed）不调用写入。
 * - 恢复量计算：hp = floor(maxHp × ratio)、无敌秒数直出。
 * - 广告结果 → 发奖凭证判定在 platform/AdAdapter.adResultGrantsReward。
 */
import type { AdReviveConfig } from '../config/ConfigTypes';
import type { AccountSaveData } from '../account/AccountSave';

export interface ReviveBattleRuntime {
  /** 本局已用复活次数（战斗运行态，换局清零；不入存档）。 */
  usedThisBattle: number;
}

export type ReviveOfferCheck =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: 'placement_disabled' | 'per_battle_limit' | 'per_day_limit' | 'stage_disabled';
    };

const AUDIT_KEY_PREFIX = 'ad_';

function auditKey(placementId: string, dayKey: string): string {
  return `${AUDIT_KEY_PREFIX}${placementId}_${dayKey}`;
}

/** 读取当日已用次数（无记录为 0；仅识别本投放的当日键）。 */
export function getDailyAdUses(save: AccountSaveData, placementId: string, dayKey: string): number {
  const entry = save.offerClaims[auditKey(placementId, dayKey)];
  return entry !== undefined ? entry.claimCount : 0;
}

export function canOfferRevive(
  save: AccountSaveData,
  runtime: ReviveBattleRuntime,
  config: AdReviveConfig,
  dayKey: string,
  stageId: string,
  isPlacementEnabled: (placementId: string) => boolean,
): ReviveOfferCheck {
  if (!isPlacementEnabled(config.placementId)) {
    return { ok: false, reason: 'placement_disabled' };
  }
  if (runtime.usedThisBattle >= config.maxPerBattle) {
    return { ok: false, reason: 'per_battle_limit' };
  }
  if (getDailyAdUses(save, config.placementId, dayKey) >= config.maxPerDay) {
    return { ok: false, reason: 'per_day_limit' };
  }
  if (config.disabledStageIds.indexOf(stageId) !== -1) {
    return { ok: false, reason: 'stage_disabled' };
  }
  return { ok: true };
}

/**
 * 记一次已发奖的复活使用（幂等防护：调用方仅在 adResultGrantsReward 为真后
 * 调用一次）；运行态 +1 并写存档审计键，清理同投放其他日键（容量有界）。
 * 直接改写传入存档，落盘由调用方负责。
 */
export function recordReviveUse(
  save: AccountSaveData,
  runtime: ReviveBattleRuntime,
  config: AdReviveConfig,
  placementId: string,
  dayKey: string,
): void {
  runtime.usedThisBattle += 1;
  const key = auditKey(placementId, dayKey);
  const current = save.offerClaims[key];
  save.offerClaims[key] = { claimCount: (current !== undefined ? current.claimCount : 0) + 1 };
  const keepPrefix = `${AUDIT_KEY_PREFIX}${placementId}_`;
  for (const existing of Object.keys(save.offerClaims)) {
    if (existing !== key && existing.indexOf(keepPrefix) === 0) {
      delete save.offerClaims[existing];
    }
  }
}

/** 复活恢复量：hp = floor(maxHp × ratio)、无敌秒数直出（配置校验保证合法）。 */
export function computeReviveRestore(
  config: AdReviveConfig,
  maxHp: number,
): { readonly hp: number; readonly invulnerableSeconds: number } {
  return {
    hp: Math.floor(maxHp * config.hpRestoreRatio),
    invulnerableSeconds: config.invulnerableSeconds,
  };
}
