/**
 * 埋点上报通道（V10-12，wx 全局绑定层）：console 调试实现（开发期默认，
 * 走查友好）与微信 wx.reportAnalytics 通道（真机自动选择）。业务零 wx.*。
 */
import type { AnalyticsAdapter, AnalyticsEvent } from './AnalyticsCore';

class ConsoleAnalyticsAdapter implements AnalyticsAdapter {
  public sendBatch(events: readonly AnalyticsEvent[]): Promise<boolean> {
    for (const event of events) {
      console.log(`[Analytics] ${event.name} ${JSON.stringify(event.payload)}`);
    }
    return Promise.resolve(true);
  }
}

class WechatAnalyticsAdapter implements AnalyticsAdapter {
  public sendBatch(events: readonly AnalyticsEvent[]): Promise<boolean> {
    const wx = (globalThis as {
      wx?: { reportAnalytics?: (eventName: string, data: Record<string, unknown>) => void };
    }).wx;
    if (wx?.reportAnalytics === undefined) {
      return new ConsoleAnalyticsAdapter().sendBatch(events);
    }
    for (const event of events) {
      wx.reportAnalytics?.(event.name, {
        at: event.at,
        sessionId: event.sessionId,
        ...event.payload,
      });
    }
    return Promise.resolve(true);
  }
}

export function createAnalyticsAdapter(): AnalyticsAdapter {
  const wx = (globalThis as { wx?: unknown }).wx;
  return wx !== undefined ? new WechatAnalyticsAdapter() : new ConsoleAnalyticsAdapter();
}
