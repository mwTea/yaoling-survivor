/**
 * 经济库存与事务（V05-02，V0.5 基础产消闭环）。
 *
 * 单文件叶子模块（零跨文件值导入，仅类型导入，可被 node 纯逻辑测试直接加载）：
 * - 余额存于账号存档 balances（resourceId → 整数最小单位），本模块不改存档结构；
 * - 一切发放/消耗走事务：前置校验 → 原子变更 → 追加审计记录（环形截断，ECONOMY.md）；
 * - 余额不得为负；发放超出库存上限的部分被钳制并明确报告丢失；
 * - 失败路径绝不修改状态：多资源请求整体生效或整体拒绝。
 */
import type { AccountTxEntry } from '../account/AccountSave';
import type { ResourceConfig } from '../config/ConfigTypes';

/** 经济状态切片：账号存档的库存域 + 审计域（AccountSaveData 结构兼容，按结构类型传入）。 */
export interface EconomyState {
  balances: Record<string, number>;
  recentTransactions: AccountTxEntry[];
}

/** 事务请求：grant 要求 deltas 全为正整数，spend 全为负整数；txId 由调用方保证唯一。 */
export interface EconomyOpRequest {
  readonly txId: string;
  readonly kind: string;
  readonly deltas: Record<string, number>;
  /** 事务时间（epoch 毫秒）。 */
  readonly at: number;
}

export type EconomyOpFailureReason =
  | 'invalid_request'
  | 'unknown_resource'
  | 'insufficient_balance';

export type EconomyOpResult =
  | {
    readonly ok: true;
    /** 实际生效的变化量（发放被上限钳制后可能小于请求值，已到上限的资源为 0）。 */
    readonly appliedDeltas: Record<string, number>;
    /** 因库存上限被钳制而丢失的数量（spend 恒为空对象）。 */
    readonly lostToCap: Record<string, number>;
  }
  | {
    readonly ok: false;
    readonly reason: EconomyOpFailureReason;
    /** 指出资源 ID/字段的详情，开发期快速定位；不用于 UI 文案。 */
    readonly detail: string;
  };

export interface EconomyServiceOptions {
  /** 事务日志环形上限；装配层传入 account/AccountSave 的 MAX_RECENT_TRANSACTIONS 保持一致。 */
  readonly txLogCapacity: number;
  /**
   * 消耗观察钩子（V08-09 任务接线）：spend 原子生效后回调（deltas 为正数消耗量）。
   * 仅观察，不得在钩子内再走经济事务（回调方负责幂等与落盘时机）。
   */
  readonly onSpend?: (state: EconomyState, deltas: Record<string, number>) => void;
}

export class EconomyService {
  private readonly capacities: Map<string, number>;
  private readonly txLogCapacity: number;
  private readonly onSpend: ((state: EconomyState, deltas: Record<string, number>) => void) | null;

  constructor(resources: readonly ResourceConfig[], options: EconomyServiceOptions) {
    this.capacities = new Map<string, number>();
    for (const resource of resources) {
      this.capacities.set(resource.id, resource.capacity);
    }
    this.txLogCapacity = options.txLogCapacity;
    this.onSpend = options.onSpend ?? null;
  }

  /** 读取余额；未持有的资源视为 0。 */
  getBalance(state: EconomyState, resourceId: string): number {
    const value = state.balances[resourceId];
    return typeof value === 'number' ? value : 0;
  }

  /** 发放：正整数 deltas；超出库存上限的部分被钳制并通过 lostToCap 报告。 */
  grant(state: EconomyState, request: EconomyOpRequest): EconomyOpResult {
    return this.apply(state, request, 'grant');
  }

  /** 消耗：负整数 deltas；任一资源余额不足则整体拒绝（原子）。 */
  spend(state: EconomyState, request: EconomyOpRequest): EconomyOpResult {
    return this.apply(state, request, 'spend');
  }

