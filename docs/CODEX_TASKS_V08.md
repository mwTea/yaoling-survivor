# CODEX_TASKS_V08 — V0.8 完整产品化

> 本文件是 V0.8 阶段的唯一任务进度真相。任务编号 `V08-xx`，与 Phase 0（T00～T14）、V0.1（V01-xx）、V0.5（V05-xx）完全独立，不回填、不扩大已完成任务的边界。阶段范围以 `ROADMAP.md` 的 V0.8 行为准：章节关卡/难度/三星、任务、图鉴、商店、30 日奖励、礼包、成就、红点、奖励中心、基础活动框架；**明确不含**正式上线接入（微信登录/云存档/支付/广告/埋点正式接入）与倍速。规则沿用 `AGENTS.md`。

## 阶段设计决策（立项定案，任务不得悄悄偏离）

1. **存档 schema v2 一次成型**（V08-01）：关卡进度/任务/成就/累计登录/商店/图鉴/奖励中心/活动各域一次性定义，后续任务只填语义不改结构，避免连续迁移；v1→v2 迁移函数与测试同提交。
2. **时间语义**：V0.8 无服务器。新增 `platform/TimeService` 统一入口（本地时间实现 + 日切 key），任务周期/商店刷新/累计登录一律经它取"当天"，业务禁止各自读 `Date`；V1.0 换服务器时间实现，接口不变。此为对 LIVEOPS"服务器时间"的**已知妥协**，如实记录。
3. **难度简化**：难度档 = 配置化数值/奖励乘数 + 解锁条件（首星解锁）+ 独立星级记录；"改变机制"的行为差异不做，记录为后续内容迭代。
4. **怪物内容复用灰盒**：新怪/新 Boss 以配置区分（数值/波次组合/Boss 弹幕参数），灰盒视觉复用既有 prefab；"不以颜色假装新内容"按 CONTENT.md 记录为内容迭代项。
5. **灵玉随成就首次投放**（ECONOMY.md 灵玉来源=成就），商店稀缺商品消费灵玉，补全灵玉产消闭环；无支付、无广告。
6. **奖励中心最小版**：聚合"可领取"（任务/成就/累计登录/礼包）并提供集中领取；不建邮件/补发队列（无对应场景），如实记录简化。
7. **红点只挂"可领取/可执行"**（RETENTION.md 红点原则）：中央红点状态事件驱动刷新，禁止每帧扫描，页面打开不自动清除。
8. **数值瓶颈复核在 V08-02**：多关卡产出曲线 + 首通/星级一次性奖励扩充账号经验与灵石投放，缓解 V0.5 收口标记的"玩家等级 538 局"瓶颈；等级/星级门槛作为内容门。

## 使用规则

- 严格按依赖顺序推进；一次只领取一个任务。
- 新能力一律配置驱动：schema、初始值、校验、CONFIG.md 同提交更新。
- 留存系统进度一律由领域事件累计、幂等；禁止 UI 轮询游戏状态推断完成（RETENTION.md）。
- 时间一律经 `platform/TimeService`；业务零 `Date` 直读。
- 复用 V0.5 已验证机制（AccountStore/EconomyService 事务、领域模块叶子模式、persist 账号服务、面板底板/排版约定），不重写。
- 纯逻辑必须可 node 测试（零跨文件值导入、无参数属性）；组件提供 Creator 手工验证步骤。

## V08-01 — 存档 schema v2 与迁移 ✅（已完成）

依赖：无。

**状态（2026-10-04）**：实现完成，待验收。类型检查通过（Creator 自带 tsc 5.8.2，`tsc -p tsconfig.json --noEmit`）；自动测试 229/229 通过（`node --experimental-strip-types --test tests/*.test.mjs`，其中 accountSave 16 项含迁移/幂等/损坏恢复）。待 Creator 人工验收：旧 v1 档启动自动升级（不重置、不清档），控制台无红色报错。

实现说明：

- `AccountSave.ts` 升级为 schemaVersion 2（`ACCOUNT_SAVE_SCHEMA_VERSION = 2`），一次性新增容器：进度域 `stageRecords`（键 `buildStageRecordKey(stageId, difficultyId)` = `stageId|difficultyId`）/`unlockedChapterIds`/`stageSelection`；留存域 `taskBuckets`（main/daily/weekly 三桶，`TASK_MAIN_PERIOD_KEY='main'`）/`achievements`/`loginReward`（totalDays/lastCountedDayKey/claimedTier）/`shop`（refreshDayKey/purchaseCounts）/`codex`（seenIds/defeatedIds）/`offerClaims`（奖励中心条目=统一礼包领取记录；奖励中心为聚合视图不设独立领取真相，阶段决策 6）/`activities`（status 标记）。字段只定容器与最小字段，语义由 V08-03～V08-16 赋予。
- 迁移：`upgradeAccountSaveV1ToV2`（= 全量 normalize；v1 缺失域落默认值），`parseAccountSave` 对 v1/v2 均接受、未知版本仍拒绝；迁移幂等（v2 输入原样返回，反复加载不漂移）。`AccountStore.load()` 对 v1 档自动迁移且不算重置（`lastResetReason` 为 null），未显式 save 前存储保留 v1 原文（下次 save 自然写入 v2）。
- v2 往返/损坏备份/未知版本拒绝/审计环形截断等既有行为全部维持并有测试。

DoD：

- [x] v1 存档迁移到 v2 无损（原字段全保留、新域有默认值）有测试；v2 往返、损坏修复、未知版本拒绝维持。
- [x] 迁移幂等：v2 数据再次经过迁移函数不变。

## V08-02 — 章节关卡配置体系与数值扩充 ✅（已完成）

依赖：V08-01。

**状态（2026-10-04）**：实现完成，待验收。类型检查通过；自动测试 235/235（新增 7 项配置校验测试：内容表规模/星级条件/难度档/章节环与双向归属/里程碑/Boss 引用/怪物展示名）。待 Creator 人工验收：启动无报错、默认关卡（stage_mvp_01）行为与 V0.5 完全一致（回归）。

实现说明：

