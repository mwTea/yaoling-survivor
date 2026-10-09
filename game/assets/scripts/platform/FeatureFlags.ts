/**
 * 功能开关（V08-06）：静态配置开关——稳定 ID、默认值与开关语义集中在本文件，
 * 新系统入口按开关隐藏/展示（关闭时入口隐藏，不显示假数据）。
 * V1.0 接远程开关时替换实现（默认值兜底 + 可降级），接口不变。
 *
 * 叶子模块：零跨文件值导入，可被 node 纯逻辑测试直接加载。
 */

export type FeatureFlagId =
  | 'stage_select' // 关卡选择页（V08-05）
  | 'profile' // 我的页（V08-06）
  | 'codex' // 图鉴（V08-11 实装后默认开启）
  | 'tasks' // 任务（V08-09 实装后默认开启）
  | 'shop' // 商店（V08-12/13 实装后默认开启）
  | 'achievements' // 成就（V08-10 实装后默认开启）
  | 'reward_center' // 奖励中心（V08-15 实装后默认开启）
  | 'login_reward'; // 30 日累计登录（V08-14 实装后默认开启）

export interface FeatureFlagDefinition {
  readonly id: FeatureFlagId;
  /** 开关语义（面向开发/验收，不直接做玩家文案）。 */
  readonly description: string;
  readonly enabledByDefault: boolean;
}

const DEFINITIONS: readonly FeatureFlagDefinition[] = [
  { id: 'stage_select', description: '关卡选择页（章节/难度/里程碑领取）', enabledByDefault: true },
  { id: 'profile', description: '我的页（账号概览/存档信息/清档重开）', enabledByDefault: true },
  { id: 'tasks', description: '任务系统入口（V08-09 实装）', enabledByDefault: true },
  { id: 'achievements', description: '成就入口（V08-10 实装）', enabledByDefault: true },
  { id: 'codex', description: '图鉴入口（V08-11 实装）', enabledByDefault: true },
  { id: 'shop', description: '商店入口（V08-13 实装）', enabledByDefault: true },
  { id: 'reward_center', description: '奖励中心入口（V08-15 实装）', enabledByDefault: true },
  { id: 'login_reward', description: '30 日累计登录入口（V08-14 实装）', enabledByDefault: true },
];

const ENABLED_BY_DEFAULT: ReadonlySet<FeatureFlagId> = new Set(
  DEFINITIONS.filter((definition) => definition.enabledByDefault).map((definition) => definition.id),
);

export function getFeatureFlagDefinitions(): readonly FeatureFlagDefinition[] {
  return DEFINITIONS;
}

export function isFeatureFlagId(value: string): value is FeatureFlagId {
  return DEFINITIONS.some((definition) => definition.id === value);
}

/** 开关查询：未知 ID 恒为关闭（安全默认值）；V1.0 远程开关在此处接入覆盖逻辑。 */
export function isFeatureEnabled(id: FeatureFlagId): boolean {
  return ENABLED_BY_DEFAULT.has(id);
}
