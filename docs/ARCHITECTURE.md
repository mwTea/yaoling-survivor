# ARCHITECTURE — 客户端架构与演进边界

## 设计目标

架构服务于小步可玩、可测试和微信端稳定性能。完整产品方向见十份核心产品文档，实际实现范围见 `ROADMAP.md` 与 `CODEX_TASKS.md`。本文同时标注“当前实现”和“后续边界”，不得因后续设计提前引入系统或框架。

## 分层与模块

| 层/模块 | 责任 | 不负责 |
|---|---|---|
| `core` | 战局状态、强类型事件契约、时间门、随机源接口 | 具体节点表现、数值配置 |
| `battle` | 创建/结束/暂停/恢复战局，协调系统初始化顺序 | 单个实体行为、UI 排版 |
| `player` | 输入意图、移动、玩家局内状态 | 摇杆视觉、怪物生成 |
| `monster` | 生成策略、激活集合、追踪行为、精英有效数值快照 | 伤害公式、升级逻辑 |
| `combat` | 目标查询接口、武器计时、投射物、HP、伤害、死亡 | 经验等级、UI |
| `progression` | 经验、等级阈值、候选抽取、效果应用、当局功法运行态 | 面板渲染、怪物死亡实现 |
| `pooling` | 池注册、预热、获取、回收、诊断 | 业务生成节奏 |
| `config` | schema、表、验证、只读查询 | 运行态 |
| `ui` | 输入适配、HUD 和升级选择展示 | 战斗规则、直接修改怪物 |

后续版本按需增加 `content`（章节/关卡运行数据）和 `retention`（任务/登录/成就）模块；`account/`（账号局外成长）、`economy/`（库存与事务）、`platform/`（平台适配，当前仅存储接口）已随 V0.5 建立。局内 `progression/` 只承载当局成长，账号成长一律在 `account/`，两者命名语义严格分离。

V0.8 实际落位（未新建 `retention/` 目录，留存领域全部以叶子模块落 `account/`，避免目录扩散）：`StageProgress`（关卡解锁链/星级/里程碑领取）、`TaskSystem`（任务周期桶）、`AchievementSystem`（分级成就）、`CodexSystem`（图鉴记录）、`ShopSystem`（商店购买）、`LoginReward`（30 日累计登录）、`OfferSystem`（统一礼包免费子集）、`RewardCenter`（一键领取编排）、`ActivitySystem`（活动壳编排）；`platform/` 增 `TimeService`（全仓唯一时间入口，V0.8 本地时间实现）与 `FeatureFlags`（静态功能开关）；`battle/` 增 `ActiveStage`（当局选中关卡快照）与 `StarEvaluator`（三星条件评估）。UI 层新增 `PanelKit`（动态灰盒 UI 构建，面板内容代码生成以压缩装配足迹）与 `RedDotService`（中央红点，事件驱动、无每帧扫描）。

## 场景装配

`HomeScene`（V05-10 起，产品流程入口）与 `BattleScene` 的建议根结构：

```text
HomeScene
├── AccountRoot                ← 挂 AccountSystem（persistent=true，addPersistRootNode 跨场景常驻）
└── Canvas
    └── HomeHud                ← 首页灰盒（等级/境界/资源栏/开始战斗；V05-11/12 扩展培养面板）

BattleScene
├── Systems
│   ├── BattleController（含 PoolService/TargetRegistryComponent 等）
│   ├── MonsterSpawner
│   ├── AccountBattleLink      ← battleFinished 转发给 persist 账号服务（V05-10）
│   └── BeastCompanionSystem   ← 出战灵兽触发技能（V05-08）
└── Canvas
    ├── Camera
    ├── World                  ← CameraController 挂此；相机跟随 = 反向平移本容器
    │   ├── Player
    │   └── PoolRoot（池实例）
    ├── HUD
    ├── VirtualJoystick
    ├── LevelUpPanel
    └── BattleResultPanel（含可选 rewardLabel/homeButton）
```

账号服务生命周期：`AccountSystem` 常驻于 HomeScene 的 persist 根节点，战斗场景经静态 `AccountSystem.instance` 只读访问——快照注入由 `ProgressionSystem.onLoad` 拉取（onLoad 先于一切 start，`PlayerAgent` 读取 maxHp 加成顺序确定），结算经 `AccountBattleLink` 转发。**直接预览 BattleScene（不经 HomeScene）时无账号服务：战斗保持 V0.1 行为，不结算不落账**（账号链路调试须从 HomeScene 进）。返回首页时场景内 AccountRoot 副本由单例防护销毁。