- **任务文本与 DoD 冲突记录**：工作项写"3 章节 × 3 关卡"，DoD 要求"CONFIG.md 记录 12 关产出表"——按 DoD 落地为 **3 章节 × 4 关 = 12 关**（首关复用已验证的 stage_mvp_01，保留其 ID 与全部既有数值）。
- schema（`ConfigTypes.ts`）：新增 `ChapterConfig`（有序关卡引用/展示名/`requiredChapterId` 解锁链）、`StarCondition`（clear/hpRatioAbove/timeUnder/hitTakenAtMost，长度恒 3 首位恒 clear）、`StageDifficultyConfig`（数值+奖励乘数/首星解锁链）、`StageMilestoneRewardsConfig`（首通 + perStar[3]）；`StageConfig` 扩展 displayName/chapterId/bossId/starConditions/difficulties/milestoneRewards；`MonsterConfig` 补 displayName（图鉴详情来源）；`GameConfig` 增加 `chapters` 表。
- 设计决策：`StageRewardConfig` 保持按关卡唯一（基础值=普通难度全额），"按难度档扩展"经难度 `rewardMultiplier` 实现（同一公式单一所有者；发放=逐项×乘数后向下取整，V08-03 装配接入）；首通/星级奖励按难度档各自领取一次（与 V08-01 存档 stageRecords 字段对齐）。
- 内容：3 新怪（妖奴/毒蛛/石人，复用 `prefab_monster_basic`）、2 新 Boss（腐潮树妖/噬妖之主，复用 Boss 灰盒 prefab 与 `BossAgent` 通用查找）、每关 2 波次、22 条新波次配置；普通难度产出表与里程碑数值见 CONFIG.md"V0.8 章节关卡与产出"。
- 数值复核结论（CONFIG.md 已记录）：玩家等级满级 538 局 → 约 40 局；灵石不再瓶颈；修为差约 8～10 局刷取；灵魄为长线目标。难度/波次密度的真机风险移交 V08-17。
- 校验（`ConfigValidation.ts`）：章节引用/章内重复/解锁链成环/双向归属、星级条件集、难度乘数与解锁链、里程碑、bossId、怪物 displayName；`BossAgent` 构造的怪物快照补 displayName（唯一战斗代码改动，类型对齐不改行为）。

DoD：

- [x] 配置校验快速失败（引用断裂/星级条件非法/难度乘数非法/章节解锁环）。
- [x] 新内容全部经 `assertValidGameConfig` 通过；CONFIG.md 记录 12 关产出表与瓶颈复核结论。
- [x] 怪物/Boss 新配置复用既有运行时（新怪走既有波次/池化链路、新 Boss 走 BossAgent 通用 ID 查找；"实际运行新关"的选关入口为 V08-03 装配边界，当前运行时仍按 initialStageId 跑默认关）。

## V08-03 — 关卡进度服务与战斗按关卡装配 ✅（已完成）

依赖：V08-02。

**状态（2026-10-04）**：实现完成，待验收。类型检查通过；自动测试 247/247（新增 stageProgress 9 项 + 结算乘数/难度乘数用例）。待 Creator 人工验收：从首页进入战斗按默认第一关（stage_mvp_01 普通难度）运行且行为与 V0.5 一致；结算日志显示 `@ stage_mvp_01/diff_normal`；存档 stageRecords 出现通关记录。

实现说明：

- **`account/StageProgress.ts` 纯 TS**（叶子模块，零值导入）：解锁链判定（章节链 `requiredChapterId` 全通关 → 章内前一关通关 → 难度档 `requiredStarsOnPrevious` 历史最高星门槛）、`recordStageOutcome` 星级/通关只进不退、首通/星级累计领取标志（`markFirstClearClaimed`/`claimStarTier`/`getClaimableStarTiers`，领取事务 V08-05 接）、`syncUnlockedChapters` 增量同步章节解锁、选中关卡解析（未选择默认第一章第一关 × 首个难度档；未知引用快速失败）。记录键内联实现 `stageId|difficultyId`（与 `AccountSave.buildStageRecordKey` 同格式，测试交叉验证）。
- **`battle/ActiveStage.ts` 当局关卡运行态**：静态快照（stage + difficulty），由 `AccountBattleLink.onLoad` 按账号存档选中状态装配（onLoad 先于一切 start）；未配置（直接预览 BattleScene）时回退 `initialStageId` + 首个难度档，保持旧直预览行为；`onDisable` 时 reset 防跨局残留。
- **战斗装配切换**：MonsterSpawner（波次/软硬上限/Boss 池/召唤位置改读 `ActiveStage.current`；Boss 关联 `stage.bossId`，null = 无 Boss 关不装配 Boss 池）、StageResultService（时长/胜利 Boss）、CameraController（改为 start 一次性缓存边界——顺带修复了原先每帧 `find` 的热路径违规）、PlayerMover（边界解析从 onLoad 移至 start）、SwordQiEmitter/AutoSwordWeapon/BeastCompanionSystem（playArea 取 ActiveStage）。
- **难度数值乘数**：`EliteStats.buildMonsterEffectiveStats` 增加可选难度乘数参数（经 `MonsterRuntimeContext.difficultyMultipliers` 注入，精英×难度叠加取整；无难度参数时行为与旧版逐位一致）；`BossAgent` 的 Boss 数值快照与弹幕伤害按难度乘数取整（Boss 不走精英乘数规则不变）。
- **结算**：`computeStageRewards` 增加难度 `rewardMultiplier`（发放 = floor(基础值 × 乘数 × 保留比例)，合并一次取整；缺省 1 与 V0.5 一致）；`AccountSystem.handleSettlement` 按 ActiveStage 的当局关卡结算，并 `recordStageOutcome`（本任务 stars 恒 0，V08-04 接入真实星级）+ `syncUnlockedChapters` 后落盘；战斗全程不回写账号（结算点除外）不变。
- **选中状态持久化**：存档 `stageSelection` 域；`AccountSystem.getStageSelection/setStageSelection`（校验存在性+解锁链，拒绝未解锁选择）供 V08-05 选关页使用；不新增场景传参通道。

DoD：

- [x] 解锁链/星级只进不退/难度门槛有纯逻辑测试；非法 stageId 快速失败。
- [x] 战斗按选中关卡的波次/Boss/时长/场地运行；结算按该关奖励配置发放（比例规则不变，难度乘数折算）。
- [x] 未选择时默认第一关；战斗全程不回写账号。

Creator 装配验证注意：无需新增场景节点（ActiveStage 为纯静态装配）；V08-05 选关页落地前，玩家无选择入口，默认第一关即 V0.5 行为。

## V08-04 — 三星判定 ✅（已完成）

依赖：V08-03。

**状态（2026-10-04）**：实现完成，待验收。类型检查通过；自动测试 253/253（新增 starEvaluator 6 项：边界/失败恒 0 星/明细文案/缺失与未知条件）。待 Creator 人工验收：通关一局后结算面板显示星级与逐条达成明细（需结算面板装配 ≥5 个 statLabels 或留待 V08-05 选关页展示）；再次低分重打后选关数据不回退（存档 highestStars 保持）。

实现说明：

