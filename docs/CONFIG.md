# CONFIG — 配置规范与扩展目录

## 总则

- 所有配置使用稳定、可读的 `snake_case` ID；显示文本不是 ID。
- 单位统一：时间为秒、距离/速度为 Creator 世界单位、概率为 `[0,1]`、角度为度、生命/伤害/经验为整数。
- 配置加载后深度只读；运行态绝不写回配置。
- 引用字段以 `Id`/`Ids` 结尾，并在启动校验中验证目标存在。
- Phase 0 可使用 TypeScript 常量表；若改为 JSON/远程配置，schema 类型和验证器仍是唯一入口。
- 配置定义“规则与内容”，存档记录“玩家状态”，运行态记录“当局状态”；三者禁止混写。
- 后续设计条目只有进入 `ROADMAP.md` 当前阶段并建立任务后才可加入运行时 schema；本节扩展目录不是实现要求。

## 公共类型

```ts
type ConfigId = string;

interface LevelCurveEntry {
  readonly level: number;
  readonly requiredXp: number;
}
```

`requiredXp` 表示从当前等级升到下一等级所需经验，不是累计阈值。等级必须从 1 连续递增，数值必须为正整数。

## PlayerConfig

```ts
interface PlayerConfig {
  readonly moveSpeed: number;
  readonly collisionRadius: number;
  readonly maxHp: number;
  readonly invulnerableSeconds: number;
}
```

`moveSpeed` 和 `collisionRadius` 必须为正数；`maxHp` 为正整数；`invulnerableSeconds`（受击后无敌帧，秒）非负。MVP 使用单一玩家配置，不为尚未存在的角色选择系统提前建立配置表。

## MonsterConfig

```ts
interface MonsterConfig {
  readonly id: ConfigId;
  readonly displayName: string;   // 展示名（图鉴/UI）；不参与关联
  readonly prefabId: ConfigId;
  readonly maxHp: number;
  readonly moveSpeed: number;
  readonly contactDamage: number;
  readonly xpValue: number;
  readonly collisionRadius: number;
}
```

校验：`displayName` 非空；数值有限；`maxHp > 0`、`moveSpeed >= 0`、`contactDamage >= 0`、`xpValue >= 0`、`collisionRadius > 0`。

V0.1 起始数值变更：`monster_basic.contactDamage` 0 → 2（玩家受击系统启用，配合 `player.invulnerableSeconds: 0.8` 形成可观察的受击节奏）。

V0.8 新怪（V08-02，阶段决策 4：配置区分，灰盒视觉复用 `prefab_monster_basic`）：`monster_yaonu` 妖奴（HP 14 / 速 140 / 接触 2 / 经验 1）、`monster_duzhu` 毒蛛（HP 26 / 速 105 / 接触 3 / 经验 2）、`monster_shiren` 石人（HP 60 / 速 55 / 接触 4 / 经验 3）；`monster_basic` 展示名定为"妖卒"。

## WeaponConfig / ProjectileConfig

```ts
interface WeaponConfig {
  readonly id: ConfigId;
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

interface ProjectileConfig {
  readonly id: ConfigId;
  readonly prefabId: ConfigId;
  readonly speed: number;
  readonly lifetime: number;
  readonly collisionRadius: number;
}
```

校验：`displayName` 非空；伤害非负；所有时间/半径/速度为正；`cooldown >= minCooldown`；数量为正整数且不超过上限；`maxActiveProjectiles`（同时在场投射物硬上限，即池容量）为正整数；`projectileSpreadDegrees`（多发时相邻投射物的散射夹角）非负；引用存在。

## ExperiencePickupConfig

```ts
interface ExperiencePickupConfig {
  readonly id: ConfigId;
  readonly prefabId: ConfigId;
  readonly pickupRadius: number;
  readonly maxActiveCount: number;
}
```

校验：`pickupRadius` 为正；`maxActiveCount`（同时在场经验物硬上限，即池容量）为正整数；ID 唯一。达到上限时新掉落合并进最近的经验物，经验总量守恒。

## ResourceConfig（V0.5 局外资源）

```ts
interface ResourceConfig {
  readonly id: ConfigId;
  readonly displayName: string;
  readonly capacity: number;
}
```

校验：`displayName` 非空；`capacity`（库存上限）为正整数；ID 唯一。库存余额存于账号存档 `balances` 域（resourceId → 整数最小单位），一切发放/消耗经 `economy/Economy` 事务：grant 要求正整数 deltas（超出上限部分钳制并通过 `lostToCap` 明确报告丢失，手改超上限余额不回收只钳增量）；spend 要求负整数 deltas（任一资源不足则整体拒绝，原子生效）；失败路径零修改；审计环形日志保留最近 20 条（容量由装配层与 `AccountSave.MAX_RECENT_TRANSACTIONS` 同源注入）。

当前配置（V0.5）：`res_lingshi` 灵石 / `res_xiuwei` 修为 / `res_yaodan` 妖丹（上限 999999 / 999999 / 9999）；灵魄按兽隔离 `res_lingpo_<beast>`（青龙/白虎/朱雀/玄武/九尾狐，上限 9999），禁止跨兽互换（PROGRESSION.md）。灵玉无产出不投放（库存为通用 resourceId 结构，后续加入仅为数据项）；白虎/朱雀/玄武/九尾狐灵魄的投放来源随 V0.8 关卡扩充。

## PlayerLevelConfig（V0.5 账号玩家等级）

```ts
interface PlayerLevelConfig {
  readonly levelCurve: readonly LevelCurveEntry[];  // 复用公共类型：level + requiredXp
}
```

- 与局内战斗等级（`levelCurve`）完全无关：账号经验只来自结算奖励（V05-09），局内经验不进入账号；字段、存档、展示均分离（PROGRESSION.md 四线不共用含糊 level）。
- 曲线长度即满级；`requiredXp` 语义与局内一致（当前级升到下一级所需账号经验）。
- 校验：与 `levelCurve` 共用规则——level 从 1 连续递增、`requiredXp` 为正整数、至少一条。
- **满级策略定案：溢出保留**（PROGRESSION.md 要求首发前只能选一种）——满级后账号经验继续累积在存档 `playerXp`，不转换不丢弃，后续提高曲线上限时自然消化；等级只进不退，存档等级高于曲线长度（配置缩短）时保持等级并按满级语义处理。
- 结算账号经验投放量由 V05-09 `StageRewardConfig` 定案后一并复核节奏（本表为 V05-03 初始值）。

当前配置（V0.5）：20 级，`requiredXp` 依次 60/80/105/135/170/215/265/325/395/475/570/680/810/960/1140/1350/1600/1900/2250/2650（曲线长度 20 与 V05-05 法器等级配置上限对齐）。

## StageRewardConfig（V0.5 结算奖励）

```ts
interface StageRewardConfig {
  readonly stageId: ConfigId;                          // 引用 StageConfig.id，唯一
  readonly accountXp: number;                          // 胜利全额账号经验（不入库存，只进玩家等级）
  readonly resources: Readonly<Record<ConfigId, number>>; // 胜利全额资源（resourceId → 正整数）
  readonly defeatRatio: number;                        // 失败保留比例 [0,1]
  readonly abortRatio: number;                         // 主动退出保留比例 [0,1]
}
```

- victory 全额发放；defeat/abort 按比例**逐项向下取整**（取整到 0 的项不发放）。
- 发放为**单事务原子**（审计 kind=`stage_reward_<result>`，含来源）；账号经验经 `PlayerLeveling`（只进不退、满级溢出保留）结算；修为到账后由 `autoPromoteSubRealms` 自动推进小境界（同一结算内完成）。
- 结算面板奖励行与实际发放共用 `computeStageRewards` 纯函数，展示数字与库存变化天然一致；库存上限钳制差异由 `lostToCap` 与账目日志体现（V0.5 上限下不触发）。
- 校验：`stageId` 引用关卡且唯一；资源引用存在且数量非负整数；比例在 [0,1]；`accountXp` 非负整数。

当前配置（V0.5）：`stage_mvp_01` 胜利 = 账号经验 30（首升 2 局）+ 灵石 100 + 修为 30（首局即推进练气一层）+ 妖丹 1 + 青龙灵魄 2（V0.5 唯一灵魄投放）；失败/中止保留 50%。产出节奏复核见"V0.8 章节关卡与产出"一节（V08-02 已扩充为 12 关产出表）。

