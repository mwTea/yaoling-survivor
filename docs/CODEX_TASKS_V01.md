# CODEX_TASKS_V01 — V0.1 战斗玩法成型

> 本文件是 V0.1 阶段的唯一任务进度真相。任务编号 `V01-xx`，与 Phase 0 的 T00～T14 完全独立，不回填、不扩大已完成任务的边界。阶段范围以 `ROADMAP.md` 的 V0.1 行为准：首批法器方向、功法、法宝、Build、玩家受击、精英、Boss、正式战斗结算。规则沿用 `AGENTS.md`（每轮一个任务、状态协议、DoD 含测试/类型检查/Creator 验收/文档同步）。

## 使用规则

- 严格按依赖顺序推进；一次只领取一个任务。
- 新能力一律配置驱动：schema、初始值、校验、CONFIG.md 同提交更新。
- 复用 Phase 0 已验证机制（池化、事件总线、伤害入口、目标查询、升级队列），不重写。
- 纯逻辑必须可 node 测试；组件提供 Creator 手工验证步骤。

## V01-01 — 玩家受击与生命、战局失败

依赖：无（T08 伤害契约、T05 池、T02 状态机）。

待用户在 Creator 3.8.8 内验收（未执行项）：

1. 打开工程导入新脚本，确认无编译错误。
2. 选中 `Player` 节点添加组件 **PlayerAgent**，唯一槽 `battleController` ← Systems。
3. 选中 `BattleHud` 节点，把 `Player` 节点拖入新增的 `playerAgent` 槽。Cmd+S 保存。
4. 预览预期：怪物贴身后 HUD HP 从 20/20 开始下降（每次 -2），控制台有 `[PlayerAgent] contact damage 2 ...` 日志；同批怪物持续贴脸不会瞬间掉光（0.8s 无敌帧）；玩家走开后不再掉血；HP 归零瞬间状态标签变 `Battle: ended`、全场冻结（怪物/飞剑/计时停）、无红色报错。
5. 被围死大约需要 10 次有效受击（20 HP / 2 伤害），无敌帧保证最快约 8 秒——可观察节奏而非瞬杀。

工作：`PlayerAgent` 运行态（玩家 maxHp 来自配置）、怪物接触伤害结算（复用 DamageRequest，`damageType: 'contact'`，sourceEntityId 为怪物激活 ID）、玩家受击后短无敌帧（配置化）、玩家死亡幂等（复用死亡顺序协议：注销→发布 `playerDied`→战局转 `Ended`）。

DoD：

- 接触伤害、无敌帧计时、死亡幂等均有纯逻辑测试；玩家死亡后战局 Ended、模拟冻结。
- 无敌帧期间同一怪物重复接触不重复扣血；玩家碰撞半径来自配置。
- Creator 验收：被怪包围后 HP 下降、归零后战局结束、HUD 生命同步、无红色报错。

## V01-02 — 正式战斗结算（胜/败/退出）

依赖：V01-01（玩家死亡事件）、阶段时长配置。

状态：实现完成，待验收（2026-09-21）。纯逻辑测试累计 95/95 通过（新增 4 项：击杀/经验累计、非正经验忽略、快照新对象、用时下取整与负值钳制）；Creator 3.8.8 严格类型检查通过（退出码 0）。实现：`core/BattleEvents` 新增 `battleFinished { result, stats }`（`BattleResultStats` 类型定义在 core，依赖方向 battle→core）、`battle/StageResultRecorder.ts`（纯 TS 统计累计）、`battle/StageResultService.ts`（计时达 stage.duration 判胜利、playerDied 判失败、首个终局幂等、发布前确保战局 Ended）、`ui/BattleResultPanel.ts`（终局浮层：胜负标题 + 用时/击杀/经验/等级四项统计，"再来一局"重载 BattleScene）。

实现摘要：`core/BattleEvents.battleFinished` + `BattleResultStats`（类型在 core）、`battle/StageResultRecorder`（纯 TS）、`battle/StageResultService`（600s 胜利/playerDied 失败/幂等）、`ui/BattleResultPanel`（浮层 + 再来一局重载场景）。

