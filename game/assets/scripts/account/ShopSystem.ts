/**
 * 商店数据层（V08-12）。
 *
 * 单文件叶子模块（零跨文件值导入，仅类型导入，可被 node 纯逻辑测试直接加载）：
 * - 购买事务：校验（未知商品 → 限购 → 余额）→ 扣价（经济 spend，审计
 *   kind=shop_purchase）→ 发货（经济 grant，kind=shop_goods，上限钳制差异由
 *   lostToCap 体现）→ 计数（purchaseCounts 最后写入，失败路径零修改）。
 * - 每日限购重置：按 TimeService 的 dayKey 惰性刷新——refreshDayKey ≠ 当前
 *   dayKey 时清空所有 dailyRefresh 商品的已购计数（永久限购商品计数保留）。
 * - 消费灵玉：稀缺珍品以 res_lingyu 定价（灵玉产出口径见 CONFIG.md）。
 */
import type { PlayerLevelConfig, ShopGroupConfig, ShopItemConfig } from '../config/ConfigTypes';
import type { AccountTxEntry, ShopSaveState } from './AccountSave';
import type { EconomyOpRequest, EconomyOpResult } from '../economy/Economy';
import type { AddAccountXpResult, PlayerLevelState } from './PlayerLeveling';

/** 商店配置表切片（GameConfig 结构兼容）。 */
export interface ShopTables {
  readonly shopGroups: readonly ShopGroupConfig[];
  readonly shopItems: readonly ShopItemConfig[];
  readonly playerLevel: PlayerLevelConfig;
}

/** 商店系统存档切片（AccountSaveData 结构兼容：shop 域 + 库存 + 审计 + 玩家等级）。 */
export interface ShopState extends PlayerLevelState {
  shop: ShopSaveState;
  balances: Record<string, number>;
  recentTransactions: AccountTxEntry[];
}

export interface ShopEconomyOps {
  getBalance(state: ShopState, resourceId: string): number;
  grant(state: ShopState, request: EconomyOpRequest): EconomyOpResult;
  spend(state: ShopState, request: EconomyOpRequest): EconomyOpResult;
}

export interface ShopLevelOps {
  addAccountXp(state: PlayerLevelState, config: PlayerLevelConfig, amount: number): AddAccountXpResult;
}

export type ShopPurchaseResult =
  | { readonly ok: true; readonly remaining: number; readonly granted: Record<string, number> }
  | {
    readonly ok: false;
    readonly reason: 'unknown_item' | 'limit_reached' | 'insufficient_balance' | 'spend_rejected' | 'grant_rejected';
    readonly detail: string | null;
  };

export interface ShopPurchaseRequest {
  readonly txId: string;
  readonly at: number;
}

/** 惰性每日重置（带商品表）：跨 dayKey 时清空 dailyRefresh 商品的已购计数（幂等）。 */
export function refreshShopForDay(
  state: ShopState,
  tables: Pick<ShopTables, 'shopItems'>,
  dayKey: string,
): void {
  if (state.shop.refreshDayKey === dayKey) {
    return;
  }
  for (const item of tables.shopItems) {
    if (item.dailyRefresh) {
      delete state.shop.purchaseCounts[item.id];
    }
  }
  state.shop.refreshDayKey = dayKey;
}

/** 商品当前剩余可购次数（未知商品为 0；自动先做每日刷新）。 */
export function getRemainingPurchases(
  state: ShopState,
  tables: ShopTables,
  itemId: string,
  dayKey: string,
): number {
  const item = tables.shopItems.find((candidate) => candidate.id === itemId);
  if (item === undefined) {
    return 0;
  }
  refreshShopForDay(state, tables, dayKey);
  const purchased = state.shop.purchaseCounts[itemId] ?? 0;
  return Math.max(0, item.purchaseLimit - purchased);
}

/**
 * 购买事务：限购/余额校验 → 扣价（shop_purchase）→ 发货（shop_goods）→ 计数。
 * 任何失败路径零修改（计数与发货都在扣价成功之后）。
 */
export function purchaseShopItem(
  state: ShopState,
  tables: ShopTables,
  economy: ShopEconomyOps,
  itemId: string,
  dayKey: string,
  request: ShopPurchaseRequest,
): ShopPurchaseResult {
  const item = tables.shopItems.find((candidate) => candidate.id === itemId);
  if (item === undefined) {
    return { ok: false, reason: 'unknown_item', detail: `shop item "${itemId}" not found` };
  }
  refreshShopForDay(state, tables, dayKey);
  const purchased = state.shop.purchaseCounts[itemId] ?? 0;
  if (purchased >= item.purchaseLimit) {
    return { ok: false, reason: 'limit_reached', detail: null };
  }
  const balance = economy.getBalance(state, item.priceType);
  if (balance < item.price) {
    return { ok: false, reason: 'insufficient_balance', detail: null };
  }
  const spend = economy.spend(state, {
    txId: request.txId,
    kind: 'shop_purchase',
    deltas: { [item.priceType]: -item.price },
    at: request.at,
  });
  if (!spend.ok) {
    return { ok: false, reason: 'spend_rejected', detail: spend.detail };
  }
  const grant = economy.grant(state, {
    txId: `${request.txId}#goods`,
    kind: 'shop_goods',
    deltas: { [item.goods.resourceId]: item.goods.amount },
    at: request.at,
  });
  if (!grant.ok) {
    return { ok: false, reason: 'grant_rejected', detail: grant.detail };
  }
  state.shop.purchaseCounts[itemId] = purchased + 1;
  const remaining = Math.max(0, item.purchaseLimit - (purchased + 1));
  return { ok: true, remaining, granted: grant.appliedDeltas };
}
