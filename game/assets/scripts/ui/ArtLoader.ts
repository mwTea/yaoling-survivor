import { assetManager, Graphics, Label, Node, resources, Sprite, SpriteFrame, UITransform } from 'cc';
import type { AssetManager } from 'cc';

/**
 * 正式美术接入（V10-14）：切图加载与应用工具。
 *
 * - 加载双通道：优先显式 Bundle `art`（assets/art 配置为 Bundle，名称 art），
 *   失败回退 resources 特殊目录（resources/art/<artId>）。两条链路任一可用
 *   即出图；均失败 warn 一次并回退灰盒——**缺失资源不报错**（V10-14 DoD）。
 * - 切图清单与命名见 docs/ART_ASSETS.md，文件名即 artId。
 * - `applyArtSprite` 幂等：节点已应用过则跳过；加载成功后才销毁同节点灰盒
 *   Graphics（同节点多 UIRenderer 互斥）。
 * - 九宫格：`sliced: true` 用 SLICED 类型按节点 UITransform 尺寸拉伸。
 */
const spriteCache = new Map<string, SpriteFrame>();
const pendingLoads = new Map<string, Promise<SpriteFrame | null>>();
const missingWarned = new Set<string>();
const appliedNodes = new WeakMap<object, string>();

let artBundle: AssetManager.Bundle | null = null;
let artBundleNoticeLogged = false;

/** 显式 art Bundle（配置后缓存；未配置返回 null，走 resources 回退）。 */
function ensureArtBundle(): Promise<AssetManager.Bundle | null> {
  if (artBundle !== null) {
    return Promise.resolve(artBundle);
  }
  return new Promise((resolve) => {
    assetManager.loadBundle('art', (err: Error | null, bundle: AssetManager.Bundle | null) => {
      if (err || bundle === null) {
        if (!artBundleNoticeLogged) {
          artBundleNoticeLogged = true;
          const known = Object.keys(assetManager.bundles).join(', ');
          console.warn(
            `[ArtLoader] loadBundle("art") 失败: ${err instanceof Error ? err.message : String(err ?? 'null bundle')}；` +
            `当前已注册 bundles: [${known || '（空）'}]`,
          );
        }
        resolve(null);
        return;
      }
      artBundle = bundle;
      console.log('[ArtLoader] using explicit bundle "art"');
      resolve(bundle);
    });
  });
}

function loadOnce(artId: string): Promise<SpriteFrame | null> {
  return ensureArtBundle().then(
    (bundle: AssetManager.Bundle | null) =>
      new Promise<SpriteFrame | null>((resolve) => {
        const settle = (err: Error | null, asset: SpriteFrame | null, via: string): void => {
          if (err || asset === null) {
            resolve(null);
            return;
          }
          spriteCache.set(artId, asset);
          resolve(asset);
        };
        const tryResources = (): void => {
          resources.load(`art/${artId}/spriteFrame`, SpriteFrame, (err: Error | null, asset: SpriteFrame | null) => {
            settle(err, asset ?? null, 'resources');
          });
        };
        if (bundle === null) {
          tryResources();
          return;
        }
        bundle.load(`${artId}/spriteFrame`, SpriteFrame, (err: Error | null, asset: SpriteFrame | null) => {
          if (err || asset === null) {
            tryResources();
            return;
          }
          settle(null, asset, 'bundle art');
        });
      }),
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 单图加载（带 3 次自动重试，间隔 1s）：覆盖启动早期 bundle/资产库未就绪的竞态。 */
async function loadSpriteFrame(artId: string): Promise<SpriteFrame | null> {
  const cached = spriteCache.get(artId);
  if (cached !== undefined) {
    return cached;
  }
  const pending = pendingLoads.get(artId);
  if (pending !== undefined) {
    return pending;
  }
  const load = (async (): Promise<SpriteFrame | null> => {
    let lastErr: Error | null = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const asset = await loadOnce(artId);
      if (asset !== null) {
        return asset;
      }
      lastErr = new Error('not found in bundle/resources');
      if (attempt < 3) {
        await delay(1000);
      }
    }
    if (!missingWarned.has(artId)) {
      missingWarned.add(artId);
      console.warn(
        `[ArtLoader] art asset missing: ${artId}（重试 3 次后仍失败，回退灰盒；原因: ${lastErr?.message ?? 'unknown'}）`,
      );
    }
    return null;
  })();
  pendingLoads.set(artId, load);
  return load;
}

/** 是否已成功加载过（诊断用）。 */
export function isArtLoaded(artId: string): boolean {
  return spriteCache.has(artId);
}

/** 预热（可选）：启动时批量预载常用图，减少首帧闪灰。 */
export function preloadArt(artIds: readonly string[]): void {
  for (const artId of artIds) {
    void loadSpriteFrame(artId);
  }
}

export interface ArtApplyOptions {
  /** 显示尺寸（逻辑像素）；缺省沿用节点现有 UITransform 尺寸。 */
  readonly width?: number;
  readonly height?: number;
  /** 九宫格拉伸（面板/按钮框类）。 */
  readonly sliced?: boolean;
  /** 平铺（可平铺纹理如 bg_battle）：按节点尺寸重复铺满而非拉伸。 */
  readonly tiled?: boolean;
}

/**
 * 把切图应用到节点：加载成功后挂 Sprite。**同节点 Graphics（灰盒）与 Sprite
 * 互斥**——Creator 不支持一个节点多个 UIRenderer，因此加载成功后才销毁灰盒
 * Graphics（失败路径不销毁，保留回退）；节点已有 Sprite（灰盒占位）则复用
 * 换帧。缺省保持节点显示尺寸。幂等；失败静默回退灰盒。
 */
export function applyArtSprite(node: Node, artId: string, options: ArtApplyOptions = {}): void {
  void (async () => {
    const frame = await loadSpriteFrame(artId);
    if (frame === null || !node.isValid || appliedNodes.get(node) === artId) {
      return;
    }
    const label = node.getComponent(Label);
    const renderNode = label === null ? node : getOrCreateArtChild(node, artId);
    const existing = renderNode.getComponent(Sprite);
    if (existing === null && renderNode === node) {
      node.getComponent(Graphics)?.destroy();
    }
    const sprite = existing ?? renderNode.addComponent(Sprite);
    appliedNodes.set(node, artId);
    sprite.spriteFrame = frame;
    if (options.sliced === true) {
      sprite.type = Sprite.Type.SLICED;
    } else if (options.tiled === true) {
      sprite.type = Sprite.Type.TILED;
    }
    const transform = renderNode.getComponent(UITransform);
    if (transform !== null) {
      sprite.sizeMode = Sprite.SizeMode.CUSTOM;
      const parentTransform = node.getComponent(UITransform);
      transform.setContentSize(
        options.width ?? parentTransform?.width ?? transform.width,
        options.height ?? parentTransform?.height ?? transform.height,
      );
    }
    if (label !== null) {
      label.enabled = false;
    }
  })().catch((error: unknown) => {
    console.error(`[ArtLoader] failed to apply art asset "${artId}"`, error);
  });
}

function getOrCreateArtChild(parent: Node, artId: string): Node {
  const childName = `ArtSprite_${artId}`;
  const existing = parent.getChildByName(childName);
  if (existing !== null) {
    return existing;
  }
  const child = new Node(childName);
  child.setParent(parent);
  child.addComponent(UITransform);
  return child;
}

/** 按钮两态用的直接取帧（PanelKit 内部；缺图返回 null 回退灰盒）。 */
export function loadSpriteFrameForButton(artId: string): Promise<SpriteFrame | null> {
  return loadSpriteFrame(artId);
}
