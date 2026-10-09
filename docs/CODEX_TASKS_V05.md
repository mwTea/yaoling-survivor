# CODEX_TASKS_V05 — V0.5 局外成长

> 本文件是 V0.5 阶段的唯一任务进度真相。任务编号 `V05-xx`，与 Phase 0（T00～T14）、V0.1（V01-xx）完全独立，不回填、不扩大已完成任务的边界。阶段范围以 `ROADMAP.md` 的 V0.5 行为准：玩家等级、境界/小境界/修为/突破、法器培养、灵兽培养、基础资源产消闭环；**明确不含**商店/活动/礼包、任务/图鉴/章节产品化、正式商业化。规则沿用 `AGENTS.md`（每轮一个任务、状态协议、DoD 含测试/类型检查/Creator 验收/文档同步）。

## 使用规则

- 严格按依赖顺序推进；一次只领取一个任务。
- 新能力一律配置驱动：schema、初始值、校验、CONFIG.md 同提交更新；新增配置域见 CONFIG.md「后续配置域」表（局外成长最早版本 V0.5）。
- 四条成长线（玩家等级/境界/本命法器/灵兽）不得共用含糊的 `level` 字段；命名、存档、配置均显式区分（PROGRESSION.md）。
- 局外属性只能通过只读 `BattleLoadoutSnapshot` 注入战斗；战斗过程不得改写账号状态（PRODUCT.md / ARCHITECTURE.md）。
- 资源一律整数最小单位、余额不得为负、关键操作走"校验→扣除→变更→记录→保存"事务（ECONOMY.md）。
- 复用既有机制（配置校验入口、事件总线、结算 `battleFinished`、PlayerCombatStats），不重写。
- 纯逻辑必须可 node 测试（零跨文件值导入、无参数属性）；组件提供 Creator 手工验证步骤。

## V05-01 — 存档底座与账号状态骨架

依赖：无（ARCHITECTURE.md 预留的 `platform` 适配层与账号存档边界）。

状态：已完成（2026-10-01，用户确认关闭）。纯逻辑测试累计 **124/124** 通过（新增 11 项存档测试，`node --experimental-strip-types --test tests/*.test.mjs`）；Creator 3.8.8 内置 TypeScript 5.8.2 严格类型检查通过（`tsc -p tsconfig.json --noEmit`，退出码 0）。实现：`platform/StorageAdapter.ts`（适配接口 + MemoryStorageAdapter 测试实现）、`account/AccountSave.ts`（单文件叶子：schema v1 进度/养成/库存/审计五域；create/parse 修复/serialize；未知版本拒绝不静默降级；事务 deltas 允许负数与余额钳 0 分离修复；环形日志保留最近 20 条；`AccountStore` 会话内缓存、lastSavedAt 盖戳、损坏/未知版本档备份 `yaoling_account_save_corrupt_backup` 后开新档并暴露 `lastResetReason`）。无场景可见行为，Creator 装配（存储适配组件接入）并入 V05-10；新目录 `account/`、`platform/` 将在下次打开 Creator 时自动生成 `.meta` 并导入脚本。

## V05-02 — 经济库存与事务

依赖：V05-01。

状态：已完成（2026-10-01，用户确认关闭）。纯逻辑测试累计 **137/137** 通过（新增 13 项：经济事务 12 + 资源配置校验 1）；Creator 3.8.8 严格类型检查通过（`tsc -p tsconfig.json --noEmit`，退出码 0）。实现：`economy/Economy.ts`（单文件叶子：`EconomyState` 结构切片与 AccountSaveData 结构兼容；grant/spend 原子事务——第一遍只读校验失败零修改、第二遍整体提交；grant 超上限钳制并通过 `lostToCap` 明确报告丢失、手改超上限余额不回收只钳增量；spend 任一资源不足整体拒绝；审计环形日志容量由装配注入（与 `AccountSave.MAX_RECENT_TRANSACTIONS` 同源）、失败事务不入日志、日志快照与返回对象分离）；配置新增 `ResourceConfig`（schema/校验/8 条初始资源，灵玉不投放、灵魄按兽隔离，CONFIG.md 已同步）。过程中修复：纯空白 txId/kind 未被拒（改为 trim 非空校验，测试覆盖）。`EconomyService` 的运行时装配（接入账号服务与存档）并入 V05-09/V05-10。

