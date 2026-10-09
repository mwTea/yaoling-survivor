import { _decorator, Component, Label } from 'cc';

import { BattleController } from '../battle/BattleController';
import type { BattleState } from '../core/BattleState';

const { ccclass, property, requireComponent } = _decorator;

@ccclass('BattleStateDebugView')
@requireComponent(Label)
export class BattleStateDebugView extends Component {
  @property({ type: BattleController })
  private battleController: BattleController | null = null;

  private label: Label | null = null;
  private unsubscribe: (() => void) | null = null;

  protected override onLoad(): void {
    this.label = this.getComponent(Label);
    if (this.label === null) {
      throw new Error('[BattleStateDebugView] Label component is required');
    }
    if (this.battleController === null) {
      throw new Error('[BattleStateDebugView] BattleController reference is required');
    }
  }

  protected override onEnable(): void {
    if (this.label === null || this.battleController === null) {
      return;
    }

    this.render(this.battleController.state);
    this.unsubscribe = this.battleController.subscribeToState(this.handleStateChanged);
  }

  protected override onDisable(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private readonly handleStateChanged = (_previous: BattleState, current: BattleState): void => {
    this.render(current);
  };

  private render(state: BattleState): void {
    if (this.label !== null) {
      this.label.string = `Battle: ${state}`;
    }
  }
}
