import { Color, Graphics, Label, Node, Sprite, UITransform, view } from 'cc';

import { AudioService } from '../platform/AudioService';
import { applyArtSprite, loadSpriteFrameForButton } from './ArtLoader';
import { PanelBackdrop } from './PanelBackdrop';

/**
 * 灰盒动态 UI 工具（V08-05）：面板内容（底板/文本/可点区域）在代码中构建，
 * 场景装配只保留"面板根 + content 子节点"最小足迹——规避多槽位装配与
 * 新建节点同位堆叠问题（V0.5 装配轮结论）。V10-14 起支持 artId 切图：
 * 传入 artId 的控件加载成功后以 Sprite 呈现（盖过灰盒 Graphics），缺失时
 * 回退灰盒不报错（docs/ART_ASSETS.md 清单）。
 */

/**
 * 面板互斥与置顶（V0.8 遮挡修复）：面板 show() 时调用 claimActivePanel——
 * 自动关闭上一个面板并把本面板节点提到兄弟节点最上层（盖过导航与首页 HUD）；
 * 面板"关闭"按钮里调用 clearActivePanel。
 */
interface ActivePanelHandle {
  readonly node: Node;
  hide(): void;
}

let activePanel: ActivePanelHandle | null = null;

/** 把面板节点移到父节点最上层（渲染顺序置顶，覆盖导航/首页元素）。 */
export function bringPanelToFront(panelNode: Node): void {
  const parent = panelNode.parent;
  if (parent !== null) {
    panelNode.setSiblingIndex(parent.children.length - 1);
  }
}

export function claimActivePanel(panel: ActivePanelHandle): void {
  if (activePanel !== null && activePanel !== panel) {
    activePanel.hide();
  }
  activePanel = panel;
}

/** 当前互斥面板读取（V10-04 引导观察用；null = 无打开面板）。 */
export function getActivePanel(): ActivePanelHandle | null {
  return activePanel;
}

export function clearActivePanel(panel: ActivePanelHandle): void {
  if (activePanel === panel) {
    activePanel = null;
  }
}

/** 面板底图选项（V10-14 P1）：竖版整面底图（panel_shop 等）传固定逻辑尺寸。 */
export interface PanelBackdropOptions {
  /** 装饰底图切图 ID（缺省 panel_frame）。 */
  readonly frameArt?: string;
  /** 底图固定逻辑尺寸（如 panel_shop 640×900）；缺省全屏 +40 拉伸。 */
  readonly frameWidth?: number;
  readonly frameHeight?: number;
  /** 固定尺寸底图顶部锚定（内容自屏幕顶向下铺的面板用；缺省居中）。 */
  readonly frameAnchorTop?: boolean;
}

/** 动态构建全屏遮罩与面板底图。
 * 遮罩压低首页/底栏的视觉干扰；装饰框负责面板边框，缺图时保留深色底板。 */
export function addPanelBackdrop(content: Node, options: PanelBackdropOptions = {}): void {
  const visibleSize = view.getVisibleSize();
  const dim = new Node('BackdropDim');
  dim.setParent(content);
  dim.setSiblingIndex(0);
  const dimTransform = dim.addComponent(UITransform);
  dimTransform.setContentSize(visibleSize.width + 40, visibleSize.height + 40);
  const dimGraphics = dim.addComponent(Graphics);
  dimGraphics.fillColor = new Color(0, 0, 0, 176);
  dimGraphics.rect(-dimTransform.width / 2, -dimTransform.height / 2, dimTransform.width, dimTransform.height);
  dimGraphics.fill();

  const backdrop = new Node('BackdropFrame');
  backdrop.setParent(content);
  backdrop.setSiblingIndex(1);
  const transform = backdrop.addComponent(UITransform);
  transform.setContentSize(
    options.frameWidth ?? visibleSize.width + 40,
    options.frameHeight ?? visibleSize.height + 40,
  );
  const graphics = backdrop.addComponent(Graphics);
  graphics.fillColor = new Color(10, 28, 24, 230);
  graphics.rect(-transform.width / 2, -transform.height / 2, transform.width, transform.height);
  graphics.fill();
  applyArtSprite(backdrop, options.frameArt ?? 'panel_frame', { sliced: true });
  if (options.frameAnchorTop === true && options.frameWidth !== undefined && options.frameHeight !== undefined) {
    backdrop.setPosition(0, visibleSize.height / 2 - options.frameHeight / 2, 0);
  }
  content.addComponent(PanelBackdrop).initialize(
    dim,
    backdrop,
    options.frameWidth ?? null,
    options.frameHeight ?? null,
    options.frameAnchorTop === true,
  );
}