工作：新增 `scripts/economy/Economy.ts`（单文件叶子：`Inventory` 纯 TS——resourceId→整数余额、余额不得为负、库存上限配置、溢出部分明确报告丢失；事务入口：grant/spend 前置校验→变更→追加事务记录（唯一 txId/kind/deltas/at，环形保留最近 20 条）→返回结果）；`ResourceConfig`（V0.5 资源：`res_lingshi` 灵石、`res_xiuwei` 修为、`res_yaodan` 妖丹、每灵兽灵魄 `res_lingpo_<beast>`）+ schema/校验 + CONFIG.md 同步。`res_lingyu` 灵玉无产出不投放，库存为通用 resourceId 结构，后续加入仅为数据项。

DoD：

- 非法扣减（负数/非整数/余额不足）、超上限、未知资源均有测试；余额永不出现负数。
- 事务记录可审计（txId/kind/deltas），环形截断有测试。
- 配置校验快速失败并指出资源 ID/字段。

## V05-03 — 玩家等级（账号级）

依赖：V05-02（账号经验不入库存，但状态提交走同一骨架）。

状态：已完成（2026-10-01，用户确认关闭）。纯逻辑测试累计 **147/147** 通过（新增 10 项：玩家等级 9 + 配置校验 1）；Creator 3.8.8 严格类型检查通过（退出码 0）。实现：`account/PlayerLeveling.ts`（纯 TS：`addAccountXp` 循环消化阈值支持一次跨多级、阈值恰好达标即升级、满级**溢出保留**继续累积、等级只进不退（存档等级高于曲线长度的配置缩短场景保持等级并按满级语义处理）、非法数额（非正整数/NaN）整体拒绝零修改；`getAccountLevelProgress` 供 UI 读取进度，满级返回 `requiredXp: null`）；配置新增 `PlayerLevelConfig`（曲线长度即满级，校验与局内 `levelCurve` 抽取共用 `validateLevelCurve`，CONFIG.md 已同步）；初始账号曲线 20 级（60→2650，与 V05-05 法器等级上限对齐）。过程中修正：测试对"曲线长度即满级"的语义预期错误（实现与局内曲线语义一致），已按正确语义修正测试。运行时接线（结算发放账号经验、HUD/修行面板展示）并入 V05-09/V05-11。

工作：新增 `scripts/account/PlayerLeveling.ts` 纯 TS（账号经验曲线配置、addAccountXp/升级/等级只进不退；满级策略二选一定案并记录：**溢出保留**，后续提上限不丢经验）；`PlayerLevelConfig` + 校验 + CONFIG.md。账号经验与局内战斗等级完全隔离（局内经验不进入账号）。

DoD：

- 边界经验、一次跨多级、满级溢出保留、等级不回退均有测试。
- 玩家等级仅作为培养上限/解锁门槛使用，本任务不接战斗属性。

## V05-04 — 境界、小境界、修为与突破

依赖：V05-03。

状态：已完成（2026-10-01，用户确认关闭）。纯逻辑测试累计 **167/167** 通过（新增 20 项：境界推进/自动推进/突破预览与确认 19 + 配置校验 1）；Creator 3.8.8 严格类型检查通过（退出码 0）。实现：`account/RealmProgress.ts`（纯 TS：`promoteSubRealm` 圆满后拒绝、经济事务原子扣耗修为零修改失败；`autoPromoteSubRealms` 批量自动推进、事务 ID `txIdBase#n` 派生、上界=剩余层数+1 以观察停止原因（sub_realm_maxed/economy_rejected/invalid_realm_state）；`previewBreakthrough` 两步制第一步——未圆满/末境返回 null 不伪装可突破，unmet 用稳定 key（xiuwei/material/playerLevel）由 UI 出文案；`confirmBreakthrough` 复核圆满/材料/玩家等级后修为+材料**单事务原子扣耗**、realmIndex+1 subRealmIndex 归零、重复确认由下一境条件自然拦截；`getTotalRealmMaxHpBonus` 累计增量供 V05-07 快照注入；economy 依赖经结构接口注入保持零跨文件值导入）；配置新增 `RealmConfig`/`RealmBreakthroughConfig`（练气/筑基/金丹三境 + 校验：非末境突破不得为 null/末境必须 null、材料引用存在，CONFIG.md 已同步）。过程中修正：自动推进循环上界由"剩余层数"改为"剩余层数+1"，使圆满/资源不足的停止原因可观察。运行时接线（结算后自动推进触发、修行面板预览/确认 UI）并入 V05-09/V05-11。