- **`battle/StarEvaluator.ts` 纯 TS**：按 `StageConfig.starConditions` 评估 0～3 星；失败（defeat）恒 0 星；边界语义 = 比例 `>=`、限时 `<=`、受击 `<=`（相等均达成）；产出逐条明细（star/kind/met/中文文案，比例显示按百分比四舍五入），供结算 UI 与后续选关页复用。
- **事件契约扩展**：新增 `playerHpChanged { hp, maxHp, cause: 'damage' | 'heal' }`（PlayerAgent 在受击结算、击杀回血、出战灵兽治疗三处发出）；`BattleResultStats` 扩展 `stars` 与 `starDetails`（StageResultRecorder.finish 增加可选参数）。
- **`StageResultService`**：订阅 `playerHpChanged` 累计受击次数并跟踪最后生命快照（未受伤视为满血，订阅 onEnable/onDisable 成对）；结算时用战局用时（升级暂停不计时，由战斗时间门保证）+ 生命比例 + 受击数评估星级，写入 battleFinished 统计。
- **结算写档**：`AccountBattleLink` 转发 stats；`AccountSystem.handleSettlement(result, stats)` 以 `stats.stars` 调 `recordStageOutcome`——历史最高星只进不退（低分重打不回退，StageProgress 已有测试）。
- **结算面板**：胜利时在统计行后追加星级行与逐条达成明细（复用既有 statLabels 数组，装配更多 Label 即逐行显示；完整星级 UI 随 V08-05 选关页）。

DoD：

- [x] 条件边界（比例取整/限时相等/受击计数）与"第一星恒为通关"有测试；失败恒 0 星。
- [x] 历史最高星不因低分重打回退有测试（stageProgress.recordStageOutcome）。
- [x] 结算明细逐条可展示（stats.starDetails 随 battleFinished 发布，结算面板已接入）。

## V08-05 — 关卡选择页 UI 与星级/首通奖励 ✅（已完成）

依赖：V08-04。

**状态（2026-10-04）**：实现完成，待验收。类型检查通过；自动测试 254/254（新增里程碑领取事务测试：按难度乘数缩放/重复领取拒绝/星级档推进/未知引用拒绝/审计入账）。**待 Creator 人工验收（装配步骤见下）**：选关 → 战斗 → 结算 → 回首页重开选关页星级更新；锁定关不可开战；首通/星级奖励领取与重复领取拒绝。

实现说明：

- **`ui/PanelKit.ts` 动态 UI 工具**：底板/文本/可点区域（Graphics+UITransform+TOUCH_END，不依赖 Button 组件与美术资源）代码化构建，规避多槽位装配与新建节点同位堆叠（V0.5 装配轮教训）。
- **`ui/StagePanel.ts` 关卡选择页**：章节切换（◀/▶）→ 每章 4 关列表（星级/通关态/锁定🔒）→ 选中关卡详情（难度选择按钮、奖励预览按难度乘数折算、首通/星级领取按钮、开战）。内容全部代码构建，场景装配仅 2 节点。选中经 `AccountSystem.setStageSelection`（解锁链校验 + 落盘）→ `director.loadScene('BattleScene')`；锁定时按钮禁用并显示条件。
- **里程碑领取事务（`account/StageProgress.ts` 扩展）**：`claimFirstClearMilestone`/`claimStarTierMilestone`——校验通关/可领档位/未领取 → 资源单事务（审计 kind=`milestone_reward`）→ 账号经验（`addAccountXp`）→ 标志位最后写入（失败路径零修改）；金额 = `milestoneRewards` 基础值 × 难度 `rewardMultiplier` 逐项向下取整（与 CONFIG.md 口径一致）。红点源预留：`isFirstClearClaimed`/`getClaimableStarTiers`/`isStageCleared` 即 V08-16 红点查询接口。
- **HomeHud**：新增可选槽 `stageButton`/`stagePanel`（未装配不报错）；面板操作后经 `onOperationDone` 刷新资源栏。

**Creator 装配步骤（HomeScene）**：

1. Canvas 下新建空节点 `StagePanel`（位置 0,0），添加 `StagePanel` 组件。
2. 在 `StagePanel` 下新建子节点 `content`（位置 0,0），把 `content` 拖入 StagePanel 组件的 content 槽（面板内容全部代码生成，无需再建子节点）。
3. Canvas 下新建按钮节点 `StageButton`（位置建议 y=-190，与修行/灵兽按钮同排）：加 Button 组件 + 子 Label 文字"选关"。
4. 把 `StageButton` 拖入 HomeHud 的 `stageButton` 槽，把 `StagePanel` 节点拖入 HomeHud 的 `stagePanel` 槽。
5. Cmd+S 保存场景后预览：点"选关"开面板（默认第一章第一关），点关卡行选中、点难度切换、点"开 战"进入战斗。

DoD：

- [x] 锁定关不可开战并显示条件（开战按钮禁用 + 详情行显示🔒与条件；结算明细展示随 V08-04 已接入）。
- [x] 首通/星级奖励只可领一次、重复领取拒绝；金额与 CONFIG.md 一致（基础值 × 难度乘数，逐项向下取整，有测试）。
- [ ] Creator 闭环：选关 → 战斗 → 结算 → 回选关页星级更新（待用户验收）。

## V08-06 — 一级导航骨架、我的页与功能开关 ✅（已完成）

依赖：V08-05。

**状态（2026-10-04）**：实现完成，待验收。类型检查通过；自动测试 258/258（新增 featureFlags 3 项 + 显式清档路径测试）。**待 Creator 人工验收（装配步骤见下）**：导航各入口往返无泄漏；我的页信息正确；清档两步确认后恢复新档（等级 1/资源 0/选关复位）且资源栏刷新；功能开关关闭的入口不显示。

实现说明：

- **`platform/FeatureFlags.ts`**（叶子模块，3 测试）：稳定 ID + 默认值 + 开关语义集中定义；未知 ID 恒为关闭（安全默认值）；V1.0 远程开关替换实现、接口不变。当前开启：`stage_select`、`profile`；关闭（入口隐藏）：`tasks`/`codex`/`shop`/`reward_center`/`login_reward`——对应任务实装时同提交翻转默认值。
- **`ui/MainNav.ts` 一级导航骨架**：首页底部横排动态入口（关卡/修行/灵兽/任务/图鉴/商店/奖励中心/我的），按 FeatureFlags 过滤 + 仅为已装配面板生成入口（开关关闭或面板缺失一律隐藏，不做假数据/建设中占位）。
- **`ui/ProfilePanel.ts` 我的页（最小版）**：账号概览（等级/境界/创建与最近保存时间戳）、存档 schema 版本、最近事务计数（含最新 kind）、清档重开（两步确认：首次点击进入待确认态，再次点击执行）。清档 = `AccountSystem.resetAccount()` → `AccountStore.resetToNewSave()`（新增公开重置路径，与"无档开新档"同路径，立即落盘全新 v2 存档；`lastResetReason` 保持 null 不算故障）。
- HomeHud 原有三个入口按钮保留（可选装配不冲突）；后续导航以 MainNav 为准。

