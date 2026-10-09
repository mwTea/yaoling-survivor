/**
 * 身份适配层（V10-07）：登录身份的接口、访客兜底与登录结果落档纯逻辑。
 *
 * 单文件叶子模块（零跨文件值导入，仅类型导入，可被 node 纯逻辑测试直接加载）：
 * - `IdentityAdapter` 接口：login 返回 Promise<IdentityResult>（wx / guest 两类）。
 * - `applyLoginResult` 登录结果落档唯一路径：成功写 openid 与 lastLoginAt；
 *   失败降级访客（不写 openid、不推进 lastLoginAt）；localGuestId 首次生成后
 *   不变（随机源注入）；迁移老档回填 accountCreatedAt（仅当为 0）。幂等可重入。
 * - `MockIdentityAdapter`：开发期模拟实现（Creator 预览/无云环境），可注入
 *   失败模式与固定 openid；无参数属性（node strip-types 约束）。
 *
 * 微信实现（wx.login → 云函数换 openid）在 `platform/WechatIdentityAdapter.ts`
 * （wx 全局绑定层）；业务代码只经本接口消费。隐私授权入口预留 V10-16 接入。
 */
import type { AccountSaveData } from '../account/AccountSave';

export type IdentityMode = 'wx' | 'guest';

export interface IdentityResult {
  /** true = 登录成功（kind=wx 且 openid 非空）；false = 登录失败（访客兜底）。 */
  readonly ok: boolean;
  readonly kind: IdentityMode;
  /** 微信 openid（成功时非空；失败/访客为空串）。 */
  readonly openid: string;
  /** 失败原因诊断（成功为 null；面向日志，不做玩家文案）。 */
  readonly detail: string | null;
}

export interface IdentityAdapter {
  /** 发起登录；实现不得抛错——失败以 ok:false 返回（访客兜底由落档路径统一处理）。 */
  login(): Promise<IdentityResult>;
}

/** 本地访客 ID 形态：guest_ + 16 位十六进制（随机源注入，测试可复现）。 */
export function createGuestId(random: () => number): string {
  let hex = '';
  for (let i = 0; i < 16; i += 1) {
    hex += Math.floor(random() * 16).toString(16);
  }
  return `guest_${hex}`;
}

export interface ApplyLoginOutcome {
  /** 存档身份域是否变化（调用方据此落盘）。 */
  readonly changed: boolean;
  /** 本次生效模式。 */
  readonly mode: IdentityMode;
  readonly detail: string | null;
}

/**
 * 登录结果落档（幂等可重入）：
 * - 成功（wx）：openid 非空才写入；lastLoginAt 推进为 nowMs；
 *   同 openid 重复登录只推进时间戳，不重生成 guestId。
 * - 失败：访客兜底——不写 openid、不推进 lastLoginAt（未登录语义）；
 *   localGuestId 为空时生成。
 * - 任一路径：accountCreatedAt 为 0（迁移老档）时回填 save.createdAt。
 * 随机源仅生成 localGuestId 使用；返回 changed 供调用方决定落盘。
 */
export function applyLoginResult(
  save: AccountSaveData,
  result: IdentityResult,
  nowMs: number,
  random: () => number,
): ApplyLoginOutcome {
  const identity = save.identity;
  let changed = false;
  if (identity.accountCreatedAt === 0 && save.createdAt > 0) {
    identity.accountCreatedAt = save.createdAt;
    changed = true;
  }
  if (result.ok && result.kind === 'wx' && result.openid.length > 0) {
    if (identity.wxOpenId !== result.openid) {
      identity.wxOpenId = result.openid;
      changed = true;
    }
    if (identity.lastLoginAt !== nowMs) {
      identity.lastLoginAt = nowMs;
      changed = true;
    }
  }
  if (identity.localGuestId.length === 0) {
    identity.localGuestId = createGuestId(random);
    changed = true;
  }
  return {
    changed,
    mode: result.ok && result.kind === 'wx' && result.openid.length > 0 ? 'wx' : 'guest',
    detail: result.detail,
  };
}

export type MockIdentityFailureMode = 'none' | 'always';

/**
 * 开发期模拟实现：默认成功并返回稳定 mock openid（便于 V10-09 云存档等
 * 下游任务在 Creator 内联调）；注入 'always' 失败模式可演练访客降级路径。
 * 模拟身份在日志中明确标注（"[MockIdentityAdapter]"），不伪装真实登录。
 */
export class MockIdentityAdapter implements IdentityAdapter {
  private failureMode: MockIdentityFailureMode;
  private readonly mockOpenId: string;

  constructor(options: { failureMode?: MockIdentityFailureMode; mockOpenId?: string } = {}) {
    this.failureMode = options.failureMode ?? 'none';
    this.mockOpenId = options.mockOpenId ?? 'mock_openid_dev_0000000000';
  }

  public setFailureMode(mode: MockIdentityFailureMode): void {
    this.failureMode = mode;
  }

  public login(): Promise<IdentityResult> {
    if (this.failureMode === 'always') {
      return Promise.resolve({ ok: false, kind: 'guest', openid: '', detail: 'mock_failure_injected' });
    }
    return Promise.resolve({ ok: true, kind: 'wx', openid: this.mockOpenId, detail: null });
  }
}