工作：新增 `scripts/account/RealmProgress.ts` 纯 TS：大境界有序列表（练气/筑基/金丹），小境界推进（当前小境界所需修为达标 → 事务消耗 `res_xiuwei` → 前进，自动推进并在 UI 可见）；大境界突破两步制（`previewBreakthrough` 返回条件与消耗快照 → `confirmBreakthrough` 校验修为/妖丹/玩家等级门槛 → 扣耗 → realmIndex+1，无失败机制）；境界收益：每个新大境界小幅 maxHp 加成（克制，配置化）。`RealmConfig` + 校验 + CONFIG.md。

DoD：

- 修为/妖丹/等级不足拒绝；预览与实际消耗一致；重复突破幂等；末个突破条件均拒绝大境界推进。
- 小境界消耗从库存 `res_xiuwei` 走事务（ECONOMY 语义），不设独立修为进度条字段。
- 境界与玩家等级互不替代，字段/展示分离。

## V05-05 — 法器培养（青霄剑）

依赖：V05-03、V05-04。

状态：已完成（2026-10-01，用户确认关闭）。纯逻辑测试累计 **179/179** 通过（新增 12 项：法器培养 11 + 配置校验 1）；Creator 3.8.8 严格类型检查通过（退出码 0）。实现：`account/WeaponGrowth.ts`（纯 TS：`getWeaponLevel` 缺省视为 1 级、`getWeaponLevelCap` = min(配置上限， 玩家等级)、`getWeaponDamageBonus` = damagePerLevel × (等级-1) 纯派生、`levelUpWeapon` 校验上限（`at_max_level`/`player_level_cap` 两种封顶分别返回原因供 UI 提示）→ 原子扣耗 `res_lingshi` → 等级 +1，经济失败零修改）；配置新增 `WeaponGrowthConfig`（weaponId 引用局内武器且唯一、levelUpCosts 长度 = maxLevel-1、ultimateIds 绝学预留字段当前为空数组不建效果，CONFIG.md 已同步）；初始青霄剑 maxLevel 20、灵石曲线 80→1583（约 ×1.18/级）、每级伤害 +2（20 级 10→48）。局内 `WeaponConfig` 数值未改动，培养增量只经 V05-07 快照注入。运行时接线（修行面板培养操作 UI）并入 V05-11，快照注入并入 V05-07。

工作：新增 `scripts/account/WeaponGrowth.ts` 纯 TS（法器等级、升级消耗灵石曲线、每级基础攻击参数增量、等级上限 = min(配置上限, 玩家等级)）；`WeaponGrowthConfig` + 校验 + CONFIG.md。绝学/流派仅保留稳定 ID 与字段预留，不实现（首发数量与效果按 PROGRESSION.md 留待内容表立项）。局内 `WeaponConfig` 数值不变，培养增量只进快照（V05-07）。

DoD：

- 消耗不足/满级/上限受玩家等级钳制均有测试；等级派生参数纯函数可测。
- 不改写局内武器配置对象；CONFIG.md 记录成长曲线与上限规则。

## V05-06 — 灵兽培养与出战

依赖：V05-03。

状态：已完成（2026-10-01，用户确认关闭）。纯逻辑测试累计 **198/198** 通过（新增 19 项：灵兽花名册 18 + 配置校验 1）；Creator 3.8.8 严格类型检查通过（退出码 0）。实现：`account/BeastRoster.ts`（纯 TS：`getBeastEntry` 缺省条目按配置推导默认态（unlockSoulCost=0 默认解锁、等级 1、星级 0）、`getBeastLevelCap` = min(曲线长度+1, 玩家等级)、`unlockBeast`/`levelUpBeast`/`starUpBeast` 原子事务（解锁/升星只耗自身灵魄 `soulResourceId`、升级耗 `res_lingshi`；`already_unlocked`/`not_unlocked`/`at_max_level`/`player_level_cap`/`at_max_star` 分原因拒绝、经济失败零修改、重复解锁幂等）、`deployBeast` 单出战槽直接切换（未解锁拒绝、重复出战幂等、返回前一出战）、`getDeployedBeast` 快照查询）；配置新增 `BeastConfig`/`BeastSkillEffect`（五兽：青龙默认解锁 + 白虎/朱雀/玄武/九尾狐需自身灵魄×10；技能 damageNearest/heal 两种结构；共用升级曲线 10 级、升星 5 星，CONFIG.md 已同步含数值表）。灵魄按兽隔离（升星测试验证只耗自身灵魄、他兽灵魄不动）。出战技能战斗接入在 V05-08，灵兽面板 UI 在 V05-12。