**Creator 装配步骤（HomeScene）**：

1. Canvas 下新建空节点 `ProfilePanel`（位置 0,0）添加 `ProfilePanel` 组件；其下新建子节点 `content`（位置 0,0）拖入 content 槽（内容代码生成）。
2. Canvas 下新建空节点 `MainNav`（位置建议 y=-250，底部导航条），添加 `MainNav` 组件。
3. 把 `StagePanel`/`RealmPanel`/`BeastPanel`/`ProfilePanel` 节点分别拖入 MainNav 的四个面板槽。
4. Cmd+S 保存后预览：底部出现 关卡/修行/灵兽/我的 四个入口（任务/图鉴/商店/奖励中心因开关关闭不显示）；"我的"页可查看存档信息并两步确认清档。

DoD：

- [ ] 导航到各已实现页面往返无泄漏；未实现入口无假数据（待用户验收）。
- [ ] 清档走确认流程且恢复新档行为（待用户验收；代码路径有测试）。
- [x] 功能开关默认值安全，关闭时入口隐藏（isFeatureEnabled + MainNav 过滤，有测试）。

## V08-07 — 时间服务适配 ✅（已完成）

依赖：V08-06。

**状态（2026-10-04）**：实现完成，待验收。类型检查通过；自动测试 262/262（新增 timeService 4 项：固定时钟日切/周切边界、周一为周起点、dayKey/weekKey 协同）。待 Creator 人工验收：无独立运行时行为（无控制台报错即通过）；后续任务/商店/签到页面的日切表现随各自任务验收。

实现说明：

- **`platform/TimeService.ts`**（叶子模块）：`now()` / `dayKey()`（本地 yyyy-MM-dd）/ `weekKey()`（本地自然周 = 本周周一的 dayKey，周一为周起点，字典序可比）；注入式时钟（测试固定时钟）。**如实标注**：V0.8 本地时间实现为对 LIVEOPS"服务器时间"的已知妥协，V1.0 换服务器实现且接口不变；回拨不做特殊处理（单机灰盒无获利场景，限购/签到按 dayKey 天然幂等）。
- **收敛**：全仓 `Date` 直读仅剩两处——TimeService 自身（唯一实现点）与 `AccountStore` 构造默认值（叶子模块装配兜底，生产装配已传显式时钟 `() => time.now()`）。业务侧替换：AccountSystem（settlement txId/at + store 时钟）、RealmPanel（突破/法器事务）、BeastPanel（灵兽事务）、StagePanel（里程碑事务）均改经 `account.time.now()`。
- **装配**：`AccountSystem.time` 公开只读（persist 单例），后续任务/商店/签到领域的周期 key 由 UI/装配层经它计算后传参，领域模块不持有时间服务（保持纯逻辑可测）。

DoD：

- [x] 任务/商店/累计登录共用同一 dayKey/weekKey（TimeService 单源 + 测试固定时钟验证日切边界；各领域接入随 V08-08/12/14 验收）。
- [x] 业务代码零直接 `Date` 读取（走查确认：仅 TimeService 实现点 + AccountStore 装配默认值，均有注释说明）。

## V08-08 — 任务系统数据层 ✅（已完成）

依赖：V08-07。

**状态（2026-10-04）**：实现完成，待验收。类型检查通过；自动测试 269/269（新增 taskSystem 6 项：进度截断/前置链/周期重置/领取幂等与事务/spend 映射 + 任务配置校验 1 项）。待 Creator 人工验收：无独立 UI（随 V08-09 任务页验收）。

实现说明：

- **`TaskConfig` schema**（ConfigTypes/GameConfig）：类型（main/daily/weekly）、条件类型（killCount/clearCount/collectXp/levelUpCount/spendResource，全部可由既有领域事件驱动）、奖励（账号经验+资源）、前置任务 ID。初始表 13 项：主线引导链 7 + 每日 3 + 每周 3。
- **`account/TaskSystem.ts`**（叶子模块，6 测试）：`applyTaskProgress/applyTaskEvent/applyTaskSpend`（按条件类型+资源 ID 匹配任务、前置已领取才累计、按目标截断）；周期桶惰性重置（periodKey ≠ 当前 dayKey/weekKey 即整桶清空——主线桶恒 `main` 不重置）；`claimTaskReward` 领取事务（校验完成 → 资源单事务 kind=`task_reward` → 账号经验 → 领取记录最后写入，重复领取拒绝）；`isTaskClaimable`（V08-16 红点查询源）。
- **校验**（ConfigValidation）：任务 ID 唯一、条件结构与目标值、奖励资源引用、前置链引用存在且不成环。
- `TaskSystem` 内联 `MAIN_PERIOD_KEY='main'`（与 AccountSave.TASK_MAIN_PERIOD_KEY 同值，测试交叉验证——叶子模块零值导入约束）。

DoD：

- [x] 进度幂等（事件增量累计、目标截断、重复事件由上游单次发布保证）、周期重置（跨日/跨周清进度与领取态）、前置未完成不可接取均有测试。
- [x] 领取幂等（重复领取拒绝）、奖励经经济事务入账。
- [x] 初始任务表全部可由既有领域事件驱动完成（5 种条件类型均有对应事件源）。

## V08-09 — 任务事件接线与任务页 UI ✅（已完成）

依赖：V08-08。

**状态（2026-10-04）**：实现完成，待验收。类型检查通过；自动测试 271/271（新增 economy spend 钩子 1 项 + battleFinished 统计映射 1 项；FeatureFlags tasks 翻默认开启并更新测试）。**待 Creator 人工验收（装配步骤见下）**：打一局后任务进度可见增长；领取后资源入账、首页资源栏刷新；无红色报错。

实现说明：

- **接线设计（架构说明）**：战斗全程不回写账号（V05-10 契约），因此 `monsterDied/experienceCollected/levelUpResolved` 不做战斗中订阅，而是由 `battleFinished` 统计在**结算点一次性应用**——`TaskSystem.applyBattleStatsToTasks`（纯函数，有测试）：killCount→击杀、xpCollected→拾取经验、levelReached-1→升级次数、victory→通关；`AccountSystem.handleSettlement` 调用后随结算落盘。**经济消费接线**：`EconomyService` 新增可选 `onSpend` 观察钩子（spend 原子生效后回调正数消耗量），AccountSystem 装配时注入 → `applyTaskSpend`（只改写 taskBuckets，不经经济事务）。因无事件订阅，"订阅成对解除"不适用（无新增订阅）。
- **`ui/TaskPanel.ts` 任务页**（PanelKit 代码构建，装配 2 节点）：主线/每日/每周三组 13 行任务（名称+进度/目标+状态），可领取行绿色高亮"● 可领取"，点击行领取（`claimTaskReward` 事务 → 状态行反馈 + persistSave + 刷新 + onOperationDone 资源栏联动）；已领取行暗色 ✓；未完成行灰底显示描述文案；周期 key 经 `account.time` 计算（跨日/跨周刷新由周期桶惰性重置保证）。
- **MainNav** 接入"任务"入口（槽 `taskPanel`）；`FeatureFlags.tasks` 默认值翻转为开启（V08-09 实装）。

