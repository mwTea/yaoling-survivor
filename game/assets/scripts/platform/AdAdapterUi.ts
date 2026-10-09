import { createAdAdapter } from './WechatAdAdapter';
import type { AdAdapter, AdShowResult } from './AdAdapter';
import { INITIAL_GAME_CONFIG } from '../config/GameConfig';
import { trackAnalytics } from './AnalyticsService';

/**
 * 广告适配器共享单例（V10-10/11）：三个投放（复活/结算加成/每日资源）共用
 * 同一 AdAdapter 实例（微信实现内部按 placement 复用底层广告对象；Mock
 * 同样共享）。业务代码经本入口取适配器，避免各 UI 点各自创建。
 */
let sharedAdapter: AdAdapter | null = null;

/**
 * 带埋点的展示包装（V10-12）：三个投放统一经此入口，广告结果埋点
 * （ad_result）单点接线；业务仍用返回值判定发奖，互不影响。
 */
class AnalyticsTrackedAdapter implements AdAdapter {
  private readonly inner: AdAdapter;

  constructor(inner: AdAdapter) {
    this.inner = inner;
  }

  public load(placementId: string): Promise<boolean> {
    return this.inner.load(placementId);
  }

  public async show(placementId: string): Promise<AdShowResult> {
    let result: AdShowResult;
    try {
      result = await this.inner.show(placementId);
    } catch {
      result = 'failed';
    }
    trackAnalytics('ad_result', { placementId, result });
    return result;
  }
}

export function createAdAdapterProxy(): AdAdapter {
  if (sharedAdapter === null) {
    const unitIds = new Map<string, string>();
    for (const placement of INITIAL_GAME_CONFIG.ads.placements) {
      unitIds.set(placement.id, placement.adUnitId);
    }
    sharedAdapter = new AnalyticsTrackedAdapter(createAdAdapter(unitIds));
  }
  return sharedAdapter;
}

export { adResultGrantsReward } from './AdAdapter';
