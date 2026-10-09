import {
  _decorator,
  Component,
  EventKeyboard,
  input,
  Input,
  KeyCode,
} from 'cc';

import { MovementInputController } from './MovementInputController';

const { ccclass, requireComponent } = _decorator;

@ccclass('KeyboardMovementAdapter')
@requireComponent(MovementInputController)
export class KeyboardMovementAdapter extends Component {
  private inputController: MovementInputController | null = null;
  private isLeftPressed = false;
  private isRightPressed = false;
  private isUpPressed = false;
  private isDownPressed = false;

  protected override onLoad(): void {
    this.inputController = this.getComponent(MovementInputController);
    if (this.inputController === null) {
      throw new Error('[KeyboardMovementAdapter] MovementInputController is required');
    }
  }

  protected override onEnable(): void {
    input.on(Input.EventType.KEY_DOWN, this.handleKeyDown, this);
    input.on(Input.EventType.KEY_UP, this.handleKeyUp, this);
  }

  protected override onDisable(): void {
    input.off(Input.EventType.KEY_DOWN, this.handleKeyDown, this);
    input.off(Input.EventType.KEY_UP, this.handleKeyUp, this);
    this.clearKeys();
  }

  private handleKeyDown(event: EventKeyboard): void {
    this.setKey(event.keyCode, true);
  }

  private handleKeyUp(event: EventKeyboard): void {
    this.setKey(event.keyCode, false);
  }

  private setKey(keyCode: KeyCode, isPressed: boolean): void {
    switch (keyCode) {
      case KeyCode.KEY_A:
      case KeyCode.ARROW_LEFT:
        this.isLeftPressed = isPressed;
        break;
      case KeyCode.KEY_D:
      case KeyCode.ARROW_RIGHT:
        this.isRightPressed = isPressed;
        break;
      case KeyCode.KEY_W:
      case KeyCode.ARROW_UP:
        this.isUpPressed = isPressed;
        break;
      case KeyCode.KEY_S:
      case KeyCode.ARROW_DOWN:
        this.isDownPressed = isPressed;
        break;
      default:
        return;
    }
    this.publishDirection();
  }

  private publishDirection(): void {
    const horizontal = Number(this.isRightPressed) - Number(this.isLeftPressed);
    const vertical = Number(this.isUpPressed) - Number(this.isDownPressed);
    this.inputController?.setKeyboardDirection(horizontal, vertical);
  }

  private clearKeys(): void {
    this.isLeftPressed = false;
    this.isRightPressed = false;
    this.isUpPressed = false;
    this.isDownPressed = false;
    this.inputController?.clearKeyboardDirection();
  }
}