**Creator 装配步骤（HomeScene）**：

1. Canvas 下新建空节点 `TaskPanel`（位置 0,0）添加 `TaskPanel` 组件；其下新建子节点 `content`（位置 0,0）拖入 content 槽（内容代码生成）。
2. 把 `TaskPanel` 节点拖入 MainNav 的 `taskPanel` 槽。
3. Cmd+S 保存后预览：底部导航出现"任务"入口；打一局（任意结果）回首页打开任务页，对应任务进度增长；领取后状态行反馈、资源栏（HomeHud）数字刷新。

DoD：

- [ ] 打一局后对应任务进度可见增长；跨日重置后每日任务刷新（改 dayKey 验证——跨日可用系统日期或等次日；周期重置逻辑有固定时钟测试）（待用户验收）。
- [ ] 领取后资源入账、首页资源栏刷新（onOperationDone 约定）（待用户验收）。
- [ ] 无红色报错（待用户验收）；订阅成对解除（本次接线无新增订阅——结算点应用 + 经济钩子，见实现说明）。

## V08-10 — 成就系统 ✅（已完成）

依赖：V08-08。

**状态（2026-10-04）**：实现完成，待验收。类型检查通过；自动测试 276/276（新增 achievementSystem 4 项：进度封顶与不回退/分级领取与重复拒绝/隐藏成就可见性/未知与耗尽拒绝 + 成就配置校验 1 项；FeatureFlags 增 `achievements` 开关默认开启）。**待 Creator 人工验收（装配步骤见下）**：成就页显示当前阶段与可领取高亮；灵玉入账可见（首页资源栏如未展示灵玉，可在成就领取状态行确认）；隐藏成就未解锁前不可见。

实现说明：

- **`AchievementConfig` schema**：条件（与任务同 5 种语义、无周期无前置）+ 分级档位（升序目标+奖励）+ hidden 标记。初始表四类 6 项 13 档（战斗 2/收集 1/成长 2/挑战 1 隐藏）。
- **`account/AchievementSystem.ts`**（叶子模块）：永久累计进度（封顶最终档、只进不退）、分级当前阶段视图（`getAchievementView`/`listAchievementViews`——隐藏未解锁不出现，红点/列表同源）、`claimAchievementTier` 领取事务（可见+达标+未领完 → 资源单事务 kind=`achievement_reward` → 账号经验 → claimedTier 最后写入）。
- **灵玉首次投放**：新增资源 `res_lingyu`（上限 9999）；唯一产出 = 成就阶段奖励；消费 = 商店稀缺商品（V08-12）。CONFIG.md 已补产出口径。
- **接线复用**：成就进度与任务共用同一事件源——结算点（killCount/collectXp/levelUpCount/clearCount）+ EconomyService onSpend 钩子（spendResource），`AccountSystem.handleSettlement`/钩子内一并应用。
- **`ui/AchievementPanel.ts`**（PanelKit 代码构建，装配 2 节点）：只显示当前阶段（第 N/M 阶 + 进度/目标），可领取行绿色高亮，点击领取；全部领完暗色 ✓；隐藏成就整行隐藏。MainNav 加"成就"入口（槽 `achievementPanel`，flag `achievements`）。

**Creator 装配步骤（HomeScene）**：

1. Canvas 下新建空节点 `AchievementPanel`（位置 0,0）添加 `AchievementPanel` 组件；其下新建子节点 `content`（位置 0,0）拖入 content 槽。
2. 把 `AchievementPanel` 节点拖入 MainNav 的 `achievementPanel` 槽。
3. Cmd+S 保存后预览：底部导航出现"成就"入口；打几局后打开成就页，可见进度增长、达标后绿色可领取，点击领取。

DoD：

- [x] 分级成就只显示当前阶段、历史进度保留、完成后不因配置回退有测试。
- [x] 灵玉经事务入账并可被商店消费（V08-12 商店接入灵玉价格；本任务先入库存，有测试）。
- [x] 隐藏成就未解锁前不在列表与红点出现（listAchievementViews 过滤，有测试）。

## V08-11 — 图鉴页 UI ✅（已完成）

依赖：V08-03（关卡/怪物内容）、V08-10（灵玉/收集奖励口径）。

**状态（2026-10-04）**：实现完成，待验收。类型检查通过；自动测试 278/278（新增 codexSystem 1 项：击杀记录增量幂等 + recorder 击杀分布 1 项；FeatureFlags codex 翻默认开启）。**待 Creator 人工验收（装配步骤见下）**：击败怪物/Boss 后图鉴条目从未见面具转详情；未遇条目不泄露数值；章节随通关点亮。

实现说明：

- **击杀分布入账**：`BattleResultStats` 扩展 `killCounts`（按配置 ID 的击杀分布，含 Boss，`StageResultRecorder.onMonsterDied(monsterId)` 累计）；结算点 `recordCodexKills` 写入存档图鉴域（seenIds/defeatedIds，增量幂等）。战斗中不回写账号（与 V08-09 同架构，无新增事件订阅）。
- **三态语义（如实记录）**：V0.8 解锁来源唯一为击杀事件，"已见剪影"态当前不会出现（seenIds 与 defeatedIds 一致）；三态 UI 保留（未见面具 `？？？` / 已遭遇 / 已解锁详情），未来加入出场类事件源时仅写 seenIds。
- **`ui/CodexPanel.ts`**（PanelKit 代码构建，装配 2 节点）：五页签（法器/灵兽/怪物/Boss/章节）+ 固定 5 行条目池。怪物/Boss 未击败显示 `？？？` 不泄露任何数值，击败后显示配置数值（HP/速度/接触伤害/经验/召唤时间/弹幕数）；法器显示培养等级与攻击加成（存档派生）；灵兽显示解锁态与技能说明；章节按关卡通关派生点亮（X/N 通关）。详情全部来自配置，无假数据。
- MainNav 加"图鉴"入口（槽 `codexPanel`，flag `codex` 翻默认开启）。

**Creator 装配步骤（HomeScene）**：

