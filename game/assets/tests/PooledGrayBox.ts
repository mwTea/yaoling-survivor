import { _decorator, Component } from 'cc';

import type { PoolAcquireContext, PooledObject } from '../scripts/pooling/PoolTypes';

const { ccclass } = _decorator;

/**
 * 灰盒池化验证组件：T05 用来在 Creator 里观察池生命周期的占位实体，
 * T06 起由真正的怪物/飞剑组件替代。计数器仅供自检夹具断言使用。
 */
@ccclass('PooledGrayBox')
export class PooledGrayBox extends Component implements PooledObject {
  public acquireCount = 0;
  public releaseCount = 0;
  public isAcquired = false;

  public onAcquire(context: PoolAcquireContext): void {
    this.acquireCount += 1;
    this.isAcquired = true;
    this.node.setPosition(0, 0, 0);
    this.node.active = true;
  }

  public onRelease(): void {
    this.releaseCount += 1;
    this.isAcquired = false;
    this.node.setPosition(0, 0, 0);
    this.node.active = false;
  }
}