工作：`StageResultService`——关卡计时达标（`stage.duration`）为胜利、玩家死亡为失败、主动退出为中止；统一结算状态（用时/击杀数/拾取经验/达到等级），发布 `battleFinished { result, stats }` 事件；灰盒结算浮层展示三项统计与"再来一局"（重载场景）。

DoD：

- 三种结束路径与统计累计有纯逻辑测试；统计口径与 monsterDied/experienceCollected 事件一致。
- 结算出现后模拟冻结（Ended 状态门已保证），浮层按钮仅重载场景。
- Creator 验收：胜利/失败各跑一遍，统计数字与局内 HUD/日志一致。

## V01-03 — 青霄剑正式化：法器配置与攻击范式

依赖：V01-02；`weapon_flying_sword` 技术原型。

实现摘要：`WeaponConfig.displayName`；ID 正式化 `weapon_qingxiao_sword`/`projectile_qingxiao_sword`（旧 ID 删除，prefabId 不变）。

工作：引入 `WeaponConfig` 正式法器条目（青霄剑 `weapon_qingxiao_sword`，含等级概念占位、绝学预留字段），攻击数值迁移配置；`AutoSwordWeapon` 改为按法器 ID 实例化的通用单武器组件（范式不变：索敌飞剑）。

DoD：

- 法器 schema + 校验 + CONFIG.md 同步；旧 `weapon_flying_sword` 保留为兼容或明确删除（二选一并记录）。
- 武器行为与 Phase 0 一致（回归：85/85 测试不变绿→不变红）。
- Creator 验收：游戏行为无肉眼可见变化，控制台打印法器 ID。

## V01-04 — 功法系统：局内获得型技能框架 + 首批 2 个功法

依赖：V01-03。

实现摘要：配置 `GongfaConfig`（schema/校验/两个初始功法，CONFIG.md 已同步）与 `projectile_sword_qi`（speed 540/lifetime 1.6，复用飞剑 prefab）；`progression/GongfaRuntime.ts`（纯 TS：层数、剑气数量派生、减伤应用到 PlayerCombatStats）、`PlayerCombatStats` 新增 `addContactDamageReduction/reduceContactDamage`（连乘、结算下限 0.1）、`ProgressionService` 候选池改为 `RunOptionSeed` 结构契约（升级+功法合并）、`ProgressionSystem.chooseOption` 按 ID 路由到功法或升级应用、`combat/SwordQiEmitter.ts`（周期向最近目标发射穿透剑气，独立池复用 SwordProjectile）、`PlayerAgent` 接触伤害经运行态减免后入契约、`LevelUpPanel` 显示功法标题/描述。

待用户在 Creator 3.8.8 内验收（未执行项）：

1. 打开工程等编译，确认无报错。
2. `Systems` 添加组件 **SwordQiEmitter**，三个槽：`battleController` ← Systems、`playerNode` ← Player、`swordPrefab` ← SwordGray prefab。Cmd+S 保存。
3. 预览游玩到第一次升级，预期三选一里会随机出现"剑气冲击"或"护体罡气"（与原三个升级项混合，不重复）：
   - 选**剑气冲击**后：每 3 秒从玩家位置向最近怪发出一道稍慢的蓝色剑气（damage=6=10×0.6），穿透多个怪；再选一层变两道小扇形。
   - 选**护体罡气**后：怪物贴身受击日志显示 `contact damage 1 (raw 2)`（15% 减免 → floor(2×0.85)=1）。
   - 功法与升级可混搭；跨级连选正常；防连点仍有效；全程无红色报错。
4. 若一次升级三候选都不是功法属正常随机——多升几级必遇（候选池 5 项）。

## V01-05 — 法宝系统：触发型被动 + 首批 1 个法宝

依赖：V01-04。

实现摘要：`TreasureConfig`/`TreasureRuntime`/`PlayerVitals.heal`（双向夹紧）/击杀回血接线/候选池并入。