工作：新增 `scripts/account/BeastRoster.ts` 纯 TS（五灵兽青龙/白虎/朱雀/玄武/九尾狐状态：解锁/等级/星级/出战；升级耗灵石、星级耗对应灵魄、解锁耗灵魄；等级上限受玩家等级钳制、星级上限 5；默认单出战槽，未解锁不可出战，切换出战即时写档）；`BeastConfig` ×5（含出战触发技能效果配置）+ 校验 + CONFIG.md。V0.5 单关卡只投放青龙灵魄，其余灵兽解锁来源随 V0.8 关卡扩充（UI 明示"来源待开放"，不做假数据）。

DoD：

- 解锁/升级/升星/出战切换的合法路径与拒绝路径均有测试；重复操作幂等。
- 灵魄按兽隔离，无跨兽互换；出战槽唯一约束有测试。
- 技能效果仅定义配置结构，战斗接入在 V05-08。

## V05-07 — 出战快照与战斗注入

依赖：V05-04、V05-05、V05-06。

状态：已完成（2026-10-03 用户确认 Creator 装配与闭环跑通）。纯逻辑测试累计 **207/207** 通过（新增 9 项：快照装配与注入 9）；Creator 3.8.8 严格类型检查通过（退出码 0）。实现：`account/LoadoutBuilder.ts`（单文件叶子：`buildBattleLoadout` 从账号存档切片 + 培养配置表构建只读 `BattleLoadoutSnapshot` {weaponDamageBonus, maxHpBonus, deployedBeast}；法器伤害加成按等级跨成长表累计、境界 maxHp 累计（下标越界钳到末境不回收已拥有收益）、出战灵兽校验解锁态（默认解锁灵兽无条目可出战、锁定/未设置/未知 ID 均为 null）；`EMPTY_BATTLE_LOADOUT` 为无账号服务时的空快照，注入后行为与 V0.1 一致）；`PlayerCombatStats` 新增 `addMaxHpBonus`/`maxHpBonus`（一次性注入语义，非正忽略）；`ProgressionSystem.applyLoadout`（一次性注入入口：法器伤害进运行态 + maxHp 加成进运行态，重复调用只生效一次防叠加）+ `loadout` getter；`PlayerAgent` 生命运行态改为 `playerConfig.maxHp + loadout.maxHpBonus`，`maxHp` getter 同步。培养派生公式与 WeaponGrowth/RealmProgress 同源（均以 CONFIG.md 为唯一公式定义），快照内为独立实现以保持叶子可测（已在文件头注明）。

待用户确认（未执行项）：本任务的 Creator 可观察验收（培养前后伤害/HP 差异）依赖培养入口（V05-11）与账号装配（V05-10），并入 V05-10 后的统一 Creator 验收轮执行；当前以自动测试 + 类型检查为完成依据。快照的调用方（账号服务）在 V05-10 接线。

工作：新增 `scripts/account/LoadoutBuilder.ts` 纯 TS（AccountSave + 配置 → 只读 `BattleLoadoutSnapshot`：青霄剑培养派生攻击参数、境界 maxHp 加成、出战灵兽技能描述）；`BattleController` 开局从账号状态构建快照并一次性注入 `PlayerCombatStats`/`PlayerAgent`；战斗全程不得回写账号。战斗中升级仍只改当局运行态。

DoD：

- 快照构建纯函数测试（各养成线为 0 时与现状数值一致）。
- 注入后战斗数值可观察（Creator：培养前后伤害/HP 差异）。
- 战斗过程零账号写入；快照对象只读。

## V05-08 — 出战灵兽触发技能

依赖：V05-07。

状态：已完成（2026-10-03 用户确认 Creator 装配与闭环跑通）。纯逻辑测试累计 **213/213** 通过（新增 6 项：触发计划/节拍器 6）；Creator 3.8.8 严格类型检查通过（退出码 0）。实现：`combat/BeastCompanionTrigger.ts`（单文件叶子：`createBeastCompanionPlan` 把 BeastSkillEffect 展开为运行计划（数值只读透传、无默认值兜底）；`BeastCompanionTrigger` 受战斗时间门控的周期节拍器——只在模拟运行时推进、暂停冻结、首拍即触发、`markFired` 保留余量长帧不丢拍、due 状态保持供无目标重试）；`combat/BeastCompanionSystem.ts`（组件：从 `ProgressionSystem.loadout.deployedBeast` 取技能；damageNearest 复用 SwordQiEmitter 范式——NearestTargetQuery + 独立投射物池（key `projectile_beast_companion`，灰盒参数复用 `projectile_sword_qi` 配置）+ 小角度散射，无目标保持 due 下帧重试；heal 走 `PlayerAgent.applyCompanionHeal`（新增统一入口，复用 PlayerVitals.heal 双向夹紧、满血静默）；未出战灵兽时空闲并输出一条日志；暂停由 battleDeltaTime=0 + 触发器 running 门控双保险；数值全部来自 BeastConfig，战斗中不回写账号）。

