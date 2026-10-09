/**
 * 广告适配层（V10-10）：激励广告接口、结果契约、奖励凭证判定与模拟实现。
 *
 * 单文件叶子模块（零跨文件值导入，仅类型导入，可被 node 纯逻辑测试直接加载）：
 * - `AdAdapter`：load（预加载）/ show（展示至关闭）。实现不得抛错——失败以
 *   'failed' 返回；'rewarded' 是发奖唯一凭证（中途关闭 closed_early 不发奖）。
 * - `adResultGrantsReward`：结果 → 是否发奖的唯一点。
 * - `MockAdAdapter`：Creator/无广告环境用，默认发奖并可注入关闭/失败，
 *   日志明确标注【模拟广告】。
 *
 * 微信激励视频实现（wx.createRewardedVideoAd 单例）在 `platform/WechatAdAdapter.ts`；
 * 广告位配置（adUnitId/开关）来自 GameConfig.ads.placements。
 */

export type AdShowResult = 'rewarded' | 'closed_early' | 'failed';

export interface AdAdapter {
  /** 预加载广告（可重复调用；失败返回 false，展示时实现方应自行重试一次）。 */
  load(placementId: string): Promise<boolean>;
  /** 展示广告并等待关闭；rewarded = 完整观看（发奖唯一凭证）。 */
  show(placementId: string): Promise<AdShowResult>;
}

/** 奖励凭证判定（唯一点）：仅完整观看发奖；中途关闭/失败不发奖、不扣次数。 */
export function adResultGrantsReward(result: AdShowResult): boolean {
  return result === 'rewarded';
}

export type MockAdOutcome = 'rewarded' | 'closed_early' | 'failed';

/** 模拟实现：默认完整观看发奖；日志带【模拟广告】标记（防误当真实发奖）。 */
export class MockAdAdapter implements AdAdapter {
  private outcome: MockAdOutcome;

  constructor(outcome: MockAdOutcome = 'rewarded') {
    this.outcome = outcome;
  }

  public setOutcome(outcome: MockAdOutcome): void {
    this.outcome = outcome;
  }

  public load(_placementId: string): Promise<boolean> {
    console.log('【模拟广告】load（Creator/工具预览模拟实现，非真实广告）');
    return Promise.resolve(true);
  }

  public show(placementId: string): Promise<AdShowResult> {
    console.log(`【模拟广告】show ${placementId} → ${this.outcome}（Creator/工具预览模拟实现，非真实广告）`);
    return Promise.resolve(this.outcome);
  }
}