World 容器内的节点用世界坐标，`CameraController` 每帧把容器平滑推向"视口中心=玩家"的反向偏移（`CameraFollowMath` 纯函数夹紧在世界边界内）；屏幕 UI 在 World 之外不受影响。场地大小来自 `stage.playArea`（当前 2400×1600）。

节点结构是装配方案，不是跨模块 API。业务组件不得用硬编码路径查找这些节点。

## 战局状态

最小状态：`Booting → Running ↔ LevelUpPaused → Ended`。

- 只有 `BattleSession`/`BattleController` 可发起合法状态转换。
- `LevelUpPaused` 时：移动、刷怪、AI、武器、投射物和拾取模拟暂停；升级 UI 仍响应真实输入。
- 战斗系统读取统一的 `BattleClock` 语义（当前接口/实现为 `BattleTime` / `SimulationClock`），不得各自修改 `director` 全局时间缩放。
- 结束战斗后拒绝新生成、新伤害和新经验，统一回收局内实体。

当前实现：`BattleSession` 是状态转换的唯一入口；`SimulationClock` 接收真实帧间隔，但只在 `Running` 状态产出非零 battle delta。UI 继续使用 Cocos 的真实输入/生命周期，不依赖 battle delta，因此升级暂停不会冻结按钮。V1.1 才实现 `1x/1.5x/2x`；届时仅在这个统一入口引入 `timeScale`，AI、移动、技能、投射物、状态、刷怪和战斗计时不得散落乘倍率。服务器倒计时、广告和 UI 动画不使用 battle time。

## 核心事件流

```text
InputSource -> PlayerMover
MonsterSpawner -> PoolService -> Monster activated -> TargetRegistry
AutoSwordWeapon -> TargetQuery -> SwordProjectile
SwordProjectile -> DamageService -> Health
Health reaches 0 -> DeathService -> MonsterDied
MonsterDied -> XP drop request -> PoolService -> ExperiencePickup
ExperiencePickup -> ExperienceCollected -> ProgressionService
ProgressionService -> LevelUpRequested -> BattleSession pauses -> LevelUpPanel
LevelUpPanel choice -> UpgradeService applies effect -> LevelUpResolved -> BattleSession resumes
```

输入通过 `MovementInputController` 汇合：键盘用于编辑器调试；虚拟摇杆触摸期间拥有输入优先权，触摸结束/取消/组件禁用时释放优先权并清零摇杆状态。`PlayerMover` 只读取统一的归一化方向，不依赖具体输入 UI。

推荐中央事件仅包含跨模块事实：

- `monsterDied { entityId, monsterId, position, xpValue }`
- `playerHpChanged { hp, maxHp, cause }`（玩家生命变化事实：受击结算或任意治疗后发出；V08-04 星级受击计数/剩余生命条件使用）
- `playerDied { entityId, monsterId, position, xpValue }`（monsterId 固定 'player'、xpValue 恒 0；V0.1 起）
- `experienceCollected { amount }`
- `battleFinished { result, stats }`（终局事实：victory/defeat + 用时/击杀/经验/等级快照；V08-04 起含 stars 与逐条星级条件明细 starDetails）
- `levelUpRequested { level, optionIds }`
- `levelUpResolved { level, optionId }`
- `battleStateChanged { previous, current }`

单模块内部优先直接方法/回调。事件 payload 用稳定值对象，不泄露组件实例。

当前实现（T08）：`core/BattleEventBus` 是类型化事件总线（快照 emit、订阅成对解除、dispose 后静默忽略在途 emit），由 `BattleController` 持有并随场景销毁清理；战局状态变化经其转发为 `battleStateChanged`。`monsterDied` 由 `combat/MonsterVitals` 在死亡编排中发布（顺序固定：标记死亡 → 注销目标 → 发布一次 → 回池），payload 为纯值对象。伤害契约 `DamageRequest`/`validateDamageRequest` 与 `Health`、`MonsterVitals` 集中在 `combat/Combat.ts` 单文件（同 `Pools.ts` 的 Node/Creator 导入约束先例）；`MonsterAgent.takeDamage` 是怪物受伤的唯一入口，每次激活新建 vitals 保证回池再激活后无旧状态。

## 实体与 ID

- 配置 ID 表示“种类”；运行时 `entityId` 表示一次激活实例。二者不得混用。
- 池回收再激活后必须获得新的 `entityId`，使过期投射物/事件无法误伤新实体。
- `Health` 只管理当前/最大生命与伤害幂等；掉落和计分由死亡事件下游处理。

