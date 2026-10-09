import { _decorator, Component, Node, view } from 'cc';

import { ActiveStage } from '../battle/ActiveStage';
import type { RectangleBoundsConfig } from '../config/ConfigTypes';
import { computeWorldOffset } from './CameraFollowMath';
import type { MutableVector2 } from '../shared/Vector2Types';

const { ccclass, property } = _decorator;

/** 跟随平滑系数（越大越紧）；帧率无关的指数插值。 */
const FOLLOW_SPEED = 8;

/**
 * 相机跟随（World 容器方案）：挂在世界容器节点（Player/PoolRoot 的父节点）。
 * 每帧把容器位置平滑推向"视口中心 = 玩家"的反向偏移（夹紧在世界边界内），
 * 屏幕空间 UI（Canvas 下、World 之外）不受影响。使用真实帧时间——暂停时
 * 玩家不动，跟随自然静止。
 */
@ccclass('CameraController')
export class CameraController extends Component {
  @property({ type: Node })
  private playerNode: Node | null = null;

  private readonly targetOffset: MutableVector2 = { x: 0, y: 0 };
  private hasSnapped = false;
  private playArea: RectangleBoundsConfig | null = null;

  protected override start(): void {
    if (this.playerNode === null) {
      throw new Error('[CameraController] missing reference: playerNode ← 把 Player 节点拖入该属性槽');
    }
    // V08-03：边界一次性缓存（此前每帧查询关卡配置，违反热路径约束）。
    this.playArea = ActiveStage.current.stage.playArea;
    this.snapToPlayer();
  }

  protected override update(deltaTime: number): void {
    if (this.playerNode === null || this.playArea === null) {
      return;
    }
    const playArea = this.playArea;
    const visibleSize = view.getVisibleSize();
    computeWorldOffset(
      this.playerNode.position.x,
      this.playerNode.position.y,
      playArea,
      visibleSize.width,
      visibleSize.height,
      this.targetOffset,
    );

    if (!this.hasSnapped) {
      this.snapToPlayer();
      return;
    }

    const smoothing = 1 - Math.exp(-FOLLOW_SPEED * Math.max(0, deltaTime));
    const position = this.node.position;
    this.node.setPosition(
      position.x + (this.targetOffset.x - position.x) * smoothing,
      position.y + (this.targetOffset.y - position.y) * smoothing,
      position.z,
    );
  }

  /** 首帧直接对准玩家，避免开局从原点扫过大半张地图。 */
  private snapToPlayer(): void {
    if (this.playerNode === null || this.playArea === null) {
      return;
    }
    const playArea = this.playArea;
    const visibleSize = view.getVisibleSize();
    computeWorldOffset(
      this.playerNode.position.x,
      this.playerNode.position.y,
      playArea,
      visibleSize.width,
      visibleSize.height,
      this.targetOffset,
    );
    this.node.setPosition(this.targetOffset.x, this.targetOffset.y, this.node.position.z);
    this.hasSnapped = true;
  }
}
