import { _decorator, Component, Prefab } from 'cc';

import type { InstancePool } from '../scripts/pooling/Pools';
import { PoolService } from '../scripts/pooling/PoolService';
import { PooledGrayBox } from './PooledGrayBox';

const { ccclass, property } = _decorator;

const POOL_KEY = 'gray_box';
const PREWARM_COUNT = 4;
const MAX_CAPACITY = 8;
const STRESS_CYCLES = 300;
const STRESS_CONCURRENCY = 2;

/**
 * T05 池骨架的 Creator 自检夹具：挂在场景临时节点上运行，
 * 通过控制台日志和灰盒显隐验证预热、借出/归还、复用与 300 次循环
 * 后创建数稳定。验收通过后可与节点一起删除。
 */
@ccclass('PoolSelfTest')
export class PoolSelfTest extends Component {
  @property({ type: PoolService })
  private poolService: PoolService | null = null;

  @property({ type: Prefab })
  private grayBoxPrefab: Prefab | null = null;

  protected override start(): void {
    if (this.poolService === null || this.grayBoxPrefab === null) {
      throw new Error('[PoolSelfTest] poolService and grayBoxPrefab references are required');
    }

    const pool = this.poolService.registerNodePool(POOL_KEY, this.grayBoxPrefab, PooledGrayBox, {
      prewarmCount: PREWARM_COUNT,
      maxCapacity: MAX_CAPACITY,
    });
    this.logStats(pool, `registered (prewarm=${PREWARM_COUNT})`);

    const boxes = [pool.acquire(), pool.acquire(), pool.acquire()];
    boxes.forEach((box, index) => {
      box.node.setPosition((index - 1) * 120, 120, 0);
    });
    this.logStats(pool, 'acquired 3 boxes (visible row above player)');

    this.scheduleOnce(() => {
      for (const box of boxes) {
        pool.release(box);
      }
      this.logStats(pool, 'released 3 boxes (hidden)');

      this.scheduleOnce(() => this.runStressCycles(pool), 1);
    }, 1.5);
  }

  protected override onDisable(): void {
    this.unscheduleAllCallbacks();
  }

  private runStressCycles(pool: InstancePool<PooledGrayBox>): void {
    const held: PooledGrayBox[] = [];
    for (let i = 0; i < STRESS_CONCURRENCY; i += 1) {
      held.push(pool.acquire());
    }
    for (let i = 0; i < STRESS_CYCLES; i += 1) {
      const cycler = pool.acquire();
      pool.release(cycler);
    }
    for (const box of held) {
      pool.release(box);
    }

    const stats = pool.stats;
    const passed =
      stats.createdCount === PREWARM_COUNT &&
      stats.borrowedCount === 0 &&
      stats.freeCount === PREWARM_COUNT &&
      stats.totalAcquireCount === stats.totalReleaseCount;
    const summary =
      `after ${STRESS_CYCLES} cycles: created=${stats.createdCount} (expect ${PREWARM_COUNT}), ` +
      `borrowed=${stats.borrowedCount} (expect 0), free=${stats.freeCount}, peak=${stats.peakBorrowedCount}, ` +
      `acquires=${stats.totalAcquireCount}, releases=${stats.totalReleaseCount}`;
    if (passed) {
      console.log(`[PoolSelfTest] PASS ${summary}`);
    } else {
      console.error(`[PoolSelfTest] FAIL ${summary}`);
    }
  }

  private logStats(pool: InstancePool<PooledGrayBox>, phase: string): void {
    const stats = pool.stats;
    console.log(
      `[PoolSelfTest] ${phase}: created=${stats.createdCount} borrowed=${stats.borrowedCount} free=${stats.freeCount}`,
    );
  }
}
