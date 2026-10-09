import type { PoolKey, PooledObject, PoolOptions, PoolStats } from './PoolTypes';

/**
 * 池模块所有误用错误的基类，便于调用方统一捕获开发期断言。
 *
 * 运行时类（错误、InstancePool、PoolRegistry）集中在本文件：Node 测试按文件
 * 直接加载 .ts，无扩展名的跨文件值导入无法被 ESM 解析，而 Creator 约定
 * 使用无扩展名导入，因此池的运行时实现保持单文件、零值导入。
 */
export class PoolError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'PoolError';
  }
}

export class PoolRegistrationError extends PoolError {
  public constructor(key: string, reason: string) {
    super(`Pool "${key}" registration failed: ${reason}`);
    this.name = 'PoolRegistrationError';
  }
}

export class PoolKeyError extends PoolError {
  public constructor(key: string) {
    super(`Unknown pool key "${key}"`);
    this.name = 'PoolKeyError';
  }
}

export class PoolCapacityError extends PoolError {
  public constructor(key: string, createdCount: number, maxCapacity: number) {
    super(
      `Pool "${key}" is at capacity: created ${createdCount}/${maxCapacity} instances and none are free. ` +
        'Release an instance or raise the pool budget.',
    );
    this.name = 'PoolCapacityError';
  }
}

export class PoolReleaseError extends PoolError {
  public constructor(key: string, reason: string) {
    super(`Pool "${key}" release rejected: ${reason}`);
    this.name = 'PoolReleaseError';
  }
}

/**
 * 单个 pool key 对应的实例池：预热、借出、归还与开发期诊断。
 *
 * 协议保证：
 * - 借出时必定调用 `onAcquire`（完整重置），归还时必定恰好调用一次 `onRelease`（清理）。
 * - `onAcquire` 抛错时实例回到空闲列表且不计入借出，异常原样上抛。
 * - `onRelease` 抛错时实例保持借出状态，异常原样上抛，不会把半清理实例放回服务。
 * - 重复归还、归还外来实例、容量耗尽均抛出带 key 的明确错误。
 */
export class InstancePool<TObject extends PooledObject<TAcquireData>, TAcquireData = void> {
  public readonly key: PoolKey;

  private readonly factory: () => TObject;
  private readonly maxCapacity: number;
  private readonly freeStack: TObject[] = [];
  private readonly freeSet = new Set<TObject>();
  private readonly borrowedSet = new Set<TObject>();

  private createdCount = 0;
  private totalAcquireCount = 0;
  private totalReleaseCount = 0;
  private peakBorrowedCount = 0;
  private isDisposed = false;

  constructor(key: PoolKey, factory: () => TObject, options: PoolOptions) {
    if (typeof key !== 'string' || key.trim() === '') {
      throw new PoolRegistrationError(key, 'pool key must be a non-empty string');
    }
    if (!Number.isInteger(options.prewarmCount) || options.prewarmCount < 0) {
      throw new PoolRegistrationError(key, `prewarmCount must be a non-negative integer, got ${options.prewarmCount}`);
    }
    if (!Number.isInteger(options.maxCapacity) || options.maxCapacity < 1) {
      throw new PoolRegistrationError(key, `maxCapacity must be an integer >= 1, got ${options.maxCapacity}`);
    }
    if (options.prewarmCount > options.maxCapacity) {
      throw new PoolRegistrationError(
        key,
        `prewarmCount ${options.prewarmCount} must not exceed maxCapacity ${options.maxCapacity}`,
      );
    }

    this.key = key;
    this.factory = factory;
    this.maxCapacity = options.maxCapacity;

    for (let i = 0; i < options.prewarmCount; i += 1) {
      const instance = factory();
      this.freeStack.push(instance);
      this.freeSet.add(instance);
      this.createdCount += 1;
    }
  }

  public get stats(): PoolStats {
    return {
      key: this.key,
      createdCount: this.createdCount,
      borrowedCount: this.borrowedSet.size,
      freeCount: this.freeStack.length,
      peakBorrowedCount: this.peakBorrowedCount,
      totalAcquireCount: this.totalAcquireCount,
      totalReleaseCount: this.totalReleaseCount,
    };
  }

