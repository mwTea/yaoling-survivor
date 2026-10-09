import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deployBeast,
  getBeastEntry,
  getBeastLevelCap,
  getDeployedBeast,
  levelUpBeast,
  starUpBeast,
  unlockBeast,
} from '../assets/scripts/account/BeastRoster.ts';
import { EconomyService } from '../assets/scripts/economy/Economy.ts';

const BEASTS = [
  {
    id: 'beast_qinglong',
    displayName: '青龙',
    soulResourceId: 'res_lingpo_qinglong',
    unlockSoulCost: 0,
    levelUpCosts: [50, 60, 72],
    starUpCosts: [5, 10, 20],
    skill: { kind: 'damageNearest', intervalSeconds: 6, damage: 8, projectileCount: 1 },
    skillDescription: '出战时每 6 秒向最近的敌人喷吐一颗灵弹（伤害 8）',
  },
  {
    id: 'beast_baihu',
    displayName: '白虎',
    soulResourceId: 'res_lingpo_baihu',
    unlockSoulCost: 10,
    levelUpCosts: [50, 60, 72],
    starUpCosts: [5, 10, 20],
    skill: { kind: 'heal', intervalSeconds: 12, value: 3 },
    skillDescription: '出战时每 12 秒为玩家回复 3 点生命',
  },
];

function makeEconomy() {
  return new EconomyService(
    [
      { id: 'res_lingshi', displayName: '灵石', capacity: 9999 },
      { id: 'res_lingpo_qinglong', displayName: '青龙灵魄', capacity: 9999 },
      { id: 'res_lingpo_baihu', displayName: '白虎灵魄', capacity: 9999 },
    ],
    { txLogCapacity: 20 },
  );
}

/** 同一对象结构兼容 BeastRosterState / BeastEconomyState / PlayerLevelState。 */
function makeSave({ lingshi = 0, qinglongSoul = 0, baihuSoul = 0, playerLevel = 20, beasts = {}, deployedBeastId = null } = {}) {
  return {
    playerLevel,
    beasts: { ...beasts },
    deployedBeastId,
    balances: {
      ...(lingshi > 0 ? { res_lingshi: lingshi } : {}),
      ...(qinglongSoul > 0 ? { res_lingpo_qinglong: qinglongSoul } : {}),
      ...(baihuSoul > 0 ? { res_lingpo_baihu: baihuSoul } : {}),
    },
    recentTransactions: [],
  };
}

const QINGLONG = 'beast_qinglong';
const BAIHU = 'beast_baihu';

test('entries default by config: zero-cost beasts are unlocked, others locked', () => {
  const save = makeSave();

  const qinglong = getBeastEntry(save, BEASTS[0]);
  assert.deepEqual(qinglong, { unlocked: true, level: 1, star: 0 });

  const baihu = getBeastEntry(save, BEASTS[1]);
  assert.deepEqual(baihu, { unlocked: false, level: 1, star: 0 });
});

test('beast level cap is curve length + 1 clamped by player level', () => {
  assert.equal(getBeastLevelCap(BEASTS[0], 20), 4);
  assert.equal(getBeastLevelCap(BEASTS[0], 2), 2);
  assert.equal(getBeastLevelCap(BEASTS[0], 0), 1);
});

test('unlock consumes only the beast own soul resource', () => {
  const economy = makeEconomy();
  const save = makeSave({ baihuSoul: 10 });

  const result = unlockBeast(save, save, BEASTS, economy, BAIHU, { txId: 'tx-u1', at: 1000 });

  assert.ok(result.ok);
  assert.deepEqual(save.beasts[BAIHU], { unlocked: true, level: 1, star: 0 });
  assert.equal(save.balances.res_lingpo_baihu, 0);
  const entry = save.recentTransactions[0];
  assert.equal(entry.kind, 'beast_unlock');
  assert.deepEqual(entry.deltas, { res_lingpo_baihu: -10 });
});

test('unlocking an already unlocked beast is refused without spending (idempotent)', () => {
  const economy = makeEconomy();
  const save = makeSave({ baihuSoul: 10 });

  const first = unlockBeast(save, save, BEASTS, economy, BAIHU, { txId: 'tx-u2', at: 1000 });
  assert.ok(first.ok);

  const repeat = unlockBeast(save, save, BEASTS, economy, BAIHU, { txId: 'tx-u3', at: 1001 });
  assert.equal(repeat.ok, false);
  assert.equal(repeat.reason, 'already_unlocked');
  assert.equal(save.balances.res_lingpo_baihu, 0, 'no double spend on repeat');
  assert.equal(save.recentTransactions.length, 1);
});

test('zero-cost beasts are default unlocked and cannot be unlocked again', () => {
  const economy = makeEconomy();
  const save = makeSave();

  const result = unlockBeast(save, save, BEASTS, economy, QINGLONG, { txId: 'tx-u4', at: 1000 });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'already_unlocked');
  assert.equal(save.recentTransactions.length, 0);
});

test('unlock with insufficient soul is rejected and the beast stays locked', () => {
  const economy = makeEconomy();
  const save = makeSave({ baihuSoul: 9 });

  const result = unlockBeast(save, save, BEASTS, economy, BAIHU, { txId: 'tx-u5', at: 1000 });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'economy_rejected');
  assert.equal(getBeastEntry(save, BEASTS[1]).unlocked, false);
});

test('beast level up spends lingshi and advances the level', () => {
  const economy = makeEconomy();
  const save = makeSave({ lingshi: 110 });

  const result = levelUpBeast(save, save, save, BEASTS, economy, QINGLONG, { txId: 'tx-l1', at: 1000 });

  assert.ok(result.ok);
  assert.deepEqual(save.beasts[QINGLONG], { unlocked: true, level: 2, star: 0 });
  assert.equal(save.balances.res_lingshi, 60);
  assert.equal(save.recentTransactions[0].kind, 'beast_level_up');
});

