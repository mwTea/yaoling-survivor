import { _decorator, Component } from 'cc';

import { registerGuideAnchor, unregisterGuideAnchor } from './GuideEvents';

const { ccclass, property } = _decorator;

/**
 * 引导锚点（V10-04）：挂在目标 UI/实体节点上向表现层登记 anchorId。
 * 未知/缺失锚点由 GuideOverlay 回退为屏幕居中气泡（不报错——动态实体
 * 如经验灵珠无法静态挂锚点）。
 * 独立成文件：Cocos 约束每个脚本文件最多一个 Component 类。
 */
@ccclass('GuideAnchor')
export class GuideAnchor extends Component {
  @property
  public anchorId = '';

  protected override onEnable(): void {
    registerGuideAnchor(this.anchorId, this.node);
  }

  protected override onDisable(): void {
    unregisterGuideAnchor(this.anchorId, this.node);
  }
}
