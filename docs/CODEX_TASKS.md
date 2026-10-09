# CODEX_TASKS — Phase 0（T00～T14）任务与验收记录

> 本文件是已验证技术底座的审计记录。V0.2 文档重构不改变 T00～T14 的任务边界、代码结论或验收状态；后续 V0.1+ 工作必须使用新任务编号，不得回填扩大这些任务。完整产品方向与阶段范围分别见 `PRODUCT.md`、`ROADMAP.md`。

## 使用规则

- 严格按依赖顺序推进；一次只领取一个任务。
- 开始前读取 `AGENTS.md`、`ROADMAP.md` 和相关专题文档，确认依赖已验收。
- 完成后在任务下追加简短验收记录（日期、Creator 版本、测试结果），不要只勾选代码完成。
- 每项 DoD 都隐含：无新增控制台错误、无无关修改、相关文档同步、列出未执行的人工/真机验证。

## T00 — 用 Creator 生成工程与 BattleScene

依赖：无。

状态：已完成（2026-09-20）。使用 Cocos Creator `3.8.8` 生成 `game/`，清理嵌套 Git 仓库，建立资源目录，并确认 `BattleScene` 与 `.meta` 已保存到 `assets/scenes/`。Creator 内预览结果由用户确认。

工作：在仓库根目录生成 `game/` 2D TypeScript 工程；记录 Creator 精确版本；建立 `assets/scenes/BattleScene.scene` 和约定的一级资源目录。

DoD：

- Dashboard 可识别并打开项目；BattleScene 预览成功。
- 目录与 `ARCHITECTURE.md` 一致；生成缓存未被 Git 跟踪。
- README 中记录精确 Creator 版本 `3.8.8`。

## T01 — 纯 TypeScript 核心契约与配置校验

依赖：T00。

状态：已完成（2026-09-20）。配置测试 7/7 通过；使用 Creator 3.8.8 内置 TypeScript 编译器执行严格类型检查通过；Creator 已完成脚本导入，用户确认 BattleScene 预览无编译错误。

工作：建立战局状态、时钟接口、随机源接口、事件 payload 类型、配置 schema、初始配置与启动校验；不做 UI 和实体行为。

DoD：

- 非法 ID、重复 ID、越界数值和断裂引用均有测试并快速失败。
- 初始配置包含一个怪物、飞剑武器/投射物、一关波次、等级曲线、三个升级项。
- 纯逻辑代码不依赖场景节点；类型检查和测试通过。

## T02 — BattleSession 与暂停时间门

依赖：T01。

状态：已完成（2026-09-20）。状态机与暂停时钟测试通过，Creator 场景已装配；用户确认预览显示 `Battle: running`，最新预览日志无错误。

工作：实现 `Booting/Running/LevelUpPaused/Ended` 合法转换和 `BattleClock`；在 BattleScene 装配最小 `BattleController`。

DoD：

- 合法/非法状态转换有纯逻辑测试。
- 模拟暂停时 battle delta 为 0，但普通 UI 回调可继续执行。
- 场景预览可显示当前状态，重复进入无监听残留。

## T03 — 玩家灰盒、输入接口与边界移动

依赖：T02。

状态：已完成（2026-09-20）。移动与配置相关测试累计 19/19 通过，Creator 3.8.8 严格类型检查通过；BattleScene 已挂载玩家灰盒，用户确认 WASD/方向键移动、斜向速度和边界限制均正常。

工作：实现与 UI 解耦的 `MovementInput`、PlayerMover、矩形边界和编辑器键盘适配器。

DoD：

- 输入归一化、斜向速度、delta time 和边界夹紧有测试或确定性验证。
- Running 时移动，LevelUpPaused 时停止。
- PlayerMover 不查找摇杆节点，不在 update 中获取组件。

## T04 — 虚拟摇杆触控

依赖：T03。

状态：已完成（2026-09-20）。累计 22/22 自动测试通过，Creator 3.8.8 严格类型检查通过；用户确认 Creator 触摸模拟中的拖动、死区、半径夹紧、松手停止和键盘共存均正常。微信开发者工具及真机触控仍未验证，保留到 T14。

工作：实现摇杆视觉与触摸适配，向 `MovementInput` 输出方向。

