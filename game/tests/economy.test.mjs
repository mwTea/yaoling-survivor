import assert from 'node:assert/strict';
import test from 'node:test';

import { EconomyService } from '../assets/scripts/economy/Economy.ts';

const RESOURCES = [
  { id: 'res_lingshi', displayName: '灵石', capacity: 1000 },
  { id: 'res_xiuwei', displayName: '修为', capacity: 500 },
  { id: 'res_yaodan', displayName: '妖丹', capacity: 100 },
];

function makeService(txLogCapacity = 3) {
  return new EconomyService(RESOURCES, { txLogCapacity });
}

function makeState(balances = {}) {
  return { balances, recentTransactions: [] };
}

function makeRequest(overrides = {}) {
  return { txId: 'tx-1', kind: 'test_op', deltas: { res_lingshi: 10 }, at: 1000, ...overrides };
}

test('grant applies deltas and appends an audit entry at the tail', () => {
  const service = makeService();
  const state = makeState({ res_lingshi: 100 });

  const result = service.grant(state, makeRequest());

  assert.ok(result.ok);
  assert.equal(state.balances.res_lingshi, 110);
  assert.equal(state.recentTransactions.length, 1);
  const entry = state.recentTransactions[0];
  assert.deepEqual(
    { txId: entry.txId, kind: entry.kind, deltas: entry.deltas, at: entry.at },
    { txId: 'tx-1', kind: 'test_op', deltas: { res_lingshi: 10 }, at: 1000 },
  );
});

test('grant clamps at capacity and reports the lost overflow', () => {
  const service = makeService();
  const state = makeState({ res_lingshi: 960 });

  const result = service.grant(state, makeRequest({ deltas: { res_lingshi: 100 } }));

  assert.ok(result.ok);
  if (!result.ok) return;
  assert.deepEqual(result.appliedDeltas, { res_lingshi: 40 });
  assert.deepEqual(result.lostToCap, { res_lingshi: 60 });
  assert.equal(state.balances.res_lingshi, 1000);
});

test('grant into an over-cap inventory applies nothing and never confiscates holdings', () => {
  const service = makeService();
  const state = makeState({ res_lingshi: 1200 });

  const result = service.grant(state, makeRequest({ deltas: { res_lingshi: 50 } }));

  assert.ok(result.ok);
  if (!result.ok) return;
  assert.deepEqual(result.appliedDeltas, { res_lingshi: 0 });
  assert.deepEqual(result.lostToCap, { res_lingshi: 50 });
  assert.equal(state.balances.res_lingshi, 1200, 'hand-edited over-cap balance is not reduced');
});

test('multi-resource grant clamps only the capped resource and leaves others untouched', () => {
  const service = makeService();
  const state = makeState({ res_lingshi: 990, res_yaodan: 5 });

  const result = service.grant(
    state,
    makeRequest({ deltas: { res_lingshi: 100, res_yaodan: 10, res_xiuwei: 30 } }),
  );

  assert.ok(result.ok);
  if (!result.ok) return;
  assert.deepEqual(result.appliedDeltas, { res_lingshi: 10, res_yaodan: 10, res_xiuwei: 30 });
  assert.deepEqual(result.lostToCap, { res_lingshi: 90 });
  assert.deepEqual(state.balances, { res_lingshi: 1000, res_yaodan: 15, res_xiuwei: 30 });
});

test('spend deducts balances and records negative deltas', () => {
  const service = makeService();
  const state = makeState({ res_lingshi: 200, res_yaodan: 10 });

  const result = service.spend(
    state,
    makeRequest({ kind: 'weapon_level_up', deltas: { res_lingshi: -80, res_yaodan: -4 } }),
  );

  assert.ok(result.ok);
  if (!result.ok) return;
  assert.deepEqual(result.appliedDeltas, { res_lingshi: -80, res_yaodan: -4 });
  assert.deepEqual(result.lostToCap, {});
  assert.deepEqual(state.balances, { res_lingshi: 120, res_yaodan: 6 });
});

test('spend rejects insufficient balance with the offending resource in the detail', () => {
  const service = makeService();
  const state = makeState({ res_lingshi: 20 });

  const result = service.spend(state, makeRequest({ deltas: { res_lingshi: -80 } }));

  assert.deepEqual(result, {
    ok: false,
    reason: 'insufficient_balance',
    detail: 'insufficient balance for "res_lingshi": have 20, need 80',
  });
  assert.equal(state.balances.res_lingshi, 20, 'rejected spend leaves balances unchanged');
  assert.equal(state.recentTransactions.length, 0);
});