1. Canvas 下新建空节点 `CodexPanel`（位置 0,0）添加 `CodexPanel` 组件；其下新建子节点 `content`（位置 0,0）拖入 content 槽。
2. 把 `CodexPanel` 节点拖入 MainNav 的 `codexPanel` 槽。
3. Cmd+S 保存后预览：底部导航出现"图鉴"入口；怪物/Boss 页签未遇条目为 ？？？；击败后重开图鉴显示完整数值；章节页签随通关点亮。

DoD：

- [ ] 未遇怪物显示剪影不泄露详情；击败后转"已解锁"有测试与 Creator 验证（测试已过，Creator 待验收）。
- [x] 详情数值全部来自配置，无假数据（页内不出现任何配置外数值）。

## V08-12 — 商店数据层 ✅（已完成）

依赖：V08-10（灵玉投放）。

**状态（2026-10-04）**：实现完成，待验收。类型检查通过；自动测试 281/281（新增 shopSystem 3 项：购买事务与审计/拒绝路径与零修改/跨日重置与永久限购）。待 Creator 人工验收：无独立 UI（随 V08-13 商店页验收）。

实现说明：

- **`ShopConfig` schema**（ConfigTypes/GameConfig）：`ShopItemConfig`（内容=单资源 goods、单币种 priceType（灵石/灵玉）、price、purchaseLimit、dailyRefresh）+ `ShopGroupConfig`（有序商品引用）。初始表 8 商品 2 组：常用补给（每日刷新，灵石定价，含四兽灵魄）+ 稀缺珍品（永久限购，灵玉定价——消费 V08-10 成就投放的灵玉，闭环成立）。
- **`account/ShopSystem.ts`**（叶子模块，3 测试）：`purchaseShopItem` 购买事务（未知商品/限购/余额校验 → 扣价 kind=`shop_purchase` → 发货 kind=`shop_goods`（上限钳制由 lostToCap 体现）→ 计数最后写入，失败路径零修改）；`refreshShopForDay` 按 dayKey 惰性重置（只清 dailyRefresh 商品计数，永久限购跨日保留）；`getRemainingPurchases` 供 UI/红点查询。
- **校验**（ConfigValidation）：商品 ID 唯一、goods/priceType 资源引用、数值正整数、dailyRefresh 布尔、组引用与去重。CONFIG.md 已同步 ShopConfig 节。

DoD：

- [x] 余额不足/超限购/未知商品拒绝；每日重置后限购恢复（跨 dayKey）有测试。
- [x] 购买记录入审计日志（kind=shop_purchase，有测试断言）。

## V08-13 — 商店页 UI ✅（已完成）

依赖：V08-12。

**状态（2026-10-04）**：实现完成，待验收。类型检查通过；自动测试 281/281（FeatureFlags shop 翻默认开启）。**待 Creator 人工验收（装配步骤见下）**：购买成功货物入账、限购次数扣减显示正确；余额不足行禁用并显示原因；跨日重置可见（改系统日期或次日）。

实现说明：

- **`ui/ShopPanel.ts`**（PanelKit 代码构建，装配 2 节点）：顶栏余额展示（灵石/灵玉）+ 按商品组分组的商品行（内容/价格/余 N/限购 + 刷新说明）。可购买行绿色高亮，点击购买（`purchaseShopItem` 事务 → 状态行反馈 + persistSave + 刷新 + onOperationDone 首页资源栏联动）；已售罄行 🔒 禁用；余额不足行禁用并显示原因。每日刷新组标题注明"每日刷新"、稀缺组"永久限购"。
- MainNav 加"商店"入口（槽 `shopPanel`，flag `shop` 翻默认开启）。

**Creator 装配步骤（HomeScene）**：

1. Canvas 下新建空节点 `ShopPanel`（位置 0,0）添加 `ShopPanel` 组件；其下新建子节点 `content`（位置 0,0）拖入 content 槽。
2. 把 `ShopPanel` 节点拖入 MainNav 的 `shopPanel` 槽。
3. Cmd+S 保存后预览：底部导航出现"商店"入口；购买补气丹后灵石减少/修为增加、余次数扣减；重复买满 3 次后行变"已售罄"；灵玉不足时稀缺珍品行显示"余额不足"。

DoD：

- [ ] 购买成功货物入账、限购次数扣减显示正确；跨日重置可见（待用户验收；数据层有测试）。
- [x] 余额不足按钮禁用并显示原因（render 分支 + 状态行；数据层拒绝路径有测试）。

## V08-14 — 30 日累计登录 ✅（已完成）

依赖：V08-07。

**状态（2026-10-04）**：实现完成，待验收。类型检查通过；自动测试 285/285（新增 loginReward 3 项：同日幂等与漏登续推/逐档领取与幂等/第 30 档完结不循环（固定时钟）+ 登录奖励校验 1 项；FeatureFlags login_reward 翻默认开启）。**待 Creator 人工验收（装配步骤见下）**：首次启动累计 +1；同日重进不重复推进；领取后资源入账、资源栏刷新。

实现说明：

- **`LoginRewardConfig` schema**（ConfigTypes/GameConfig）：`totalDays=30` + 30 档奖励表（day 1..30 升序，奖励=灵石 60→350 + 修为 22→80，里程碑日 5/10/15/20/25/30 加妖丹与对应灵魄；灵玉不在登录奖励投放——唯一产出=成就，口径不变）。校验：tiers 长度=totalDays、day 连续递增、奖励引用合法。
- **`account/LoginReward.ts`**（叶子模块，3 测试）：`advanceLoginDay`（会话启动推进，lastCountedDayKey 幂等——每自然日最多 +1、不要求连续、不补签、漏登不清零）；`claimLoginReward` 领取事务（本轮完结/天数未达拒绝 → 资源单事务 kind=`login_reward` → 账号经验 → claimedTier 最后写入；第 30 档领完 `completed=true` 本轮结束，首发一次性不循环——第 31 天继续累计天数但无可领）。
- **会话启动接线**：`AccountSystem.onLoad` 载入存档后 `advanceLoginDay(this.time.dayKey())`，推进才落盘。
- **`ui/LoginRewardPanel.ts`**（PanelKit 代码构建，装配 2 节点）：累计天数/已领档数/本轮完结态头部 + 近 7 档预览窗（已领 ✓ / 可领取高亮 / 🔒 未达成）+ 逐档领取按钮 + 状态行反馈。MainNav 加"签到"入口（槽 `loginRewardPanel`，flag `login_reward`）。

**Creator 装配步骤（HomeScene）**：