DoD：

- 开始/拖动/结束/取消/禁用均正确；死区和半径夹紧正确。
- 键盘与触摸不会互相留下脏输入；松手玩家立即停止。
- Creator 触摸模拟通过，并记录微信开发者工具待验证项。

## T05 — 通用对象池骨架

依赖：T01、T02。

状态：已完成（2026-09-20）。自动测试累计 33/33 通过（新增 11 项池生命周期测试，命令 `node --experimental-strip-types --test tests/*.test.mjs`）；Creator 3.8.8 内置 TypeScript 5.8.2 严格类型检查通过（`tsc -p tsconfig.json --noEmit`，退出码 0）。用户已在 Creator 3.8.8 内完成场景装配（PoolRoot、Systems/PoolService、GrayBox prefab、PoolSelfTest）并确认预览验收：registered/acquired 3/released 3/PASS after 300 cycles 日志符合预期（created=4、borrowed=0、acquires=releases=305），灰盒显隐正确，无控制台错误。池预算配置化保留到 T07。

工作：实现 pool key、预热、acquire/release、池化生命周期和开发期诊断；先用灰盒测试 prefab/节点验证。

DoD：

- 获取时完整重置，回收时取消监听/计时并清引用。
- 重复回收、未知 key、容量异常有清晰断言。
- 300 次循环后创建数稳定、借出数归零，不依赖 `onDestroy` 清理。

## T06 — 怪物运行态、注册表与追踪

依赖：T03、T05。

状态：已完成（2026-09-20）。纯逻辑测试累计 40/40 通过（目标注册表 3 + 追踪数学 3 + 池数据透传 1 为本任务新增）；Creator 3.8.8 内置 TypeScript 5.8.2 严格类型检查通过（退出码 0）。用户在 Creator 内完成装配与预览验收：自检输出 PASS（entityId 有效、暂停冻结、追踪接近玩家、回收注销、重激活获得新 entityId），画面表现符合预期（5 怪生成→level_up_paused 冻结→恢复追踪→回收 2 个→重生成 1 个）。已知过程问题：排障期间一次脚本编译错误导致场景中 MonsterSelfTest 的 poolService 属性槽序列化值丢失、连线反复失效，用户重新连线后通过；夹具为一次性验收工具，验收后节点删除，不修该历史问题。

实现摘要：`combat/TargetRegistry.ts`（纯 TS 注册表：统一分配递增 entityId、注销即失效、`INVALID_ENTITY_ID=0`）、`monster/MonsterMovement.ts`（纯 TS `moveTowards`）、`monster/MonsterAgent.ts`（池化组件：onAcquire 注入配置/注册、onRelease 注销清态、update 仅在 battleDeltaTime>0 时按配置速度追踪）、`assets/tests/MonsterSelfTest.ts`（灰盒自检，验收后删除）。附带协议调整：`PoolAcquireContext` 增加 `data`（池按 `TData` 泛型透传获取数据）、`registerNodePool` 增加 `onCreate` 注入钩子、注册表改用 `ManagedPool` 数据无关接口、`MutableVector2` 移至 `shared/Vector2Types.ts` 由 player 重导出。

工作：实现怪物池化组件、唯一激活 `entityId`、有效目标注册表和向玩家追踪。

DoD：

- 回池再激活获得新 entityId；旧引用不可作为有效目标。
- 怪物只在 Running 追踪，速度来自配置。
- 回收后从注册表移除且所有临时状态清零。

## T07 — MonsterSpawner 与第一波次

依赖：T06。

状态：已完成（2026-09-20）。纯逻辑测试累计 48/48 通过（新增 8 项刷怪规划器测试）；Creator 3.8.8 内置 TypeScript 5.8.2 严格类型检查通过（退出码 0）。用户在 Creator 内完成装配（Systems 挂 TargetRegistryComponent 与 MonsterSpawner）并确认预览验收：开局约 1 秒后怪物从屏幕外持续进入并追踪玩家，移动时从新位置周围生成，数量受控增长，无红色报错。用户询问的"怪物叠在玩家身上"确认为预期行为（追踪目标即玩家，T08/T09 前无伤害死亡机制）。