## ShopConfig（V0.8 商店）

```ts
interface ShopGoods {
  readonly resourceId: ConfigId;  // 发放资源（灵魄即按兽隔离的资源项）
  readonly amount: number;        // 正整数
}

interface ShopItemConfig {
  readonly id: ConfigId;
  readonly displayName: string;
  readonly description: string;
  readonly goods: ShopGoods;
  readonly priceType: ConfigId;   // 价格币种 = 资源 ID（res_lingshi / res_lingyu）
  readonly price: number;         // 正整数
  readonly purchaseLimit: number; // 刷新周期内限购次数
  readonly dailyRefresh: boolean; // true = 按 dayKey 重置限购；false = 永久总限购
}

interface ShopGroupConfig {
  readonly id: ConfigId;
  readonly displayName: string;
  readonly itemIds: readonly ConfigId[];
}
```

- 购买事务（`account/ShopSystem.purchaseShopItem`）：限购/余额校验 → 扣价（审计 kind=`shop_purchase`）→ 发货（kind=`shop_goods`，库存上限钳制差异由 lostToCap 体现）→ 已购计数（存档 `shop.purchaseCounts`，最后写入，失败路径零修改）。
- 每日限购重置：`refreshShopForDay` 按 TimeService 的 dayKey 惰性刷新——refreshDayKey 变化时清空全部 `dailyRefresh=true` 商品的已购计数（永久限购计数跨日保留）；回拨不特殊处理（V0.8 已知边界）。
- 校验：商品/组 ID 唯一、goods 资源引用存在且数量正整数、priceType 引用存在、price/purchaseLimit 正整数、dailyRefresh 布尔、组内商品引用存在且不重复。
- 消费闭环：稀缺珍品以灵玉定价（灵玉唯一产出 = 成就，V08-10）；常用补给以灵石定价。

当前配置（V0.8 初始表，8 商品 2 组）：常用补给（每日刷新，灵石定价）——补气丹（修为×40 / 80 灵石 / 3 次）、妖丹礼盒（×2 / 150 / 1）、白虎/朱雀/玄武/九尾狐灵魄（各 ×2 / 200~280 / 1）；稀缺珍品（永久限购，灵玉定价）——灵石宝袋（灵石×500 / 10 灵玉 / 10 次）、妖丹精粹（妖丹×5 / 20 灵玉 / 5 次）。节奏待 V08-17 收口复核。

## OfferConfig（V0.8 统一礼包·免费子集）

```ts
type OfferUnlockCondition =
  | { readonly kind: 'playerLevel'; readonly level: number }     // 玩家等级档
  | { readonly kind: 'chapterClear'; readonly chapterId: ConfigId } // 章节全部关卡通关（任意难度）
  | { readonly kind: 'realmIndex'; readonly realmIndex: number };  // 达到某大境界

interface OfferConfig {
  readonly id: ConfigId;
  readonly displayName: string;
  readonly description: string;
  readonly contents: TaskReward;        // 复用任务奖励结构
  readonly priceType: 'free';           // V0.8 免费子集：恒 'free'（付费/广告不做，字段保留对齐统一模型）
  readonly price: 0;
  readonly unlockCondition: OfferUnlockCondition;
  readonly purchaseLimit: 1;            // 免费礼包恒 1（领取一次）
  readonly prerequisiteOfferId: ConfigId | null; // 前置礼包未领不可领后继（链不成环）
}
```

- 领取事务（`account/OfferSystem.claimOffer`）：条件未达/前置未领拒绝 → 资源单事务（审计 kind=`offer_reward`）→ 账号经验 → claimCount 推进（存档 `offerClaims`，最后写入，失败路径零修改；重复领取被 purchaseLimit=1 拦截）。
- 领取记录即"奖励中心条目"领取态（V08-01 schema 决策）：任务/成就/登录领取态在各自域，奖励中心为聚合视图不设独立领取真相。
- 校验：ID 唯一、free 语义（priceType/price/purchaseLimit 恒定）、条件结构与数值、contents 引用合法、前置链引用存在且不成环。

当前配置（V0.8 初始表，9 礼包三线）：成长（Lv5/10/15/20 链，灵石+修为+妖丹递增）、章节（青云/妖潮/噬妖链，灵石+灵魄）、境界（筑基/金丹链，灵石+妖丹）。

## 奖励中心（V0.8 最小版）

聚合任务/成就/累计登录/礼包四源的可领取状态（直接查询各系统领域模块 `isTaskClaimable`/`listAchievementViews`/`getClaimableTierIndex`/`isOfferClaimable`——列表与各系统领取态天然一致）；逐项领取复用各系统领取事务；一键领取经 `claimAllSequential` 顺序逐项执行（单项失败不阻断其余，逐项报告成败）。**不建邮件/补发队列**（阶段决策 6，无对应场景，如实记录）。

## AchievementConfig（V0.8 成就）

```ts
type AchievementCondition =
  | { readonly kind: 'killCount' }
  | { readonly kind: 'clearCount' }
  | { readonly kind: 'collectXp' }
  | { readonly kind: 'levelUpCount' }
  | { readonly kind: 'spendResource'; readonly resourceId: ConfigId };

interface AchievementTier {
  readonly target: number;       // 阶段目标（升序、正整数）
  readonly reward: TaskReward;   // 复用任务奖励结构
}

interface AchievementConfig {
  readonly id: ConfigId;
  readonly displayName: string;
  readonly description: string;
  readonly condition: AchievementCondition;
  readonly tiers: readonly AchievementTier[];
  readonly hidden: boolean;
}
```

- 永久一次性 + 分级阶段：进度由与任务相同的事件源累计（结算点 + 经济 spend 钩子，V08-09 接线复用），**只进不退、无周期重置**；进度封顶最终档目标。
- 分级只显示当前阶段（下一未领取档）；**领取与完成分离**：达标的每档各自领取一次（`claimAchievementTier` 事务，审计 kind=`achievement_reward`），重复领取拒绝；进度/claimedTier 不因配置回退回收。
- **隐藏成就**（hidden=true）：累计进度未达第一阶目标前不在列表与红点出现（`listAchievementViews` 过滤）。
- 校验：ID 唯一、displayName/description 非空、hidden 布尔、条件 kind 合法（spendResource 资源引用存在）、tiers 非空且**升序**（严格递增正整数）、奖励资源引用存在且数量正整数。
- **灵玉产出口径（ECONOMY 补充）**：`res_lingyu` 灵玉（上限 9999）唯一产出 = 成就阶段奖励（一次性，当前四类 6 成就共 13 档，合计灵玉 650 + 2 个隐藏档）；消费 = 商店稀缺商品（V08-12）。无支付、无广告。

当前配置（V0.8 初始表）：战斗（斩妖除魔 killCount 100/1000/5000、百战不殆 clearCount 3/20/80）、收集（吐纳凝魂 collectXp 500/5000/20000）、成长（日进斗精 levelUpCount 10/50/200、挥金如土 spendResource 灵石 500/5000/20000）、挑战（秘境征服者 clearCount 30/120，**隐藏**）。每档奖励含灵玉 10~150；节奏待 V08-17 收口复核。

## TaskConfig（V0.8 任务）

```ts
type TaskPeriod = 'main' | 'daily' | 'weekly';

type TaskCondition =
  | { readonly kind: 'killCount'; readonly target: number }      // monsterDied 次数
  | { readonly kind: 'clearCount'; readonly target: number }     // battleFinished=victory 次数
  | { readonly kind: 'collectXp'; readonly target: number }      // experienceCollected 累计量
  | { readonly kind: 'levelUpCount'; readonly target: number }   // levelUpResolved 次数
  | { readonly kind: 'spendResource'; readonly resourceId: ConfigId; readonly target: number };

interface TaskReward {
  readonly accountXp: number;                            // 账号经验（不入库存）
  readonly resources: Readonly<Record<ConfigId, number>>; // 资源发放（正整数）
}

interface TaskConfig {
  readonly id: ConfigId;
  readonly displayName: string;
  readonly description: string;      // 展示文案（非 ID）
  readonly period: TaskPeriod;
  readonly condition: TaskCondition;
  readonly reward: TaskReward;
  readonly prerequisiteTaskId: ConfigId | null; // 前置任务领取奖励后开放
}
```

