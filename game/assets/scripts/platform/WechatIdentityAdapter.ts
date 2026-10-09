import { MockIdentityAdapter } from './IdentityAdapter';
import type { IdentityAdapter, IdentityResult } from './IdentityAdapter';

/**
 * 微信登录实现（V10-07，wx 全局绑定层）：wx.login 拿 code → 云函数
 * `yaoling_login`（随任务交付，见 `cloudfunctions/login/`）换取 openid。
 * 平台能力全部集中本文件，业务代码零 `wx.*`；任何失败以 ok:false 返回
 * （不抛错），访客兜底由 `applyLoginResult` 统一处理。
 *
 * 环境判定：无 `wx` 全局（Creator 预览）或无 `wx.cloud`（未开通云开发）时
 * 由工厂回退 MockIdentityAdapter；真机 + 云环境部署后自动走真实登录。
 * 隐私授权（wx.requirePrivacyAuthorize）入口预留 V10-16 合规流接入。
 */

interface WxCloudLike {
  init?: (options?: { env?: string; traceUser?: boolean }) => void;
  callFunction?: (options: {
    name: string;
    data?: Record<string, unknown>;
    success?: (res: { result?: unknown }) => void;
    fail?: (err: { errMsg?: string }) => void;
  }) => void;
}

interface WxLoginLike {
  login?: (options: {
    success?: (res: { code?: string }) => void;
    fail?: (err: { errMsg?: string }) => void;
  }) => void;
}

/** 云函数名（部署见 cloudfunctions/login/；换名需同步）。 */
export const LOGIN_CLOUD_FUNCTION_NAME = 'yaoling_login';

export class WechatIdentityAdapter implements IdentityAdapter {
  private readonly cloudEnvId: string | null;

  constructor(cloudEnvId: string | null = null) {
    this.cloudEnvId = cloudEnvId;
  }

  public login(): Promise<IdentityResult> {
    const wx = (globalThis as { wx?: WxLoginLike & { cloud?: WxCloudLike } }).wx;
    if (wx === undefined || wx.login === undefined) {
      return Promise.resolve({ ok: false, kind: 'guest', openid: '', detail: 'wx_unavailable' });
    }
    const cloud = wx.cloud;
    if (cloud === undefined || cloud.callFunction === undefined) {
      return Promise.resolve({ ok: false, kind: 'guest', openid: '', detail: 'wx_cloud_unavailable' });
    }
    try {
      cloud.init?.({ env: this.cloudEnvId ?? undefined, traceUser: true });
    } catch {
      // init 失败继续尝试 callFunction，由其 fail 路径统一降级。
    }
    return new Promise<IdentityResult>((resolve) => {
      wx.login?.({
        success: (res) => {
          const code = res.code;
          if (typeof code !== 'string' || code.length === 0) {
            resolve({ ok: false, kind: 'guest', openid: '', detail: 'wx_login_empty_code' });
            return;
          }
          cloud.callFunction?.({
            name: LOGIN_CLOUD_FUNCTION_NAME,
            data: { code },
            success: (callRes) => {
              const result = callRes.result as { openid?: unknown; errMsg?: string } | undefined;
              const openid = typeof result?.openid === 'string' ? result.openid : '';
              if (openid.length === 0) {
                resolve({ ok: false, kind: 'guest', openid: '', detail: result?.errMsg ?? 'cloud_login_no_openid' });
                return;
              }
              resolve({ ok: true, kind: 'wx', openid, detail: null });
            },
            fail: (err) => {
              resolve({ ok: false, kind: 'guest', openid: '', detail: err.errMsg ?? 'cloud_call_failed' });
            },
          });
        },
        fail: (err) => {
          resolve({ ok: false, kind: 'guest', openid: '', detail: err.errMsg ?? 'wx_login_failed' });
        },
      });
    });
  }
}

/**
 * 身份适配器工厂：真机（wx + 云开发可用）走微信实现；Creator 预览等
 * 无 wx/云环境回退 Mock（日志标注模拟）。云环境 ID 为用户前置配置项
 * （mp 后台开通后填入；null = 使用云开发默认环境）。
 */
export function createIdentityAdapter(cloudEnvId: string | null = null): IdentityAdapter {
  const wx = (globalThis as { wx?: WxLoginLike & { cloud?: WxCloudLike } }).wx;
  if (wx !== undefined && wx.cloud !== undefined) {
    return new WechatIdentityAdapter(cloudEnvId);
  }
  console.log('[Identity] no wx/cloud environment, using MockIdentityAdapter (dev preview)');
  return new MockIdentityAdapter();
}
