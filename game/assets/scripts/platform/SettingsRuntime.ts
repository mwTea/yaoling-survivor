import { game } from 'cc';

import { AudioService } from './AudioService';
import { resolveQualityFrameRate } from './QualityProfile';
import { setVibrationEnabled } from './Vibration';
import type { SettingsSaveState } from '../account/AccountSave';

/**
 * 设置域运行时应用（V10-06）：把存档设置域一次性生效到各平台服务——
 * 音量（AudioService）、震动开关、画质档位（目标帧率）。
 * 启动装配（AccountSystem.onLoad / AudioService.onLoad 兜底）与设置页实时
 * 变更（ProfilePanel）都走本入口，禁止各服务自行读存档拼装语义。
 */
export function applyRuntimeSettings(settings: SettingsSaveState): void {
  AudioService.instance?.applySettings(settings);
  setVibrationEnabled(settings.vibrationEnabled);
  game.frameRate = resolveQualityFrameRate(settings.qualityTier);
}