- 进度由领域事件累计（`account/TaskSystem`，V08-09 接线：monsterDied→killCount、battleFinished victory→clearCount、experienceCollected→collectXp、levelUpResolved→levelUpCount、经济 spend→spendResource），按目标截断；**前置任务未领取奖励时后继不累计进度**（前置未完成不可接取）。
- 周期桶（存档 `taskBuckets`）：主线永久桶 periodKey 恒 `main` 不重置；每日/每周桶 periodKey 为 TimeService 的 dayKey / weekKey（本地自然日/周，周一为周起点），**key 变化即整桶重置**（进度与领取态清空）。
- 领取：资源单事务（审计 kind=`task_reward`）+ 账号经验（只进玩家等级）；重复领取拒绝；失败路径零修改。
- 校验：ID 唯一、displayName/description 非空、period 合法、条件 kind 合法且 target 正整数、`spendResource.resourceId` 引用存在、奖励资源引用存在且数量正整数、`accountXp` 非负整数、前置引用存在且**前置链不成环**。

当前配置（V0.8 初始表，13 项）：主线引导链 7 项（击杀 20 → 升级 3 → 首胜 → 拾取经验 150 → 消耗灵石 300 → 5 胜 → 击杀 500；奖励灵石/修为/妖丹/账号经验递增）；每日 3 项（击杀 60 / 通关 1 / 拾取经验 120）；每周 3 项（击杀 400 / 通关 8 / 消耗灵石 1500）。全部可由既有领域事件驱动完成；投放节奏待 V08-17 收口复核。

## V0.8 章节关卡与产出（V08-02）

### ChapterConfig / StageConfig 扩展 / 难度档 / 星级条件 / 里程碑

```ts
interface ChapterConfig {
  readonly id: ConfigId;
  readonly displayName: string;
  readonly stageIds: readonly ConfigId[];   // 有序关卡引用 = 章内顺序与解锁链（前一关通关解锁下一关）
  readonly requiredChapterId: ConfigId | null; // null = 初始解锁；否则完成该章节（其全部关卡通关，任意难度）后解锁
}

type StarCondition =
  | { readonly kind: 'clear' }                                   // 通关（第一星恒为通关，校验强制只允许在首位）
  | { readonly kind: 'hpRatioAbove'; readonly ratio: number }    // 结算时剩余生命比例 ≥ ratio，ratio ∈ (0,1]
  | { readonly kind: 'timeUnder'; readonly seconds: number }     // 用时 ≤ seconds
  | { readonly kind: 'hitTakenAtMost'; readonly count: number }; // 受击次数 ≤ count（非负整数）

interface StageDifficultyConfig {
  readonly id: ConfigId;                     // 关卡内唯一（全局允许跨关复用同名档）
  readonly displayName: string;
  readonly hpMultiplier: number;             // 数值乘数（作用于运行态快照，不改写配置）
  readonly speedMultiplier: number;
  readonly contactDamageMultiplier: number;
  readonly xpMultiplier: number;
  readonly rewardMultiplier: number;         // 结算奖励乘数（对 StageRewardConfig 与里程碑逐项相乘后向下取整）
  readonly requiredStarsOnPrevious: number;  // 前一难度档历史最高星 ≥ 该值解锁；首档必须 0
}

interface StageMilestoneGrant {
  readonly accountXp: number;
  readonly resources: Readonly<Record<ConfigId, number>>; // 数量为正整数
}

interface StageMilestoneRewardsConfig {
  readonly firstClear: StageMilestoneGrant;        // 首通奖励（按难度档各自一次）
  readonly perStar: readonly StageMilestoneGrant[]; // 星级累计：历史最高星达 N+1 可领 perStar[N]；长度恒 3
}

interface StageConfig {          // 在 V0.1 字段基础上扩展
  readonly displayName: string;  // 展示名
  readonly chapterId: ConfigId;  // 归属章节；与章节 stageIds 双向一致（校验）
  readonly bossId: ConfigId | null; // null = 无 Boss 关（存活到时长即胜利）
  readonly starConditions: readonly StarCondition[]; // 长度恒 3，下标即星序
  readonly difficulties: readonly StageDifficultyConfig[]; // 至少 1 档，首档恒解锁
  readonly milestoneRewards: StageMilestoneRewardsConfig;
}
```

校验要点（快速失败）：章节 stageIds 引用存在且章内不重复；`requiredChapterId` 引用存在且**解锁链不成环**；stage.chapterId 与章节收录**双向一致**；星级条件长度恒 3、首位恒 `clear`、各类型数值合法；难度档 ID 组内唯一、乘数全部为正、首档 `requiredStarsOnPrevious` 恒 0 / 后续档为正整数；里程碑 perStar 长度恒 3、资源引用存在且数量为正整数；`bossId` 引用存在。

设计决策记录（阶段决策 3）：难度档 = 数值/奖励乘数 + 解锁条件（首星解锁）+ 独立星级记录（存档 stageRecords 按 `stageId|difficultyId`）；"改变机制"的行为差异不做，记录为后续内容迭代。`StageRewardConfig` 保持按关卡唯一（基础值 = 普通难度全额），"按难度档扩展"经难度档 `rewardMultiplier` 实现（同一公式单一所有者）；里程碑奖励同按该乘数取整（逐项向下取整，与 defeat/abort 比例同规则，V08-03 装配接入）。首通/星级奖励按难度档各自领取一次（与存档 stageRecords 字段对齐，V08-05 实装领取）。

### 初始内容表（3 章节 × 4 关）

- 章节链：`chapter_qingyun` 青云外门（初始解锁）→ `chapter_yaochao` 妖潮深林 → `chapter_shiyao` 噬妖巢穴。
- 新怪 3：妖奴/毒蛛/石人（见 MonsterConfig 节）；新 Boss 2：`boss_fuchao_shuyao` 腐潮树妖（150s 召唤，900 HP，弹幕 16 发/4.5s，半血 2.5s）、`boss_shiyao_lord` 噬妖之主（180s 召唤，2000 HP，弹幕 20 发/4s，半血 2s）；全部复用既有灰盒 prefab 与运行时。
- 场地统一 2400×1600；软/硬上限 C1 120/180、C2 130/190、C3 140/200；时长 480～600s；无 Boss 关存活到时长即胜利。

**普通难度胜利产出表**（基础值；困难 ×1.6 / 噩梦 ×2.4 按难度乘数逐项向下取整）：

| # | 关卡 | 展示名 | 账号经验 | 灵石 | 修为 | 妖丹 | 灵魄 | Boss |
|---|---|---|---|---|---|---|---|---|
| 1 | stage_mvp_01 | 外门第一试 | 30 | 100 | 30 | 1 | 青龙×2 | 噬妖妖将 |
| 2 | stage_qingyun_02 | 外门妖奴潮 | 34 | 120 | 34 | 1 | 青龙×2 | 无 |
| 3 | stage_qingyun_03 | 毒蛛林道 | 38 | 145 | 38 | 1 | 青龙×2 | 无 |
| 4 | stage_qingyun_04 | 妖将压境 | 44 | 175 | 44 | 2 | 白虎×2 | 噬妖妖将 |
| 5 | stage_yaochao_01 | 深林边缘 | 52 | 210 | 52 | 2 | 白虎×3 | 无 |
| 6 | stage_yaochao_02 | 石人古道 | 60 | 250 | 60 | 2 | 白虎×3 | 无 |
| 7 | stage_yaochao_03 | 腐潮蔓延 | 68 | 295 | 68 | 3 | 朱雀×2 | 无 |
| 8 | stage_yaochao_04 | 树妖之巢 | 78 | 350 | 78 | 3 | 朱雀×3 | 腐潮树妖 |
| 9 | stage_shiyao_01 | 巢穴外沿 | 88 | 410 | 88 | 3 | 玄武×2 | 无 |
| 10 | stage_shiyao_02 | 噬妖回廊 | 100 | 480 | 100 | 4 | 玄武×3 | 无 |
| 11 | stage_shiyao_03 | 妖群深处 | 112 | 555 | 112 | 4 | 九尾狐×2 | 无 |
| 12 | stage_shiyao_04 | 噬妖之主 | 128 | 640 | 128 | 5 | 九尾狐×3 | 噬妖之主 |

胜利合计（普通）：账号经验 832 / 灵石 3730 / 修为 832 / 妖丹 31 / 灵魄 29。

