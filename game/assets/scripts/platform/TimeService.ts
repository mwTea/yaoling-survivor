/**
 * 时间服务（V08-07 建立，V10-08 升级为"服务器时间 + 单调偏移"）：全仓时间
 * 读取的唯一入口——`now()` 当前毫秒、`dayKey()` 本地自然日 key（yyyy-MM-dd）、
 * `weekKey()` 本地自然周 key（本周周一，可按字典序比较）。接口不变，
 * 业务零改动（V08 已知妥协就此收敛：任务/商店/签到/活动全部经本服务取"当天"）。
 *
 * V10-08 时间语义：
 * - `syncWithServer(serverNowMs)`：云函数（`cloudfunctions/time/`）返回服务器
 *   毫秒后写入偏移（offset = 服务器 − 本地时钟）；此后 now() = 本地时钟 + 偏移。
 * - 输出单调：now() 恒不小于上次接受值（微小抖动被钳制）。
 * - **明显回拨检测 → 安全降级**：now() 较上次接受值回退超过
 *   SERVER_TIME_ROLLBACK_THRESHOLD_MS（用户手改设备时钟等）时进入 frozen 态，
 *   时间冻结在上次可信值——dayKey/weekKey 随之冻结（商店/签到按上次可信
 *   "当天"冻结，不自行发奖、不触发周期重置），待时钟追上或重新校时恢复。
 * - **断网容错（降级态记录）**：未同步（status 'local'）或同步后断网期间，
 *   偏移持续可用；status 供装配层诊断输出，业务不分支。
 * - 同步通道在 `platform/ServerTimeSync.ts`（wx 绑定层），业务零 `wx.*`。
 *
 * 业务代码禁止直读 `Date`（唯一实现点为本文件 + AccountStore 装配默认值）。
 * 叶子模块：零跨文件值导入，可被 node 纯逻辑测试直接加载（注入时钟）。
 */

export type Clock = () => number;

const SYSTEM_CLOCK: Clock = () => Date.now();

/** 回拨判定阈值：回退超过该值视为"明显回拨"（毫秒）；微小抖动直接钳制。 */
export const SERVER_TIME_ROLLBACK_THRESHOLD_MS = 60_000;

export type TimeServiceStatus = 'local' | 'synced' | 'frozen';

export class TimeService {
  private readonly clock: Clock;
  private offsetMs = 0;
  private lastAcceptedNow = -1;
  private status: TimeServiceStatus = 'local';
  private statusBeforeFrozen: TimeServiceStatus = 'local';

  constructor(clock: Clock = SYSTEM_CLOCK) {
    this.clock = clock;
  }

  /** 当前时间（epoch 毫秒；服务器偏移校准 + 输出单调 + 明显回拨冻结）。 */
  now(): number {
    const raw = this.clock() + this.offsetMs;
    if (this.lastAcceptedNow >= 0 && raw < this.lastAcceptedNow - SERVER_TIME_ROLLBACK_THRESHOLD_MS) {
      this.statusBeforeFrozen = this.status === 'frozen' ? this.statusBeforeFrozen : this.status;
      this.status = 'frozen';
      return this.lastAcceptedNow;
    }
    this.lastAcceptedNow = this.lastAcceptedNow < 0 ? raw : Math.max(this.lastAcceptedNow, raw);
    if (this.status === 'frozen') {
      this.status = this.statusBeforeFrozen;
    }
    return this.lastAcceptedNow;
  }

  /**
   * 服务器校时（云函数返回服务器毫秒后调用）：重算偏移、解除冻结、
   * 以服务器值为新的可信锚点。非法值忽略（不破坏当前状态）。
   */
  syncWithServer(serverNowMs: number): void {
    if (!Number.isFinite(serverNowMs) || serverNowMs <= 0) {
      return;
    }
    this.offsetMs = serverNowMs - this.clock();
    this.lastAcceptedNow = serverNowMs;
    this.status = 'synced';
  }

  /** 时间状态（诊断/降级态记录用）：local=未校时、synced=已校时、frozen=回拨冻结。 */
  get timeStatus(): TimeServiceStatus {
    return this.status;
  }

  /** 最近一次可信时间锚点（毫秒）；从未校时且未读 now() 时为 -1。 */
  get lastTrustedNow(): number {
    return this.lastAcceptedNow;
  }

  /** 当前服务器偏移（毫秒；诊断用）。 */
  get serverOffsetMs(): number {
    return this.offsetMs;
  }

  /** 本地自然日 key：yyyy-MM-dd（本地时区；回拨冻结期间保持上次可信日）。 */
  dayKey(timestamp: number = this.now()): string {
    const date = new Date(timestamp);
    return formatDayKey(date.getFullYear(), date.getMonth() + 1, date.getDate());
  }

  /** 本地自然周 key：本周周一的 dayKey（周一为一周起点）。 */
  weekKey(timestamp: number = this.now()): string {
    const date = new Date(timestamp);
    const daysSinceMonday = (date.getDay() + 6) % 7;
    const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - daysSinceMonday);
    return formatDayKey(monday.getFullYear(), monday.getMonth() + 1, monday.getDate());
  }
}

function formatDayKey(year: number, month: number, day: number): string {
  const monthText = month < 10 ? `0${month}` : `${month}`;
  const dayText = day < 10 ? `0${day}` : `${day}`;
  return `${year}-${monthText}-${dayText}`;
}