  public acquire(data: TAcquireData): TObject {
    if (this.isDisposed) {
      throw new PoolError(`Pool "${this.key}" is disposed and can no longer acquire`);
    }

    let instance = this.freeStack.pop();
    if (instance === undefined) {
      if (this.createdCount >= this.maxCapacity) {
        throw new PoolCapacityError(this.key, this.createdCount, this.maxCapacity);
      }
      instance = this.factory();
      this.createdCount += 1;
    } else {
      this.freeSet.delete(instance);
    }

    try {
      instance.onAcquire({ poolKey: this.key, data });
    } catch (error) {
      this.freeStack.push(instance);
      this.freeSet.add(instance);
      throw error;
    }

    this.borrowedSet.add(instance);
    this.totalAcquireCount += 1;
    if (this.borrowedSet.size > this.peakBorrowedCount) {
      this.peakBorrowedCount = this.borrowedSet.size;
    }
    return instance;
  }

  public release(instance: TObject): void {
    if (this.isDisposed) {
      throw new PoolError(`Pool "${this.key}" is disposed and can no longer release`);
    }
    if (!this.borrowedSet.has(instance)) {
      if (this.freeSet.has(instance)) {
        throw new PoolReleaseError(this.key, 'instance was already released (double release)');
      }
      throw new PoolReleaseError(this.key, 'instance is not currently borrowed by this pool');
    }

    instance.onRelease();

    this.borrowedSet.delete(instance);
    this.freeSet.add(instance);
    this.freeStack.push(instance);
    this.totalReleaseCount += 1;
  }

  /** 归还当前所有借出实例，返回归还数量；用于战局结束统一回收。 */
  public releaseAll(): number {
    const borrowed = Array.from(this.borrowedSet);
    for (const instance of borrowed) {
      this.release(instance);
    }
    return borrowed.length;
  }

  /** 最终清理：先归还全部借出实例，再清空空闲列表并拒绝后续使用。 */
  public dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this.releaseAll();
    this.freeStack.length = 0;
    this.freeSet.clear();
    this.isDisposed = true;
  }
}

/** 注册表视角的池契约：只需诊断与批量回收；借出通过各系统持有的类型化 `InstancePool` 引用。 */
export interface ManagedPool {
  readonly key: PoolKey;
  readonly stats: PoolStats;
  releaseAll(): number;
  dispose(): void;
}

/**
 * 战局内的池注册表：显式 key 注册、按 key 查询与全局回收/销毁。
 *
 * 使用方式：各系统在初始化时调用 `register` 并持有返回的类型化池引用，
 * 不在热路径按 key 反复查询；`getPool`/`stats` 仅用于诊断和战局收尾。
 */
export class PoolRegistry {
  private readonly pools = new Map<PoolKey, ManagedPool>();

  public register<TObject extends PooledObject<TAcquireData>, TAcquireData = void>(
    key: PoolKey,
    factory: () => TObject,
    options: PoolOptions,
  ): InstancePool<TObject, TAcquireData> {
    if (this.pools.has(key)) {
      throw new PoolRegistrationError(key, 'pool key is already registered');
    }
    const pool = new InstancePool<TObject, TAcquireData>(key, factory, options);
    this.pools.set(key, pool);
    return pool;
  }

  public getPool(key: PoolKey): ManagedPool {
    const pool = this.pools.get(key);
    if (pool === undefined) {
      throw new PoolKeyError(key);
    }
    return pool;
  }

  public stats(key: PoolKey): PoolStats {
    return this.getPool(key).stats;
  }

  public allStats(): readonly PoolStats[] {
    return Array.from(this.pools.values()).map((pool) => pool.stats);
  }

  /** 归还所有池的全部借出实例，返回总归还数。 */
  public releaseAll(): number {
    let total = 0;
    for (const pool of this.pools.values()) {
      total += pool.releaseAll();
    }
    return total;
  }

  public disposeAll(): void {
    for (const pool of this.pools.values()) {
      pool.dispose();
    }
    this.pools.clear();
  }

  /** 开发诊断用多行摘要；仅在关键节点输出，不在每帧调用。 */
  public describeAll(): string {
    return this.allStats()
      .map(
        (stats) =>
          `pool "${stats.key}": created=${stats.createdCount} borrowed=${stats.borrowedCount} ` +
          `free=${stats.freeCount} peak=${stats.peakBorrowedCount} ` +
          `acquires=${stats.totalAcquireCount} releases=${stats.totalReleaseCount}`,
      )
      .join('\n');
  }
}