test('spend is atomic across resources when one balance falls short', () => {
  const service = makeService();
  const state = makeState({ res_lingshi: 500, res_yaodan: 2 });

  const result = service.spend(
    state,
    makeRequest({ deltas: { res_lingshi: -80, res_yaodan: -4 } }),
  );

  assert.equal(result.ok, false);
  assert.deepEqual(
    state.balances,
    { res_lingshi: 500, res_yaodan: 2 },
    'first resource must not be deducted when the second fails',
  );
  assert.equal(state.recentTransactions.length, 0);
});

test('unknown resource ids are rejected for both operations', () => {
  const service = makeService();
  const state = makeState();

  const granted = service.grant(state, makeRequest({ deltas: { res_lingyu: 5 } }));
  const spent = service.spend(state, makeRequest({ deltas: { res_typo: -1 } }));

  assert.equal(granted.ok, false);
  assert.equal(spent.ok, false);
  assert.equal(granted.reason, 'unknown_resource');
  assert.equal(spent.reason, 'unknown_resource');
  assert.ok(granted.detail.includes('res_lingyu'));
  assert.ok(spent.detail.includes('res_typo'));
});

test('malformed requests are rejected without touching state', () => {
  const service = makeService();
  const state = makeState({ res_lingshi: 100 });
  const baseline = { ...state.balances };

  const badRequests = [
    makeRequest({ txId: '' }),
    makeRequest({ kind: '  ' }),
    makeRequest({ deltas: {} }),
    makeRequest({ deltas: { res_lingshi: 0 } }),
    makeRequest({ deltas: { res_lingshi: 2.5 } }),
    makeRequest({ deltas: { res_lingshi: -10 } }),
    makeRequest({ at: -1 }),
  ];
  for (const request of badRequests) {
    const granted = service.grant(state, request);
    assert.equal(granted.ok, false, `grant should reject ${JSON.stringify(request)}`);
    assert.equal(granted.reason, 'invalid_request');
  }
  const badSpend = service.spend(state, makeRequest({ deltas: { res_lingshi: 10 } }));
  assert.equal(badSpend.ok, false);
  assert.equal(badSpend.reason, 'invalid_request');

  assert.deepEqual(state.balances, baseline, 'no failed request may mutate state');
  assert.equal(state.recentTransactions.length, 0);
});

test('transaction log rings at the configured capacity and drops the oldest entries', () => {
  const service = makeService(3);
  const state = makeState();

  for (let i = 1; i <= 4; i++) {
    service.grant(state, makeRequest({ txId: `tx-${i}`, deltas: { res_lingshi: 1 }, at: i }));
  }
  const failed = service.spend(state, makeRequest({ txId: 'tx-bad', deltas: { res_lingshi: -99999 } }));

  assert.equal(failed.ok, false);
  assert.deepEqual(
    state.recentTransactions.map((entry) => entry.txId),
    ['tx-2', 'tx-3', 'tx-4'],
    'oldest entry dropped, newest stays at the tail, failures never append',
  );
});

test('getBalance treats missing resources as zero', () => {
  const service = makeService();
  const state = makeState({ res_lingshi: 42 });

  assert.equal(service.getBalance(state, 'res_lingshi'), 42);
  assert.equal(service.getBalance(state, 'res_xiuwei'), 0);
});

test('stored transaction entries are detached from the returned result object', () => {
  const service = makeService();
  const state = makeState();

  const result = service.grant(state, makeRequest());

  assert.ok(result.ok);
  if (!result.ok) return;
  result.appliedDeltas.res_lingshi = 999;
  assert.equal(state.recentTransactions[0].deltas.res_lingshi, 10, 'audit log keeps its own snapshot');
});

test('spend observer hook fires with positive deltas after an atomic spend (V08-09)', () => {
  const observed = [];
  const economy = new EconomyService(
    [
      { id: 'res_lingshi', displayName: '灵石', capacity: 9999 },
      { id: 'res_xiuwei', displayName: '修为', capacity: 9999 },
    ],
    {
      txLogCapacity: 20,
      onSpend: (state, deltas) => {
        observed.push({ balances: state.balances.res_lingshi, deltas: { ...deltas } });
      },
    },
  );
  const state = { balances: { res_lingshi: 500, res_xiuwei: 100 }, recentTransactions: [] };

  economy.grant(state, { txId: 'g1', kind: 'grant', deltas: { res_lingshi: 10 }, at: 1 });
  assert.equal(observed.length, 0, 'grants do not notify');

  const spent = economy.spend(state, { txId: 's1', kind: 'spend', deltas: { res_lingshi: -30, res_xiuwei: -20 }, at: 2 });
  assert.equal(spent.ok, true);
  assert.deepEqual(observed, [{ balances: 480, deltas: { res_lingshi: 30, res_xiuwei: 20 } }], 'positive deltas after commit');

  const rejected = economy.spend(state, { txId: 's2', kind: 'spend', deltas: { res_lingshi: -9999 }, at: 3 });
  assert.equal(rejected.ok, false);
  assert.equal(observed.length, 1, 'failed spends do not notify');
});
