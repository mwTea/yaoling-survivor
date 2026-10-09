import type { MovementInput, MutableVector2 } from './MovementInput';

/** Pure multi-source input state shared by Cocos adapters and tests. */
export class MovementInputState implements MovementInput {
  private keyboardHorizontal = 0;
  private keyboardVertical = 0;
  private joystickHorizontal = 0;
  private joystickVertical = 0;
  private isJoystickActive = false;

  public setKeyboardDirection(horizontal: number, vertical: number): void {
    this.keyboardHorizontal = clampAxis(horizontal);
    this.keyboardVertical = clampAxis(vertical);
  }

  public clearKeyboardDirection(): void {
    this.keyboardHorizontal = 0;
    this.keyboardVertical = 0;
  }

  public setJoystickDirection(horizontal: number, vertical: number): void {
    this.joystickHorizontal = clampAxis(horizontal);
    this.joystickVertical = clampAxis(vertical);
    this.isJoystickActive = true;
  }

  public clearJoystickDirection(): void {
    this.joystickHorizontal = 0;
    this.joystickVertical = 0;
    this.isJoystickActive = false;
  }

  public clear(): void {
    this.clearKeyboardDirection();
    this.clearJoystickDirection();
  }

  public writeDirection(out: MutableVector2): void {
    const horizontal = this.isJoystickActive
      ? this.joystickHorizontal
      : this.keyboardHorizontal;
    const vertical = this.isJoystickActive
      ? this.joystickVertical
      : this.keyboardVertical;
    const lengthSquared = horizontal * horizontal + vertical * vertical;
    if (lengthSquared > 1) {
      const inverseLength = 1 / Math.sqrt(lengthSquared);
      out.x = horizontal * inverseLength;
      out.y = vertical * inverseLength;
      return;
    }

    out.x = horizontal;
    out.y = vertical;
  }
}

function clampAxis(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(-1, Math.min(1, value));
}