实现摘要：`monster/SpawnPlanner.ts`（纯 TS：波次时间窗、间隔节奏出批后重置不结转、软上限跳过/按余量裁剪、[spawnMinRadius, spawnMaxRadius] 环带 + playArea 钳制 + 距玩家过近确定性重试，随机消耗契约固化保证同序列可复现）、`monster/MonsterSpawner.ts`（组件：按 stage 配置注册 monsterId 池，maxCapacity=activeMonsterHardCap、预热常量 8；battleDeltaTime>0 才推进；活跃计数来自 TargetRegistry；每 30 战斗秒诊断日志；仅 3 个序列化槽，PoolService/TargetRegistryComponent 从 Systems 节点一次性解析强校验）、`combat/TargetRegistryComponent.ts`、`core/RandomSource.ts` 增 `createSystemRandomSource`。

工作：按关卡/wave 配置生成怪物，落实视野外环带、安全距离、存活上下限和不补积压策略。

DoD：

- 使用确定性随机源时生成结果可复现。
- 暂停不累计爆发生成；达到硬上限不生成。
- BattleScene 中玩家移动时怪物持续从合理位置出现并追踪。

## T08 — HP、伤害和一次性死亡

依赖：T06。

状态：已完成（2026-09-20）。纯逻辑测试累计 60/60 通过（新增 12 项：事件总线 4、生命/伤害校验 3、死亡编排 5——覆盖生命夹紧、非法伤害拒绝、同帧多次致死只发一个事件、死亡顺序注销先于发布、过期 entityId 拒绝、回池再激活满血无旧状态）；Creator 3.8.8 严格类型检查通过（退出码 0）。用户在 Creator 内完成装配（CombatSelfTest 挂 battleController=Systems）并确认预览验收：每 2 战斗秒全场怪物被击杀消失、monsterDied 事件计数逐次递增且增量等于当场存活数（一次性死亡）、生成持续、无红色报错。

实现摘要：`core/BattleEventBus.ts`（类型化事件总线：快照 emit、成对解除、dispose 后静默 emit/拒绝订阅；BattleController 持有并转发 `battleStateChanged`，销毁时 dispose）、`combat/Combat.ts`（运行时规则单文件，同 Pools.ts 先例：`DamageRequest`/`validateDamageRequest` 唯一校验入口、`Health` 夹紧、`MonsterVitals` 固定死亡顺序"标记→注销→发布一次 monsterDied→回池"，同帧多次致死幂等、过期 entityId 拒绝）、`combat/TargetRegistry.forEachTarget` 快照枚举、`MonsterAgent` 改用 `MonsterRuntimeContext` 注入并提供 `takeDamage` 伤害唯一入口（每次激活新建 vitals）、`MonsterSpawner` 装配 context 并实现 `releaseAgent`。`MonsterSelfTest` 已删除；`assets/tests/CombatSelfTest.ts` 为 T08 验收夹具（保留至 T09 验收时随节点删除）。

工作：实现 DamageRequest、Health、死亡幂等和 `monsterDied` 事件；暂不掉经验。

DoD：

- 生命夹紧、非法伤害拒绝、同帧多次致死只发一个事件有测试。
- 死亡先注销交互再发布事件，随后安全回池。
- 回池再激活后 HP 完整恢复，无旧死亡状态。

## T09 — 自动飞剑与目标选择

依赖：T05、T08。

状态：已完成（2026-09-20）。纯逻辑测试累计 66/66 通过；Creator 3.8.8 严格类型检查通过（退出码 0）。用户完成装配（SwordGray prefab + Systems/AutoSwordWeapon）并确认预览验收：无怪不出剑、有怪每 0.8 秒自动发射、怪物两剑死亡、飞剑超时/越界自动消失、无红色报错（期间一次"prefab 缺 SwordProjectile 组件"为装配遗漏，用户补挂组件后通过）。

