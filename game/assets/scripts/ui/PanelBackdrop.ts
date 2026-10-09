import { _decorator, Color, Component, Graphics, Node, Sprite, UITransform, view } from 'cc';

const { ccclass } = _decorator;

/** Keeps a modal's dim layer and frame sized to the current visible canvas. */
@ccclass('PanelBackdrop')
export class PanelBackdrop extends Component {
  private dimNode: Node | null = null;
  private frameNode: Node | null = null;
  private fixedFrameWidth: number | null = null;
  private fixedFrameHeight: number | null = null;
  private frameAnchorTop = false;

  protected override onEnable(): void {
    view.on('canvas-resize', this.resize, this);
    this.resize();
  }

  protected override onDisable(): void {
    view.off('canvas-resize', this.resize, this);
  }

  public initialize(
    dimNode: Node,
    frameNode: Node,
    frameWidth: number | null = null,
    frameHeight: number | null = null,
    frameAnchorTop = false,
  ): void {
    this.dimNode = dimNode;
    this.frameNode = frameNode;
    this.fixedFrameWidth = frameWidth;
    this.fixedFrameHeight = frameHeight;
    this.frameAnchorTop = frameAnchorTop;
    this.resize();
  }

  private resize(): void {
    if (this.dimNode === null || this.frameNode === null) {
      return;
    }
    const size = view.getVisibleSize();
    const width = size.width + 40;
    const height = size.height + 40;
    this.resizeNode(this.dimNode, width, height, new Color(0, 0, 0, 176));
    this.resizeNode(
      this.frameNode,
      this.fixedFrameWidth ?? width,
      this.fixedFrameHeight ?? height,
      new Color(10, 28, 24, 230),
    );
    if (this.frameAnchorTop && this.fixedFrameWidth !== null && this.fixedFrameHeight !== null) {
      this.frameNode.setPosition(0, size.height / 2 - this.fixedFrameHeight / 2, 0);
    }
  }

  private resizeNode(node: Node, width: number, height: number, color: Color): void {
    node.getComponent(UITransform)?.setContentSize(width, height);
    const graphics = node.getComponent(Graphics);
    if (graphics !== null) {
      graphics.clear();
      graphics.fillColor = color;
      graphics.rect(-width / 2, -height / 2, width, height);
      graphics.fill();
    }
    const sprite = node.getComponent(Sprite);
    if (sprite !== null) {
      sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    }
  }
}