/** 整页背景（V10-14 P1，修行页等全出血设计稿）：暗化遮罩 + 满幅背景图，
 * 背景随画布尺寸重排（PanelBackdrop）；缺图回退深色底板。 */
export function addPageBackdrop(content: Node, bgArtId: string): void {
  const visibleSize = view.getVisibleSize();
  const dim = new Node('BackdropDim');
  dim.setParent(content);
  dim.setSiblingIndex(0);
  const dimTransform = dim.addComponent(UITransform);
  dimTransform.setContentSize(visibleSize.width + 40, visibleSize.height + 40);
  const dimGraphics = dim.addComponent(Graphics);
  dimGraphics.fillColor = new Color(0, 0, 0, 176);
  dimGraphics.rect(-dimTransform.width / 2, -dimTransform.height / 2, dimTransform.width, dimTransform.height);
  dimGraphics.fill();

  const background = new Node('PageBackground');
  background.setParent(content);
  background.setSiblingIndex(1);
  const transform = background.addComponent(UITransform);
  transform.setContentSize(visibleSize.width, visibleSize.height);
  const graphics = background.addComponent(Graphics);
  graphics.fillColor = new Color(10, 28, 24, 230);
  graphics.rect(-transform.width / 2, -transform.height / 2, transform.width, transform.height);
  graphics.fill();
  applyArtSprite(background, bgArtId);
  content.addComponent(PanelBackdrop).initialize(dim, background);
}

/** 纯切图节点（书法标题/徽记/路径装饰等，V10-14 P1）；缺图时不占视觉。 */
export function createArtNode(
  parent: Node,
  name: string,
  artId: string,
  x: number,
  y: number,
  width: number,
  height: number,
): Node {
  const node = new Node(name);
  node.setPosition(x, y, 0);
  node.setParent(parent);
  node.addComponent(UITransform).setContentSize(width, height);
  applyArtSprite(node, artId, { width, height });
  return node;
}

/** 创建文本 Label（默认 RESIZE_HEIGHT 纵向自适应，指定宽度时按宽换行）。 */
export function createLabel(
  parent: Node,
  name: string,
  text: string,
  x: number,
  y: number,
  fontSize = 20,
  width = 0,
): Label {
  const node = new Node(name);
  node.setPosition(x, y, 0);
  node.setParent(parent);
  const transform = node.addComponent(UITransform);
  const label = node.addComponent(Label);
  label.string = text;
  label.fontSize = fontSize;
  label.lineHeight = fontSize + 6;
  if (width > 0) {
    // 多行文本按"左上角"锚定（x/y 即左上角，向下自适应高度）：
    // 居中锚点会把整块文本框横跨屏幕导致左侧越界裁切。
    transform.setContentSize(width, 30);
    label.overflow = Label.Overflow.RESIZE_HEIGHT;
    transform.setAnchorPoint(0, 1);
    label.horizontalAlign = Label.HorizontalAlign.LEFT;
  }
  return label;
}

/**
 * 创建可点击区域（灰盒按钮）：UITransform 命中 + Graphics 底色 + 居中文本，
 * TOUCH_END 触发回调（不经 Button 组件，避免对美术精灵的依赖）。
 * V10-14：可选 art 传入切图 ID（{ normal, pressed?, sliced? }）——加载成功后
 * Sprite 盖过灰盒底色并支持按下态换图；缺失回退灰盒。
 * 返回根节点、文本 Label 与状态控制（setEnabled 开关 / setLook 着色）。
 */
const DISABLED_COLOR = new Color(40, 40, 40, 200);

export interface ClickRegionArt {
  /** 普通态切图 ID（artId = 文件名，见 docs/ART_ASSETS.md）。 */
  readonly normal: string;
  /** 按下态切图 ID（可选；缺省复用普通态）。 */
  readonly pressed?: string;
  /** 九宫格拉伸（按钮框类建议开）。 */
  readonly sliced?: boolean;
}

