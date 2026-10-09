import assert from 'node:assert/strict';
import test from 'node:test';

import { InstancePool, PoolRegistry } from '../assets/scripts/pooling/Pools.ts';

class CountingBox {
  constructor() {
    this.acquireCount = 0;
    this.releaseCount = 0;
    this.lastContext = null;
    this.leftoverState = 'dirty';
  }
  onAcquire(context) {
    this.acquireCount += 1;
    this.lastContext = context;
    this.leftoverState = null;
  }
  onRelease() {
    this.releaseCount += 1;
    this.leftoverState = null;
  }
}

class ThrowingAcquireBox {
  onAcquire() {
    throw new Error('acquire boom');
  }
  onRelease() {}
}

class ThrowingReleaseBox {
  onAcquire() {}
  onRelease() {
    throw new Error('release boom');
  }
}

class DataBox {
  constructor() {
    this.lastContext = null;
    this.lastData = null;
  }
  onAcquire(context) {
    this.lastContext = context;
    this.lastData = context.data;
  }
  onRelease() {}
}

test('acquire passes typed data through the context', () => {
  const pool = new InstancePool('data_box', () => new DataBox(), { prewarmCount: 0, maxCapacity: 1 });
  const box = pool.acquire({ monsterId: 'monster_basic', x: 3, y: -4 });

  assert.deepEqual(box.lastContext, {
    poolKey: 'data_box',
    data: { monsterId: 'monster_basic', x: 3, y: -4 },
  });
  assert.equal(box.lastData.monsterId, 'monster_basic');
});

test('registration validates key, option ranges, and duplicate keys', () => {
  const registry = new PoolRegistry();
  const factory = () => new CountingBox();
  const options = { prewarmCount: 0, maxCapacity: 1 };

  assert.throws(() => registry.register('', factory, options), /non-empty string/);
  assert.throws(() => registry.register('box', factory, { prewarmCount: -1, maxCapacity: 1 }), /prewarmCount/);
  assert.throws(() => registry.register('box', factory, { prewarmCount: 0.5, maxCapacity: 1 }), /prewarmCount/);
  assert.throws(() => registry.register('box', factory, { prewarmCount: 0, maxCapacity: 0 }), /maxCapacity/);
  assert.throws(
    () => registry.register('box', factory, { prewarmCount: 3, maxCapacity: 2 }),
    /must not exceed maxCapacity/,
  );

  registry.register('box', factory, options);
  assert.throws(() => registry.register('box', factory, options), /already registered/);
  assert.equal(registry.getPool('box').stats.key, 'box');
});

test('unknown pool keys fail with the key in the message', () => {
  const registry = new PoolRegistry();

  assert.throws(() => registry.getPool('ghost'), /Unknown pool key "ghost"/);
  assert.throws(() => registry.stats('ghost'), /Unknown pool key "ghost"/);
  assert.throws(() => new InstancePool('  ', () => new CountingBox(), { prewarmCount: 0, maxCapacity: 1 }), /non-empty string/);
});

test('prewarm creates free instances without acquiring them', () => {
  const created = [];
  const pool = new InstancePool('box', () => {
    const box = new CountingBox();
    created.push(box);
    return box;
  }, { prewarmCount: 3, maxCapacity: 5 });

  const stats = pool.stats;
  assert.equal(stats.createdCount, 3);
  assert.equal(stats.borrowedCount, 0);
  assert.equal(stats.freeCount, 3);
  assert.equal(stats.peakBorrowedCount, 0);
  for (const box of created) {
    assert.equal(box.acquireCount, 0);
    assert.equal(box.releaseCount, 0);
  }
});

test('acquire resets through onAcquire and release cleans through onRelease', () => {
  const pool = new InstancePool('box', () => new CountingBox(), { prewarmCount: 1, maxCapacity: 2 });
  const box = pool.acquire();

  assert.deepEqual(box.lastContext, { poolKey: 'box', data: undefined });
  assert.equal(box.leftoverState, null);
  assert.equal(pool.stats.borrowedCount, 1);
  assert.equal(pool.stats.freeCount, 0);
  assert.equal(pool.stats.totalAcquireCount, 1);

  pool.release(box);
  assert.equal(box.releaseCount, 1);
  assert.equal(box.leftoverState, null);
  assert.equal(pool.stats.borrowedCount, 0);
  assert.equal(pool.stats.freeCount, 1);

  const reused = pool.acquire();
  assert.equal(reused, box);
  assert.equal(reused.acquireCount, 2);
  assert.equal(pool.stats.createdCount, 1);
});

test('acquire fails clearly at capacity and recovers after a release', () => {
  const pool = new InstancePool('box', () => new CountingBox(), { prewarmCount: 2, maxCapacity: 3 });
  const first = pool.acquire();
  const second = pool.acquire();
  const third = pool.acquire();
  assert.equal(pool.stats.createdCount, 3);

  assert.throws(() => pool.acquire(), /Pool "box" is at capacity: created 3\/3/);

  pool.release(second);
  const fourth = pool.acquire();
  assert.equal(fourth, second);
  assert.equal(pool.stats.createdCount, 3);
  pool.release(first);
  pool.release(third);
  pool.release(fourth);
});