**里程碑奖励**（按关卡基础值；首通 = 与胜利同额账号经验 + 同额灵石；星级累计三档 ≈ 胜利的 40%/60%/100% 经验 + 50%/75%/125% 灵石，具体数值见 GameConfig，全部只发账号经验+灵石、不发修为/妖丹/灵魄）：普通难度全里程碑合计 ≈ 账号经验 2496 / 灵石 13055；按各难度领取时同乘 rewardMultiplier。

### V0.8 收口数值总览复核（V08-17）

**产出/消耗重折算（含留存系统后的完整闭环，"一轮内容"= 12 关 × 3 难度各 1 胜 + 全里程碑 + 主线任务 + 全成就 + 30 日登录 + 全免费礼包）**：

| 资源/经验 | 一轮内容产出（约 36 局 + 全留存） | 全程消耗 | 结论 |
|---|---|---|---|
| 账号经验 | ≈19225（胜利 4160 + 里程碑 12480 + 任务 270 + 成就 1550 + 登录 765） | 20 级全程 16135 | **玩家等级在一轮内容内满级**（V0.5 为 538 局） |
| 灵石 | ≈100000+（胜利 18650 + 里程碑 65275 + 任务/成就/登录/礼包 ≈17000） | 养成 15112 + 商店灵石商品 | **大幅盈余**：灵石退出瓶颈；商店日常商品为主要新增去向，通胀留待 V1.0 经济迭代 |
| 修为 | ≈6900 + 商店补气丹（3/日） | 境界全程 5161 | 金丹期在一轮内容内可达 |
| 灵魄 | ≈185（胜利 145 + 登录 25 + 章节礼包 15）+ 商店 2/日 | 解锁 40 + 满星 775 | 全解锁快、**满星为长线刷取目标**（留存驱动不变） |
| 妖丹 | ≈175（胜利/任务/登录/礼包） | 突破 12 | 充裕 |
| 灵玉 | 成就 650（唯一产出） | 商店稀缺珍品（10~20/件） | 产消闭环成立；成就为灵玉唯一来源（口径不变） |

**留存目标可玩性结论**：主线任务链（7 项）引导首局成长；每日 3 项/每周 3 项由自然玩法驱动（36 局远超每周指标）；30 日签到逐档投放灵石/修为/灵魄；成就 13 档覆盖战斗/收集/成长/挑战四类；商店承接灵石盈余与灵玉消费；红点只挂可领取（任务/成就/签到/奖励中心）。**可复述**：选关变强 → 结算产出 → 任务/成就/签到/礼包领取 → 商店消费 → 培养 → 变强再战。

**遗留风险（如实标注，移交 V1.0）**：灵石通胀（一轮内容后产出远超消耗，缺乏长线灵石回收）；噩梦难度（HP×4.5）低培养可玩性未真机验证；C3 后期波次密度（0.35s×3 批）性能未经 Profiler 验证。

### 数值扩充与瓶颈复核结论（V08-02，更新 V0.5 风险标记）

- **玩家等级满级局数：538 局 → 约 40 局**。线性通关全部内容（12 关 × 3 难度各 1 胜 = 36 局）可得账号经验 ≈ 胜利 832×5（难度系数和 1+1.6+2.4）+ 里程碑 3×832×5 = 16640 ≥ 20 级全程 16135，即正常推进中即满级，重复刷取不再是等级刚需。
- **灵石不再是瓶颈**：同口径灵石收入 ≈ 83925，远超养成总消耗 15112（青霄剑满级 9927 + 五兽升级 5185）。
- **修为**：小境界+突破全程 5161，线性通关得 4160，差额约 8～10 局重复刷取补足（合理刷取动机）。
- **灵魄为长线目标**：解锁+满星全兽需 815 魄，线性通关仅得 ≈145，其余靠重复刷高难关与后续任务/活动投放——预期留存驱动，V08-08/10/12 的任务/成就/商店承接。
- **风险标记（移交 V08-17 收口复核）**：难度乘数（噩梦 HP ×4.5）在低培养账号下的实际可玩性未经真机验证；波次密度（C3 后期 0.35s 间隔 ×3 批）在硬上限 200 下的性能未经 Profiler 验证。产消表以本节为准，V08-17 全链路验收后重折算。

## V0.5 局外数值总览（V05-13 收口记录）

**产出（`stage_mvp_01`，每局）**：胜利 = 账号经验 30 + 灵石 100 + 修为 30 + 妖丹 1 + 青龙灵魄 2；失败/中止保留 50%（逐项向下取整，妖丹取整归零不发放）。

**消耗曲线汇总**：

| 成长线 | 曲线 | 合计 |
|---|---|---|
| 玩家等级 | 20 级，每级 60→2650 | 全程 16135 经验 |
| 境界 | 练气九层 621 / 筑基九层 1244 / 金丹九层 2496 修为；突破 300 / 500 修为 + 妖丹 4 / 8 + Lv5 / Lv10 | 练气期合计约 921 修为 |
| 青霄剑 | 20 级，灵石 80→1583（约 ×1.18/级），每级伤害 +2 | 9927 灵石；满级基础伤害 48 |
| 灵兽（每只） | 10 级灵石 50→214 + 5 星自身灵魄 5→80 | 1037 灵石 + 155 灵魄 |

**关键节奏（按胜利产出/局折算）**：

- 第 1 局即有可见成长：练气一层（修为 30）+ 青霄剑首升（灵石 80）。
- 练气圆满约 21 局；突破练气约 31 局（修为 921/30；玩家 Lv5 仅需 13 局，非瓶颈）。
- 突破筑基约 58 局（修为线），但玩家 Lv10 需约 75 局——**等级开始成为瓶颈**。
- 青霄剑满级约 100 局；玩家 20 级满级约 538 局。
- **风险标记（V0.8 已复核）**：单关卡产出下，玩家等级曲线是全局养成瓶颈（20 级 ≈ 538 局，法器/灵兽上限被长期钳制）。V0.5 单关卡灰盒可接受；V0.8 已按"V0.8 章节关卡与产出"一节扩充为 12 关 + 里程碑并重折算（满级 ≈ 40 局），详见该节复核结论。

## RealmConfig（V0.5 境界、小境界、修为与突破）

```ts
interface RealmBreakthroughConfig {
  readonly xiuweiCost: number;          // 突破消耗修为
  readonly materialId: ConfigId;        // 突破消耗材料（当前 res_yaodan）
  readonly materialCost: number;
  readonly requiredPlayerLevel: number; // 玩家等级门槛；0 表示无门槛
}

interface RealmConfig {
  readonly id: ConfigId;
  readonly displayName: string;
  readonly subRealmCosts: readonly number[]; // 长度即小境界数量，第 N 项为第 N 层推进所需修为
  readonly maxHpBonus: number;               // 进入该大境界的 maxHp 增量（克制）
  readonly breakthrough: RealmBreakthroughConfig | null; // 末境为 null
}
```

- 小境界推进消耗存档库存 `res_xiuwei`（走 `economy/Economy` 原子事务），**不设独立修为进度条字段**；`subRealmIndex` 等于 `subRealmCosts.length` 表示圆满，圆满后突破开放。
- 大境界突破两步制：`previewBreakthrough`（未圆满/末境返回 null，不伪装可突破）→ `confirmBreakthrough`（复核圆满/材料/玩家等级后，修为+材料**单事务原子扣耗**；无失败机制）；重复确认由下一境条件自然拦截。
- 境界收益：当前大境界累计 maxHp 加成 = 境界 0..realmIndex 的 `maxHpBonus` 增量之和（`getTotalRealmMaxHpBonus`，V05-07 经快照注入）。
- 校验：displayName 非空；`subRealmCosts` 非空且每项正整数；`maxHpBonus` 非负整数；非末境 `breakthrough` 不得为 null、末境必须为 null；`xiuweiCost`/`materialCost` 正整数、`materialId` 引用存在、`requiredPlayerLevel` 非负整数。
- 境界与玩家等级互不替代（PROGRESSION.md）：境界走修为/材料门槛，玩家等级走账号经验曲线，字段与展示分离。

当前配置（V0.5）：练气 `realm_lianqi`（九层 30→128，突破 300 修为 + 4 妖丹 + 玩家 5 级）、筑基 `realm_zhuji`（九层 60→257，突破 500 修为 + 8 妖丹 + 玩家 10 级，maxHp +4）、金丹 `realm_jindan`（九层 120→516，末境，maxHp +8）；maxHp 增量克制（练气 0 / 筑基 4 / 金丹 8）。投放节奏待 V05-13 产消评审复核。

