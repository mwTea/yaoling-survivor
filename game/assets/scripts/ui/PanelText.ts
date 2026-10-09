/**
 * 局外面板展示文案（V05-11/V05-12）。
 *
 * 单文件叶子模块（零跨文件值导入，仅类型导入，可被 node 纯逻辑测试直接加载）：
 * 境界层数描述与突破未满足条件的中文文案。UI 只消费文案，不创造规则——
 * 数值与判断全部来自领域模块（PROGRESSION.md / UI_IA.md 第 5 节）。
 */
import type { RealmConfig } from '../config/ConfigTypes';

/** 境界当前层数描述：一层起；全部小境界推满为"圆满"。 */
export function describeRealmLine(
  realms: readonly RealmConfig[],
  realmIndex: number,
  subRealmIndex: number,
): string {
  const realm = realms[realmIndex];
  if (realm === undefined) {
    return '境界未知';
  }
  if (subRealmIndex >= realm.subRealmCosts.length) {
    return `${realm.displayName}圆满`;
  }
  return `${realm.displayName}第${subRealmIndex + 1}层`;
}

export type BreakthroughUnmetKey = 'xiuwei' | 'material' | 'playerLevel';

const UNMET_TEXT: Readonly<Record<BreakthroughUnmetKey, string>> = {
  xiuwei: '修为不足',
  material: '妖丹不足',
  playerLevel: '玩家等级不足',
};

/** 突破未满足条件的文案；空数组返回"无"。 */
export function unmetText(unmet: readonly BreakthroughUnmetKey[]): string {
  if (unmet.length === 0) {
    return '无';
  }
  return unmet
    .map((key) => UNMET_TEXT[key])
    .filter((text): text is string => text !== undefined)
    .join('、');
}
