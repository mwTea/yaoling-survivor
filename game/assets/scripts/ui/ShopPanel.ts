import { _decorator, Color, Component, Label, Node, view } from 'cc';

import { AccountSystem } from '../account/AccountSystem';
import { trackAnalytics } from '../platform/AnalyticsService';
import { INITIAL_GAME_CONFIG } from '../config/GameConfig';
import type { ShopItemConfig } from '../config/ConfigTypes';
import {
  getRemainingPurchases,
  purchaseShopItem,
} from '../account/ShopSystem';
import { addPanelBackdrop, bringPanelToFront, claimActivePanel, clearActivePanel, createClickRegion, createLabel } from './PanelKit';

const { ccclass, property } = _decorator;

const BUYABLE_COLOR = new Color(70, 110, 60, 255);
const DISABLED_LOOK = new Color(45, 45, 45, 220);
const DEFAULT_COLOR = new Color(70, 70, 70, 255);

/**
 * 商店页（V08-13，灰盒）：按商品组分组的商品行（内容/价格/今日剩余次数/刷新说明），
 * 余额展示、点击行购买（购买事务：扣价 → 发货 → 计数 → 落盘）、状态行反馈。
 * 余额不足或已售罄的行禁用并显示原因。购买后经 onOperationDone 刷新首页资源栏。
 * 内容全部代码构建（PanelKit），场景装配仅需根节点 + content 子节点。
 */
@ccclass('ShopPanel')
export class ShopPanel extends Component {
  @property({ type: Node })
  private content: Node | null = null;

  /** 操作完成后的回调（首页资源栏刷新用）。 */
  public onOperationDone: (() => void) | null = null;

  private balanceLabel: Label | null = null;
  private statusLabel: Label | null = null;
  private rowRegions: ReturnType<typeof createClickRegion>[] = [];
  private rowItems: (ShopItemConfig | null)[] = [];
  private built = false;

  protected override start(): void {
    if (this.content === null) {
      throw new Error('[ShopPanel] missing reference: content ← 在本节点下建子节点 content 并拖入该槽');
    }
    this.build();
    this.content.active = false;
  }

  public show(): void {
    if (this.content === null) {
      return;
    }
    bringPanelToFront(this.node);
    claimActivePanel(this);
    this.content.active = true;
    this.render();
  }

  /** 关闭面板（互斥注册表 + 隐藏内容）。 */
  public hide(): void {
    clearActivePanel(this);
    if (this.content !== null) {
      this.content.active = false;
    }
  }

  private build(): void {
    if (this.content === null || this.built) {
      return;
    }
    this.built = true;
    const content = this.content;
    addPanelBackdrop(content, { frameArt: 'panel_shop', frameWidth: 640, frameHeight: 900, frameAnchorTop: true });
    const visibleSize = view.getVisibleSize();
    const width = visibleSize.width;
    const height = visibleSize.height;
    const top = height / 2;

    createLabel(content, 'Title', '商店', 0, top - 34, 24);
    this.balanceLabel = createLabel(content, 'Balance', '', 0, top - 66, 16);
    createClickRegion(content, 'Close', '关闭', width / 2 - 60, top - 34, 92, 42, () => {
      this.hide();
    });

    const rowCount = INITIAL_GAME_CONFIG.shopItems.length + INITIAL_GAME_CONFIG.shopGroups.length;
    const rowHeight = Math.min(36, Math.floor((height - 250) / Math.max(1, rowCount)));
    const rowWidth = width - 200;
    const rows: Array<{ text: string; item: ShopItemConfig | null; kind: 'group' | 'item' }> = [];
    for (const group of INITIAL_GAME_CONFIG.shopGroups) {
      rows.push({ text: `【${group.displayName}】`, item: null, kind: 'group' });
      for (const itemId of group.itemIds) {
        const item = INITIAL_GAME_CONFIG.shopItems.find((candidate) => candidate.id === itemId);
        if (item !== undefined) {
          rows.push({ text: item.displayName, item, kind: 'item' });
        }
      }
    }

    rows.forEach((row, index) => {
      const region = createClickRegion(
        content,
        `ShopRow${index + 1}`,
        row.text,
        -width / 2 + 100 + rowWidth / 2,
        top - 104 - index * (rowHeight + 4) - rowHeight / 2,
        rowWidth,
        rowHeight,
        () => {
          if (row.item !== null) {
            this.handleBuyClicked(row.item);
          }
        },
        row.kind === 'group' ? new Color(56, 60, 80, 255) : DEFAULT_COLOR.clone(),
      );
      if (row.kind === 'group') {
        region.label.fontSize = 14;
        region.setLook(null);
      }
      this.rowRegions.push(region);
      this.rowItems.push(row.item);
    });

    this.statusLabel = createLabel(content, 'Status', '点击商品行购买', 0, -height / 2 + 46, 15);
  }

