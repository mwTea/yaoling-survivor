import { _decorator, Component, Vec3 } from 'cc';

import { BattleController } from '../battle/BattleController';
import { ActiveStage } from '../battle/ActiveStage';
import { INITIAL_GAME_CONFIG } from '../config/GameConfig';
import type { RectangleBoundsConfig } from '../config/ConfigTypes';
import type { MutableVector2 } from './MovementInput';
import { MovementInputController } from './MovementInputController';
import { moveWithinBounds } from './PlayerMovement';

const { ccclass, property, requireComponent } = _decorator;

@ccclass('PlayerMover')
@requireComponent(MovementInputController)
export class PlayerMover extends Component {
  @property({ type: BattleController })
  private battleController: BattleController | null = null;

  private inputController: MovementInputController | null = null;
  private bounds: RectangleBoundsConfig | null = null;
  private readonly inputDirection: MutableVector2 = { x: 0, y: 0 };
  private readonly nextPosition: MutableVector2 = { x: 0, y: 0 };
  private readonly cocosPosition = new Vec3();

  /** 是否有非零移动输入（V10-04 引导观察用；上帧 writeDirection 的输入向量为准）。 */
  public get isMoving(): boolean {
    return this.inputDirection.x !== 0 || this.inputDirection.y !== 0;
  }

  protected override onLoad(): void {
    if (this.battleController === null) {
      throw new Error('[PlayerMover] BattleController reference is required');
    }
    this.inputController = this.getComponent(MovementInputController);
    if (this.inputController === null) {
      throw new Error('[PlayerMover] MovementInputController is required');
    }
  }

  protected override start(): void {
    // 边界在 start 取用：ActiveStage 由账号链路 onLoad 装配，先于一切 start。
    this.bounds = ActiveStage.current.stage.playArea;
  }

  protected override update(): void {
    if (this.battleController === null || this.inputController === null || this.bounds === null) {
      return;
    }

    const deltaTime = this.battleController.battleDeltaTime;
    if (deltaTime <= 0) {
      return;
    }

    this.inputController.writeDirection(this.inputDirection);
    moveWithinBounds(
      this.node.position,
      this.inputDirection,
      INITIAL_GAME_CONFIG.player.moveSpeed,
      deltaTime,
      this.bounds,
      this.nextPosition,
    );
    this.cocosPosition.set(this.nextPosition.x, this.nextPosition.y, this.node.position.z);
    this.node.setPosition(this.cocosPosition);
  }
}