待用户确认（未执行项）：Creator 装配（Systems 挂 **BeastCompanionSystem**，槽 battleController ← Systems、playerNode ← Player、swordPrefab ← SwordGray prefab）与技能生效观察并入 V05-10 后的统一 Creator 验收轮（当前无培养入口时出战快照为空快照，系统空闲输出一条日志属预期，行为与 V0.1 一致）。

工作：新增 `scripts/combat/BeastCompanionSystem.ts`（出战灵兽周期触发技能运行时：effect kind `damageNearest`（向最近目标发射投射物，复用既有投射物池与命中链路）/`heal`（回复玩家，复用 PlayerVitals.heal）；冷却走统一战斗时钟，暂停冻结，池化无热路径分配）；五灵兽技能数值全部来自 `BeastConfig`。

DoD：

- 触发节奏、无目标不触发、暂停冻结、数值来自配置均有测试。
- Creator 可观察出战灵兽技能生效（投射物/回血），换灵兽后行为随配置变化。

## V05-09 — 结算奖励发放（产消闭环数据面）

依赖：V05-02、V05-03、V05-07。

状态：已完成（2026-10-03 用户确认 Creator 装配与闭环跑通，结算奖励入账与面板明细已验证）。纯逻辑测试累计 **221/221** 通过（新增 8 项：结算奖励 7 + 配置校验 1）；Creator 3.8.8 严格类型检查通过（退出码 0）。实现：配置新增 `StageRewardConfig`（stage_mvp_01：胜利全额 账号经验 30 + 灵石 100 + 修为 30 + 妖丹 1 + 青龙灵魄 2；defeat/abort 保留 50% 逐项向下取整；校验：关卡/资源引用、非负整数、比例 [0,1]、stageId 唯一，CONFIG.md 已同步）；`account/SettlementRewards.ts`（单文件叶子：`computeStageRewards` 按结果选比例逐项向下取整产出纯值计划——**UI 展示与实际发放共用同一函数，数字天然一致**；`applyStageRewards` 资源单事务原子发放（kind=`stage_reward_<result>`，审计含来源）→ 账号经验（只进不退/溢出保留）→ 修为到账后自动推进小境界（V05-04 触发点接线，事务 ID `txId#promote#n` 派生）；依赖经 ops 注入保持叶子可测；失败即停并返回部分结果，不重试）；`platform/CocosStorageAdapter.ts`（sys.localStorage 适配，业务零平台 API）；`account/AccountSystem.ts`（组件：持有 AccountStore/EconomyService/工作存档，订阅 battleFinished 幂等消费结算并立即落盘，暴露 `AccountSystem.instance`/`accountSave`/`economy` 供 V05-10/11/12 装配，onDestroy 清理静态引用）；`BattleResultPanel` 新增**可选** `rewardLabel` 奖励明细行（未装配不报错不展示；与发放共用 computeStageRewards）。

待用户确认（未执行项）：Creator 装配（Systems 挂 **AccountSystem**，槽 battleController ← Systems；可选：BattleResultPanel 增加一个 Label 拖入 `rewardLabel` 槽）与结算发放/落盘观察并入 V05-10 统一 Creator 验收轮；存档持久验证（预览重启保留）也在该轮执行。幂等说明：battleFinished 单局仅发布一次（V01-02 StageResultService 保证），消费方每个事件发放一次；单局重复发放防护由上游事件幂等承担（有测试固化该契约）。

工作：新增 `StageRewardConfig`（按 stageId：victory 全额奖励 = 账号经验/灵石/修为/妖丹/青龙灵魄；defeat/abort 保留比例配置化）；`scripts/account/SettlementRewards.ts` 纯 TS 计算（比例向下取整、整数守恒、奖励明细列表）；`battleFinished` 一次性消费发放（幂等），经事务写入库存与账号经验并落盘；`BattleResultPanel` 增加奖励明细区（分源展示）。

DoD：

- 胜/败/中止三类发放、比例取整、幂等（单局只发一次）均有测试。
- 结算展示数字与库存/账号等级实际变化一致（Creator 验证）。
- 发放失败不得重复获利；事务记录含来源 kind。

## V05-10 — 主界面场景与导航闭环