当前实现（T06）：`combat/TargetRegistry` 统一分配递增 entityId（从 1 起，0 为 `INVALID_ENTITY_ID` 保留值），注销后旧 ID 立即失效；`MonsterAgent` 在 `onAcquire` 时注册、`onRelease` 时注销并清空全部运行态（entityId/monsterId/配置引用/位置/显隐）。目标查询接口（T09）将基于该注册表的当前有效集合实现。

## 对象池原则

- 一个 prefab/type 对应显式池 key；预热数量来自关卡预算。
- `acquire` 的完整流程：取节点 → 分配新实体 ID → 注入配置快照/运行态 → 重置位置与表现 → 激活 → 注册。
- `release` 的完整流程：标记不可交互 → 注销目标/碰撞 → 清监听与计时 → 清引用 → 隐藏 → 归池。
- `release` 必须幂等防护；开发模式记录未归还计数和峰值。

当前实现（T05/T06/T07）：`pooling/PoolTypes.ts` 定义 `PooledObject<TData>` 协议（`onAcquire(context)` / `onRelease()`，context 携带 `poolKey` 与调用方通过 `acquire(data)` 传入的获取数据）与 `PoolStats` 诊断快照；`pooling/Pools.ts` 提供 `InstancePool<TObject, TData>`（单 key：预热、LIFO 复用、容量硬上限、借出/归还与峰值统计）、`ManagedPool`（注册表视角的数据无关契约）和 `PoolRegistry`（key 注册查错、全局 `releaseAll`/`disposeAll`、`describeAll` 诊断）。重复归还、归还外来实例、未知 key、容量耗尽均抛出携带 key 的专用错误。运行时类集中在 `Pools.ts` 单文件、不依赖 cc：Node 测试按文件直接加载 .ts，无法解析无扩展名的跨文件值导入，而 Creator 约定无扩展名导入。`PoolService` 组件持有注册表与 poolRoot，`registerNodePool` 以 prefab+组件类型构造工厂（新实例挂 poolRoot 下并保持隐藏，可用 `onCreate` 钩子注入依赖），场景销毁时统一回收并告警未归还实例。怪物池容量自 T07 起由 `stage.activeMonsterHardCap` 驱动（预热数量为性能常量 8）；刷怪节奏与出生位置见 `monster/SpawnPlanner`（波次时间窗、出批重置不结转、软上限跳过/裁剪、环带+playArea 钳制+安全重试，随机消耗契约固化保证同序列可复现）。

## 配置与运行态

配置表在启动时加载、校验并冻结；运行态由工厂根据配置创建。升级修正通过显式的 `PlayerCombatStats` 运行态叠加，不改写技能配置。数值关系和 schema 详见 `CONFIG.md`。

## 局内、账号与平台边界（后续版本）

- 开局时从账号数据生成只读 `BattleLoadoutSnapshot`；战斗不得直接修改账号库存、培养或任务存档。
- 结算输出纯值 `BattleResult`，由结算用例幂等发放奖励、推进任务并保存；显示层不生成奖励。
- 账号存档按身份、进度、养成、库存、留存/运营、设置分域，携带 schema/version 与迁移；本地缓存不是多端最终真相。
- 服务器时间、微信登录/云存档、广告、支付和埋点通过 `platform` 适配接口进入，业务代码不得散布 `wx.*`。
- 远程功能开关采用安全默认值和可降级接口；Phase 0 不引入后端、热更新或远程配置实现。

当前实现（V05-01，V08-01 扩展为 schema v2，V10-01 扩展为 schema v3）：`platform/StorageAdapter` 定义存储适配接口与测试用内存实现，业务代码不触碰 localStorage/wx.*；`account/AccountSave` 单文件承载账号存档 schema v3（进度 playerLevel/playerXp/realmIndex/subRealmIndex + V0.8 扩展 stageRecords/unlockedChapterIds/stageSelection，养成 weaponLevels/beasts/deployedBeastId，库存 balances，留存 taskBuckets/achievements/loginReward/shop/codex/offerClaims/activities，V1.0 扩展身份 identity[localGuestId/wxOpenId/账号创建与最后登录时间]/设置 settings[音量/震动/画质/协议版本]/引导 guide[脚本版本/已完成步骤]/云同步元数据 cloudSync，审计 recentTransactions + schemaVersion/时间戳）、创建/解析修复/序列化与 `AccountStore`（会话内缓存、lastSavedAt 盖戳、损坏或未知版本档备份到 `yaoling_account_save_corrupt_backup` 后开新档并暴露 `lastResetReason`）。v1/v2 旧档在解析时自动无损迁移到当前版本（`upgradeAccountSaveV1ToV2` / `upgradeAccountSaveV2ToV3` 同走 normalize 归一路径：补默认值、幂等、不算重置）；v2/v3 容器字段由各阶段后续任务赋予语义（阶段决策：schema 一次成型，后续只填语义不改结构）。存档只承载玩家状态，字段语义由后续任务的配置与领域模块赋予；Creator 装配与落盘时机随 V05-10 主界面接入。

