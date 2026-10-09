/** 显式池 key；一个 prefab/类型对应一个 key，运行时用它而非数组下标关联。 */
export type PoolKey = string;

/** 传入 `PooledObject.onAcquire` 的 acquisition 上下文；池保证 key 字段稳定。 */
export interface PoolAcquireContext<TAcquireData = void> {
  readonly poolKey: PoolKey;
  /** `acquire(data)` 传入的获取数据；池不解释其内容，由池化对象按自身协议消费。 */
  readonly data: TAcquireData;
}

/**
 * 池化对象必须实现的统一生命周期协议。
 *
 * - `onAcquire`：每次从池中借出时被调用，必须把实例完整重置为可用状态
 *   （位置/表现、临时状态、计时与事件等）。
 * - `onRelease`：归还池时被调用恰好一次，必须取消计时器、解除事件订阅、
 *   清空目标/配置引用并还原节点表现。不得依赖 `onDestroy` 做这些清理。
 */
export interface PooledObject<TAcquireData = void> {
  onAcquire(context: PoolAcquireContext<TAcquireData>): void;
  onRelease(): void;
}

export interface PoolOptions {
  /** 注册时立即预热的实例数量；必须是非负整数且不大于 `maxCapacity`。 */
  readonly prewarmCount: number;
  /** 单池允许存在的实例总数硬上限；达到上限且无空闲实例时 acquire 快速失败。 */
  readonly maxCapacity: number;
}

/** 池运行诊断快照；仅用于开发期观察与验收，不在每帧热路径读取。 */
export interface PoolStats {
  readonly key: PoolKey;
  readonly createdCount: number;
  readonly borrowedCount: number;
  readonly freeCount: number;
  readonly peakBorrowedCount: number;
  readonly totalAcquireCount: number;
  readonly totalReleaseCount: number;
}