## WeaponGrowthConfig（V0.5 法器培养）

```ts
interface WeaponGrowthConfig {
  readonly weaponId: ConfigId;              // 引用局内 WeaponConfig.id
  readonly maxLevel: number;                // 配置等级上限
  readonly levelUpCosts: readonly number[]; // 第 i 项 = 从第 i+1 级升到第 i+2 级的灵石消耗，长度 = maxLevel - 1
  readonly damagePerLevel: number;          // 每级基础攻击伤害增量
  readonly ultimateIds: readonly ConfigId[]; // 绝学/流派稳定 ID 预留（V0.5 为空，不建效果）
}
```

- 法器等级为账号永久养成（存档 `weaponLevels`，key 为法器 ID，缺省视为 1 级）；升级消耗 `res_lingshi` 走 `economy/Economy` 原子事务。
- **生效等级上限 = min(maxLevel, 玩家等级)**；两种封顶分别返回原因（`at_max_level` / `player_level_cap`）供 UI 提示。
- 等级 L 的伤害加成 = `damagePerLevel × (L - 1)`（纯派生）；局内 `WeaponConfig` 数值不变，增量只经 V05-07 出战快照注入，不改写武器配置对象。
- 绝学/流派仅预留稳定 ID 字段（`ultimateIds`，当前为空数组），V0.5 不建立效果；首发数量与效果待内容表立项（PROGRESSION.md）。
- 校验：`weaponId` 引用存在且唯一；`maxLevel` 正整数；`levelUpCosts` 长度 = maxLevel - 1 且每项正整数；`damagePerLevel` 正整数；`ultimateIds` 唯一且 snake_case。

当前配置（V0.5）：`weapon_qingxiao_sword`（青霄剑）maxLevel 20，升级灵石曲线 80/95/112/132/156/184/217/256/302/357/421/497/586/692/816/963/1137/1341/1583（约 ×1.18/级），`damagePerLevel` 2（20 级时基础伤害 10 → 48）；曲线长度 20 与账号玩家等级上限对齐。消耗节奏待 V05-13 产消评审复核。

## BeastConfig（V0.5 灵兽）

```ts
type BeastSkillEffect =
  | { readonly kind: 'damageNearest'; readonly intervalSeconds: number; readonly damage: number; readonly projectileCount: number }
  | { readonly kind: 'heal'; readonly intervalSeconds: number; readonly value: number };

interface BeastConfig {
  readonly id: ConfigId;
  readonly displayName: string;
  readonly soulResourceId: ConfigId;   // 该灵兽的灵魄资源（按兽隔离）
  readonly unlockSoulCost: number;     // 0 = 默认解锁（初始灵兽）
  readonly levelUpCosts: readonly number[]; // 长度 = 满级 - 1（res_lingshi）
  readonly starUpCosts: readonly number[];  // 长度 = 星级上限（自身灵魄，0 星起步）
  readonly skill: BeastSkillEffect;    // 出战触发技能（未出战不生效）
  readonly skillDescription: string;
}
```

- 解锁/升星只消耗该灵兽**自身**灵魄（`soulResourceId` 显式声明，禁止跨兽互换，PROGRESSION.md）；升级消耗 `res_lingshi`；全部走 `economy/Economy` 原子事务。
- 等级上限 = `levelUpCosts.length + 1` 且受玩家等级钳制（`at_max_level` / `player_level_cap` 分原因拒绝）；星级上限 = `starUpCosts.length`（0 星起步）。
- 默认解锁：`unlockSoulCost` 为 0 的灵兽存档无条目即视为已解锁；其余默认锁定。
- 出战为单槽（`deployedBeastId`）：`deployBeast` 直接切换、未解锁拒绝、重复出战幂等；出战技能效果仅定义配置结构，战斗接入在 V05-08；持有被动 V0.5 不做。
- 校验：`soulResourceId` 引用资源存在；`unlockSoulCost` 非负整数；`levelUpCosts`/`starUpCosts` 非空且每项正整数；`skill` kind 合法且数值合法（intervalSeconds 正数、damage/value/projectileCount 正整数）；`skillDescription` 非空。

当前配置（V0.5）五兽（共用升级曲线 [50,60,72,86,103,124,149,179,214] → 10 级、升星 [5,10,20,40,80] → 5 星，V0.5 简化后续可分化）：

| 灵兽 | ID | 解锁 | 出战技能 |
|---|---|---|---|
| 青龙 | `beast_qinglong` | 默认解锁 | 每 6s 灵弹×1（伤 8） |
| 白虎 | `beast_baihu` | 白虎灵魄×10 | 每 8s 扑击（伤 12） |
| 朱雀 | `beast_zhuque` | 朱雀灵魄×10 | 每 10s 焚击（伤 18） |
| 玄武 | `beast_xuanwu` | 玄武灵魄×10 | 每 12s 回血 3 |
| 九尾狐 | `beast_jiuweihu` | 九尾狐灵魄×10 | 每 9s 魅惑弹×2（各伤 5） |

V0.5 单关卡 `stage_mvp_01` 只投放青龙灵魄（V05-09），白虎/朱雀/玄武/九尾狐灵魄来源随 V0.8 关卡扩充，UI 明示"来源待开放"。技能数值由 V05-08 接入战斗（`combat/BeastCompanionSystem`；投射物池 key `projectile_beast_companion`，灰盒参数复用 `projectile_sword_qi` 配置，正式美术替换时调整）；节奏待 V05-13 复核。

## EliteModifierConfig（V0.1 精英前缀）

```ts
interface WeightedMonster {
  readonly monsterId: ConfigId;
  readonly weight: number;
  readonly elite?: boolean; // 可选；true 时按 eliteModifier 强化
}

interface EliteModifierConfig {
  readonly hpMultiplier: number;
  readonly speedMultiplier: number;
  readonly contactDamageMultiplier: number;
  readonly xpMultiplier: number;
  readonly collisionRadiusMultiplier: number;
}
```

校验：多乘数均为正数；`elite` 存在时必须为布尔。精英与普通怪共用池与 prefab（灰盒视觉：运行时放大 1.5 倍 + 橙红着色，正式美术替换时调整）；有效数值 = 基础值 × 乘数（hp/contact/xp 取整，hp/xp 下限 1）。掉落粒度为 1：`xpValue>1` 的死亡按数值拆成多枚经验物环形散布（总量守恒）。当前修饰值：hp×4 / speed×0.85 / contact×2 / xp×5 / radius×1.5；波次权重 normal:elite = 5:1（早期）/ 4:1（后期）。

## V0.1 灰盒数值总览（V01-08 记录）

| 项 | 值 | 说明 |
|---|---|---|
| 玩家 | HP 20 / 移速 320 / 无敌帧 0.8s / 碰撞 24 | 受击节奏：普通怪 2 伤 ≈ 最快 8s 被围死 |
| 青霄剑 | 伤害 10 / 冷却 0.8s（下限 0.2）/ 单发 | 升级后伤害加算、冷却连乘、数量封顶 8 |
| 剑气冲击 | 每 3s 一轮、伤害 6（0.6×）、每层 +1 道 | maxStacks 5 |
| 护体罡气 | 每层 ×0.85 减伤，结算下限 0.1 | maxStacks 5 |
| 噬妖幡 | 每层击杀回血 +2 | maxStacks 3 |
| 基础怪 | HP 20 / 速度 90 / 接触 2 / 经验 1 | 两剑死 |
| 精英 | ×4 HP / ×0.85 速 / ×2 伤 / ×5 经验 / ×1.5 半径 | 权重 5:1（后期 4:1），5 枚经验散落 |
| Boss | 120s 召唤 / 400 HP / 接触 6 / 经验 30 | 弹幕 12 发，5s→半血 3s；击杀即胜利 |
| 经验曲线 | 10 级：5/8/12/17/23/30/38/47/57/68 | V01-08 由 5 级扩至 10 级（原 1 分钟即满级过快） |
| 场地 | playArea 2400×1600（±1200/±800） | V01-09 起"世界 > 视口 + 相机跟随"（World 容器方案）；视口内夹紧不露边 |

三选一候选池（V01-08 审视结论）：6 项（升级 3 + 功法 2 + 法宝 1），权重全 1，总层数 37 ≥ 10 级 9 次选择，**无需保底**；池小且全部可叠层，**暂不引入前置/互斥**（后续内容表扩充时再评审）。运行时随机源为 Math.random 适配器（无种子）；"固定种子可复现"由纯逻辑层的可注入 RandomSource 测试覆盖，运行时不做种子化（V0.1 无每日挑战需求）。

