import { _decorator, Component } from 'cc';

import { TargetRegistry } from './TargetRegistry';

const { ccclass } = _decorator;

/**
 * 场级目标注册表持有者：挂在 Systems 节点上，刷怪/武器等系统通过显式引用
 * 共享同一注册表实例（怪物注册/注销、T09 目标查询）。
 */
@ccclass('TargetRegistryComponent')
export class TargetRegistryComponent extends Component {
  private readonly instance = new TargetRegistry();

  public get registry(): TargetRegistry {
    return this.instance;
  }
}
