/**
 * 服务器时间同步通道（V10-08，wx 全局绑定层）：调用云函数
 * `yaoling_time`（随任务交付，见 `cloudfunctions/time/`）取服务器毫秒，
 * 写入 TimeService（`syncWithServer` 偏移校准）。失败返回 false 并由调用方
 * 记录降级态（本地时钟容错），不阻断任何玩法路径。业务代码零 `wx.*`。
 */
import { TimeService } from './TimeService';

/** 云函数名（部署见 cloudfunctions/time/；换名需同步）。 */
export const TIME_CLOUD_FUNCTION_NAME = 'yaoling_time';

interface WxTimeCloud {
  init?: (options?: { env?: string; traceUser?: boolean }) => void;
  callFunction?: (options: {
    name: string;
    data?: Record<string, unknown>;
    success?: (res: { result?: unknown }) => void;
    fail?: (err: { errMsg?: string }) => void;
  }) => void;
}

/**
 * 发起一次服务器校时：成功返回 true 并完成 TimeService 偏移校准；
 * 无 wx/云环境或调用失败返回 false（保持本地容错态）。不抛错。
 */
export function syncServerTime(time: TimeService, cloudEnvId: string | null = null): Promise<boolean> {
  const wx = (globalThis as { wx?: { cloud?: WxTimeCloud } }).wx;
  const cloud = wx?.cloud;
  if (cloud === undefined || cloud.callFunction === undefined) {
    return Promise.resolve(false);
  }
  try {
    cloud.init?.({ env: cloudEnvId ?? undefined, traceUser: true });
  } catch {
    // init 失败继续尝试 callFunction，由其 fail 路径统一处理。
  }
  return new Promise<boolean>((resolve) => {
    cloud.callFunction?.({
      name: TIME_CLOUD_FUNCTION_NAME,
      data: {},
      success: (res) => {
        const result = res.result as { serverNow?: unknown } | undefined;
        const serverNow = typeof result?.serverNow === 'number' ? result.serverNow : NaN;
        if (!Number.isFinite(serverNow) || serverNow <= 0) {
          resolve(false);
          return;
        }
        time.syncWithServer(serverNow);
        resolve(true);
      },
      fail: () => resolve(false),
    });
  });
}
