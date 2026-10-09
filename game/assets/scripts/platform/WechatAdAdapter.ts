import { MockAdAdapter } from './AdAdapter';
import type { AdAdapter, AdShowResult } from './AdAdapter';

/**
 * 微信激励视频实现（V10-10，wx 全局绑定层）：wx.createRewardedVideoAd
 * 按 placement 复用单例；onClose 的 isEnded 是发奖唯一依据
 * （中途关闭 → closed_early，不发奖不扣次数）；onError → failed。
 * adUnitId 来自 GameConfig.ads.placements（空/未配置 → failed，不连播）。
 * 任何失败不抛错；业务代码零 `wx.*`。
 */

interface WxRewardedVideoAd {
  load?: () => Promise<void>;
  show?: () => Promise<void>;
  onClose?: (handler: (res: { isEnded?: boolean }) => void) => void;
  offClose?: (handler: (res: { isEnded?: boolean }) => void) => void;
  onError?: (handler: (err: { errMsg?: string }) => void) => void;
  offError?: (handler: (err: { errMsg?: string }) => void) => void;
}

interface WxAdGlobal {
  createRewardedVideoAd?: (options: { adUnitId: string }) => WxRewardedVideoAd;
}

export class WechatRewardedAdAdapter implements AdAdapter {
  private readonly adUnitIds: ReadonlyMap<string, string>;
  private readonly instances = new Map<string, WxRewardedVideoAd>();

  constructor(adUnitIds: ReadonlyMap<string, string>) {
    this.adUnitIds = adUnitIds;
  }

  public load(placementId: string): Promise<boolean> {
    const ad = this.instanceOf(placementId);
    if (ad === null || ad.load === undefined) {
      return Promise.resolve(false);
    }
    return ad
      .load()
      .then(() => true)
      .catch(() => false);
  }

  public show(placementId: string): Promise<AdShowResult> {
    const ad = this.instanceOf(placementId);
    if (ad === null || ad.show === undefined || ad.onClose === undefined) {
      return Promise.resolve('failed');
    }
    return new Promise<AdShowResult>((resolve) => {
      let settled = false;
      const closeHandler = (res: { isEnded?: boolean }): void => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(res.isEnded === true ? 'rewarded' : 'closed_early');
      };
      const errorHandler = (): void => {
        if (settled) {
          return;
        }
        settled = true;
        resolve('failed');
      };
      ad.onClose?.(closeHandler);
      ad.onError?.(errorHandler);
      ad
        .show?.()
        .then(() => {
          // show 成功：等待 onClose/onError；无超时自动失败（用户可关闭广告）。
        })
        .catch(() => {
          if (settled) {
            return;
          }
          // 展示失败尝试重载一次后仍以失败结束（不连播）。
          this.load(placementId).then(() => {
            ad
              .show?.()
              .then(() => {
                // 二次展示成功：等待关闭回调。
              })
              .catch(() => {
                if (!settled) {
                  settled = true;
                  resolve('failed');
                }
              });
          });
        });
    });
  }

  private instanceOf(placementId: string): WxRewardedVideoAd | null {
    const existing = this.instances.get(placementId);
    if (existing !== undefined) {
      return existing;
    }
    const adUnitId = this.adUnitIds.get(placementId);
    const wx = (globalThis as { wx?: WxAdGlobal }).wx;
    if (adUnitId === undefined || adUnitId.length === 0 || wx?.createRewardedVideoAd === undefined) {
      return null;
    }
    const instance = wx.createRewardedVideoAd({ adUnitId });
    if (instance === undefined) {
      return null;
    }
    this.instances.set(placementId, instance);
    return instance;
  }
}

/**
 * 广告适配器工厂：placement 的 adUnitId 均未配置（首发占位）或无 wx 环境
 * 时回退 Mock（日志标注【模拟广告】）；真机 + 正式 adUnitId 后自动走真实广告。
 */
export function createAdAdapter(
  adUnitIds: ReadonlyMap<string, string>,
): AdAdapter {
  const wx = (globalThis as { wx?: WxAdGlobal }).wx;
  let hasRealUnit = false;
  for (const unitId of adUnitIds.values()) {
    if (unitId.length > 0) {
      hasRealUnit = true;
      break;
    }
  }
  if (wx !== undefined && wx.createRewardedVideoAd !== undefined && hasRealUnit) {
    return new WechatRewardedAdAdapter(adUnitIds);
  }
  console.log('[Ads] no wx/ad-unit environment, using MockAdAdapter (dev preview)');
  return new MockAdAdapter();
}
