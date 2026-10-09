import assert from 'node:assert/strict';
import test from 'node:test';

import { EconomyService } from '../assets/scripts/economy/Economy.ts';
import { addAccountXp } from '../assets/scripts/account/PlayerLeveling.ts';
import {
  getRemainingPurchases,
  purchaseShopItem,
  refreshShopForDay,
} from '../assets/scripts/account/ShopSystem.ts';

const DAY_1 = '2026-10-04';
const DAY_2 = '2026-10-05';

const TABLES = {
  playerLevel: { levelCurve: [{ level: 1, requiredXp: 60 }] },
  shopGroups: [{ id: 'group_a', displayName: '补给', itemIds: ['item_pill', 'item_rare'] }],
  shopItems: [
    {
      id: 'item_pill',
      displayName: '补气丹',
      description: '',
      goods: { resourceId: 'res_xiuwei', amount: 40 },
      priceType: 'res_lingshi',
      price: 80,
      purchaseLimit: 2,
      dailyRefresh: true,
    },
    {
      id: 'item_rare',
      displayName: '珍品',
      description: '',
      goods: { resourceId: 'res_yaodan', amount: 5 },
      priceType: 'res_lingyu',
      price: 20,
      purchaseLimit: 1,
      dailyRefresh: false,
    },
  ],
};

function makeState(balances) {
  return {
    playerLevel: 1,
    playerXp: 0,
    shop: { refreshDayKey: DAY_1, purchaseCounts: {} },
    balances,
    recentTransactions: [],
  };
}

function makeEconomy() {
  return new EconomyService(
    [
      { id: 'res_lingshi', displayName: '灵石', capacity: 999999 },
      { id: 'res_lingyu', displayName: '灵玉', capacity: 9999 },
      { id: 'res_xiuwei', displayName: '修为', capacity: 999999 },
      { id: 'res_yaodan', displayName: '妖丹', capacity: 9999 },
    ],
    { txLogCapacity: 20 },
  );
}

test('purchase deducts price, grants goods, increments count and writes both audit entries', () => {
  const tables = TABLES;
  const state = makeState({ res_lingshi: 500 });
  const economy = makeEconomy();

  const result = purchaseShopItem(state, tables, economy, 'item_pill', DAY_1, { txId: 'p1', at: 1 });

  assert.equal(result.ok, true);
  assert.equal(result.remaining, 1);
  assert.equal(economy.getBalance(state, 'res_lingshi'), 420, 'price deducted');
  assert.equal(economy.getBalance(state, 'res_xiuwei'), 40, 'goods granted');
  assert.equal(state.shop.purchaseCounts.item_pill, 1);
  const kinds = state.recentTransactions.map((entry) => entry.kind);
  assert.deepEqual(kinds, ['shop_purchase', 'shop_goods'], 'purchase audit includes kind=shop_purchase');
});

test('unknown items, exhausted limits and insufficient balances are rejected cleanly', () => {
  const tables = TABLES;
  const state = makeState({ res_lingshi: 500, res_lingyu: 100 });
  const economy = makeEconomy();

  assert.equal(purchaseShopItem(state, tables, economy, 'item_ghost', DAY_1, { txId: 'p0', at: 0 }).reason, 'unknown_item');

  // 永久限购商品：买 1 次后跨日也不恢复。
  assert.equal(purchaseShopItem(state, tables, economy, 'item_rare', DAY_1, { txId: 'p1', at: 1 }).ok, true);
  const exhausted = purchaseShopItem(state, tables, economy, 'item_rare', DAY_1, { txId: 'p2', at: 2 });
  assert.equal(exhausted.reason, 'limit_reached');
  const nextDay = purchaseShopItem(state, tables, economy, 'item_rare', DAY_2, { txId: 'p3', at: 3 });
  assert.equal(nextDay.reason, 'limit_reached', 'permanent limits never reset');

  // 余额不足：零修改。
  const poor = makeState({ res_lingshi: 10 });
  const poorResult = purchaseShopItem(poor, tables, economy, 'item_pill', DAY_1, { txId: 'p4', at: 4 });
  assert.equal(poorResult.reason, 'insufficient_balance');
  assert.deepEqual(poor.recentTransactions, [], 'failed purchase leaves no audit entries');
  assert.deepEqual(poor.shop.purchaseCounts, {});
});

test('daily limits restore after the day key changes while permanent limits persist', () => {
  const tables = TABLES;
  const state = makeState({ res_lingshi: 5000 });
  const economy = makeEconomy();

  assert.equal(purchaseShopItem(state, tables, economy, 'item_pill', DAY_1, { txId: 'p1', at: 1 }).ok, true);
  assert.equal(purchaseShopItem(state, tables, economy, 'item_pill', DAY_1, { txId: 'p2', at: 2 }).ok, true);
  assert.equal(purchaseShopItem(state, tables, economy, 'item_pill', DAY_1, { txId: 'p3', at: 3 }).reason, 'limit_reached');
  assert.equal(getRemainingPurchases(state, tables, 'item_pill', DAY_1), 0);

  // 永久限购商品同日购买一次。
  state.balances.res_lingyu = 100;
  assert.equal(purchaseShopItem(state, tables, economy, 'item_rare', DAY_1, { txId: 'p4', at: 4 }).ok, true);

  // 跨 dayKey：每日限购恢复，永久限购计数保留。
  refreshShopForDay(state, tables, DAY_2);
  assert.equal(getRemainingPurchases(state, tables, 'item_pill', DAY_2), 2, 'daily limit restored');
  assert.equal(state.shop.purchaseCounts.item_rare, 1, 'permanent count survives the reset');
  assert.equal(state.shop.refreshDayKey, DAY_2);
});