依赖：V05-09。

状态：已完成（2026-10-03 用户确认装配与闭环跑通；收口过程中完成 Canvas 渲染顺序修正——World 移到最上、面板移到最后，怪物不再遮挡弹层）。纯逻辑测试累计 **221/221** 通过（无新增纯逻辑，本任务为装配接线）；Creator 3.8.8 严格类型检查通过（退出码 0）。实现：`AccountSystem` 改造为 persist 装配（`persistent` 属性 → `addPersistRootNode`；移除 battleController 订阅改由绑定组件转发 `handleSettlement`；**单例防护**——从战斗场景返回首页时场景内 AccountRoot 副本再次实例化会被销毁，存档状态始终归 persist 实例；新增 `persistSave` 供培养操作落盘）；`account/AccountBattleLink.ts`（战斗场景绑定组件：转发 battleFinished → 账号服务，订阅成对解除；直接预览 BattleScene 时提示"无账号服务"并保持 V0.1 行为）；`ProgressionSystem.onLoad` 拉取快照（`buildBattleLoadout(accountSave)` → `applyLoadout`，onLoad 先于一切 start，PlayerAgent 读取 maxHp 加成顺序确定；无账号服务注入空快照）；`ui/HomeHud.ts`（首页灰盒：修行者等级/境界层数（圆满判定）/灵石·修为·青龙灵魄资源栏/开始战斗，全部读账号服务与配置，UI 零规则）；`BattleResultPanel` 新增可选 `homeButton`（返回 HomeScene）并给奖励行加账号服务守卫（无账号不展示，不伪装未兑现的奖励）。

待用户在 Creator 3.8.8 内装配与验收（**统一验收轮，覆盖 V05-07～V05-12**；V05-11/12 面板已一并实现，装配一次完成）：

1. 打开工程等编译完成，确认无编译错误。
2. **创建 HomeScene**（assets/scenes 新建场景），完整结构：
   - 根层级空节点 `AccountRoot`：挂 **AccountSystem**，勾选 `persistent` ✓。
   - Canvas 下空节点 `HomeHud`：挂 **HomeHud**；其下建：
     - Label ×5：LevelLabel（"修行者 Lv.1"）、RealmLabel（"练气第1层"）、ResourceLingshi、ResourceXiuwei、ResourceQinglong；
     - Button ×3：StartButton（子 Label"开始战斗"）、RealmButton（"修行"）、BeastButton（"灵兽"）；
     - HomeHud 槽位 ×8：levelLabel ← LevelLabel、realmLabel ← RealmLabel、resourceLabels ← [灵石, 修为, 青龙灵魄]（顺序固定）、startButton ← StartButton、realmButton ← RealmButton、beastButton ← BeastButton、realmPanel ← RealmPanel 节点、beastPanel ← BeastPanel 节点。
   - Canvas 下空节点 `RealmPanel`（挂 **RealmPanel**，建议初始位置居中偏上半透明底）：其 content 子节点下建 Label ×5（PlayerLabel/RealmLabel/BreakthroughLabel 多行/WeaponLabel 多行/StatusLabel）与 Button ×3（BreakthroughButton"突破"/WeaponUpButton"升级法器"/CloseButton"关闭"），全部拖入对应槽位。
   - Canvas 下空节点 `BeastPanel`（挂 **BeastPanel**，同上）：content 下建 Label ×4（TitleLabel/StateLabel/SkillLabel/StatusLabel）与 Button ×7（PrevButton"上一只"/NextButton"下一只"/UnlockButton"解锁"/LevelUpButton"升级"/StarUpButton"升星"/DeployButton"出战"/CloseButton"关闭"），全部拖入对应槽位。
3. **BattleScene Systems** 新增组件：**AccountBattleLink**（battleController ← Systems）、**BeastCompanionSystem**（V05-08：battleController ← Systems、playerNode ← Player、swordPrefab ← SwordGray prefab）。
4. **BattleResultPanel**：content 下加一个 Label 拖入 `rewardLabel` 槽（V05-09）；再加"返回首页"按钮拖入 `homeButton` 槽（V05-10）。Cmd+S 保存全部场景。
5. 预览从 HomeScene 打开（构建面板首发场景建议改为 HomeScene）。

验收清单：

