/**
 * 震动适配（V10-06）：平台能力集中封装，业务代码零 `wx.*`。
 * 开关默认开启（与设置域默认值一致）；微信真机 vibrateShort('light')，
 * Creator/无 wx 环境为静默 no-op（不报错）。
 */

let vibrationEnabled = true;

export function setVibrationEnabled(enabled: boolean): void {
  vibrationEnabled = enabled;
}

export function isVibrationEnabled(): boolean {
  return vibrationEnabled;
}

/** 轻震动（按钮确认/结算等场景；调用方控制频率，不在热路径循环调用）。 */
export function vibrateShort(): void {
  if (!vibrationEnabled) {
    return;
  }
  const wexin = (globalThis as { wx?: { vibrateShort?: (options?: { type?: string }) => void } }).wx;
  wexin?.vibrateShort?.({ type: 'light' });
}