实现摘要：`combat/TargetQuery.ts`（`TargetQuery` 接口可替换空间分区，`NearestTargetQuery` 有界线性扫描、等距离 entityId 决胜）、`combat/CooldownTimer.ts`（发射冷却/重试共用，epsilon 消浮点残差）、`combat/SwordProjectile.ts`（池化直线飞行、穿透命中同一 entityId 仅一次、超时/越界回池）、`combat/AutoSwordWeapon.ts`（冷却+受控重试+小角度散射，池容量=配置 `maxActiveProjectiles`）、`RegisteredTarget.collisionRadius`。配置新增 `WeaponConfig.maxActiveProjectiles/projectileSpreadDegrees`（已同步 CONFIG.md/校验/测试）。开发中发现并修复两个缺陷：最近目标查询首个候选无视半径上限、冷却浮点残差不就绪（均有回归测试）。

工作：实现最近有效目标查询、武器冷却、飞剑池化移动/命中/超时；数值来自配置。

DoD：

- 相同距离按 entityId 稳定选择；目标死亡/回池后不会被命中。
- 无目标采用受控重试；暂停时冷却、飞行和命中均冻结。
- 飞剑命中同一激活实例最多一次，回收后状态完整重置。

## T10 — 经验掉落与拾取

依赖：T08、T05、T03。

状态：已完成（2026-09-20）。纯逻辑测试累计 70/70 通过；Creator 3.8.8 严格类型检查通过（退出码 0）。用户确认预览验收：击杀掉绿宝石、走近拾取消失、守恒日志正常、无红色报错。实现：配置新增 `ExperiencePickupConfig`（id/prefabId/pickupRadius=60/maxActiveCount=100，已同步 CONFIG.md/校验）、`progression/ExperienceDrop.ts`（纯 TS 决策：预算内生成，达预算且有现存则合并进最近经验物，无现存宁可超预算也不丢经验）、`progression/ExperienceGem.ts`（池化经验物：静止于掉落位，玩家进入 pickupRadius 即收集；顺序固定"标记已收集→发布一次 experienceCollected→回池"，重复接触只结算一次；仅 battleDeltaTime>0 检测，暂停不拾取）、`progression/ExperienceDropService.ts`（订阅 monsterDied onEnable/onDisable 成对解除；合并时叠加 addAmount；每 30 战斗秒输出守恒诊断 dropped/collected/merged/onField）。事件：monsterDied → 生成/合并；experienceCollected {amount} 已发布（T11 消费）。

实现摘要：配置新增 `ExperiencePickupConfig`（pickupRadius=60/maxActiveCount=100，已同步 CONFIG.md/校验）；`progression/ExperienceDrop.ts`（纯 TS 决策：预算内生成、达预算合并进最近经验物、无现存宁可超预算不丢经验）；`progression/ExperienceGem.ts`（池化静止拾取：标记已收集→发布一次 experienceCollected→回池，幂等，暂停不拾取）；`progression/ExperienceDropService.ts`（订阅 monsterDied 成对解除、addAmount 合并、30 战斗秒守恒诊断日志）。

工作：监听怪物死亡，池化生成经验物，实现拾取幂等和经验守恒；不做升级面板。

DoD：

- 一次死亡产生一次正确经验；重复接触只收集一次。
- 达到经验物预算时执行合并且总经验不丢失。
- 暂停时不移动/拾取；场景退出后无事件残留。

## T11 — 等级、经验队列与升级候选

依赖：T01、T10。

状态：已完成（2026-09-20）。纯逻辑测试累计 79/79 通过（新增 9 项）；Creator 3.8.8 严格类型检查通过（退出码 0）。本任务无场景可见行为，DoD 全部由自动测试覆盖；用户确认关闭，Creator 表现验收并入 T12。实现：`progression/ProgressionService.ts`（纯 TS，不依赖 cc：addExperience 循环处理阈值允许跨级入队；同一时刻至多一个 currentChoice，resolve 后才服务下一个，期间 hasPendingLevelUp 保持暂停意图；候选按权重不放回抽取、每项消耗一个随机数、固定序列可复现；maxStacks 过滤、候选为空的等级直接完成不产生请求；onLevelUpChoice 监听供 T12 接线）。本任务无场景可见行为，DoD 全部由自动测试覆盖，Creator 表现验收随 T12 升级面板进行。

工作：实现等级曲线、跨级队列、三个不重复候选和堆叠上限过滤；暂不做最终 UI。

DoD：

- 边界经验、一次跨多级、候选不足、满层过滤均有测试。
- 固定种子候选可复现，不存在无限抽取循环。
- 每次只产生一个待处理升级请求，所有请求处理前保持暂停意图。

