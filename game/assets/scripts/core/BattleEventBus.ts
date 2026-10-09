import type { BattleEventMap, BattleEventName } from './BattleEvents';

export type BattleEventListener<K extends BattleEventName> = (payload: BattleEventMap[K]) => void;

/** 内部擦除 key 后的监听器形态；以 never 参数位保证写入端类型安全。 */
type ErasedListener = (payload: never) => void;

/**
 * 类型化战局事件总线：只承载"一件事已经发生"的跨模块事实（见 BattleEventMap）。
 *
 * - 订阅方必须成对解除（on 返回取消函数），或随 dispose 一次性清理；
 *   池化对象在 onRelease 时兜底解除。
 * - emit 使用监听器快照：回调内增删监听不影响本轮已快照的调用集合。
 * - dispose 后 emit 静默忽略（销毁竞态中的在途事件），dispose 后再订阅视为
 *   开发期误用并抛错。
 */
export class BattleEventBus {
  private readonly listeners = new Map<BattleEventName, Set<ErasedListener>>();
  private disposed = false;

  public on<K extends BattleEventName>(name: K, listener: BattleEventListener<K>): () => void {
    if (this.disposed) {
      throw new Error('[BattleEventBus] subscribe after dispose');
    }
    let bucket = this.listeners.get(name);
    if (bucket === undefined) {
      bucket = new Set<ErasedListener>();
      this.listeners.set(name, bucket);
    }
    bucket.add(listener as ErasedListener);
    return (): void => {
      this.off(name, listener);
    };
  }

  public off<K extends BattleEventName>(name: K, listener: BattleEventListener<K>): void {
    const bucket = this.listeners.get(name);
    if (bucket === undefined) {
      return;
    }
    bucket.delete(listener as ErasedListener);
    if (bucket.size === 0) {
      this.listeners.delete(name);
    }
  }

  public emit<K extends BattleEventName>(name: K, payload: BattleEventMap[K]): void {
    if (this.disposed) {
      return;
    }
    const bucket = this.listeners.get(name);
    if (bucket === undefined || bucket.size === 0) {
      return;
    }
    const snapshot = Array.from(bucket);
    for (const listener of snapshot) {
      listener(payload as never);
    }
  }

  public dispose(): void {
    this.listeners.clear();
    this.disposed = true;
  }
}