  private render(): void {
    if (this.content === null || !this.content.active || this.balanceLabel === null) {
      return;
    }
    const account = AccountSystem.instance;
    const save = account?.accountSave ?? null;
    const economy = account?.economy ?? null;
    if (account === null || save === null || economy === null) {
      this.balanceLabel.string = '账号服务未装配';
      for (const region of this.rowRegions) {
        region.setLook(null);
      }
      return;
    }
    const dayKey = account.time.dayKey();
    this.balanceLabel.string =
      `灵石 ${economy.getBalance(save, 'res_lingshi')}　灵玉 ${economy.getBalance(save, 'res_lingyu')}`;

    for (let index = 0; index < this.rowRegions.length; index += 1) {
      const region = this.rowRegions[index];
      const item = this.rowItems[index];
      if (region === undefined || item === undefined) {
        continue;
      }
      if (item === null) {
        continue; // 分组头保持原样。
      }
      const remaining = getRemainingPurchases(save, INITIAL_GAME_CONFIG, item.id, dayKey);
      const currencyName = item.priceType === 'res_lingyu' ? '灵玉' : '灵石';
      const balance = economy.getBalance(save, item.priceType);
      const refreshNote = item.dailyRefresh ? '每日刷新' : '永久限购';
      if (remaining <= 0) {
        region.label.string = `${item.displayName}（${item.description}）　🔒 已售罄（${refreshNote}）`;
        region.setLook(DISABLED_LOOK);
      } else if (balance < item.price) {
        region.label.string =
          `${item.displayName}（${item.description}）　${item.price} ${currencyName}　余 ${remaining}/${item.purchaseLimit}　余额不足`;
        region.setLook(DISABLED_LOOK);
      } else {
        region.label.string =
          `${item.displayName}（${item.description}）　${item.price} ${currencyName}　余 ${remaining}/${item.purchaseLimit}　${refreshNote}`;
        region.setLook(BUYABLE_COLOR);
      }
    }
  }

  private handleBuyClicked(item: ShopItemConfig): void {
    const account = AccountSystem.instance;
    const save = account?.accountSave ?? null;
    const economy = account?.economy ?? null;
    if (account === null || save === null || economy === null) {
      return;
    }
    const outcome = purchaseShopItem(save, INITIAL_GAME_CONFIG, economy, item.id, account.time.dayKey(), {
      txId: `shop_buy_${account.time.now()}`,
      at: account.time.now(),
    });
    trackAnalytics('purchase_result', {
      kind: 'shop',
      id: item.id,
      ok: outcome.ok,
      reason: outcome.ok ? null : outcome.reason,
    });
    if (outcome.ok) {
      this.setStatus(`购买成功：${item.displayName}（剩余 ${outcome.remaining} 次）`);
    } else {
      this.setStatus(`购买失败：${describePurchaseFailure(outcome.reason)}`);
    }
    account.persistSave();
    this.render();
    this.onOperationDone?.();
  }

  private setStatus(text: string): void {
    if (this.statusLabel !== null) {
      this.statusLabel.string = text;
    }
  }
}

function describePurchaseFailure(reason: string): string {
  switch (reason) {
    case 'limit_reached':
      return '已达限购次数';
    case 'insufficient_balance':
      return '余额不足';
    case 'spend_rejected':
      return '扣款失败';
    case 'grant_rejected':
      return '发货失败';
    case 'unknown_item':
      return '商品不存在';
    default:
      return '状态异常';
  }
}
