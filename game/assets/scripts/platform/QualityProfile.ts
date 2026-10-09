/**
 * 画质档位纯语义（V10-06）：档位 → 目标帧率的灰盒映射，无 cc 依赖可 node 测试。
 * 0 = 自动（引擎默认 60）；1 = 流畅（30 FPS，省电优先）；2 = 高清（60 FPS）。
 * 分辨率缩放等重度手段不做（灰盒语义），真机表现随 V10-15 门禁复核。
 */

export type QualityProfile = 'auto' | 'fps30' | 'fps60';

export const QUALITY_ENGINE_DEFAULT_FRAME_RATE = 60;

export function resolveQualityProfile(tier: number): QualityProfile {
  if (tier === 1) {
    return 'fps30';
  }
  if (tier === 2) {
    return 'fps60';
  }
  return 'auto';
}

/** 档位目标帧率：auto 恒为引擎默认（保证从其他档位可回退）。 */
export function resolveQualityFrameRate(tier: number): number {
  return resolveQualityProfile(tier) === 'fps30' ? 30 : QUALITY_ENGINE_DEFAULT_FRAME_RATE;
}