1. Canvas 下新建空节点 `LoginRewardPanel`（位置 0,0）添加 `LoginRewardPanel` 组件；其下新建子节点 `content`（位置 0,0）拖入 content 槽。
2. 把 `LoginRewardPanel` 节点拖入 MainNav 的 `loginRewardPanel` 槽。
3. Cmd+S 保存后预览：底部导航出现"签到"入口；首次打开显示"累计登录 1 天"、第 1 天档可领取；领取后资源入账；同日重进游戏不重复推进（看控制台 `login day advanced` 日志只出现一次）。

DoD：

- [x] 同日多次登录只推进一次；漏登后次日继续推进；第 30 档领完即完结有测试（固定时钟）。
- [x] 领取幂等；奖励经经济事务入账。

## V08-15 — 统一礼包模型、免费礼包与奖励中心 ✅（已完成）

依赖：V08-10（成就/任务领取态）、V08-14（登录领取态）。

**状态（2026-10-04）**：实现完成，待验收。类型检查通过；自动测试 289/289（新增 offerSystem 4 项：条件解锁/章节全通判定/领取幂等与拒绝/一键领取续跑 + 礼包配置校验；FeatureFlags reward_center 翻默认开启）。**待 Creator 人工验收（装配步骤见下）**：条件未达礼包不可见；领取后资源入账、资源栏刷新；一键领取逐项生效。

实现说明：

- **`OfferConfig` schema**（ECONOMY §5 免费子集）：priceType 恒 'free'、price 恒 0、purchaseLimit 恒 1（字段保留对齐统一模型，付费/广告 V0.8 不做）；解锁条件 playerLevel/chapterClear/realmIndex；前置 offerId 链。初始表 9 礼包三线：成长（Lv5/10/15/20 链）、章节（青云/妖潮/噬妖链）、境界（筑基/金丹链）。
- **`account/OfferSystem.ts`**（叶子模块）：`getOfferUnlockStatus`/`isOfferClaimable`（前置链 + 条件判定；chapterClear = 章节全部关卡通关任意难度，内联 stageRecords 扫描与 StageProgress 同键格式同语义、测试交叉验证）；`claimOffer` 领取事务（资源单事务 kind=`offer_reward` → 账号经验 → claimCount 最后写入）。
- **奖励中心最小版**：聚合 = 直接查询四源领域模块（`isTaskClaimable`/`listAchievementViews`/`getClaimableTierIndex`/`isOfferClaimable`），列表与各系统领取态天然一致；**不建邮件/补发队列**（阶段决策 6，如实记录）。`account/RewardCenter.claimAllSequential` 纯函数编排一键领取（逐项调用注入的领取事务闭包，单项失败不阻断其余、逐项报告成败，有测试）。
- **`ui/RewardCenterPanel.ts`**（PanelKit 代码构建，装配 2 节点）：可领取聚合列表（任务·/成就·/累计登录·/礼包· 前缀）、逐项点击领取、一键领取按钮、状态行报告成败计数；超 16 项提示用一键领取。MainNav 加"奖励中心"入口（槽 `rewardCenterPanel`，flag `reward_center`）。

**Creator 装配步骤（HomeScene）**：

1. Canvas 下新建空节点 `RewardCenterPanel`（位置 0,0）添加 `RewardCenterPanel` 组件；其下新建子节点 `content`（位置 0,0）拖入 content 槽。
2. 把 `RewardCenterPanel` 节点拖入 MainNav 的 `rewardCenterPanel` 槽。
3. Cmd+S 保存后预览：底部导航出现"奖励中心"入口；完成任务/成就/签到达标的奖励出现在列表；点单项领取或一键领取，状态行报告成败，资源栏刷新。

DoD：

- [x] 条件未达不可领、重复领取拒绝、前置礼包未领不可领后继有测试。
- [x] 奖励中心列表与各系统领取态一致（同源查询）；一键领取逐项走事务（单项失败不阻断其余，有测试）。

## V08-16 — 红点系统与基础活动框架 ✅（已完成）

依赖：V08-15。

**状态（2026-10-04）**：实现完成，待验收。类型检查通过；自动测试 294/294（新增 activityRedDot 5 项：活动窗口边界与开关门控/实例同步与关闭未领取记录/红点重算与通知/失败源兜底）。**待 Creator 人工验收（装配步骤随本轮合并清单）**：可领取时导航入口出现红点角标，领取后红点熄灭；资源栏随领取联动刷新。

实现说明：

- **`ui/RedDotService.ts` 中央红点服务**：数据源 = 各系统"可领取/可执行"查询（MainNav 注册 tasks/achievements/login_reward/reward_center 四源；奖励中心 = 四源 OR 独立聚合，**页面聚合不递归**）；`refresh()` 全量重算并通知订阅者——调用点为面板开/关、领取操作（onOperationDone 包装）、场景返回（onEnable），**无每帧扫描**（走查确认：无 update() 轮询）；打开页面不自动清除红点（熄灭只由领取事务驱动的查询翻转产生）；失败源按熄灭兜底不阻塞。
- **导航角标**：MainNav 为各入口挂红色圆点角标（动态 Graphics），订阅 RedDotService 通知显隐；HomeHud 订阅同一通知刷新资源栏（领取后余额同步）。
- **`ActivityConfig` 基础活动壳**（ConfigTypes/GameConfig）：ID/类型（V0.8 仅 login）/展示名/内容引用（contentRef → login_rewards）/功能开关 ID/参与窗口（dayKey 字典序，null=永久开放）。初始实例 `activity_login_01` 开服累计登录（window null）。
- **`account/ActivitySystem.ts`**（叶子模块）：窗口状态计算 + 入口可见性（窗口 × 功能开关，未知开关按关闭降级）+ 实例同步（open/not_started/ended；**活动关闭后未领取处理记录**：ended 且内容探针判定有未领取 → 记 `closed_unclaimed_handled` 一次性不回退）。**登录活动复用 LoginReward**：活动壳只做编排与门控，无第二套领取逻辑（签到入口可见性即活动门控）。AccountSystem.onLoad 会话启动同步实例并落盘。
- 校验：活动类型/contentRef/featureFlag snake_case、窗口 dayKey 格式与顺序。

DoD：

- [x] 红点状态与可领取查询一致；领取后红点清除；无每帧扫描（refresh 触发点走查 + 单元测试）。
- [x] 活动窗口外入口隐藏；功能开关关闭可降级（isActivityEntryVisible，有测试）。
- [x] 活动实例复用登录模型，无复制粘贴的第二套领取逻辑（活动壳仅编排，LoginReward 事务唯一）。

## V08-17 — V0.8 收口 ✅（已完成）

依赖：V08-05～V08-16。

