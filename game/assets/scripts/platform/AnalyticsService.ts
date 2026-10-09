import { _decorator, Component, director } from 'cc';

import { AnalyticsBuffer, createAnalyticsEvent } from './AnalyticsCore';
import { createAnalyticsAdapter } from './AnalyticsChannel';
import type { AnalyticsAdapter, AnalyticsEvent, AnalyticsEventName, AnalyticsPayloadValue, AnalyticsPriority } from './AnalyticsCore';

const { ccclass, property } = _decorator;

const FLUSH_INTERVAL_SECONDS = 30;
const MAX_BUFFER_SIZE = 128;
const MAX_BATCH_SIZE = 16;

/**
 * 埋点服务（V10-12，cc 装配层）：`trackAnalytics(name, payload)` 唯一业务
 * 入口——critical 即时上报、normal 进缓冲定时 flush（30s）；失败回填保序
 * 补投，**永不抛错、永不阻断玩法**（未装配时全局入口静默 no-op）。
 * 通道装配：Creator/无 wx 用 console 适配（走查友好）；真机自动切
 * wx.reportAnalytics（wx 集中在适配层）。会话 ID 首启生成；退场由
 * AccountSystem.onDestroy 调 flushNow 收尾。
 */
@ccclass('AnalyticsService')
export class AnalyticsService extends Component {
  /** 勾选后随 AccountRoot persist 跨场景常驻。 */
  @property
  private persistent = false;

  public static instance: AnalyticsService | null = null;

  private buffer = new AnalyticsBuffer({ maxBufferSize: MAX_BUFFER_SIZE, maxBatchSize: MAX_BATCH_SIZE });
  private adapter: AnalyticsAdapter = createAnalyticsAdapter();
  private sessionId = '';
  private flushing = false;

  protected override onLoad(): void {
    if (AnalyticsService.instance !== null && AnalyticsService.instance !== this) {
      this.node.destroy();
      return;
    }
    AnalyticsService.instance = this;
    if (this.persistent) {
      director.addPersistRootNode(this.node);
    }
    this.sessionId = `sess_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
    this.schedule(() => void this.flushNow(), FLUSH_INTERVAL_SECONDS);
  }

  protected override onDestroy(): void {
    if (AnalyticsService.instance === this) {
      AnalyticsService.instance = null;
    }
  }

  /** 业务唯一入口：critical 即时上报；normal 缓冲。永不抛错。 */
  public track(
    name: AnalyticsEventName,
    payload: Readonly<Record<string, AnalyticsPayloadValue>>,
    priority: AnalyticsPriority = 'normal',
  ): void {
    const event = createAnalyticsEvent(name, Date.now(), this.sessionId, payload, priority);
    if (priority === 'critical') {
      void this.sendBatch([event]);
      return;
    }
    this.buffer.enqueue(event);
  }

  /** 立即清空缓冲（定时器/退场调用）；失败回填保序。 */
  public async flushNow(): Promise<void> {
    if (this.flushing) {
      return;
    }
    this.flushing = true;
    try {
      let batch = this.buffer.nextBatch();
      while (batch.length > 0) {
        const ok = await this.sendBatch(batch);
        if (!ok) {
          this.buffer.requeue(batch);
          break;
        }
        batch = this.buffer.nextBatch();
      }
    } finally {
      this.flushing = false;
    }
  }

  private async sendBatch(events: readonly AnalyticsEvent[]): Promise<boolean> {
    try {
      return await this.adapter.sendBatch(events);
    } catch {
      return false;
    }
  }
}

/** 便捷空安全入口（未装配时静默 no-op——埋点绝不阻断玩法）。 */
export function trackAnalytics(
  name: AnalyticsEventName,
  payload: Readonly<Record<string, AnalyticsPayloadValue>>,
  priority: AnalyticsPriority = 'normal',
): void {
  AnalyticsService.instance?.track(name, payload, priority);
}