待用户在 Creator 3.8.8 内验收（未执行项）：

1. 打开工程等编译，确认无报错（无新组件、无需装配——法宝触发复用 PlayerAgent 与 ProgressionSystem）。
2. 预览游玩升级数次，三选一可能随机出现"噬妖幡"（候选池 6 项）：
   - 先故意让怪物贴身掉一些血，选**噬妖幡**后每次飞剑/剑气击杀怪物，控制台出现 `[PlayerAgent] heal +2 on kill, hp=…`，HUD HP 数字回升（不超过 20/20）。
   - 叠第二层后每次击杀 +4。
   - 与功法/升级混搭正常；无红色报错。
3. 满血时击杀不回血（heal 返回 0，无日志）属正常。

DoD：触发条件/次数/数值有测试；击杀回血在 Creator 可观察（HP 变化）。

## V01-06 — 精英怪物

依赖：V01-01（玩家受击）、V01-04。

实现摘要：`eliteModifier`/`EliteStats`/`SpawnPlanner` elite 标记/`MonsterAgent` 有效数值与精英视觉/掉落粒度 1。

待用户在 Creator 3.8.8 内验收（未执行项）：

1. 打开工程等编译，确认无报错（无新组件、无需装配）。
2. 预览 1–2 分钟，预期：
   - 约 1/6 的怪物是**精英**：明显更大（1.5 倍）且橙红色，移动稍慢（×0.85）。
   - 精英明显更肉（80 HP ≈ 8 剑）、贴身更痛（受击日志 `raw 4`，有罡气则显示减免后值）、被杀后**原地散落 5 枚绿色经验**（拾取总量 5）。
   - 击杀精英同样触发噬妖幡回血（每次击杀 +2，多枚宝石不影响触发次数——回血按击杀事件）。
   - 无红色报错。

DoD：精英生成/掉落/属性强化有测试；Creator 可稳定识别精英并验证掉落量。

## V01-07 — Boss 与战斗收尾

依赖：V01-06。

实现摘要：`BossConfig`（噬妖妖将 120s 召唤/400HP/弹幕 12 发 5s→半血 3s，子弹 `projectile_boss_bullet`，CONFIG.md 已同步）、`monster/BossPhase.ts`（纯 TS 阶段与间隔）、`monster/BossAgent.ts`（继承 MonsterAgent：覆写数值来源/视觉（紫 2.5 倍），驱动径向弹幕）、`combat/BossBullet.ts`（池化子弹：直线/超时/越界/命中一次即回池，命中走 `PlayerAgent.applyExternalDamage` 统一减免与无敌帧路径）、`MonsterSpawner` 装配 Boss/子弹池并按 spawnTime 定时召唤（新增 bossPrefab/bulletPrefab 槽）、`StageResultService` 击杀 Boss（monsterDied.monsterId === bossId）即胜利。

待用户在 Creator 3.8.8 内验收（未执行项）：

1. 制作两个 prefab：
   - `BossGray`：Sprite 紫色（约 120×120），挂 **BossAgent** 组件 → `assets/prefabs/BossGray.prefab`，删除场景源节点。
   - `BulletGray`：Sprite 白色（约 20×20），挂 **BossBullet** 组件 → `assets/prefabs/BulletGray.prefab`，删除场景源节点。
2. 选中 `Systems`（MonsterSpawner 组件）新增两个槽：`bossPrefab` ← BossGray、`bulletPrefab` ← BulletGray。Cmd+S 保存。
3. **胜利路径 A（杀 Boss）**：预览游走刷怪，2:00 时控制台出现 `[MonsterSpawner] boss 噬妖妖将…spawned`，画面上方出现巨大紫色 Boss 追过来；它每 5 秒向四周放一圈白色弹幕（半血后 3 秒一圈）；靠近 Boss 会被弹幕/接触打痛（受击日志）。用飞剑+剑气磨掉 400 血（约 20+ 剑，注意走位躲弹幕）→ 击杀瞬间**"战斗胜利"浮层弹出**（远早于 600s），统计里击杀数 +1、经验大额增加；点"再来一局"正常重开。
4. **胜利路径 B（到时）**：重开一局挂机躲开 Boss（或故意不杀），撑到 10:00 计时 → "战斗胜利"同样触发。
5. 全程无红色报错；弹幕子弹出界/超时自动消失（不堆积）。