**状态（2026-10-04）**：实现完成，待验收。全量自动检查通过（294/294 测试、Creator 自带 tsc 严格类型检查零错误）；CONFIG.md 已更新 V0.8 收口数值总览复核（产消表 + 留存闭环结论 + 遗留风险）。**未执行项（如实标注，待用户 Creator/微信验收）**：Creator 全链路人工验收（下方合并清单）、存档 v1→v2 迁移与损坏恢复的 Creator 验证、微信开发者工具回归、真机（沿用 T14 遗留跟踪）。

### 遮挡与排版修复（2026-10-05，验收反馈；全部代码侧，场景无需改动）

用户预览反馈三类遮挡，已修复（刷新预览即可生效）：

1. **导航条/首页元素压在面板上**：`PanelKit` 新增面板互斥与置顶——`show()` 时 `bringPanelToFront`（面板节点提到兄弟最上层，盖过 MainNav 与 HomeHud）+ `claimActivePanel`（自动关闭上一个面板）；"关闭"按钮走 `clearActivePanel`。全部 10 个面板（含 V0.5 RealmPanel/BeastPanel）统一接入 `hide()`。
2. **多行文本左侧越界裁切**（签到页"累计登…"被切、详情/概览类文本）：`PanelKit.createLabel` 带宽度时改为**左上角锚定**（x/y = 左上角，向下自适应高度），原先居中锚点会把整块文本框横跨屏幕。
3. **底板改为全不透明**（alpha 235 → 255）：面板打开后彻底盖住底层元素，消除 8% 透底重影。
4. **零星布局**：StagePanel"难度"标题对齐到难度按钮行（原 y 计算错误飘到详情区）；TaskPanel 分组标题左对齐；RewardCenterPanel 行高自适应可视高度、行数 16→12（其余项走一键领取，已有溢出提示）。

### Creator 合并装配清单（本轮全部 UI 任务一次性装配，HomeScene）

**新建节点（全部挂在 Canvas 下，位置 0,0）：**

| 节点 | 组件 | 子节点 |
|---|---|---|
| StagePanel | StagePanel | content（空节点） |
| TaskPanel | TaskPanel | content |
| AchievementPanel | AchievementPanel | content |
| CodexPanel | CodexPanel | content |
| ShopPanel | ShopPanel | content |
| LoginRewardPanel | LoginRewardPanel | content |
| RewardCenterPanel | RewardCenterPanel | content |
| ProfilePanel | ProfilePanel | content |
| MainNav | MainNav（无 content） | 无 |

面板内容全部由代码生成（PanelKit），各面板的 content 子节点拖入对应组件的 content 槽即可。

**槽位连线（MainNav，10 个面板槽）：** StagePanel / RealmPanel / BeastPanel / TaskPanel / AchievementPanel / CodexPanel / ShopPanel / LoginRewardPanel / RewardCenterPanel / ProfilePanel 节点分别拖入同名槽。（HomeHud 的 stageButton/stagePanel 可选槽为 V08-05 旧入口，可拖可不拖——MainNav 已提供"关卡"入口。）

**按钮（可选）：** HomeHud 原 修行/灵兽/开始战斗 按钮保留；如需"选关"独立按钮（V08-05 旧入口），新建 Button 节点拖入 HomeHud.stageButton。

**验收清单（按序执行）：**

1. ⬜ 打开 HomeScene 预览：底部导航出现 关卡/修行/灵兽/任务/成就/图鉴/商店/签到/奖励中心/我的（无红字报错；`[AccountSystem] loaded` 日志出现）。
2. ⬜ 签到：首次启动"累计登录 1 天"，第 1 档可领取，领取后资源入账；重进预览不重复推进。
3. ⬜ 选关 → 战斗：选关页选 stage_mvp_01 普通难度开战 → 结算面板显示星级与逐条达成明细、奖励行 → 回首页。
4. ⬜ 任务：打一局后任务进度增长；完成项绿色高亮，领取后 ✓ 且资源栏刷新。
5. ⬜ 成就：击杀/胜利类成就进度增长；灵玉首次入账（成就页状态行可见 +N）。
6. ⬜ 红点：有可领取任务/成就/签到时对应导航入口出现红点；全部领取后红点熄灭。
7. ⬜ 商店：买补气丹（灵石-80 修为+40、余次数扣减）；买满 3 次显示"已售罄"；灵玉不足时稀缺珍品显示"余额不足"。
8. ⬜ 奖励中心：聚合列表与各系统一致；一键领取逐项生效（状态行报告成败）。
9. ⬜ 我的：显示 schema 版本 v2；清档两步确认后恢复新档（Lv1/资源 0/导航红点按新档状态）。
10. ⬜ 存档迁移：把一个 V0.5 旧档（或临时把存档 schemaVersion 改 1）带入启动——自动迁移不重置（等级/资源保留），控制台无报错；损坏 JSON 启动 → 备份 + 新档（沿用 V0.5 验证路径）。
11. ⬜ 微信开发者工具构建回归：进入首页 → 选关 → 战斗 → 结算全链路无平台错误（真机沿用 T14 遗留跟踪）。

DoD：

- [x] 产消闭环 + 留存目标可玩、可观察、可复述（CONFIG.md V0.8 收口数值总览复核）。
- [x] 全量测试/类型检查通过（294/294 + tsc 零错误）。
- [ ] 无新增控制台错误（待用户按上方清单验收确认）。
- [x] 未执行的项（Creator 全链路/微信回归/真机）如实标注（本节 + MILESTONES）。

## 当前状态

- **已完成（2026-10-05 用户确认 Creator 验收通过）：V08-01 ～ V08-17 全部关闭。** 自动基线：294/294 测试、Creator 自带 tsc 严格类型检查零错误。
- 验收确认内容（用户截图/确认）：导航十入口与面板互斥/置顶、选关页（外门第一试 ★3/3 已通关）、三星与结算、任务进度与领取（主线/每日/每周）、签到领取（第 1 档）、红点角标亮灭；遮挡与排版问题（导航/首页元素压面板、多行文本左裁、难度标题错位、状态行贴边）已在验收轮修复并由用户确认"没问题"。
- 用户场景侧调整：MainNav 移至底部导航位（解除与青龙灵魄资源标签的 (0,0) 重叠）。
- 如实标注未单独验证项：微信开发者工具回归、真机验证（沿用 T14 遗留跟踪）；我的页清档、存档 v1→v2 迁移的 Creator 端到端操作未单独截图走查（纯逻辑层有测试覆盖，损坏恢复沿用 V0.5 已验证路径）。
- 已知边界（移交 V1.0）：时间语义为本地时间实现；难度仅数值/奖励乘数；怪物新内容复用灰盒视觉；图鉴"已见剪影"态预留；灵石通胀与长线灵石回收；奖励中心不建邮件队列；正式 UI/美术。