test('double release and foreign instances are rejected', () => {
  const pool = new InstancePool('box', () => new CountingBox(), { prewarmCount: 1, maxCapacity: 2 });
  const box = pool.acquire();
  pool.release(box);

  assert.throws(() => pool.release(box), /double release/);
  assert.throws(() => pool.release(new CountingBox()), /not currently borrowed/);
  assert.equal(pool.stats.borrowedCount, 0);
  assert.equal(pool.stats.freeCount, 1);
});

test('onAcquire failure keeps the instance free and uncounted as borrowed', () => {
  const pool = new InstancePool('boom', () => new ThrowingAcquireBox(), { prewarmCount: 1, maxCapacity: 2 });

  assert.throws(() => pool.acquire(), /acquire boom/);
  assert.equal(pool.stats.borrowedCount, 0);
  assert.equal(pool.stats.freeCount, 1);
  assert.equal(pool.stats.totalAcquireCount, 0);
  assert.throws(() => pool.acquire(), /acquire boom/);
});

test('onRelease failure keeps the instance borrowed instead of half-cleaning it', () => {
  const pool = new InstancePool('boom', () => new ThrowingReleaseBox(), { prewarmCount: 1, maxCapacity: 2 });
  const box = pool.acquire();

  assert.throws(() => pool.release(box), /release boom/);
  assert.equal(pool.stats.borrowedCount, 1);
  assert.equal(pool.stats.freeCount, 0);
  assert.throws(() => pool.release(box), /release boom/);
  assert.equal(pool.stats.borrowedCount, 1);
});

test('300 cycles keep created count stable and borrowed count at zero', () => {
  const pool = new InstancePool('box', () => new CountingBox(), { prewarmCount: 2, maxCapacity: 10 });
  for (let i = 0; i < 300; i += 1) {
    const box = pool.acquire();
    pool.release(box);
  }

  let stats = pool.stats;
  assert.equal(stats.createdCount, 2);
  assert.equal(stats.borrowedCount, 0);
  assert.equal(stats.freeCount, 2);
  assert.equal(stats.totalAcquireCount, 300);
  assert.equal(stats.totalReleaseCount, 300);

  const held = [];
  for (let i = 0; i < 5; i += 1) {
    held.push(pool.acquire());
  }
  for (let i = 0; i < 300; i += 1) {
    const cycler = pool.acquire();
    pool.release(cycler);
    if (i === 0) {
      stats = pool.stats;
    }
  }
  for (const box of held) {
    pool.release(box);
  }

  stats = pool.stats;
  assert.equal(stats.createdCount, 6);
  assert.equal(stats.peakBorrowedCount, 6);
  assert.equal(stats.borrowedCount, 0);
  assert.equal(stats.freeCount, 6);
});

test('releaseAll and dispose close a pool without relying on destroy hooks', () => {
  const pool = new InstancePool('box', () => new CountingBox(), { prewarmCount: 1, maxCapacity: 4 });
  const borrowed = [pool.acquire(), pool.acquire(), pool.acquire()];

  assert.equal(pool.releaseAll(), 3);
  assert.equal(pool.stats.borrowedCount, 0);
  assert.equal(pool.stats.freeCount, 3);
  assert.equal(pool.releaseAll(), 0);
  for (const box of borrowed) {
    assert.equal(box.releaseCount, 1);
  }

  pool.dispose();
  assert.throws(() => pool.acquire(), /is disposed/);
  assert.throws(() => pool.release(borrowed[0]), /is disposed/);
});

test('registry aggregates stats, releaseAll, and disposeAll across pools', () => {
  const registry = new PoolRegistry();
  const applePool = registry.register('apple', () => new CountingBox(), { prewarmCount: 1, maxCapacity: 2 });
  const pearPool = registry.register('pear', () => new CountingBox(), { prewarmCount: 1, maxCapacity: 2 });
  const apple = applePool.acquire();
  const pear = pearPool.acquire();

  assert.equal(registry.stats('apple').borrowedCount, 1);
  assert.equal(registry.stats('pear').borrowedCount, 1);
  assert.equal(registry.allStats().length, 2);
  assert.ok(registry.describeAll().includes('pool "apple"'));

  assert.equal(registry.releaseAll(), 2);
  assert.equal(registry.stats('apple').borrowedCount, 0);
  assert.equal(registry.stats('pear').borrowedCount, 0);

  registry.disposeAll();
  assert.throws(() => registry.getPool('apple'), /Unknown pool key/);
  assert.equal(registry.allStats().length, 0);
  assert.throws(() => applePool.release(apple), /is disposed/);
  assert.throws(() => pearPool.acquire(), /is disposed/);
});
