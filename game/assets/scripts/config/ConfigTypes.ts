export type ConfigId = string;

export interface LevelCurveEntry {
  readonly level: number;
  readonly requiredXp: number;
}

export interface PlayerConfig {
  readonly moveSpeed: number;
  readonly collisionRadius: number;
  /** 玩家最大生命。 */
  readonly maxHp: number;
  /** 受击后的无敌帧时长（秒）；期间重复接触不扣血。 */
  readonly invulnerableSeconds: number;
}

export interface RectangleBoundsConfig {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

export interface MonsterConfig {
  readonly id: ConfigId;
  /** 展示名（如"妖奴"）；图鉴/UI 与日志使用，不参与关联。 */
  readonly displayName: string;
  readonly prefabId: ConfigId;
  readonly maxHp: number;
  readonly moveSpeed: number;
  readonly contactDamage: number;
  readonly xpValue: number;
  readonly collisionRadius: number;
}

export interface WeaponConfig {
  readonly id: ConfigId;
  /** 法器展示名（如"青霄剑"）；UI 与日志使用，不参与关联。 */
  readonly displayName: string;
  readonly projectileId: ConfigId;
  readonly baseDamage: number;
  readonly cooldown: number;
  readonly minCooldown: number;
  readonly projectileCount: number;
  readonly maxProjectileCount: number;
  readonly maxActiveProjectiles: number;
  readonly projectileSpreadDegrees: number;
  readonly attackRadius: number;
  readonly targetRetryInterval: number;
}

export interface ProjectileConfig {
  readonly id: ConfigId;
  readonly prefabId: ConfigId;
  readonly speed: number;
  readonly lifetime: number;
  readonly collisionRadius: number;
}

export interface WeightedMonster {
  readonly monsterId: ConfigId;
  readonly weight: number;
  /** 精英前缀：可选；true 时按 eliteModifier 强化该条目生成的怪物。 */
  readonly elite?: boolean;
}

/**
 * 星级条件（V08-02 schema，V08-04 接入战斗判定）：按数组下标对应第 1～3 星；
 * 第一星恒为通关（kind 'clear'），校验强制。
 */
export type StarCondition =
  | { readonly kind: 'clear' }
  | { readonly kind: 'hpRatioAbove'; readonly ratio: number }
  | { readonly kind: 'timeUnder'; readonly seconds: number }
  | { readonly kind: 'hitTakenAtMost'; readonly count: number };

/**
 * 关卡难度档（V08-02，阶段决策 3）：配置化数值/奖励乘数 + 解锁条件；
 * "改变机制"的行为差异不做（记录为后续内容迭代）。乘数作用于基础怪物/Boss
 * 运行态快照与结算奖励（逐项相乘后取整），不改写配置对象。
 */
export interface StageDifficultyConfig {
  readonly id: ConfigId;
  readonly displayName: string;
  readonly hpMultiplier: number;
  readonly speedMultiplier: number;
  readonly contactDamageMultiplier: number;
  readonly xpMultiplier: number;
  /** 结算奖励乘数（对 StageRewardConfig 全额值与里程碑奖励逐项相乘）。 */
  readonly rewardMultiplier: number;
  /** 解锁条件：同一关卡前一难度档历史最高星 >= 该值；首档必须为 0（恒解锁）。 */
  readonly requiredStarsOnPrevious: number;
}

/** 里程碑奖励发放内容（首通/星级累计；金额为基础值，发放时按难度奖励乘数取整）。 */
export interface StageMilestoneGrant {
  /** 账号经验（不入库存，只进玩家等级）。 */
  readonly accountXp: number;
  /** 资源发放（resourceId → 正整数数量）。 */
  readonly resources: Readonly<Record<ConfigId, number>>;
}

/**
 * 关卡一次性里程碑奖励（V08-02，阶段决策 8）：按难度档各自领取一次
 * （存档 stageRecords 以 stageId|difficultyId 记录 firstClearClaimed/claimedStarRewardTiers）。
 * perStar[N-1] 为"历史最高星达到 N+1 星时可领取"的累计档；长度恒 3。
 */
export interface StageMilestoneRewardsConfig {
  readonly firstClear: StageMilestoneGrant;
  readonly perStar: readonly StageMilestoneGrant[];
}

/**
 * 章节（V08-02）：有序关卡引用即章内关卡顺序与解锁链（前一关通关解锁下一关）；
 * 解锁条件为完成 requiredChapterId 章节（其全部关卡通关，任意难度），null = 初始解锁。
 */
export interface ChapterConfig {
  readonly id: ConfigId;
  readonly displayName: string;
  readonly stageIds: readonly ConfigId[];
  readonly requiredChapterId: ConfigId | null;
}

/** 任务周期（V08-08）：主线永久桶不重置；每日/每周按 TimeService 的 dayKey/weekKey 重置。 */
export type TaskPeriod = 'main' | 'daily' | 'weekly';

/** 任务条件（V08-08）：全部可由既有领域事件驱动累计。 */
export type TaskCondition =
  | { readonly kind: 'killCount'; readonly target: number } // monsterDied 次数
  | { readonly kind: 'clearCount'; readonly target: number } // battleFinished=victory 次数
  | { readonly kind: 'collectXp'; readonly target: number } // experienceCollected 累计量
  | { readonly kind: 'levelUpCount'; readonly target: number } // levelUpResolved 次数
  | { readonly kind: 'spendResource'; readonly resourceId: ConfigId; readonly target: number }; // 经济 spend 累计量

/** 任务奖励（V08-08）：资源经经济事务入账，账号经验只进玩家等级。 */
export interface TaskReward {
  readonly accountXp: number;
  readonly resources: Readonly<Record<ConfigId, number>>;
}

/**
 * 任务配置（V08-08）：前置任务领取奖励后开放（前置未完成不累计进度）；
 * 每日/每周任务周期重置时进度与领取态整桶清空。
 */
export interface TaskConfig {
  readonly id: ConfigId;
  readonly displayName: string;
  readonly description: string;
  readonly period: TaskPeriod;
  readonly condition: TaskCondition;
  readonly reward: TaskReward;
  readonly prerequisiteTaskId: ConfigId | null;
}

/** 成就条件（V08-10）：与任务条件同语义（无周期、无前置），阶段目标在 tiers 中。 */
export type AchievementCondition =
  | { readonly kind: 'killCount' }
  | { readonly kind: 'clearCount' }
  | { readonly kind: 'collectXp' }
  | { readonly kind: 'levelUpCount' }
  | { readonly kind: 'spendResource'; readonly resourceId: ConfigId };

/** 成就分级阶段（V08-10）：升序目标；每档奖励领取一次（灵玉首次投放来源）。 */
export interface AchievementTier {
  readonly target: number;
  readonly reward: TaskReward;
}

/**
 * 成就配置（V08-10）：永久累计进度（只进不退）+ 分级阶段；领取与完成分离。
 * hidden 成就在累计进度达到第一阶目标前不在列表与红点出现。
 */
export interface AchievementConfig {
  readonly id: ConfigId;
  readonly displayName: string;
  readonly description: string;
  readonly condition: AchievementCondition;
  readonly tiers: readonly AchievementTier[];
  readonly hidden: boolean;
}

/** 商品内容（V08-12）：发放资源（灵兽灵魄即按兽隔离的资源项）。 */
export interface ShopGoods {
  readonly resourceId: ConfigId;
  readonly amount: number;
}

/** 商品（V08-12）：单一资源内容 + 单币种价格；dailyRefresh 为 true 时限购按 dayKey 重置。 */
export interface ShopItemConfig {
  readonly id: ConfigId;
  readonly displayName: string;
  readonly description: string;
  readonly goods: ShopGoods;
  /** 价格币种（资源配置 ID：res_lingshi / res_lingyu）。 */
  readonly priceType: ConfigId;
  readonly price: number;
  /** 刷新周期内限购次数（正整数；dailyRefresh=false 时为永久总限购）。 */
  readonly purchaseLimit: number;
  readonly dailyRefresh: boolean;
}

/** 商品组（V08-12）：有序商品引用，供商店页分组展示。 */
export interface ShopGroupConfig {
  readonly id: ConfigId;
  readonly displayName: string;
  readonly itemIds: readonly ConfigId[];
}

/** 30 日累计登录单档奖励（V08-14）：day 1..totalDays 升序，每档领取一次。 */
export interface LoginRewardTierConfig {
  readonly day: number;
  readonly reward: TaskReward;
}

/**
 * 累计登录配置（V08-14）：不要求连续、不补签、漏登不清零；
 * 第 totalDays 档领完本轮结束，首发一次性不循环。
 */
export interface LoginRewardConfig {
  readonly totalDays: number;
  readonly tiers: readonly LoginRewardTierConfig[];
}

/** 礼包解锁条件（V08-15，ECONOMY §5 免费子集）：等级/章节首通/境界档。 */
export type OfferUnlockCondition =
  | { readonly kind: 'playerLevel'; readonly level: number }
  | { readonly kind: 'chapterClear'; readonly chapterId: ConfigId }
  | { readonly kind: 'realmIndex'; readonly realmIndex: number };


/** 活动类型（V0.8 仅 login：登录活动壳编排 30 日累计登录）。 */
export type ActivityType = 'login';

/** 活动展示与参与窗口（dayKey 字典序比较）；null = 永久开放。 */
export interface ActivityWindowConfig {
  readonly startDayKey: string;
  readonly endDayKey: string;
}

/**
 * 基础活动壳（V08-16）：ID/类型/展示与参与窗口/功能开关/内容引用；
 * 活动实例只编排既有系统（login → LoginReward），不建第二套领取逻辑。
 */
export interface ActivityConfig {
  readonly id: ConfigId;
  readonly displayName: string;
  readonly type: ActivityType;
  /** 内容引用（login 类型恒引用 loginRewards 配置）。 */
  readonly contentRef: ConfigId;
  /** 功能开关 ID（运行时未知开关按关闭处理——安全默认值）。 */
  readonly featureFlag: string;
  readonly window: ActivityWindowConfig | null;
}

/**
 * 统一礼包模型（V08-15，ECONOMY §5 免费子集）：priceType 恒 'free'、price 恒 0
 * （付费/广告子集 V0.8 不做，字段保留对齐统一模型）；领取计数即限购判据。
 */
export interface OfferConfig {
  readonly id: ConfigId;
  readonly displayName: string;
  readonly description: string;
  readonly contents: TaskReward;
  readonly priceType: 'free';
  readonly price: 0;
  readonly unlockCondition: OfferUnlockCondition;
  /** 免费礼包恒 1（领取一次）。 */
  readonly purchaseLimit: 1;
  /** 前置礼包未领取不可领后继。 */
  readonly prerequisiteOfferId: ConfigId | null;
}

/** 精英前缀修饰（作用于基础怪物运行态快照，不改写基础配置）。 */
export interface EliteModifierConfig {
  readonly hpMultiplier: number;
  readonly speedMultiplier: number;
  readonly contactDamageMultiplier: number;
  readonly xpMultiplier: number;
  readonly collisionRadiusMultiplier: number;
}

export interface SpawnWaveConfig {
  readonly id: ConfigId;
  readonly startTime: number;
  readonly endTime: number;
  readonly spawnInterval: number;
  readonly batchSize: number;
  readonly monsters: readonly WeightedMonster[];
}

export interface StageConfig {
  readonly id: ConfigId;
  /** 展示名（如"外门第一试"）；UI 与日志使用，不参与关联。 */
  readonly displayName: string;
  /** 归属章节（ChapterConfig）ID；必须与该章节 stageIds 双向一致。 */
  readonly chapterId: ConfigId;
  readonly duration: number;
  readonly activeMonsterSoftCap: number;
  readonly activeMonsterHardCap: number;
  readonly spawnMinRadius: number;
  readonly spawnMaxRadius: number;
  readonly playArea: RectangleBoundsConfig;
  readonly waveIds: readonly ConfigId[];
  /** 该关 Boss（BossConfig）ID；null = 无 Boss 关（存活到时长即胜利）。 */
  readonly bossId: ConfigId | null;
  /** 三星条件集：长度恒 3，下标即星序；第一星恒为通关。 */
  readonly starConditions: readonly StarCondition[];
  /** 难度档列表（至少 1 档，首档恒解锁；顺序即解锁链）。 */
  readonly difficulties: readonly StageDifficultyConfig[];
  /** 首通/星级累计一次性里程碑奖励（基础值，发放按难度奖励乘数取整）。 */
  readonly milestoneRewards: StageMilestoneRewardsConfig;
}

export type UpgradeEffect =
  | { readonly kind: 'addSwordDamage'; readonly value: number }
  | { readonly kind: 'multiplySwordCooldown'; readonly value: number }
  | { readonly kind: 'addSwordCount'; readonly value: number };

export interface UpgradeOptionConfig {
  readonly id: ConfigId;
  readonly title: string;
  readonly description: string;
  readonly maxStacks: number;
  readonly weight: number;
  readonly effects: readonly UpgradeEffect[];
}

/** Boss 径向弹幕参数；enraged 为半血以下阶段的发射间隔。 */
export interface BossRadialBurstConfig {
  readonly count: number;
  readonly damage: number;
  readonly burstIntervalSeconds: number;
  readonly enragedIntervalSeconds: number;
}

/** Boss 配置；数值即有效值（不走精英乘数）。 */
export interface BossConfig {
  readonly id: ConfigId;
  readonly displayName: string;
  readonly spawnTime: number;
  readonly maxHp: number;
  readonly moveSpeed: number;
  readonly contactDamage: number;
  readonly xpValue: number;
  readonly collisionRadius: number;
  readonly radialBurst: BossRadialBurstConfig;
}

/** 局内法宝效果：噬妖幡（value=每次击杀回复生命）。 */
export type TreasureEffect = { readonly kind: 'healOnKill'; readonly value: number };

/** 局内法宝配置：触发型被动；与升级/功法同构进三选一候选池。 */
export interface TreasureConfig {
  readonly id: ConfigId;
  readonly title: string;
  readonly description: string;
  readonly maxStacks: number;
  readonly weight: number;
  readonly effects: readonly TreasureEffect[];
}

/** 局内功法效果：剑气冲击（value=每层剑气数）与护体罡气（value=每层减伤比例）。 */
export type GongfaEffect =
  | {
    readonly kind: 'addSwordQi';
    readonly value: number;
    readonly intervalSeconds: number;
    readonly damageFactor: number;
  }
  | { readonly kind: 'contactDamageReduction'; readonly value: number };

/** 局内功法配置；与 UpgradeOptionConfig 同构（title/description/maxStacks/weight）进三选一候选池。 */
export interface GongfaConfig {
  readonly id: ConfigId;
  readonly title: string;
  readonly description: string;
  readonly maxStacks: number;
  readonly weight: number;
  readonly effects: readonly GongfaEffect[];
}

/** 经验掉落物（绿宝石）配置；maxActiveCount 是同时在场硬上限（池容量）。 */
export interface ExperiencePickupConfig {
  readonly id: ConfigId;
  readonly prefabId: ConfigId;
  readonly pickupRadius: number;
  readonly maxActiveCount: number;
}

/**
 * 局外资源配置（V0.5 经济）；库存为通用 resourceId 结构（存档 balances 域），
 * 后续新增资源（如灵玉）仅为数据项，不改结构。数量一律整数最小单位。
 */
export interface ResourceConfig {
  readonly id: ConfigId;
  /** 展示名（如"灵石"）；UI 与日志使用，不参与关联。 */
  readonly displayName: string;
  /** 库存上限（正整数）；发放超出部分被钳制并明确报告丢失。 */
  readonly capacity: number;
}

/**
 * 账号玩家等级配置（V0.5 局外成长）。与局内 levelCurve（战斗等级）完全无关；
 * 曲线长度即满级；满级策略为溢出保留（见 CONFIG.md）。
 */
export interface PlayerLevelConfig {
  /** 账号等级曲线：level 从 1 连续递增，requiredXp 为当前级升到下一级所需账号经验。 */
  readonly levelCurve: readonly LevelCurveEntry[];
}

/** 大境界突破条件（V0.5）。突破只消耗页面明确列出的资源，无失败机制（PROGRESSION.md）。 */
export interface RealmBreakthroughConfig {
  /** 突破消耗的修为（存档 balances 域的 res_xiuwei 整数消耗）。 */
  readonly xiuweiCost: number;
  /** 突破消耗的养成材料资源 ID（当前为 res_yaodan 妖丹）。 */
  readonly materialId: ConfigId;
  readonly materialCost: number;
  /** 可选玩家等级门槛；0 表示无门槛。 */
  readonly requiredPlayerLevel: number;
}

/**
 * 大境界配置（有序，数组下标即境界顺序）。小境界推进消耗存档库存 res_xiuwei，
 * 不设独立修为进度条字段（ECONOMY 事务语义）。
 */
export interface RealmConfig {
  readonly id: ConfigId;
  readonly displayName: string;
  /** 有序小境界的修为消耗列表，长度即小境界数量；第 N 项为第 N 层推进所需修为。 */
  readonly subRealmCosts: readonly number[];
  /** 进入该大境界带来的 maxHp 增量（克制；总收益为其与之前所有境界的增量之和）。 */
  readonly maxHpBonus: number;
  /** 突破到下一大境界的条件；最后一个大境界为 null。 */
  readonly breakthrough: RealmBreakthroughConfig | null;
}

/**
 * 法器局外培养配置（V0.5）。法器等级为永久养成，提升基础攻击参数；
 * 实际生效等级上限 = min(maxLevel, 玩家等级)。绝学/流派仅预留稳定 ID 字段，
 * V0.5 不实现效果（首发数量与效果待内容表立项，PROGRESSION.md）。
 */
export interface WeaponGrowthConfig {
  /** 关联的法器（局内 WeaponConfig）ID。 */
  readonly weaponId: ConfigId;
  /** 配置等级上限（与玩家等级取小后生效）。 */
  readonly maxLevel: number;
  /** 升级消耗列表（res_lingshi）；第 i 项为从第 i+1 级升到第 i+2 级的消耗，长度 = maxLevel - 1。 */
  readonly levelUpCosts: readonly number[];
  /** 每级基础攻击伤害增量（等级 L 的加成 = damagePerLevel × (L - 1)）。 */
  readonly damagePerLevel: number;
  /** 绝学/流派稳定 ID 预留；V0.5 为空数组，不建立效果。 */
  readonly ultimateIds: readonly ConfigId[];
}

/** 出战灵兽触发技能效果（V0.5）：仅定义结构，战斗接入在 V05-08；持有被动 V0.5 不做。 */
export type BeastSkillEffect =
  | {
    readonly kind: 'damageNearest';
    readonly intervalSeconds: number;
    readonly damage: number;
    readonly projectileCount: number;
  }
  | { readonly kind: 'heal'; readonly intervalSeconds: number; readonly value: number };

/**
 * 灵兽配置（V0.5 首批五兽）。解锁/升星消耗对应灵魄（按兽隔离，soulResourceId 显式声明）；
 * 等级上限 = levelUpCosts.length + 1 且受玩家等级钳制；星级上限 = starUpCosts.length（0 星起步）。
 */
export interface BeastConfig {
  readonly id: ConfigId;
  readonly displayName: string;
  /** 该灵兽的灵魄资源 ID（如 res_lingpo_qinglong）。 */
  readonly soulResourceId: ConfigId;
  /** 解锁所需自身灵魄数量；0 表示默认解锁（初始灵兽）。 */
  readonly unlockSoulCost: number;
  /** 升级消耗列表（res_lingshi）；长度 = 满级 - 1。 */
  readonly levelUpCosts: readonly number[];
  /** 升星消耗列表（自身灵魄）；第 i 项为从 i 星到 i+1 星，长度 = 星级上限。 */
  readonly starUpCosts: readonly number[];
  /** 出战触发技能（未出战不生效）。 */
  readonly skill: BeastSkillEffect;
  /** 技能说明（UI 展示用，不参与关联）。 */
  readonly skillDescription: string;
}

/**
 * 单关结算奖励配置（V0.5 产消闭环数据面）：victory 全额发放；
 * defeat/abort 按保留比例逐项向下取整（CONTENT.md：失败/退出保留比例配置化）。
 * 账号经验与库存资源均为整数；资源以 resourceId 显式声明，禁止隐式映射。
 */
export interface StageRewardConfig {
  /** 关联的关卡（StageConfig）ID。 */
  readonly stageId: ConfigId;
  /** 胜利全额账号经验（账号玩家等级专用，不入库存）。 */
  readonly accountXp: number;
  /** 胜利全额资源发放（resourceId → 正整数数量）。 */
  readonly resources: Readonly<Record<ConfigId, number>>;
  /** 失败保留比例 [0,1]。 */
  readonly defeatRatio: number;
  /** 主动退出保留比例 [0,1]。 */
  readonly abortRatio: number;
}

/**
 * 功能解锁条件（V10-02）：玩家进度为主、账号创建天数为辅（GAME_LOOP §4；
 * PROGRESSION §2：玩家等级为主要解锁杠杆）。条件参数显式命名，不做布尔组合
 * （首发单条件足够；组合需求出现时再扩展，不预设）。
 */
export type UnlockCondition =
  | { readonly kind: 'always' } // 首次进入即可用（首页/关卡/基础法器）
  | { readonly kind: 'playerLevel'; readonly level: number } // 账号玩家等级达到
  | { readonly kind: 'stageClear'; readonly stageId: ConfigId } // 章节内推进：通关指定关卡（任意难度）
  | { readonly kind: 'chapterClear'; readonly chapterId: ConfigId } // 章节通关：指定章节全部关卡通关
  | { readonly kind: 'realmIndex'; readonly realmIndex: number } // 大境界下标达到
  | { readonly kind: 'accountAgeDays'; readonly days: number }; // 账号创建天数达到（服务器时间语义）

/** 未解锁时入口表现：hide = 直接隐藏；show_condition = 保留入口并显示条件文案。 */
export type UnlockLockedBehavior = 'hide' | 'show_condition';

/**
 * 功能解锁表条目（V10-02）：featureId 为稳定功能 ID（导航/面板入口绑定），
 * 与 FeatureFlags 取交集——开关关闭恒隐藏，开关开启且未解锁按 lockedBehavior 表现
 * （GAME_LOOP §4：未解锁入口可隐藏或显示明确条件，不制造无解释红点）。
 */
export interface UnlockConfig {
  readonly id: ConfigId;
  readonly featureId: ConfigId;
  readonly condition: UnlockCondition;
  readonly lockedBehavior: UnlockLockedBehavior;
  /** 未解锁提示文案（lockedBehavior 为 show_condition 时必须非空）。 */
  readonly lockedText: string;
  /** 功能开关 ID（FeatureFlags）；null = 无开关维度。未知开关按关闭处理。 */
  readonly featureFlag: string | null;
}

/**
 * 引导领域事件（V10-03）：表现层（V10-04）从真实战斗/界面事件映射后投递给
 * GuideSystem 的语义事件；界面进入（battle/home）也是事件，不设独立触发种类。
 * 数据层只认这组稳定 ID，不直接订阅 BattleEventBus。
 */
export type GuideEventId =
  | 'guide_home_entered' // 返回/进入首页
  | 'guide_battle_started' // 进入战斗局
  | 'guide_move_started' // 首次移动输入
  | 'guide_attack_fired' // 首次自动攻击发射
  | 'guide_xp_collected' // 首次经验拾取
  | 'guide_levelup_resolved' // 首次三选一完成
  | 'guide_settlement_shown' // 结算面板出现
  | 'guide_cultivate_opened'; // 首次打开修行/灵兽面板（首次培养）

/**
 * 引导步骤类型（V10-03）：strong = 强引导遮罩（战斗暂停/聚焦，仅首次核心操作，
 * 白名单在配置校验中强制）；weak = 弱提示（不阻塞战斗）；info = 纯说明。
 */
export type GuideStepType = 'strong' | 'weak' | 'info';

/** 步骤归属场景（V10-04 补充定案）：表现层按场景过滤，战斗步骤不上首页。 */
export type GuideStepScene = 'battle' | 'home';

/** 引导步骤（V10-03）：nextStepId 显式成链（null = 最后一步）；可跳过步骤不得为 strong。 */
export interface GuideStepConfig {
  readonly id: ConfigId;
  /** 步骤名（验收/调试识别；表现层气泡标题可用）。 */
  readonly displayName: string;
  /** 气泡/说明文案（正式文案随美术接入评审，规则语义不变）。 */
  readonly description: string;
  readonly type: GuideStepType;
  /** 归属场景：battle 步骤仅在战斗遮罩层显示；home 步骤仅在首页显示。 */
  readonly scene: GuideStepScene;
  /** 触发事件：脚本入口步骤的触发即"开始脚本"；后续步骤触发为表现层展示时机参考。 */
  readonly trigger: GuideEventId;
  /** 完成事件：仅当本步骤为当前活跃步骤时生效（链式推进）。 */
  readonly completionEvent: GuideEventId;
  readonly nextStepId: ConfigId | null;
  readonly skippable: boolean;
  /** 表现层高亮锚点 ID（UI 侧解析；表现层对未知锚点回退居中展示）。 */
  readonly anchorId: string;
}

/**
 * 引导脚本（V10-03）：单一首发脚本（GAME_LOOP §5 最短闭环）。
 * version 用于改版迁移：与存档引导域 scriptVersion 不一致且非 0 的老玩家不重卡。
 */
export interface GuideScriptConfig {
  readonly version: number;
  /** 引导总开关（false = 完全关闭：不启动、不显示、零写入；保留脚本随时可开）。 */
  readonly enabled: boolean;
  readonly entryStepId: ConfigId;
  readonly steps: readonly GuideStepConfig[];
}

/**
 * 音频分组（V10-05）：BGM/技能/命中/UI 四组；组音量基线 × 设置域主音量
 * （bgm→settings.bgmVolume，其余→settings.sfxVolume）为实际播放音量。
 */
export type AudioChannelId = 'bgm' | 'skill' | 'hit' | 'ui';

export interface AudioChannelConfig {
  readonly channel: AudioChannelId;
  /** 组音量基线 0～100。 */
  readonly volume: number;
  /** 同组并发上限（同组第 N+1 个未过期播放请求被拒绝）。 */
  readonly maxConcurrent: number;
  /** 同组两次播放最小间隔毫秒（高频组节流；0 = 不节流）。 */
  readonly minIntervalMs: number;
  /** 组开关（静态配置；设置域音量 0 即静音，独立维度）。 */
  readonly enabled: boolean;
}

export interface AudioClipBinding {
  /** 音频剪辑 ID（= Creator 音频资产名，如 sfx_levelup）。 */
  readonly id: ConfigId;
  readonly channel: AudioChannelId;
}

export interface AudioConfig {
  readonly channels: readonly AudioChannelConfig[];
  readonly clips: readonly AudioClipBinding[];
}

/** 激励广告位类型（V1.0 仅 rewarded；插屏默认关闭仅远程开关预留）。 */
export type AdPlacementType = 'rewarded';

export interface AdPlacementConfig {
  readonly id: ConfigId; // 稳定投放 ID（ad_revive 等）
  readonly type: AdPlacementType;
  /** 微信广告位 ID（用户提供；空串 = 未配置，运行时回退模拟/失败）。 */
  readonly adUnitId: string;
  readonly enabled: boolean;
}

/**
 * 战斗复活配置（V10-10，GAME_LOOP §6）：全部配置化；每日次数入存档审计
 * （offerClaims 键 ad_<placement>_<dayKey>），每局次数为战斗运行态。
 */
/**
 * 结算广告加成（V10-11，GAME_LOOP §6/ECONOMY §6）：结算页可选激励位，
 * 对本局已结算奖励按倍率补差（发放 = floor(基础×倍率) − 本局已发，幂等）。
 * 仅 victory/defeat 可用（abort 不提供）；次数每日配置化。
 */
export interface AdSettlementBonusConfig {
  /** 引用 placements 的投放 ID。 */
  readonly placementId: ConfigId;
  /** 奖励倍率（>1；2 = 翻倍）。补差 = floor(基础值×倍率) − 本局已发。 */
  readonly rewardMultiplier: number;
  /** 每日可用次数（跨局累计，存档审计）。 */
  readonly maxPerDay: number;
  /** 提供本位的结果（abort 不提供——主动退出不属于激励场景）。 */
  readonly results: readonly BattleResultLiteral[];
}

/**
 * 每日广告资源位（V10-11，ECONOMY §6"每日有限资源"）：首页入口，观看激励
 * 广告领固定资源包；每日有限次数（存档审计），冷却分钟数（0 = 无冷却）。
 */
export interface AdDailyResourceConfig {
  /** 引用 placements 的投放 ID。 */
  readonly placementId: ConfigId;
  /** 每次发放的资源包（resourceId → 正整数）。 */
  readonly resources: Readonly<Record<ConfigId, number>>;
  /** 每日次数上限。 */
  readonly maxPerDay: number;
  /** 同日两次领取最小间隔分钟（0 = 不限）。 */
  readonly cooldownMinutes: number;
}

export type BattleResultLiteral = 'victory' | 'defeat' | 'abort';

export interface AdReviveConfig {
  /** 引用 placements 的投放 ID。 */
  readonly placementId: ConfigId;
  /** 每局复活次数上限。 */
  readonly maxPerBattle: number;
  /** 每日复活次数上限（跨局累计，存档审计）。 */
  readonly maxPerDay: number;
  /** 复活后无敌秒数（>0）。 */
  readonly invulnerableSeconds: number;
  /** 复活回复比例 [0,1]（按 maxHp 折算）。 */
  readonly hpRestoreRatio: number;
  /** 不可用关卡（如 Boss 关/首发关）；列表内 stageId 不提供复活。 */
  readonly disabledStageIds: readonly ConfigId[];
}

/** 三选一"换一批"广告位（V10-11 追加，用户定案）：每局次数配置化。 */
export interface AdRerollConfig {
  readonly placementId: ConfigId;
  readonly maxPerBattle: number;
}

export interface AdConfig {
  readonly placements: readonly AdPlacementConfig[];
  readonly revive: AdReviveConfig;
  readonly settlementBonus: AdSettlementBonusConfig;
  readonly dailyResource: AdDailyResourceConfig;
  readonly reroll: AdRerollConfig;
}

export interface GameConfig {
  readonly initialStageId: ConfigId;
  readonly player: PlayerConfig;
  readonly monsters: readonly MonsterConfig[];
  readonly projectiles: readonly ProjectileConfig[];
  readonly weapons: readonly WeaponConfig[];
  readonly pickups: readonly ExperiencePickupConfig[];
  readonly resources: readonly ResourceConfig[];
  readonly spawnWaves: readonly SpawnWaveConfig[];
  readonly eliteModifier: EliteModifierConfig;
  readonly bosses: readonly BossConfig[];
  readonly gongfas: readonly GongfaConfig[];
  readonly treasures: readonly TreasureConfig[];
  readonly chapters: readonly ChapterConfig[];
  readonly stages: readonly StageConfig[];
  readonly levelCurve: readonly LevelCurveEntry[];
  readonly playerLevel: PlayerLevelConfig;
  readonly realms: readonly RealmConfig[];
  readonly weaponGrowth: readonly WeaponGrowthConfig[];
  readonly beasts: readonly BeastConfig[];
  readonly stageRewards: readonly StageRewardConfig[];
  readonly tasks: readonly TaskConfig[];
  readonly achievements: readonly AchievementConfig[];
  readonly shopGroups: readonly ShopGroupConfig[];
  readonly shopItems: readonly ShopItemConfig[];
  readonly offers: readonly OfferConfig[];
  readonly activities: readonly ActivityConfig[];
  readonly loginRewards: LoginRewardConfig;
  readonly upgrades: readonly UpgradeOptionConfig[];
  readonly unlocks: readonly UnlockConfig[];
  readonly guide: GuideScriptConfig;
  readonly audio: AudioConfig;
  readonly ads: AdConfig;
}