## BossConfig（V0.1 Boss）

```ts
interface BossRadialBurstConfig {
  readonly count: number;              // 每轮弹幕数量
  readonly damage: number;             // 单发伤害（对玩家，走减免/无敌帧）
  readonly burstIntervalSeconds: number;
  readonly enragedIntervalSeconds: number; // 半血以下阶段间隔
}

interface BossConfig {
  readonly id: ConfigId;
  readonly displayName: string;
  readonly spawnTime: number;   // 战斗秒；到达即在玩家上方环带召唤（一次）
  readonly maxHp: number;
  readonly moveSpeed: number;
  readonly contactDamage: number;
  readonly xpValue: number;
  readonly collisionRadius: number;
  readonly radialBurst: BossRadialBurstConfig;
}
```

校验：displayName 非空；spawnTime 非负；maxHp/xpValue/count 正整数；contactDamage/damage 非负整数；其余正数。Boss 数值即有效值（不走精英乘数）；复用怪物池化/受击/死亡链路（`monsterDied` 携带 boss id → `StageResultService` 判定击杀即胜利，xpValue 参与掉落守恒）。当前配置：`boss_shiyao_general`（噬妖妖将，120s 召唤，400 HP，弹幕 12 发/5s，半血 3s，子弹 `projectile_boss_bullet` 240 速度/3s 存活）；V0.8 新增 `boss_fuchao_shuyao`（腐潮树妖，150s，900 HP，弹幕 16 发/4.5s，半血 2.5s）、`boss_shiyao_lord`（噬妖之主，180s，2000 HP，弹幕 20 发/4s，半血 2s）——灰盒视觉复用同一 Boss prefab，Boss 与关卡的关联经 `StageConfig.bossId`（V08-03 装配接入；此前运行时硬编码取 bosses[0]）。

## GongfaConfig（V0.1 局内功法）

```ts
type GongfaEffect =
  | { kind: 'addSwordQi'; value: number; intervalSeconds: number; damageFactor: number }
  | { kind: 'contactDamageReduction'; value: number };

interface GongfaConfig {
  readonly id: ConfigId;
  readonly title: string;
  readonly description: string;
  readonly maxStacks: number;
  readonly weight: number;
  readonly effects: readonly GongfaEffect[];
}
```

校验：title/description 非空；maxStacks 正整数；weight 正数；effects 非空且 kind 合法；`addSwordQi.value` 正整数、`intervalSeconds` 正数、`damageFactor ∈ (0,1]`；`contactDamageReduction.value ∈ (0,1)`。功法与 UpgradeOptionConfig 同构进三选一候选池；当局获得，结算清空。当前配置：`gongfa_sword_qi`（剑气冲击，maxStacks 5，interval 3s，damageFactor 0.6，投射物 `projectile_sword_qi` 复用飞剑 prefab）、`gongfa_ward`（护体罡气，maxStacks 5，每层 0.15 连乘减伤，结算系数下限 0.1）。

## TreasureConfig（V0.1 局内法宝）

```ts
type TreasureEffect = { kind: 'healOnKill'; value: number };

interface TreasureConfig {
  readonly id: ConfigId;
  readonly title: string;
  readonly description: string;
  readonly maxStacks: number;
  readonly weight: number;
  readonly effects: readonly TreasureEffect[];
}
```

校验：与功法同构（title/description 非空、maxStacks 正整数、weight 正数、effects 非空）；`healOnKill.value` 正整数（每次击杀回复量，每层累加）。法宝为触发型被动：当局获得、结算清空，触发由击杀事件驱动。当前配置：`treasure_shiyao_banner`（噬妖幡，maxStacks 3，每层击杀回复 +2）。

## SpawnWaveConfig / StageConfig

```ts
interface WeightedMonster {
  readonly monsterId: ConfigId;
  readonly weight: number;
}

interface SpawnWaveConfig {
  readonly id: ConfigId;
  readonly startTime: number;
  readonly endTime: number;
  readonly spawnInterval: number;
  readonly batchSize: number;
  readonly monsters: readonly WeightedMonster[];
}

interface StageConfig {
  readonly id: ConfigId;
  readonly duration: number;
  readonly activeMonsterSoftCap: number;
  readonly activeMonsterHardCap: number;
  readonly spawnMinRadius: number;
  readonly spawnMaxRadius: number;
  readonly playArea: {
    readonly minX: number;
    readonly maxX: number;
    readonly minY: number;
    readonly maxY: number;
  };
  readonly waveIds: readonly ConfigId[];
}
```

校验：wave 时间区间合法且按开始时间排序；权重大于 0；`batchSize` 为正整数；soft cap 不大于 hard cap；出生最大半径大于最小半径；活动边界为有限数且 min 小于 max；所有 wave 和 monster 引用存在。根配置中的 `initialStageId` 必须引用存在的关卡。

## UpgradeOptionConfig

```ts
type UpgradeEffect =
  | { readonly kind: 'addSwordDamage'; readonly value: number }
  | { readonly kind: 'multiplySwordCooldown'; readonly value: number }
  | { readonly kind: 'addSwordCount'; readonly value: number };

interface UpgradeOptionConfig {
  readonly id: ConfigId;
  readonly title: string;
  readonly description: string;
  readonly maxStacks: number;
  readonly weight: number;
  readonly effects: readonly UpgradeEffect[];
}
```

校验：`maxStacks` 为正整数、权重大于 0、效果非空；倍率必须大于 0；所有效果应用后仍由运行态硬上限夹紧。UI 只展示 title/description 并回传 ID。

## UnlockConfig（V1.0 功能解锁表，V10-02）

功能解锁全部配置驱动（GAME_LOOP §4）：每个可解锁功能一条记录，`featureId` 为稳定功能 ID，导航/面板入口经其绑定解锁表。

- 条件类型 `UnlockCondition`：`always`（首次进入即可用）/ `playerLevel`（账号玩家等级达到）/ `stageClear`（**章节内推进**：通关指定关卡，任意难度）/ `chapterClear`（章节通关：指定章节全部关卡通关）/ `realmIndex`（大境界下标达到）/ `accountAgeDays`（账号创建天数达到，服务器时间语义）。首发单条件，不做布尔组合；条件参数显式命名。
- 入口表现：与 FeatureFlags **取交集**——开关关闭恒隐藏（未知开关按关闭处理）；开关开启且已解锁为 normal；开关开启但未解锁按 `lockedBehavior`：`hide`（直接隐藏）或 `show_condition`（保留入口并显示 `lockedText` 条件文案，文案全部来自配置）。锁定入口不挂红点（GAME_LOOP §4：不制造无解释红点）。
- 未知 `featureId`（入口绑定了解锁表不存在的功能）：运行时按安全隐藏处理并 console 告警（`resolveFeatureEntryState` 返回 null）；启动校验不拦截（绑定关系在 UI 装配侧，不在配置内）。
- 条件引用未知关卡/章节：启动校验快速失败；运行时判定同样抛错（双保险）。
- 账号创建天数经 `account/UnlockSystem.computeAccountAgeDays`（24h 向下取整；创建时间未知或时钟回拨返回 0，不为负），时间源为 AccountSystem 的 TimeService（业务零 `Date` 直读）。

**初始解锁表校准定案（2026-10-05 用户确认，"章节内推进"方案）**：

| featureId | 消费入口 | 条件 | lockedBehavior | featureFlag |
|---|---|---|---|---|
| `home` | 首页 | always | hide | null |
| `stage_select` | 关卡入口 | always | hide | stage_select |
| `base_weapon` | 基础法器（出装） | always | hide | null |
| `realm` | 修行入口 | stageClear `stage_mvp_01` | hide | null |
| `beast` | 灵兽入口 | stageClear `stage_mvp_01` | hide | null |
| `codex` | 图鉴入口 | stageClear `stage_qingyun_02` | hide | codex |
| `shop` | 商店入口 | stageClear `stage_qingyun_03` | hide | shop |
| `offers` | 奖励中心礼包区 | chapterClear `chapter_qingyun` | hide | null |
| `activities` | 活动类入口（预留） | realmIndex 1 | hide | null |

