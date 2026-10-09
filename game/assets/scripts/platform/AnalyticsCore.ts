/**
 * 埋点核心纯逻辑（V10-12，LIVEOPS §6）：事件契约、批量缓冲与频率控制。
 *
 * 单文件叶子模块（零跨文件值导入，仅类型导入，可被 node 纯逻辑测试直接加载）：
 * - **事件契约集中**：`AnalyticsEventName` 为全量稳定事件枚举（新手漏斗六步/
 *   开局/结算/失败原因/Build 选择/资源产消快照/广告结果/购买结果）；
 *   payload 为窄化只读结构（无 any），新增事件必须在此登记。
 * - **批量与频率控制**：normal 优先级事件进环形缓冲（容量 maxBufferSize），
 *   满则丢最旧（记 dropped 计数）；critical 优先级即时逐条上报不缓冲；
 *   flush 按最大批量分批；上报失败整批回填队首保序补投。
 * - 上报通道由 `AnalyticsAdapter` 注入（console 调试实现 + 微信通道装配层
 *   选择），业务代码零 `wx.*`；**埋点失败不阻断任何玩法路径**。
 * - 时间戳由调用方注入；会话 ID 由装配层生成传入。
 */

/** 全量埋点事件名（V1.0 首发；新增事件在此登记并同步 LIVEOPS §6）。 */
export type AnalyticsEventName =
  // —— 新手漏斗（六步最短闭环）——
  | 'guide_move_started' // 首次移动
  | 'guide_attack_fired' // 首次自动攻击
  | 'guide_xp_collected' // 首次拾取
  | 'guide_levelup_resolved' // 首次三选一完成
  | 'guide_settlement_shown' // 首次结算
  | 'guide_cultivate_opened' // 首次培养面板打开
  // —— 对局 ——
  | 'battle_started' // 开局（stage/difficulty/loadout）
  | 'battle_finished' // 结算（result/时长/击杀/经验/星级）
  | 'battle_defeat_reason' // 失败原因
  | 'build_option_chosen' // 三选一选择（局内升级）
  // —— 经济 ——
  | 'resource_snapshot' // 资源产消快照（结算后余额）
  | 'ad_result' // 广告结果（placement/result）
  | 'purchase_result'; // 购买结果（商店/礼包，免费子集）

/** 事件优先级：critical 即时上报不缓冲；normal 进缓冲受频率控制。 */
export type AnalyticsPriority = 'critical' | 'normal';

export type AnalyticsPayloadValue = string | number | boolean | null;

/** 事件载荷（窄化联合：值为原始类型，无 any/对象嵌套）。 */
export interface AnalyticsEvent {
  readonly name: AnalyticsEventName;
  readonly at: number;
  readonly sessionId: string;
  readonly priority: AnalyticsPriority;
  readonly payload: Readonly<Record<string, AnalyticsPayloadValue>>;
}

/** 上报通道（console 调试 / 微信 wx.reportAnalytics 或云开发收集）。 */
export interface AnalyticsAdapter {
  /** 上报一批事件；失败返回 false（缓冲保留补投，不抛错）。 */
  sendBatch(events: readonly AnalyticsEvent[]): Promise<boolean>;
}

export interface AnalyticsBufferConfig {
  /** 环形缓冲容量（满丢最旧）；>0。 */
  readonly maxBufferSize: number;
  /** 单次上报最大批量；>0。 */
  readonly maxBatchSize: number;
}

/** 批量缓冲（纯逻辑）。 */
export class AnalyticsBuffer {
  private readonly config: AnalyticsBufferConfig;
  private readonly queue: AnalyticsEvent[] = [];
  private droppedCount = 0;

  constructor(config: AnalyticsBufferConfig) {
    if (config.maxBufferSize <= 0 || config.maxBatchSize <= 0) {
      throw new Error('[AnalyticsBuffer] maxBufferSize/maxBatchSize must be positive');
    }
    this.config = config;
  }

  /** 入队（环形：满丢最旧并计数）。 */
  public enqueue(event: AnalyticsEvent): void {
    if (this.queue.length >= this.config.maxBufferSize) {
      this.queue.shift();
      this.droppedCount += 1;
    }
    this.queue.push(event);
  }

  /** 取出下一批（≤ maxBatchSize，先进先出）；空缓冲返回空数组。 */
  public nextBatch(): AnalyticsEvent[] {
    return this.queue.splice(0, this.config.maxBatchSize);
  }

  /** 上报失败整批回填队首（保序补投）；超容量从队尾丢弃并计数。 */
  public requeue(events: readonly AnalyticsEvent[]): void {
    this.queue.unshift(...events);
    const overflow = this.queue.length - this.config.maxBufferSize;
    if (overflow > 0) {
      this.queue.splice(this.config.maxBufferSize, overflow);
      this.droppedCount += overflow;
    }
  }

  public get size(): number {
    return this.queue.length;
  }

  public get dropped(): number {
    return this.droppedCount;
  }
}

export function createAnalyticsEvent(
  name: AnalyticsEventName,
  at: number,
  sessionId: string,
  payload: Readonly<Record<string, AnalyticsPayloadValue>>,
  priority: AnalyticsPriority = 'normal',
): AnalyticsEvent {
  return { name, at, sessionId, priority, payload };
}