当前实现（V05-07～V05-10 局外 → 战斗注入与结算回流）：`account/LoadoutBuilder` 从账号存档切片构建只读 `BattleLoadoutSnapshot`（法器伤害加成、境界 maxHp 加成、出战灵兽技能）；`ProgressionSystem.applyLoadout` 是唯一注入入口（一次性，重复调用只生效一次），onLoad 从 persist 账号服务拉取快照，`PlayerAgent` 生命运行态读取 maxHp 加成；无账号服务时注入空快照，行为与 V0.1 一致。`combat/BeastCompanionSystem` 按出战快照周期触发灵兽技能（damageNearest 复用投射物池与命中链路、heal 经 `PlayerAgent.applyCompanionHeal` 统一入口），数值全部来自 `BeastConfig`。`account/AccountSystem`（persist 根节点）持有 AccountStore/EconomyService/工作存档，是 `battleFinished` 的唯一结算消费方：`account/SettlementRewards` 纯函数计算并单事务发放（资源 → 账号经验 → 小境界自动推进）后立即落盘；结算面板奖励行与发放共用同一纯函数；战斗场景的 `AccountBattleLink` 负责事件转发，培养操作（V05-11/12）经领域事务后 `persistSave`。

当前实现（V08-03 按关卡装配）：`account/StageProgress` 纯逻辑承载关卡解锁链（章节链/章内顺序/难度档首星门槛）、星级与通关历史（只进不退）、首通/星级累计领取标志与章节解锁同步；`battle/ActiveStage` 为当局选中关卡（stage + difficulty）静态快照，由 `AccountBattleLink.onLoad` 按存档 `stageSelection` 装配（未选择默认第一章第一关 × 首个难度档；直接预览 BattleScene 回退 `initialStageId`），替代各战斗系统各自直读 `initialStageId` 的旧入口；难度档数值乘数经 `MonsterRuntimeContext.difficultyMultipliers` 注入怪物/Boss 运行态快照（精英 × 难度叠加），结算按难度 `rewardMultiplier` 折算（floor(基础 × 乘数 × 保留比例)）。战斗全程不回写账号；结算点额外记录关卡进度并同步章节解锁。

## 微信包体、资源与适配

- 控制首包同步资源，章节、正式美术和音频按微信分包/远程资源能力评估；资源引用不得让未解锁内容被首包隐式拉入。
- UI 使用 SafeArea 适配和设计分辨率重排，触控不依赖鼠标；低端机可降低粒子、飘字和音频并发，但不降低规则正确性。
- 性能门禁同时覆盖 CPU、GC、节点/DrawCall、内存、首包与加载时间。预算变更需 Creator Profiler、微信开发者工具和真机证据。

## 可测试性

- 经验阈值、升级候选、伤害/死亡幂等、刷怪节奏、武器冷却用纯 TypeScript 测试。
- Cocos 组件保持薄层：读取节点/输入，调用规则对象，再更新表现。
- 随机源、时钟、目标查询通过接口注入，测试使用确定性实现。

## 性能预算（MVP）

- 默认活跃怪物上限 120，硬上限 180；超限时跳过生成，不突发补生成。
- 默认同时活跃飞剑 32（`WeaponConfig.maxActiveProjectiles`，即飞剑池容量）、经验物 100；超过经验物预算时允许合并邻近掉落的数值，不能丢经验。
- 目标查询默认每次发射执行，避免每帧查询；先使用复用数组/注册表，性能数据证明需要时再做网格索引。当前实现（T09）：`TargetQuery` 接口 + `NearestTargetQuery` 线性扫描，武器组件不感知查询实现。
- 正常战斗热路径不得创建/销毁上述高频实体。10 分钟运行后池总量应趋于稳定。

这些是初始预算，不是永久数值；变更需用 Profiler/真机证据并同步文档。