## T12 — 升级面板与暂停闭环

依赖：T02、T11。

状态：已完成（2026-09-20）。纯逻辑测试累计 84/84 通过；Creator 3.8.8 严格类型检查通过（退出码 0）。用户完成装配（ProgressionSystem + LevelUpPanel 横排三按钮）并确认预览验收：面板弹出/全场冻结/状态标签正确、选择后恢复、三种升级效果可观察、防连点有效、无红色报错（过程一次按钮文字排版拥挤，用户调整按钮尺寸与 Label Overflow 后通过）。实现：`combat/PlayerCombatStats.ts`（纯 TS 玩家战斗运行态：伤害加算、冷却连乘且 clamp 到 minCooldown、数量封顶；不改写武器配置）、`progression/UpgradeService.ts`（纯 TS 按 option ID 应用效果）、`progression/ProgressionSystem.ts`（编排：onLoad 建运行态避免组件顺序问题；订阅 experienceCollected 累加经验；选择服务时先 pauseForLevelUp 再发 levelUpRequested（面板出现前战局已暂停）；chooseOption 校验后锁定输入（首个合法选择唯一生效）→ resolveLevelUp（自动服务下一级并保持暂停）→ 应用效果 → 发 levelUpResolved → 无待处理才 resumeAfterLevelUp）、`ui/LevelUpPanel.ts`（订阅事件展示候选，标题/描述读冻结配置；点击只回传 option ID 给 ProgressionSystem，不碰武器字段；content 子节点切显隐保持组件订阅成对；点击后锁到下一个请求）、`CooldownTimer.setDuration` 支持升级后冷却动态生效、`AutoSwordWeapon` 改读 PlayerCombatStats（伤害/冷却/数量）。

实现摘要：`combat/PlayerCombatStats.ts`（纯 TS 运行态：伤害加算、冷却连乘 clamp 至 minCooldown、数量封顶 maxProjectileCount）、`progression/UpgradeService.ts`（按 option ID 应用效果、未知选项拒绝）、`progression/ProgressionSystem.ts`（onLoad 建运行态；经验事件累加；选择服务先 pauseForLevelUp 再发 levelUpRequested；chooseOption 锁定输入→resolve→应用效果→发 levelUpResolved→无待处理才恢复）、`ui/LevelUpPanel.ts`（事件驱动显示、仅回传 option ID、content 子节点显隐保持订阅成对、点击锁）、`CooldownTimer.setDuration`、`AutoSwordWeapon` 改读运行态数值。

工作：实现三选一 UI、战局暂停/恢复、选择防连点，并通过 UpgradeService 应用三个初始效果。

DoD：

- 面板出现前战局已暂停；按钮可用且首个合法选择唯一生效。
- UI 仅回传 option ID，不直接改武器字段。
- 连升时逐个刷新选择并保持暂停；全部完成后恢复。
- 三种升级效果在下一次攻击中可观察且受上下限保护。

## T13 — HUD、清理与闭环验收

依赖：T03–T12。