export function createClickRegion(
  parent: Node,
  name: string,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  onTap: () => void,
  fillColor = new Color(70, 70, 70, 255),
  art?: ClickRegionArt,
): {
  root: Node;
  label: Label;
  setEnabled: (enabled: boolean) => void;
  /** 着色并保持可点；传 null 等价于 setEnabled(false)。 */
  setLook: (color: Color | null) => void;
} {
  const root = new Node(name);
  root.setPosition(x, y, 0);
  root.setParent(parent);
  const transform = root.addComponent(UITransform);
  transform.setContentSize(width, height);
  const graphics = root.addComponent(Graphics);
  const baseColor = fillColor.clone();
  const widthSpan = width;
  const heightSpan = height;

  // Graphics 销毁（切图成功替换）后 redraw 必须静默跳过——渲染循环里访问
  // 已销毁组件的 fillColor 会读空崩溃（关卡页每次 render 的 setEnabled 路径）。
  // art 接管后灰盒清空（按钮图带透明边，下层色块会从透明区露出）。
  let artApplied = false;
  const redraw = (color: Color): void => {
    if (!graphics.isValid || artApplied) {
      return;
    }
    graphics.fillColor = color;
    graphics.rect(-widthSpan / 2, -heightSpan / 2, widthSpan, heightSpan);
    graphics.fill();
  };
  redraw(baseColor);

  const labelNode = new Node('Text');
  const label = labelNode.addComponent(Label);
  label.string = text;
  label.fontSize = Math.floor(height * 0.42);
  label.lineHeight = Math.floor(height * 0.42) + 4;
  label.horizontalAlign = Label.HorizontalAlign.CENTER;
  label.verticalAlign = Label.VerticalAlign.CENTER;
  labelNode.setParent(root);

  let enabled = true;
  root.on(Node.EventType.TOUCH_END, () => {
    if (enabled) {
      // UI 组点击音（V10-05）：统一在按钮工厂接线；服务未装配时静默跳过。
      AudioService.instance?.play('sfx_click');
      onTap();
    }
  });

  // V10-14 切图：**子节点承载 Sprite**——同节点 Graphics 与 Sprite 互斥
  // （removeComponent 亦不生效：引擎渲染器按节点收集，实测同节点替换不渲染）。
  // 层级：父 Graphics（灰盒回退）→ ArtBg（切图，siblingIndex 0）→ Text（文字）；
  // 缺图时灰盒自然露出，加载成功后切图盖过灰盒。
  let artSprite: Sprite | null = null;
  if (art !== undefined) {
    void (async () => {
      const [normal, pressed] = await Promise.all([
        loadSpriteFrameForButton(art.normal),
        art.pressed !== undefined ? loadSpriteFrameForButton(art.pressed) : Promise.resolve(null),
      ]);
      if (normal === null || !root.isValid) {
        return;
      }
      const artBg = new Node('ArtBg');
      artBg.setParent(root);
      const artTransform = artBg.addComponent(UITransform);
      artTransform.setContentSize(widthSpan, heightSpan);
      artSprite = artBg.addComponent(Sprite);
      artSprite.spriteFrame = normal;
      artSprite.sizeMode = Sprite.SizeMode.CUSTOM;
      if (art.sliced === true) {
        artSprite.type = Sprite.Type.SLICED;
      }
      artBg.setSiblingIndex(0);
      artApplied = true;
      graphics.clear();
      if (pressed !== null) {
        root.on(Node.EventType.TOUCH_START, () => {
          if (artSprite !== null) {
            artSprite.spriteFrame = pressed;
          }
        });
        const restore = (): void => {
          if (artSprite !== null) {
            artSprite.spriteFrame = normal;
          }
        };
        root.on(Node.EventType.TOUCH_END, restore);
        root.on(Node.EventType.TOUCH_CANCEL, restore);
      }
    })();
  }

  return {
    root,
    label,
    setEnabled(next: boolean): void {
      enabled = next;
      redraw(next ? baseColor : DISABLED_COLOR);
      if (artSprite !== null && artSprite.isValid) {
        artSprite.grayscale = !next;
      }
    },
    setLook(color: Color | null): void {
      if (color === null) {
        enabled = false;
        redraw(DISABLED_COLOR);
        return;
      }
      enabled = true;
      redraw(color);
    },
  };
}