test('level up is refused for locked beasts', () => {
  const economy = makeEconomy();
  const save = makeSave({ lingshi: 999 });

  const result = levelUpBeast(save, save, save, BEASTS, economy, BAIHU, { txId: 'tx-l2', at: 1000 });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'not_unlocked');
  assert.equal(save.balances.res_lingshi, 999);
});

test('beast level is capped by player level with a distinct reason', () => {
  const economy = makeEconomy();
  const save = makeSave({ lingshi: 999, playerLevel: 2, beasts: { [QINGLONG]: { unlocked: true, level: 2, star: 0 } } });

  const capped = levelUpBeast(save, save, save, BEASTS, economy, QINGLONG, { txId: 'tx-l3', at: 1000 });
  assert.equal(capped.ok, false);
  assert.equal(capped.reason, 'player_level_cap');

  save.playerLevel = 3;
  const allowed = levelUpBeast(save, save, save, BEASTS, economy, QINGLONG, { txId: 'tx-l4', at: 1001 });
  assert.ok(allowed.ok);
  assert.equal(save.beasts[QINGLONG].level, 3);
});

test('beast level cap from the curve refuses further growth', () => {
  const economy = makeEconomy();
  const save = makeSave({ lingshi: 999, beasts: { [QINGLONG]: { unlocked: true, level: 4, star: 0 } } });

  const result = levelUpBeast(save, save, save, BEASTS, economy, QINGLONG, { txId: 'tx-l5', at: 1000 });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'at_max_level');
  assert.equal(save.balances.res_lingshi, 999, 'no economy transaction attempted at cap');
});

test('star up consumes the beast own soul, isolated from other beasts souls', () => {
  const economy = makeEconomy();
  const save = makeSave({ qinglongSoul: 5, baihuSoul: 999 });

  const result = starUpBeast(save, save, BEASTS, economy, QINGLONG, { txId: 'tx-s1', at: 1000 });

  assert.ok(result.ok);
  assert.deepEqual(save.beasts[QINGLONG], { unlocked: true, level: 1, star: 1 });
  assert.equal(save.balances.res_lingpo_qinglong, 0, 'only own soul is spent');
  assert.equal(save.balances.res_lingpo_baihu, 999, 'other souls untouched');
  assert.deepEqual(save.recentTransactions[0].deltas, { res_lingpo_qinglong: -5 });
});

test('star up stops at the configured max star', () => {
  const economy = makeEconomy();
  const save = makeSave({ qinglongSoul: 999, beasts: { [QINGLONG]: { unlocked: true, level: 1, star: 3 } } });

  const result = starUpBeast(save, save, BEASTS, economy, QINGLONG, { txId: 'tx-s2', at: 1000 });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'at_max_star');
});

test('star up is refused for locked beasts', () => {
  const economy = makeEconomy();
  const save = makeSave({ baihuSoul: 999 });

  const result = starUpBeast(save, save, BEASTS, economy, BAIHU, { txId: 'tx-s3', at: 1000 });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'not_unlocked');
  assert.equal(save.recentTransactions.length, 0);
});

test('deploy switches the single slot and reports the previous beast', () => {
  const save = makeSave();

  const first = deployBeast(save, BEASTS, QINGLONG);
  assert.deepEqual(first, { ok: true, deployedBeastId: QINGLONG, previousDeployedId: null });

  save.beasts[BAIHU] = { unlocked: true, level: 1, star: 0 };
  const second = deployBeast(save, BEASTS, BAIHU);
  assert.deepEqual(second, { ok: true, deployedBeastId: BAIHU, previousDeployedId: QINGLONG });
  assert.equal(save.deployedBeastId, BAIHU, 'single slot is overwritten');
});

test('deploy is idempotent for the same beast', () => {
  const save = makeSave();
  deployBeast(save, BEASTS, QINGLONG);

  const repeat = deployBeast(save, BEASTS, QINGLONG);

  assert.ok(repeat.ok);
  assert.deepEqual(repeat, { ok: true, deployedBeastId: QINGLONG, previousDeployedId: QINGLONG });
  assert.equal(save.deployedBeastId, QINGLONG);
});

test('locked beasts cannot be deployed', () => {
  const save = makeSave();

  const result = deployBeast(save, BEASTS, BAIHU);

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'not_unlocked');
  assert.equal(save.deployedBeastId, null);
});

test('deployed beast lookup returns config and entry, or null when unset', () => {
  const save = makeSave();
  assert.equal(getDeployedBeast(save, BEASTS), null);

  deployBeast(save, BEASTS, QINGLONG);
  const deployed = getDeployedBeast(save, BEASTS);
  assert.ok(deployed);
  if (!deployed) return;
  assert.equal(deployed.beastId, QINGLONG);
  assert.equal(deployed.config.id, QINGLONG);
  assert.equal(deployed.entry.unlocked, true);
});

test('unknown beast ids are rejected by every operation', () => {
  const economy = makeEconomy();
  const save = makeSave();

  assert.equal(unlockBeast(save, save, BEASTS, economy, 'beast_missing', { txId: 'tx-x', at: 1000 }).reason, 'unknown_beast');
  assert.equal(levelUpBeast(save, save, save, BEASTS, economy, 'beast_missing', { txId: 'tx-x', at: 1000 }).reason, 'unknown_beast');
  assert.equal(starUpBeast(save, save, BEASTS, economy, 'beast_missing', { txId: 'tx-x', at: 1000 }).reason, 'unknown_beast');
  assert.equal(deployBeast(save, BEASTS, 'beast_missing').reason, 'unknown_beast');
});