校准依据（GAME_LOOP §4/§5 + PROGRESSION §2）：修行/灵兽在首关通关（首次结算）后立即可用，保证 V10-04 新手引导"结算→首次培养"深链可达；图鉴/商店随章节内推进逐关放开，落实"每次最多重点介绍一个新系统"；礼包（奖励中心 offers 区）在第一章通关后出现；活动入口预留境界门槛。**未解锁入口初始全部 `hide`**（"首次进入不展示全部入口"）；`show_condition` 为配置可选路径，切换只改表不改码。**签到（活动壳 login）不绑 `activities` 解锁**——按 RETENTION 每日登录语义保持日 1 可用。

纯逻辑实现：`account/UnlockSystem.ts`（条件判定、入口三态、`buildUnlockEvaluationState` 存档切片）；导航接线：`ui/MainNav.ts`（解锁状态变化在返回首页时重建导航，冷路径）；礼包区接线：`ui/RewardCenterPanel.ts`。

## GuideScriptConfig（V1.0 新手引导脚本，V10-03）

新手引导全部配置驱动（GAME_LOOP §5）：单一首发脚本 `GameConfig.guide`，线性链式步骤。
**当前状态（用户决策 2026-10-05）：`enabled: false` 整体关闭**——不启动、不显示、零写入，首页不自动进战斗；脚本/状态机/表现层全部保留，改回 `true` 即整体恢复。

- 步骤字段：`id`（稳定 ID）/ `displayName` / `description`（气泡文案）/ `type`（`strong` 强引导遮罩·战斗暂停或聚焦 / `weak` 弱提示·不阻塞 / `info` 说明）/ `scene`（**归属场景** `battle`/`home`——表现层 GuideOverlay 按 `sceneScope` 装配属性过滤，战斗步骤不上首页、培养步骤不进战斗）/ `trigger`（触发事件；入口步骤的触发即"开始脚本"）/ `completionEvent`（完成事件；仅当前活跃步骤生效）/ `nextStepId`（null = 最后一步）/ `skippable` / `anchorId`（表现层高亮锚点，UI 侧解析；未知锚点回退居中气泡并隐藏高亮环）。
- 引导事件 `GuideEventId` 为稳定语义 ID（`guide_home_entered` / `guide_battle_started` / `guide_move_started` / `guide_attack_fired` / `guide_xp_collected` / `guide_levelup_resolved` / `guide_settlement_shown` / `guide_cultivate_opened`）。表现层（V10-04）负责把真实战斗/界面事件映射为引导事件；数据层零 BattleEventBus 依赖。**界面进入也是事件**（`guide_battle_started` / `guide_home_entered`），不设独立触发种类。
- 状态机语义（`account/GuideSystem.ts`）：当前步骤 = 从入口沿 nextStepId 的第一个未完成步骤；乱序事件忽略；重复完成事件幂等（不重复记录）；脚本完结后任何事件零写入。跳过 = 仅 `skippable` 步骤可跳（记完成并推进），strong 拒绝跳过；**可跳过步骤永不阻塞战斗**（校验强制 skippable ⇒ 非 strong，运行时 `isGuideStepBlocking` 双保险）。
- **strong 白名单**（GAME_LOOP §5"强制步骤只用于不可逆或首次核心操作"）：配置校验强制 strong 仅限 `guide_move` / `guide_levelup` / `guide_cultivate`；新增强引导必须显式扩展白名单（代码评审卡点）。首发脚本：移动(strong)→自动攻击(weak)→拾取(weak)→三选一(strong)→结算(info)→首次培养(strong)。
- 步骤链完整性：从入口沿 nextStepId 必须恰好走遍全部步骤（无环、无孤儿），校验快速失败。
- **改版迁移**：`guide.version` 与存档引导域 `scriptVersion`（V10-01 schema v3）比对——0 = 从未引导（入口触发事件到达时盖章当前版本并开始）；非 0 且 ≠ 当前版本（老玩家旧版/回滚包）一律视为脚本完结，**不改写存档、不重卡老玩家**；相同版本按 completedStepIds 续走。已知行为：schema v3 迁移的老档 scriptVersion 为 0，会在下次进战斗时完整走一遍引导（V1.0 前存档无引导历史，属预期）。

## AudioConfig（V1.0 音频分组，V10-05）

音频全部配置驱动：`GameConfig.audio`（BGM/技能/命中/UI 四组）。
**当前状态（用户决策 2026-10-05）：四组通道 `enabled: false` 整体后置**——零播放（BGM 含内）；音效系统/分组/并发/节流实现保留，恢复播放把各组 enabled 改回 `true` 即可。

- 每组字段：`channel`（稳定 ID）/ `volume`（组音量基线 0～100）/ `maxConcurrent`（同组并发上限）/ `minIntervalMs`（同组两次播放最小间隔，高频组节流；0 = 不节流）/ `enabled`（组开关，静态）。
- 音量合成：实际播放音量 = 组基线 × 设置域主音量 / 10000（bgm 组 → `settings.bgmVolume`，skill/hit/ui 组 → `settings.sfxVolume`）；任一为 0 即静音，**零播放**。
- 并发/节流/开关/静音判定集中在 `platform/AudioMixer.ts` 纯逻辑（时间注入，测试确定性）；cc 绑定层 `platform/AudioService.ts`（persist 组件）负责剪辑装配与播放，未装配时各接线点静默跳过——音效永不阻断玩法路径。
- 剪辑绑定：`clips`（id = Creator 音频资产名）→ 分组；首发占位音频 `bgm_main`/`sfx_levelup`/`sfx_boss`/`sfx_hit`/`sfx_click`（`game/assets/audio/`，共约 130KB，包体影响随 V10-15 门禁复核）。缺失剪辑 warn 一次并跳过，不报错。
- 接线点（全部低频事件/交互，不在热路径每帧触发）：击杀命中 `sfx_hit`（hit 组，90ms 节流 + 6 并发）、升级三选一面板 `sfx_levelup`、Boss 出场 `sfx_boss`（新增 `bossSpawned` 战斗事件）、全部灰盒按钮 `sfx_click`（PanelKit 统一）、BGM 循环 `playBgm('bgm_main')`。设置变化经 `AudioService.applySettings` 实时生效（V10-06）。

## 设置域（V1.0 我的页·设置区，V10-05/06）

设置域 `AccountSaveData.settings`（V10-01 schema v3 定义，本任务赋语义）：

- 字段：`bgmVolume`/`sfxVolume`（0～100，整数步进 10）/ `vibrationEnabled`（震动开关）/ `qualityTier`（画质档位 0=自动（引擎默认 60FPS）/ 1=流畅（30FPS）/ 2=高清（60FPS））/ `agreementVersion`（协议版本号，0=未确认，V10-16 合规流写入）。
- 默认值单一真相：`AccountSave.DEFAULT_ACCOUNT_SETTINGS`（满音量/震动开/画质自动/协议未确认）——新建存档、迁移修复与设置页"恢复默认"同源，UI 无硬编码。
- 运行时生效：`platform/SettingsRuntime.applyRuntimeSettings` 唯一入口（音量→AudioService、震动→platform/Vibration、画质→game.frameRate）；启动装配（AccountSystem.onLoad）与设置页实时变更、清档重开均走它。
- 震动为平台能力（`platform/Vibration`，微信 vibrateShort，无 wx 环境静默 no-op）；画质为灰盒语义（仅目标帧率，分辨率缩放不做），真机表现随 V10-15 门禁复核。

## AdConfig（V1.0 激励广告与战斗复活，V10-10）

广告全部配置驱动：`GameConfig.ads`（插屏默认关闭不配置，仅远程开关预留）。

- `placements`：稳定投放 ID + 类型（V1.0 仅 rewarded）+ `adUnitId`（用户提供；**空串 = 未配置**，运行时回退模拟/失败路径）+ 开关。
- `revive`（战斗复活，GAME_LOOP §6）：`placementId` 引用投放 / `maxPerBattle` 每局次数（战斗运行态）/ `maxPerDay` 每日次数（存档审计）/ `invulnerableSeconds` 复活无敌秒 / `hpRestoreRatio` 回复比例 [0,1]（按 maxHp 向下取整）/ `disabledStageIds` 不可用关卡。首发定案：每局 1 次、每日 3 次、无敌 2 秒、回复 50%。
- **发奖凭证唯一点**：`adResultGrantsReward`——仅完整观看（rewarded）发奖；中途关闭（closed_early）/失败（failed）不发奖、不扣次数、不自动连播（要约保留由玩家重选或放弃）。
- **每日次数入存档审计**（schema v3 容器复用定案）：`offerClaims` 键 `ad_<placementId>_<dayKey>`、claimCount = 当日已用；写入时清理同投放其他日键（容量有界）。不新增 v3 存档域。
- 死亡复活时序：死亡门（`PlayerAgent.deathReviveGate`，注入式，null=原行为）→ 复用升级暂停语义（running→level_up_paused，模拟冻结 UI 可用）→ 要约面板 → 发奖则 `PlayerVitals.reviveWith`（不发布 playerDied、战局不转 Ended，成就/星级不受影响）或放弃则按原死亡行为（playerDied + endBattle）。
- 模拟实现（Creator/无 adUnitId 环境）日志恒带【模拟广告】标记。

