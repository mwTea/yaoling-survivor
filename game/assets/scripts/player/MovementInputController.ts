import { _decorator, Component } from 'cc';

import type { MovementInput, MutableVector2 } from './MovementInput';
import { MovementInputState } from './MovementInputState';

const { ccclass } = _decorator;

@ccclass('MovementInputController')
export class MovementInputController extends Component implements MovementInput {
  private readonly state = new MovementInputState();

  public setKeyboardDirection(horizontal: number, vertical: number): void {
    this.state.setKeyboardDirection(horizontal, vertical);
  }

  public clearKeyboardDirection(): void {
    this.state.clearKeyboardDirection();
  }

  public setJoystickDirection(horizontal: number, vertical: number): void {
    this.state.setJoystickDirection(horizontal, vertical);
  }

  public clearJoystickDirection(): void {
    this.state.clearJoystickDirection();
  }

  public writeDirection(out: MutableVector2): void {
    this.state.writeDirection(out);
  }

  protected override onDisable(): void {
    this.state.clear();
  }
}