  private apply(
    state: EconomyState,
    request: EconomyOpRequest,
    op: 'grant' | 'spend',
  ): EconomyOpResult {
    const shapeIssue = validateRequestShape(request);
    if (shapeIssue !== null) {
      return { ok: false, reason: 'invalid_request', detail: shapeIssue };
    }

    const nextBalances: Record<string, number> = { ...state.balances };
    const appliedDeltas: Record<string, number> = {};
    const lostToCap: Record<string, number> = {};

    // 第一遍：关系与数值校验（只读，保证失败路径零修改）。
    for (const resourceId of Object.keys(request.deltas)) {
      const amount = request.deltas[resourceId];
      const capacity = this.capacities.get(resourceId);
      if (capacity === undefined) {
        return { ok: false, reason: 'unknown_resource', detail: `unknown resource id "${resourceId}"` };
      }
      if (typeof amount !== 'number' || !Number.isInteger(amount)) {
        return {
          ok: false,
          reason: 'invalid_request',
          detail: `${op} delta for "${resourceId}" must be an integer`,
        };
      }
      if (op === 'grant' && amount <= 0) {
        return {
          ok: false,
          reason: 'invalid_request',
          detail: `grant delta for "${resourceId}" must be a positive integer`,
        };
      }
      if (op === 'spend' && amount >= 0) {
        return {
          ok: false,
          reason: 'invalid_request',
          detail: `spend delta for "${resourceId}" must be a negative integer`,
        };
      }
      const current = this.getBalance(state, resourceId);
      const target = current + amount;
      if (op === 'spend' && target < 0) {
        return {
          ok: false,
          reason: 'insufficient_balance',
          detail: `insufficient balance for "${resourceId}": have ${current}, need ${-amount}`,
        };
      }
      if (op === 'grant' && target > capacity) {
        // 手改存档可能超过上限：不回收已持有余额，只钳制增量。
        const ceiling = Math.max(current, capacity);
        appliedDeltas[resourceId] = ceiling - current;
        lostToCap[resourceId] = target - ceiling;
        nextBalances[resourceId] = ceiling;
      } else {
        appliedDeltas[resourceId] = amount;
        nextBalances[resourceId] = target;
      }
    }

    // 第二遍：原子提交并追加审计记录（环形保留最近 txLogCapacity 条，新事务在尾部）。
    state.balances = nextBalances;
    const entry: AccountTxEntry = {
      txId: request.txId,
      kind: request.kind,
      deltas: { ...appliedDeltas },
      at: request.at,
    };
    state.recentTransactions.push(entry);
    const excess = state.recentTransactions.length - this.txLogCapacity;
    if (excess > 0) {
      state.recentTransactions.splice(0, excess);
    }
    if (op === 'spend' && this.onSpend !== null) {
      this.onSpend(state, toPositiveDeltas(appliedDeltas));
    }
    return { ok: true, appliedDeltas, lostToCap };
  }
}

function toPositiveDeltas(deltas: Record<string, number>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const resourceId of Object.keys(deltas)) {
    const amount = deltas[resourceId];
    if (typeof amount === 'number' && amount < 0) {
      result[resourceId] = -amount;
    }
  }
  return result;
}

function validateRequestShape(request: EconomyOpRequest): string | null {
  if (typeof request.txId !== 'string' || request.txId.trim().length === 0) {
    return 'txId must be a non-empty string';
  }
  if (typeof request.kind !== 'string' || request.kind.trim().length === 0) {
    return 'kind must be a non-empty string';
  }
  if (typeof request.at !== 'number' || !Number.isFinite(request.at) || request.at < 0) {
    return 'at must be a finite non-negative epoch timestamp';
  }
  if (typeof request.deltas !== 'object' || request.deltas === null || Array.isArray(request.deltas)) {
    return 'deltas must be an object keyed by resource id';
  }
  if (Object.keys(request.deltas).length === 0) {
    return 'deltas must contain at least one resource';
  }
  return null;
}