**结算加成与每日资源位（V10-11）**：

- `settlementBonus`：`placementId`（ad_settlement）/ `rewardMultiplier`（2 = 翻倍）/ `maxPerDay`（3）/ `results`（victory/defeat；abort 不提供）。**补差公式与 computeStageRewards 同一所有者**：已发 = floor(基础×难度×比例)，翻倍线 = floor(基础×难度×比例×倍率)，补差 = 翻倍线 − 已发（永不为负）；defeat 的翻倍基线含保留比例。资源走单事务（kind=`ad_settlement_bonus`）→ 账号经验 → 审计 +1；每局限一次（`already_topped_up` 运行态）。
- `dailyResource`：`placementId`（ad_daily）/ `resources`（{res_lingshi: 150}）/ `maxPerDay`（2）/ `cooldownMinutes`（10；冷却锚点 = 当日最近一次成功领取的服务器分钟，存审计键伴生值 lastClaimAt）。发放走单事务（kind=`ad_daily_resource`）→ 审计 +1。
- 两处共用 AdAdapter 与 offerClaims 审计模式（键 `ad_<placement>_<dayKey>`，写时清理同投放旧日键），广告失败/中途关闭零写入。

**广告位产消复核（V10-11 追加，ECONOMY §6/§7）**：

| 投放 | 单次产出 | 每日上限 | 产出归属 |
|---|---|---|---|
| ad_revive | 无资源（复活本体） | 3 次/日 | — |
| ad_settlement | 本局结算补差（≈等值一局奖励） | 3 次/日 | 与关卡结算同源（灵石/修为/经验） |
| ad_daily | 灵石 150 | 2 次/日（间隔 10 分钟） | 独立投放 |

理论日广告产出上限 ≈ 3×一局等值 + 300 灵石；对照主产出线（每日任务/成就/签到首期投放）为辅助量级，不与任务/成就重复投放（任务/成就不含"看广告"条件，投放面无交叠）。数值为首发占位，上线前按实测调参与封顶复核。

## 初始配置 ID

- 怪物：`monster_basic`（妖卒）、`monster_yaonu`（妖奴）、`monster_duzhu`（毒蛛）、`monster_shiren`（石人）——后三者为 V08-02 新增
- 武器：`weapon_qingxiao_sword`（青霄剑，Phase 0 的 `weapon_flying_sword` 于 V01-03 正式化更名并删除旧 ID，关联 `projectile_qingxiao_sword`）
- 投射物：`projectile_flying_sword`
- Boss：`boss_shiyao_general`（噬妖妖将）、`boss_fuchao_shuyao`（腐潮树妖）、`boss_shiyao_lord`（噬妖之主）
- 章节：`chapter_qingyun`、`chapter_yaochao`、`chapter_shiyao`
- 关卡：`stage_mvp_01`、`stage_qingyun_02/03/04`、`stage_yaochao_01/02/03/04`、`stage_shiyao_01/02/03/04`
- 难度档（各关复用）：`diff_normal`、`diff_hard`、`diff_nightmare`
- 升级：`sword_damage_up`、`sword_cooldown_down`、`sword_count_up`
- 资源（V0.5）：`res_lingshi`、`res_xiuwei`、`res_yaodan`、`res_lingpo_<qinglong|baihu|zhuque|xuanwu|jiuweihu>`
- 功能解锁（V1.0）：`home`、`stage_select`、`base_weapon`、`realm`、`beast`、`codex`、`shop`、`offers`、`activities`（解锁表条目 ID `unlock_*`）
- 引导步骤（V1.0）：`guide_move`、`guide_attack`、`guide_pickup`、`guide_levelup`、`guide_settlement`、`guide_cultivate`（脚本 version 1）
- 音频（V1.0）：分组 `bgm`/`skill`/`hit`/`ui`；剪辑 `bgm_main`、`sfx_levelup`、`sfx_boss`、`sfx_hit`、`sfx_click`（占位，正式音频随 V10-14 替换）
- 广告（V1.0）：投放 `ad_revive`、`ad_settlement`、`ad_daily`（adUnitId 均待用户配置）

## 后续配置域（按版本落地）

| 配置域 | 关键实体/字段 | 最早版本 |
|---|---|---|
| 战斗构筑 | 法器、功法、法宝、绝学、前置/互斥/层数/权重 | V0.1 |
| 战斗内容 | 怪物行为、精英、Boss 阶段、掉落组、结算 | V0.1 |
| 局外成长 | 玩家等级、境界/小境界、修为、突破、法器/灵兽等级星级技能 | V0.5 |
| 章节关卡 | 章节/秘境、关卡、难度、三星、首通/累计奖励 | V0.8 |
| 经济留存 | 资源、商品、统一礼包、任务、成就、30 日登录、奖励中心 | V0.8 |
| 运营平台 | 活动实例、功能开关、服务器日切、广告位、引导与埋点 | V1.0 |
| 便利性 | `timeScale` 档位及解锁条件 | V1.1 |

所有后续实体使用稳定 ID 与显式引用，不以显示名称、UI 序号或资源路径建立业务关系。时间窗保存绝对服务器时间；周期规则保存时区/日切规则。奖励统一引用奖励组；商品和免费礼包共用统一 offer 模型。概率、保底、限购、重置和互斥必须能在启动/发布前校验。

## 数值设计原则

- 基础值、成长曲线、倍率、上限和取整顺序显式配置/文档化；战力只是展示汇总，不作为结算公式。
- 先定义单位与基准，再配置倍率；同一公式只有一个所有者，UI 读取结果而不复算。
- 免费产出、关键消耗、目标完成天数和溢出处理成套评审，避免只调单点奖励。
- 难度增长同时使用敌人组合/行为与数值，不依赖无限指数膨胀；正式数值与 Phase 0 灰盒数值分表/分版本。
- 配置版本升级提供兼容/迁移说明，不降低玩家已合法拥有状态。

## 配置变更流程

1. 先更新类型与本文档语义。
2. 更新配置和启动校验。
3. 更新使用方与测试夹具。
4. 运行全量配置校验；若兼容旧数据并非 MVP 要求，可直接失败，但必须提供清晰迁移说明。

## 当前实现位置

- schema：`game/assets/scripts/config/ConfigTypes.ts`
- MVP 初始配置：`game/assets/scripts/config/GameConfig.ts`
- 集中校验：`game/assets/scripts/config/ConfigValidation.ts`
- 命令行测试：`game/tests/configValidation.test.mjs`（需要 Node.js 22 或更高版本执行 TypeScript type stripping）
- 功能解锁判定：`game/assets/scripts/account/UnlockSystem.ts`；命令行测试 `game/tests/unlockSystem.test.mjs`
- 引导状态机：`game/assets/scripts/account/GuideSystem.ts`；命令行测试 `game/tests/guideSystem.test.mjs`
- 音频混音：`game/assets/scripts/platform/AudioMixer.ts`（纯逻辑）+ `AudioService.ts`（cc 绑定）；命令行测试 `game/tests/audioMixer.test.mjs`
- 复活流程：`game/assets/scripts/battle/ReviveFlow.ts`（纯逻辑）+ `battle/ReviveController.ts` + `ui/ReviveOfferPanel.ts`；命令行测试 `game/tests/reviveFlow.test.mjs`
- 广告奖励：`game/assets/scripts/account/AdRewards.ts`（纯逻辑）；命令行测试 `game/tests/adRewards.test.mjs`

启动装配者必须先调用 `assertValidGameConfig(INITIAL_GAME_CONFIG)`，通过后才能创建战局。T01 只提供校验入口；实际启动接线属于 T02。
