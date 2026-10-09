import { _decorator, Component, instantiate, Node, Prefab } from 'cc';

import { InstancePool, PoolRegistry } from './Pools';
import type { PoolKey, PooledObject, PoolOptions, PoolStats } from './PoolTypes';

const { ccclass, property } = _decorator;

/** 构造池化组件的构造器签名；Cocos 组件由引擎以无参构造创建。 */
type ComponentConstructor<TComponent extends Component> = new () => TComponent;

/**
 * 场景级池服务：持有池注册表和实例容器节点，为各战斗系统提供注册入口。
 *
 * 系统初始化时调用 `registerNodePool` 并持有返回的类型化池引用；
 * 战局结束调用 `releaseAllPools` 统一回收，场景销毁时自动清理并报告
 * 未归还实例。池预算数值目前由调用方给出，T07 起改由关卡配置驱动。
 */
@ccclass('PoolService')
export class PoolService extends Component {
  @property({ type: Node })
  private poolRoot: Node | null = null;

  private readonly registry = new PoolRegistry();
  private rootNode: Node | null = null;

  protected override onLoad(): void {
    if (this.poolRoot === null) {
      throw new Error('[PoolService] poolRoot reference is required');
    }
    this.rootNode = this.poolRoot;
  }

  protected override onDestroy(): void {
    const unreturnedCount = this.registry.releaseAll();
    if (unreturnedCount > 0) {
      console.warn(`[PoolService] ${unreturnedCount} pooled instance(s) were still borrowed at teardown`);
    }
    this.registry.disposeAll();
  }

  public registerPool<TObject extends PooledObject>(
    key: PoolKey,
    factory: () => TObject,
    options: PoolOptions,
  ): InstancePool<TObject> {
    return this.registry.register(key, factory, options);
  }

  /** 用 prefab + 组件类型注册节点池；新实例挂 poolRoot 下并保持隐藏，可选用 onCreate 注入依赖。 */
  public registerNodePool<TObject extends PooledObject<TAcquireData> & Component, TAcquireData = void>(
    key: PoolKey,
    prefab: Prefab,
    componentType: ComponentConstructor<TObject>,
    options: PoolOptions,
    onCreate?: (component: TObject) => void,
  ): InstancePool<TObject, TAcquireData> {
    return this.registry.register(
      key,
      this.createNodeFactory<TObject, TAcquireData>(key, prefab, componentType, onCreate),
      options,
    );
  }

  public getPoolStats(key: PoolKey): PoolStats {
    return this.registry.stats(key);
  }

  /** 战局结束统一回收：归还所有池的借出实例，返回归还总数。 */
  public releaseAllPools(): number {
    return this.registry.releaseAll();
  }

  public describePools(): string {
    return this.registry.describeAll();
  }

  private createNodeFactory<TObject extends PooledObject<TAcquireData> & Component, TAcquireData = void>(
    key: PoolKey,
    prefab: Prefab,
    componentType: ComponentConstructor<TObject>,
    onCreate?: (component: TObject) => void,
  ): () => TObject {
    return () => {
      if (this.rootNode === null) {
        throw new Error(`[PoolService] Pool "${key}" factory ran before onLoad resolved poolRoot`);
      }
      const node = instantiate(prefab);
      node.active = false;
      node.setParent(this.rootNode);
      const component = node.getComponent(componentType);
      if (component === null) {
        throw new Error(`[PoolService] Prefab for pool "${key}" is missing component ${componentType.name}`);
      }
      if (onCreate !== undefined) {
        onCreate(component);
      }
      return component;
    };
  }
}