状态：已完成（2026-09-20）。纯逻辑测试累计 85/85 通过；Creator 3.8.8 严格类型检查通过（退出码 0）。用户完成 HUD 装配与桌面闭环验收：
- 闭环：完整游玩约 10 分钟，移动→刷怪→飞剑→击杀→经验→升级→三选一→恢复全链路无阻断、无红色报错；升满 5 级（DoD"至少两次升级"远超）。
- HUD：HP 20/20、Lv、mm:ss 计时（升级暂停冻结）、经验条均正确；用户调整了 XpBar 与状态标签的遮挡及 ProgressBar 留白（纯编辑器布局修正）。
- 性能记录（桌面预览）：active 怪物峰值约 2–3（自动飞剑击杀速度与生成持平，t=120s 时 totalSpawned=119 符合波次 1 配置节奏；远低于软上限 120）；经验物峰值 gems=69（低于预算 100）；守恒严格成立（collected 16 + onField 69 = dropped 85）；未开启精确 FPS 显示，全程游玩无卡顿报告——精确帧率与压力峰值留待 T14 微信端验证。
- 退出重进：预览重启后等级 1、计时 0、无残留实体、启动日志全新、无报错（第二局 dropped=85/collected=16 的低数值亦为状态归零证据）。
- 已知设计行为记录：经验曲线仅定义至 5 级，满级后不再升级/经验不累积（用户确认保持）；MVP 无玩家受击来源，HP 为静态展示（用户确认知悉）。实现：配置 `PlayerConfig.maxHp: 20`（正整数校验，已同步 CONFIG.md；MVP 无玩家伤害来源，HUD 展示并预留受击）、`ui/BattleHud.ts`（HP/Lv/经验进度条/mm:ss 战斗计时；数值仅在变化时写回，避免每帧字符串分配；经验与计时走战斗时间门，升级暂停时冻结）、`ProgressionSystem` 暴露 `progressRatio` 供 HUD。清理审计（代码走查）：BattleController（onDestroy dispose session/bus/clock）、PoolService（onDestroy releaseAll+未归还告警+disposeAll）、各系统 onEnable/onDisable 成对订阅（MonsterSpawner 无订阅、ExperienceDropService/ProgressionSystem/LevelUpPanel/BattleStateDebugView 均成对）、池对象 onRelease 全量清态——无新增泄漏点，"统一场景退出清理"由以上既有路径覆盖；退出重进归零依赖场景重载重建全部组件（预览重启即验证）。

工作：补齐生命/等级/经验/计时 HUD，统一场景退出清理，执行 M5 前的桌面闭环验收和性能记录。

DoD：

- 连续 10 分钟至少两次升级，完整闭环无阻断错误。
- 退出重进后状态归零、监听/计时/池借出无泄漏。
- Profiler 记录实体峰值与帧率；未完成的微信开发者工具/真机验证明确列出。

## T14 — 微信开发者工具与真机验收

依赖：T13。

状态：部分完成（2026-09-21）。模拟器验证已通过；真机验证未执行，保持待验。

- 平台缺陷修复：微信构建管线（Babel loose）把 `[...Set/Map]` 编译为 `[].concat(...)`，导致 TargetRegistry.forEachTarget 崩溃；全仓共 7 处同类隐患（含 BattleEventBus.emit、BattleSession 状态广播、InstancePool.releaseAll、PoolRegistry.allStats、ProgressionService 选择广播、MonsterSpawner 日志）全部改为 `Array.from()`，约束写入 CODE_STYLE.md；85/85 测试与严格类型检查保持通过。
- 开发者工具问题排查：构建产物完整（game.js/game.json/project.config.json）；期间遇到 `simulator launch failed` 与 web-adapter.js xmldom 加载崩溃（伴随 jsbridge not ready），属开发者工具（2.02.2608060）环境/基础库状态问题，用户调整后模拟器恢复正常。
- 模拟器验证（用户确认）：小游戏构建进入 BattleScene 正常运行，完整闭环可玩，无 DOM/Node.js API 依赖错误——DoD 第 1 条通过。
- 真机验证（未执行）：iPhone 真机无法运行预览版小游戏，未验。原因与出路：当前使用 Creator 默认测试 AppID，iOS 真机预览需要正式注册的小游戏 AppID（mp.weixin.qq.com 注册后填入构建面板），或改用安卓真机扫码。DoD 第 2–3 条（触摸取消/安全区/暂停恢复/10 分钟 30 FPS/设备记录）列为未验证项，T14 保持待真机关闭。

DoD 补验步骤（供后续执行）：注册小游戏 AppID → Creator 构建面板填入 → 重新构建 → 开发者工具上传/预览 → 真机扫码验证触控（摇杆滑出屏幕松开即停）、升级暂停恢复、连续 10 分钟帧率，记录设备型号与基础库版本。

工作：构建微信小游戏，处理仅平台相关的最小兼容问题，并按 M5 完成开发者工具和真机验证。

DoD：

- 构建成功进入 BattleScene，无 DOM/Node.js API 依赖错误。
- 触摸取消、安全区和暂停恢复在真机正确。
- 中档真机连续 10 分钟目标稳定 30 FPS；记录设备、基础库版本、峰值实体量和已知问题。
- `MILESTONES.md` 更新为可审计的实际结果，不把未测项标为完成。
