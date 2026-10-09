import {
  _decorator,
  Component,
  EventTouch,
  Node,
  UITransform,
  Vec2,
  Vec3,
  view,
} from 'cc';

import type { MutableVector2 } from '../player/MovementInput';
import { applyArtSprite } from './ArtLoader';
import { MovementInputController } from '../player/MovementInputController';
import { resolveVirtualJoystick } from '../player/VirtualJoystickMath';

const { ccclass, property, requireComponent } = _decorator;

@ccclass('VirtualJoystick')
@requireComponent(UITransform)
export class VirtualJoystick extends Component {
  @property({ type: MovementInputController })
  private inputController: MovementInputController | null = null;

  @property({ type: Node })
  private handle: Node | null = null;

  @property({ min: 1, tooltip: '摇杆最大拖动半径，单位为 UI 像素' })
  private radius = 80;

  @property({ range: [0, 0.95], slide: true, tooltip: '相对于半径的输入死区' })
  private deadZoneRatio = 0.15;

  private uiTransform: UITransform | null = null;
  private activeTouchId: number | null = null;
  private readonly uiLocation = new Vec2();
  private readonly worldLocation = new Vec3();
  private readonly localLocation = new Vec3();
  private readonly handlePosition: MutableVector2 = { x: 0, y: 0 };
  private readonly direction: MutableVector2 = { x: 0, y: 0 };

  protected override onLoad(): void {
    this.uiTransform = this.getComponent(UITransform);
    if (this.uiTransform === null) {
      throw new Error('[VirtualJoystick] UITransform is required');
    }
    if (this.inputController === null) {
      throw new Error('[VirtualJoystick] MovementInputController reference is required');
    }
    if (this.handle === null) {
      throw new Error('[VirtualJoystick] Handle node reference is required');
    }
    // 正式美术（V10-14）：底盘/手柄切图；缺图回退灰盒。
    applyArtSprite(this.node, 'joystick_base');
    applyArtSprite(this.handle, 'joystick_stick');
    if (!Number.isFinite(this.radius) || this.radius <= 0) {
      throw new Error(`[VirtualJoystick] radius must be positive, got ${this.radius}`);
    }
    if (!Number.isFinite(this.deadZoneRatio)
      || this.deadZoneRatio < 0
      || this.deadZoneRatio >= 1) {
      throw new Error(`[VirtualJoystick] deadZoneRatio must be in [0, 1), got ${this.deadZoneRatio}`);
    }
  }

  protected override onEnable(): void {
    view.on('canvas-resize', this.layoutJoystick, this);
    this.layoutJoystick();
    this.node.on(Node.EventType.TOUCH_START, this.handleTouchStart, this);
    this.node.on(Node.EventType.TOUCH_MOVE, this.handleTouchMove, this);
    this.node.on(Node.EventType.TOUCH_END, this.handleTouchEnd, this);
    this.node.on(Node.EventType.TOUCH_CANCEL, this.handleTouchEnd, this);
  }

  protected override onDisable(): void {
    view.off('canvas-resize', this.layoutJoystick, this);
    this.node.off(Node.EventType.TOUCH_START, this.handleTouchStart, this);
    this.node.off(Node.EventType.TOUCH_MOVE, this.handleTouchMove, this);
    this.node.off(Node.EventType.TOUCH_END, this.handleTouchEnd, this);
    this.node.off(Node.EventType.TOUCH_CANCEL, this.handleTouchEnd, this);
    this.releaseJoystick();
  }

  private readonly layoutJoystick = (): void => {
    const size = view.getVisibleSize();
    this.node.setPosition(-size.width / 2 + 112, -size.height / 2 + 150, this.node.position.z);
  };

  private handleTouchStart(event: EventTouch): void {
    if (this.activeTouchId !== null) {
      return;
    }
    this.activeTouchId = event.getID() ?? 0;
    this.updateJoystick(event);
  }

  private handleTouchMove(event: EventTouch): void {
    if (!this.isActiveTouch(event)) {
      return;
    }
    this.updateJoystick(event);
  }

  private handleTouchEnd(event: EventTouch): void {
    if (!this.isActiveTouch(event)) {
      return;
    }
    this.releaseJoystick();
  }

  private isActiveTouch(event: EventTouch): boolean {
    return this.activeTouchId !== null && (event.getID() ?? 0) === this.activeTouchId;
  }

  private updateJoystick(event: EventTouch): void {
    if (this.uiTransform === null || this.handle === null || this.inputController === null) {
      return;
    }

    event.getUILocation(this.uiLocation);
    this.worldLocation.set(this.uiLocation.x, this.uiLocation.y, 0);
    this.uiTransform.convertToNodeSpaceAR(this.worldLocation, this.localLocation);
    resolveVirtualJoystick(
      this.localLocation.x,
      this.localLocation.y,
      this.radius,
      this.deadZoneRatio,
      this.handlePosition,
      this.direction,
    );
    this.handle.setPosition(this.handlePosition.x, this.handlePosition.y, this.handle.position.z);
    this.inputController.setJoystickDirection(this.direction.x, this.direction.y);
  }

  private releaseJoystick(): void {
    this.activeTouchId = null;
    this.handle?.setPosition(0, 0, this.handle.position.z);
    this.inputController?.clearJoystickDirection();
  }
}