DoD：阶段转换/弹幕回收/胜利触发有测试；Creator 完整跑一遍"到时 or 杀 Boss"两种胜利路径。

## V01-08 — Build 收口与平衡过一遍

依赖：V01-03～V01-07。

实现摘要：经验曲线扩至 10 级、候选池审视结论与数值总览表进 CONFIG.md。
- **经验曲线 5 级 → 10 级**（5/8/12/17/23/30/38/47/57/68；原 5 级在 V0.1 数值下约 1 分钟满级过快；候选池总层数 37 ≥ 9 次选择，无枯竭风险）。
- **候选池审视**：6 项权重全 1；结论为暂不引入前置/互斥/保底（池小、全可叠层），记录进 CONFIG.md。
- **数值总览表**进 CONFIG.md（玩家/法器/功法/法宝/怪/精英/Boss/曲线全量）。
- 固定种子可复现由纯逻辑 RandomSource 测试覆盖；运行时 Math.random 适配器不做种子化（V0.1 无需求，已记录）。



## 当前状态

- 进行中：无。**V0.1 全部完成（V01-01～V01-09）。**
- 已完成：V01-09（2026-09-21 用户验收通过：相机跟随/边缘夹紧/UI 固定/微信回归确认）。V01-08（2026-09-21 用户验收通过：完整一局正常、微信模拟器回归无报错无回归）。**V0.1 阶段完成**（V01-01～V01-08 全绿）。V01-07（2026-09-21 用户验收通过：Boss 召唤/弹幕/阶段加速/击杀即胜利/到时胜利均确认）。V01-06
- 已完成：V01-06（2026-09-21 用户验收通过：精英可识别、属性强化、5 枚掉落确认）。V01-05（2026-09-21 用户验收通过：噬妖幡进三选一、击杀回血与 HUD 回升确认）。V01-04（2026-09-21 用户验收通过：功法进三选一、剑气可见、罡气减伤日志确认）。V01-03（2026-09-21 用户验收通过：行为无变化、青霄剑日志确认）。V01-02（2026-09-21 用户 Creator 验收通过：失败/胜利两路径浮层与统计正确、再来一局重开正常、无报错）。V01-01（2026-09-21 用户 Creator 验收通过：HP 实时下降、无敌帧节奏正确、死亡战局冻结、HUD 同步、无报错）。
- 已知遗留（不阻塞 V0.1，单独跟踪）：T14 真机验证待正式 AppID 或安卓设备；经验曲线 5 级待 V01-08 一并扩。

## V01-09 — 相机跟随与更大战斗场地

依赖：V0.1 完成。

状态：已完成（2026-09-21）。纯逻辑测试累计 113/113 通过（新增 3 项：中部自由跟随、四边/角夹紧不露边、视口大于世界的退化居中；修复 -0 偏移）；类型检查 exit 0。用户完成场景分层调整（Player/PoolRoot 移入 World + CameraController）并确认验收：相机平滑跟随、边缘不露黑边、UI 钉在屏幕原位、微信回归无报错。方案："移动 World 容器"实现相机（世界节点反向平移 = 相机平移），不动真相机与渲染层级。实现：`stage.playArea` 扩为 2400×1600（CONFIG.md 已记录）、`ui/CameraFollowMath.ts`（纯 TS 视口中心夹紧）、`ui/CameraController.ts`（挂 World 容器：首帧对准玩家、指数平滑跟随、真实帧时间）。刷怪环带/Boss 召唤/弹幕均为玩家相对坐标，无需改动。

实现摘要：`stage.playArea` 2400×1600、`ui/CameraFollowMath.ts`（纯 TS 视口中心夹紧）、`ui/CameraController.ts`（World 容器平滑跟随、首帧对准）。