1. 首页显示 修行者 Lv.1 / 练气第1层 / 灵石 0 / 修为 0 / 青龙灵魄 0；控制台有 `[AccountSystem] loaded`；无红色报错。
2. 开始战斗 → 打完一局：结算浮层出现奖励行（胜利全额 / 失败减半），控制台有 `[AccountSystem] settlement ...`（含 subRealmPromotions）。
3. 返回首页：资源栏与结算一致；修为累计满 30 自动推进（练气第2层）、账号经验累计升级。
4. 战斗中每 6 秒从玩家位置发出一颗灵弹飞向最近怪（青龙默认出战，V05-08）；无怪不发射；暂停时冻结。
5. **修行面板（V05-11）**：突破区初始显示"小境界未圆满"且按钮禁用；青霄剑升级消耗灵石后首页资源栏即时减少（面板操作→回调刷新）；灵石不足时状态行"升级失败：灵石不足"；玩家等级 1 时法器上限显示"上限 1（受玩家等级钳制）"且按钮禁用。
6. **灵兽面板（V05-12）**：青龙显示"（出战中）"；上一只/下一只循环浏览五兽；白虎等未解锁显示"灵魄来源：待开放（V0.8 关卡扩充）"；对未解锁兽点"解锁"失败提示"灵石或白虎灵魄不足"（灵魄按兽隔离可观察）；出战切换仅青龙可用（其余锁定），切换后下一局灵兽技能随之变化（V0.5 可观察项限于青龙，多兽切换待 V0.8）。
7. **培养→变强闭环**：灵石培养青霄剑数级后打一局，受击/结算数字与培养前对比可观察（飞剑伤害提升；培养前记录 HUD/日志基线）。
8. 存档持久：关闭预览重开，等级/资源/境界/法器等级/出战灵兽全部保留；损坏档恢复：预览页 DevTools 执行 `localStorage.setItem('yaoling_account_save','{oops')` 后刷新 → 控制台 `account save reset (invalid_json)`、数值归零（原档在 `yaoling_account_save_corrupt_backup`）。
9. 突破条件凑齐方式（可选）：自然游玩约 10 局可达练气圆满+Lv.5+妖丹 4；快速验证可用 DevTools 写入合法存档 JSON 后刷新（改档仅用于验收，正常路径由事务保证）。
10. 直接预览 BattleScene：`[AccountBattleLink] no account service ...`，战斗可玩、结算无奖励行、不落账（预期行为）。
11. 微信开发者工具回归：构建进入 HomeScene，首页→战斗→结算→培养全链路无平台 API 错误。
12. 已知不可达项（如实记录）：玄武 heal 技能与白虎/朱雀/玄武/九尾狐的解锁升星在 V0.5 无法达成（灵魄不投放），相应路径由纯逻辑测试覆盖；多灵兽出战切换待 V0.8。

工作：新增 `HomeScene` 灰盒（账号服务跨场景常驻装配：persist 节点持有 AccountStore/领域服务；资源栏（灵石/修为/灵魄余额）、"开始战斗"进入 BattleScene）；`BattleResultPanel` 增加"返回首页"；BattleScene 启动时从存档装配账号服务与出战快照；关键操作后即时落存档。

DoD：

- 首页→战斗→结算→返回首页→资源/经验增加 全链路可走通。
- Creator 预览重启后存档保留（等级/资源/培养不丢）；损坏档可恢复（手工改坏存储验证一次）。
- 场景切换无监听/池泄漏；微信开发者工具回归无平台 API 错误。

## V05-11 — 修行面板（玩家等级/境界/法器培养 UI）

依赖：V05-10。

状态：已完成（2026-10-03 用户确认装配与闭环跑通——运行时数据、突破禁用、培养上限提示均正确；面板与首页叠影由动态底板 + 渲染顺序修正解决）。纯逻辑测试累计 **224/224** 通过（新增 3 项 PanelText）；类型检查通过。实现：`ui/RealmPanel.ts`（灰盒面板：修行者等级/经验进度、境界层数+修为余额、**大境界突破预览常显**（previewBreakthrough 纯函数直出消耗/门槛/收益/未满足原因，`canBreakthrough=false` 时按钮禁用）+ 点击即确认（confirmBreakthrough 事务）、青霄剑培养（等级/上限来源受玩家等级钳制提示/下一级消耗与持有对比/攻击加成，levelUpWeapon 事务）；每次操作后 `persistSave()` + 面板重渲染 + `onOperationDone` 回调刷新首页资源栏；失败原因映射中文状态行；无账号服务降级提示）；`ui/PanelText.ts`（叶子文案模块：境界层数/圆满描述、突破未满足稳定 key → 中文文案，HomeHud 与面板共用，node 测试覆盖）。

工作：HomeScene 内修行灰盒面板：账号等级/经验条、当前境界与小境界进度（修为达标自动推进的可见反馈）、大境界突破（条件预览 → 确认执行）、青霄剑培养（当前等级/下一级消耗/上限来源展示）。UI 只展示状态并回传操作意图，全部经领域事务执行，防连点。

DoD：

- 预览消耗与实际扣除一致；条件不足按钮禁用并显示原因；防连点有效。
- 突破后境界收益（maxHp）在下一局可观察；操作即落盘（重启保留）。
- 无红色报错；事件/回调成对解除。

## V05-12 — 灵兽面板（列表/培养/出战 UI）

依赖：V05-10。

状态：已完成（2026-10-03 用户确认装配与闭环跑通——浏览/出战标记/未解锁来源明示均正确；编辑器占位文字残留已清理）。纯逻辑测试累计 **224/224**；类型检查通过。实现：`ui/BeastPanel.ts`（灰盒面板：上一只/下一只循环浏览五灵兽（免动态列表节点）；展示解锁状态（未解锁含灵魄需求与"来源待开放（V0.8 关卡扩充）"明示，不做假数据）/等级与上限/星级与上限/出战中标记/技能说明（读配置 skillDescription）；解锁（unlockBeast，自身灵魄）/升级（levelUpBeast，灵石，玩家等级钳制）/升星（starUpBeast，自身灵魄）/出战（deployBeast 单槽切换，下一局生效）全部经领域事务 + `persistSave()` + 回调刷新；失败原因映射中文状态行；按钮可用性按状态逐项钳制）；过程修正：applyOp 初版的状态文案判断会让升级误报"升星成功"，重构为 runOp 统一执行器 + 调用方写文案。

工作：HomeScene 内灵兽灰盒面板：五兽列表（未解锁显示灵魄需求与"来源待开放"）、详情（等级/星级/技能说明/出战标记）、升级/升星/出战操作。同 V05-11 事务与防连点原则。

DoD：

- 未解锁灵兽不可出战/培养；出战切换下一局生效（Creator 验证）。
- 展示数值全部来自配置与账号状态，无假数据。

## V05-13 — V0.5 产消闭环收口

依赖：V05-08～V05-12。

状态：已完成（2026-10-03 用户确认收口清单通过）。收口执行记录：数值总览表已进 CONFIG.md「V0.5 局外数值总览」节（含风险标记：单关卡产出下玩家等级为全局瓶颈，20 级 ≈ 538 局，V0.8 扩充产出时复核）；用户确认——存档重启保留 ✓、损坏档恢复 ✓（改坏存储 → invalid_json 归零 + 备份可继续游玩）、微信开发者工具回归 ✓（首发场景 HomeScene，全链路无平台 API 错误）、Canvas 渲染顺序修正（World 最上/面板最后，怪物不再遮挡弹层）；可选的突破练气端到端验证未单独执行（如实标注：两步制预览/确认与境界收益由纯逻辑测试覆盖，不阻塞收口）。**V0.5 至此整体交付。**

工作：数值总览表进 CONFIG.md（产出/消耗/关键节奏：首升天数感、资源沉淀、培养上限推进）；完整闭环验收（打一局→领奖→修行/灵兽培养→下一局变强→再打）；存档损坏恢复与版本字段复查；微信开发者工具回归；MILESTONES 更新。

DoD：

- 产消闭环可玩、可观察、可复述（每步"消耗什么、提升什么、下一目标是什么"）。
- 全量测试/类型检查通过；无新增控制台错误。
- 未执行的微信真机项如实标注（沿用 T14 遗留跟踪）。

## 当前状态

- **V0.5 局外成长：全部完成（2026-10-03）**。V05-01 ～ V05-13 全部关闭；测试基线 224/224、严格类型检查通过；产消闭环（打局 → 领奖 → 修行/灵兽培养 → 下一局变强）可玩、可观察、可复述。
- 下一阶段：V0.8 立项待启动（章节关卡/难度/三星、任务、图鉴、商店、30 日奖励、礼包、成就、红点、奖励中心、基础活动框架——范围以 `ROADMAP.md` 为准）；正式 UI/美术/音效归 V1.0。
- 遗留跟踪：T14 真机验证（需正式小游戏 AppID 或安卓机）；V0.8 立项时复核 CONFIG.md 数值总览的风险标记（玩家等级为全局养成瓶颈）。
- 已知边界：其余四灵兽灵魄来源待 V0.8 关卡扩充；灵玉无投放；玄武 heal 路径纯逻辑覆盖（Creator 不可达）。
