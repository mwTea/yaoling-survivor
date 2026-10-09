# CODEX_TASKS_V10 — V1.0 微信正式首发

> 本文件是 V1.0 阶段的唯一任务进度真相。任务编号 `V10-xx`，与 Phase 0（T00～T14）、V0.1（V01-xx）、V0.5（V05-xx）、V0.8（V08-xx）完全独立，不回填、不扩大已完成任务的边界。阶段范围以 `ROADMAP.md` 的 V1.0 行为准：新手引导、功能解锁、微信登录/云存档、广告、正式 UI/美术/音效、SafeArea、性能/包体、埋点、合规与发布验收；**明确不含**倍速、Future 系统、法币支付（支付只做商业化评审，不实现）。规则沿用 `AGENTS.md`。

## 阶段设计决策（立项定案，任务不得悄悄偏离）

1. **无自建服务器，微信云开发承担服务端职责**：登录身份（openid）、云存档、服务器时间（云函数返回）、埋点接收均走微信云开发；客户端只经 `platform/` 适配层消费，业务零 `wx.*`。各适配层先立接口 + 本地/模拟实现先行开发，真机/云环境绑定在收尾任务联调。**若用户后续决定自建服务器，只替换适配层实现，任务结构不变。**
2. **支付不实现**：法币支付、退款、补单、未成年人限制按 `ECONOMY.md` §5 要求只产出《商业化评审》文档任务；V1.0 商业化实现范围 = 激励广告（复活、结算加成、每日资源位），插屏默认关闭（远程开关预留）。
3. **时间语义升级为服务器时间**：`platform/TimeService` 接口不变，替换为"服务器时间 + 单调偏移"实现（V08-07 的本地实现降级为断网容错）；检测明显回拨不自行发奖、进入安全降级待校时（LIVEOPS §1）。业务仍零 `Date` 直读。
4. **存档 schema v3 一次成型**：新增身份域（本地访客标识/微信标识/账号创建与最后登录时间）、设置域（音量/震动/画质/协议版本）、引导域（步骤版本/完成状态）；云同步字段（更新时间/校验）随 v3 落定；v2→v3 迁移函数与测试同提交，迁移幂等。
5. **新手引导与功能解锁全部配置驱动**：引导步骤/触发/高亮、功能解锁条件（玩家等级/章节/境界/账号天数）均为配置表；状态机与解锁判定为纯逻辑可测；未解锁入口可隐藏或显示明确条件，不得形成无解释红点（GAME_LOOP §4/§5）。
6. **正式美术/音效：资源由用户提供，任务只做接入管线**（图集/九宫格/prefab 替换/验收清单/包体控制）。管线先行、资源替换独立验收；音效系统（BGM/技能/命中/UI 分组、并发上限、设置开关）为代码任务，先行用占位音频。
7. **性能与包体以实测为门禁**：首包（主包）≤ 4MB、整包分包策略、加载时间与真机 30FPS；门禁数据需 Creator Profiler + 微信开发者工具 + 真机证据，变更需记录。
8. **埋点失败不阻断游戏**：事件契约集中定义（新手漏斗/开局结算/失败原因/资源产消/广告结果），批量与频率控制，开发期 console 实现、首发接微信通道。

## 用户前置条件（需要用户配置/提供，任务领取前确认）

| 前置项 | 影响任务 | 说明 |
|---|---|---|
| 微信小游戏正式 AppID | V10-07/08/09/10/12/15/16 | T14 真机验证同样依赖；开发者工具可在测试号下先开发 |
| 微信云开发环境（开通并授权） | V10-07/08/09/12 | 云函数/云数据库配额由用户在 mp 后台开通 |
| 正式 UI/美术资源（切图/图集/字体） | V10-14 | 用户提供；任务做接入管线与替换 |
| 正式音效/BGM 素材 | V10-05 | 可先用占位音频开发，替换时用户提供 |
| 安卓真机（或带正式 AppID 的 iOS） | V10-13/15/16 | 真机性能门禁与发布验收 |

## 使用规则

- 严格按依赖顺序推进；一次只领取一个任务。
- 平台能力（登录/云/广告/埋点/时间）一律经 `platform/` 适配层接口进入；业务代码零 `wx.*`、零 `Date` 直读。
- 新能力一律配置驱动：schema、初始值、校验、CONFIG.md 同提交更新。
- 纯逻辑必须可 node 测试（零跨文件值导入、无参数属性）；组件提供 Creator 手工验证步骤。
- 复用既有机制：AccountStore/经济事务、领域叶子模块模式、PanelKit 动态 UI、RedDotService、FeatureFlags、StageProgress 解锁查询，不重写。

## V10-01 — 存档 schema v3（身份/设置/引导域）与迁移

依赖：无。

状态：实现完成，待验收（2026-10-05）。纯数据层任务，无场景可见行为；自动测试 297/297 通过（accountSave 20 项含 v2→v3 迁移/幂等/修复/清档覆盖），Creator 3.8.8 严格类型检查零错误。老玩家存档体验验收（v2 档无损迁移、清档新域归零）并入下次 Creator 进游戏验证。

工作：`account/AccountSave.ts` 扩展为 schemaVersion 3，一次性新增：身份域 `identity`（本地访客 ID、微信 openid 占位、账号创建/最后登录时间戳）、设置域 `settings`（BGM 音量/音效音量/震动开关/画质档位/协议版本，数值默认安全）、引导域 `guide`（步骤版本号、已完成步骤 ID 列表）、云同步元数据（上次云同步时间与来源标记，本地容错用）；v2→v3 迁移函数（补默认值无损）+ 解析修复/序列化适配 + 测试；迁移幂等。清档重开路径覆盖新域。

实现摘要：`AccountSave.ts` 新增 `IdentitySaveState`（localGuestId/wxOpenId 空串占位、accountCreatedAt/lastLoginAt 时间戳）、`SettingsSaveState`（bgmVolume/sfxVolume 0～100 默认 100、vibrationEnabled 默认 true、qualityTier 0～2 默认 0=自动、agreementVersion 默认 0=未确认）、`GuideSaveState`（scriptVersion 默认 0、completedStepIds 默认空）、`CloudSyncSaveMeta`（lastSyncedAt 默认 0、lastSyncSource 默认空串）四容器；`createEmptyAccountSave` 的 identity.accountCreatedAt 取创建时刻；sanitize 新增音量钳制（非法落默认）、布尔回退、列表去重；`parseAccountSave` 接受 v1/v2/v3，`upgradeAccountSaveV2ToV3` 与历史入口 `upgradeAccountSaveV1ToV2` 同走 normalize（输出恒为当前版本）；`AccountStore.resetToNewSave` 复用 `createEmptyAccountSave` 自动覆盖新域。语义赋予计划：identity→V10-07、settings→V10-05/06（协议版本→V10-16）、guide→V10-03/04、cloudSync→V10-09。

DoD：

- [x] v2 存档迁移到 v3 无损（原字段全保留、新域有默认值）有测试；v3 往返、损坏修复、未知版本拒绝维持；迁移幂等。
- [x] `AccountSystem.resetAccount` 清档后新域恢复默认（经 `AccountStore.resetToNewSave` → `createEmptyAccountSave` 覆盖，测试断言四新域归零）。

## V10-02 — 功能解锁配置体系与导航接入

依赖：无。

状态：实现完成，待验收（2026-10-05）。纯逻辑测试 307/307 通过（新增 unlockSystem 10 项 + 配置校验 2 项），Creator 3.8.8 严格类型检查零错误。Creator 人工验收（新档首页仅见基础入口、通关首关后修行/灵兽出现、二/三关后图鉴/商店出现）并入下次进游戏验证。

**设计定案（2026-10-05 用户确认，"章节内推进"方案）**：GAME_LOOP §4"章节推进"落地为 `stageClear` 条件类型（通关章节内指定关卡）。修行/灵兽=通关第 1 关（保证 V10-04 首局结算后"首次培养"深链可达，GAME_LOOP §5 最短闭环不撞锁）；图鉴=通关第 2 关、商店=通关第 3 关（每次重点介绍一个新系统）；礼包（奖励中心 offers 区）=通关第一章；活动=境界突破 1（预留，签到不绑——RETENTION 日 1 可用语义）。未解锁入口初始全部 hide（"首次进入不展示全部入口"）；show_condition 为配置可选路径（机制已实现并有测试）。与 FeatureFlags 交集语义：开关关闭恒隐藏；开关开启且未解锁按 lockedBehavior 隐藏或显示配置文案；锁定入口不挂红点。

工作：`UnlockConfig` schema（featureId 稳定 ID/解锁条件类型（玩家等级/章节通关/境界/账号创建天数）/条件参数/展示条件文案）+ `account/UnlockSystem.ts` 纯 TS（条件判定，复用 StageProgress 的章节/关卡查询语义）；初始解锁表按 GAME_LOOP §4（首次进入=首页+关卡+基础法器；章节推进解锁修行/灵兽/图鉴/商店；中后期解锁活动/礼包——与 FeatureFlags 取交集，双关闭才隐藏）；MainNav/入口接入（未解锁入口隐藏或显示条件文案，不制造无解释红点）+ 校验 + CONFIG.md。

实现摘要：`ConfigTypes.ts` 新增 `UnlockCondition`（always/playerLevel/stageClear/chapterClear/realmIndex/accountAgeDays 六类，单条件不组合）、`UnlockLockedBehavior`（hide/show_condition）、`UnlockConfig`（id/featureId/condition/lockedBehavior/lockedText/featureFlag）与 `GameConfig.unlocks`；`GameConfig.ts` 落初始解锁表 9 条（见 CONFIG.md 定案表）；`ConfigValidation.ts` 新增 `validateUnlocks`（id/featureId 双唯一、条件参数、关卡/章节引用存在、show_condition 文案非空、开关 ID snake_case）；`account/UnlockSystem.ts` 纯叶子模块（条件判定、入口三态 normal/locked_visible/hidden、未知 featureId 返回 null 安全隐藏 + 调用方告警、stageClear/chapterClear 内联实现与 StageProgress 同语义并由测试交叉验证、`computeAccountAgeDays` 回拨/未知创建时间钳 0）；`ui/MainNav.ts` 接入（stage_select/realm/beast/codex/shop 绑定 featureId；解锁状态变化在返回首页时重建导航——冷路径；锁定入口不可点且不挂角标；账号服务未就绪安全隐藏并一次性告警；panel.onOperationDone 包装只做一次防叠加）；`ui/RewardCenterPanel.ts` 礼包区按 `offers` 解锁门控。语义记录：任务/成就/奖励中心/我的暂不在解锁表（GAME_LOOP §4 未给出条件，保持现有恒可见行为，后续任务再配置化）。

DoD：

- [x] 解锁条件判定（等级/章节/境界/天数）有纯逻辑测试；未知 featureId 快速失败或安全隐藏（记录语义）。
- [x] 导航入口按解锁表显隐且与 FeatureFlags 交集正确；未解锁入口（选择显示条件时）文案来自配置，无假数据（show_condition 机制有测试；初始表全 hide，切换只改配置）。

## V10-03 — 新手引导数据层（配置驱动状态机）

依赖：V10-01。

状态：实现完成，待验收（2026-10-05）。纯数据层任务，无场景可见行为；测试 317/317 通过（新增 guideSystem 9 项 + 配置校验 2 项），Creator 3.8.8 严格类型检查零错误。表现验收并入 V10-04 Creator 闭环。

工作：`GuideConfig` schema（步骤 ID/触发条件（事件/界面进入）/步骤类型（强引导遮罩/弱提示/说明）/目标锚点 ID/完成事件/下一步/可跳过标记）+ 首发引导脚本配置（操作→自动攻击→拾取→三选一→结算→首次培养最短闭环，GAME_LOOP §5）；`account/GuideSystem.ts` 纯 TS（步骤状态机：触发推进/完成事件/跳过规则/步骤版本，状态写存档引导域，幂等）；改版迁移策略（步骤版本升级不重卡老玩家）+ 校验 + CONFIG.md。

实现摘要：`ConfigTypes.ts` 新增 `GuideEventId`（8 个稳定语义事件；界面进入=事件，不设独立触发种类）、`GuideStepType`（strong/weak/info）、`GuideStepConfig`、`GuideScriptConfig`（version/entryStepId/steps）与 `GameConfig.guide`；`GameConfig.ts` 落首发六步脚本（移动 strong→自动攻击 weak→拾取 weak→三选一 strong→结算 info→首次培养 strong；锚点 player/xp_gem/levelup_panel/settlement_panel/nav_realm）；`account/GuideSystem.ts` 纯叶子状态机（入口触发盖章启动脚本；当前步骤=链上第一个未完成步骤；完成事件仅对活跃步骤生效、乱序忽略、重复完成幂等；skip 仅限 skippable 步骤且推进链；脚本完结零写入；版本迁移——scriptVersion 非 0 且≠当前版本视为完结不改写存档，不重卡老玩家；`isGuideStepBlocking` 强步骤阻塞语义）；`ConfigValidation.ts` 新增 `validateGuideScript`（版本正整数、ID 唯一、引用存在、**单线性链无环无孤儿**、**strong 白名单强制**（guide_move/guide_levelup/guide_cultivate，新增强引导须扩白名单）、skippable ⇒ 非 strong、文案/锚点非空）。已知行为记录：schema v3 迁移的老档 scriptVersion=0，下次进战斗会完整走一遍引导（V1.0 前存档无引导历史，预期）。

DoD：

- [x] 状态机推进/跳过/幂等（重复完成事件不重复记录）/步骤版本迁移有纯逻辑测试。
- [x] 强引导步骤白名单（仅首次核心操作）在配置校验中强制；可跳过步骤不阻塞战斗有语义测试（skippable ⇒ 非 strong 校验 + isGuideStepBlocking 断言）。

## V10-04 — 新手引导表现层（首局最短闭环）

依赖：V10-03。

状态：实现完成，待验收（2026-10-05）。测试 317/317、tsc 零错误；表现层无纯逻辑变化（状态机测试已覆盖），Creator 装配与闭环验收依赖用户执行（步骤见下）。

工作：引导 UI 层（高亮遮罩/手指提示/说明气泡，PanelKit 灰盒起、正式美术随 V10-14 替换）；战斗内引导接线（首次移动/攻击/拾取/三选一的触发与完成事件订阅，成对解除）；结算后"首次培养"跳转（修行/灵兽面板深链）；首页首进入直接开始第一局（GAME_LOOP §4"首次进入"）。Creator 闭环验收：新档首局走完最短闭环，二局不再触发。

实现摘要：新增 `ui/GuideEvents.ts`（共享内核：锚点注册表、表现层刷新通知、`emitGuideEvent` 引导域唯一写入口——账号未装配静默忽略，推进即落盘+通知；单开模块避免 Overlay/Driver 循环依赖）、`ui/GuideAnchor.ts`（锚点组件：onEnable 登记/onDisable 注销）、`ui/GuideOverlay.ts`（`GuideOverlay` 全屏表现层：strong 步骤半屏聚焦遮罩+锚点高亮环+强调气泡，weak/info 无遮罩+气泡+跳过按钮（仅 skippable）；缺失/未知锚点回退居中；遮罩纯视觉不拦截触摸——移动强引导要求摇杆可用、三选一阻塞由玩法固有暂停保证；事件驱动刷新无每帧扫描；onDestroy 解除监听）、`ui/GuideBattleDriver.ts`（战斗内驱动：battleStateChanged 首次 Running→开局、experienceCollected→拾取、levelUpResolved→三选一完成、battleFinished→结算出现，订阅成对解除；移动/攻击轮询缓存组件只读状态 isMoving/totalFired，无分配无每帧查找；`GuideHomeDriver`：进首页发 home_entered、互斥面板注册表引用比较观察修行/灵兽面板打开→首次培养完成、培养步骤活跃时深链自动打开修行面板（0.8s，可装配关闭 autoJumpToCultivate）、新档（scriptVersion=0）延迟 0.2s 自动进入第一局；两 Driver 与锚点各自独立成文件——Cocos 约束每脚本文件最多一个 Component 类，Creator 报错 "Each script can have at most one Component" 于 2026-10-05 拆分修正）。增量接口：`PanelKit.getActivePanel`、`PlayerMover.isMoving`、`AutoSwordWeapon.totalFired`（均为只读 getter，不改既有逻辑）。

**Creator 装配步骤（用户执行）**：

1. BattleScene：Canvas 下新建全屏节点 `GuideOverlay`（与 HUD 同级、排最上层），挂 `ui/GuideOverlay` 组件。Systems 节点挂 `ui/GuideBattleDriver.ts` 的 GuideBattleDriver：`battleController ← Systems`、`playerNode ← Player 节点`。可选锚点：Player 节点挂 `GuideAnchor`（anchorId=`player`）、LevelUpPanel 的 content 节点挂 `GuideAnchor`（anchorId=`levelup_panel`）、结算面板 content 节点挂 `GuideAnchor`（anchorId=`settlement_panel`）——未挂的锚点气泡居中回退，不报错。
2. HomeScene：Canvas 下新建全屏节点 `GuideOverlay` 挂 `ui/GuideOverlay`；任一常驻节点挂 `ui/GuideHomeDriver.ts` 的 GuideHomeDriver：`realmPanel ← RealmPanel`、`beastPanel ← BeastPanel`、`navAnchorHost ← Canvas`（导航高亮定位宿主）。
3. 脚本导入后确认 Creator 无编译错误（新增 .meta 由 Creator 自动生成）。

**Creator 验收步骤（用户执行）**：

1. 清档重开（我的页）或首次运行：进首页约 0.2s 后自动进入战斗（首次进入直接开打）。
2. 首局六步：移动强引导（遮罩+玩家高亮+气泡，摇杆可用）→ 移动后攻击弱提示 → 自动出手后拾取弱提示（可跳过）→ 首次拾取后三选一强引导（面板可点）→ 选择后结算说明 → 结算出现后完成；回首页约 0.8s 自动打开修行面板（首次培养深链），高亮导航区；打开面板即引导完结（控制台 `script completed`）。
3. 二局再进战斗零引导 UI、零 guide 日志；跳过按钮仅出现在拾取/结算步骤，点击后推进且战斗不阻塞。
4. 老档（已完成引导）进首页/战斗零引导痕迹；全程无红色报错、无新增常驻节点。

DoD：

- [ ] 新档首局完整走完 6 步最短闭环；强引导期间战斗模拟按步骤暂停或聚焦（不冻结 UI 输入）；跳过后不阻塞。（待 Creator 验收）
- [ ] 老档（已完成步骤）零引导痕迹；引导事件订阅成对解除、无红色报错。（成对解除已代码走查：GuideBattleDriver onDisable、GuideOverlay onDestroy；待 Creator 验收）

## V10-05 — 音效系统与音频分组

依赖：V10-01（设置域默认值）。

状态：实现完成，待验收（2026-10-05）。测试 324/324、tsc 零错误；音频播放在 Creator 内无自动测试可覆盖，需用户按验收步骤执行；真机并发/性能随 V10-15 门禁复核。

工作：`platform/AudioService`（BGM/技能/命中/UI 四组；每组音量、同类并发上限、组开关；占位音频资源）；战斗接线（升级三选一/Boss 出场/命中/按钮 UI 音，节奏受控不在热路径每帧触发）；读存档设置域应用默认音量；提供 Creator 手工验证步骤。真机并发/性能随 V10-15 门禁复核。

实现摘要：`ConfigTypes.ts` 新增 `AudioChannelId`/`AudioChannelConfig`/`AudioClipBinding`/`AudioConfig` 与 `GameConfig.audio`（四组基线：bgm 70/1 并发、skill 90/4 并发/60ms、hit 60/6 并发/90ms 节流、ui 80/3 并发/40ms；剪辑绑定 5 条）；`platform/AudioMixer.ts` 纯逻辑（音量合成、并发槽（到期时间戳自然回收）、节流锚点=播放开始时间、组开关、静音零播放；时间注入）；`platform/AudioService.ts`（persist 组件：剪辑按资产名装配映射、BGM 循环源 + SFX oneShot 源、`applySettings` 实时生效、缺失剪辑 warn 一次跳过、`AudioService.instance?.` 空安全——音效永不阻断玩法）；占位音频 `game/assets/audio/*.wav` 五个（约 130KB，脚本生成正弦占位音）；接线：新增 `bossSpawned` 战斗事件（BattleEventMap + MonsterSpawner 发布，附加式）、`battle/AudioBattleLink.ts`（monsterDied→hit、levelUpRequested→levelup、bossSpawned→boss；订阅成对解除）、`PanelKit.createClickRegion` 统一 UI 点击音。

**Creator 装配步骤（用户执行）**：

1. HomeScene：AccountRoot（persist 节点）挂 `platform/AudioService`，勾选 persistent；`clips` 数组依次拖入 `assets/audio/` 下五个占位剪辑（资产名与配置 ID 一致，顺序不限）。
2. BattleScene：Systems 节点挂 `battle/AudioBattleLink`：`battleControllerRef ← Systems`。

**Creator 验收步骤（用户执行）**：

1. 进首页点任意按钮：短促 UI 音；音量随我的页设置变化（V10-06 接入前可先改存档 settings 域或用默认值验证）。
2. 进战斗：击杀有命中音（连续击杀节流不明显刺耳）；升级弹三选一面板有提示音；带 Boss 关（如 stage_qingyun_04）Boss 出场有低鸣。
3. 静音验证：存档 settings.sfxVolume=0、bgmVolume=0（或待 V10-06 设置页拉到 0）后重进，零播放。
4. 直开 BattleScene（无 HomeScene）：无音频相关红色报错。

DoD：

- [x] 音量/并发/开关为配置驱动且经设置域生效；静音设置下零播放。（纯逻辑测试覆盖；Creator 播放行为待验收）
- [x] 命中等高频音效受并发上限与节流控制（走查无每帧播放调用——接线点均为低频事件/点击；hit 组 90ms 节流 + 6 并发有测试）；占位资源约 130KB 不进首包预算冲突（随 V10-15 复核）。

## V10-06 — 设置页（我的页扩展，实时生效）

依赖：V10-05。

状态：实现完成，待验收（2026-10-05）。测试 327/327、tsc 零错误；设置区 UI 与实时生效需用户按验收步骤在 Creator 验证；画质真机表现随 V10-15 复核。

工作：我的页扩展设置区（BGM 音量/音效音量/震动开关/画质档位/协议版本展示），改动经设置域落盘并实时生效到 AudioService/震动/画质；恢复默认；灰盒沿用 PanelKit。

实现摘要：`AccountSave.ts` 抽出 `DEFAULT_ACCOUNT_SETTINGS` 常量（新建存档/迁移修复/恢复默认同源，UI 零硬编码默认值）；新增 `platform/Vibration.ts`（震动开关 + 微信 vibrateShort 适配，无 wx 环境静默 no-op）、`platform/QualityProfile.ts`（画质档位纯语义：0 自动=引擎默认 60FPS/1 流畅=30FPS/2 高清=60FPS，auto 恒回默认保证可回退）、`platform/SettingsRuntime.ts`（`applyRuntimeSettings` 唯一运行时生效入口：AudioService.applySettings + setVibrationEnabled + game.frameRate）；`AccountSystem` 启动 load 与 resetAccount 后调用 applyRuntimeSettings（增量）；`ProfilePanel` 扩展设置区（BGM/音效音量 −/＋ 步进 10、震动开关、画质循环切换、协议版本展示、"恢复默认设置"按钮；统一 `commitSettings` 路径：写设置域 → persistSave → applyRuntimeSettings → 刷新）。灰盒 UI 用 −/＋ 按钮替代滑杆（PanelKit 无滑杆控件，正式 UI 随 V10-14）。

**Creator 装配步骤（用户执行）**：无新增节点——我的页（ProfilePanel）沿用既有装配；AudioService 按 V10-05 装配在 AccountRoot 后，设置实时生效即接通。

**Creator 验收步骤（用户执行）**：

1. 我的页 → 设置区：BGM/音效音量 −/＋ 每次步进 10（0~100 夹紧），改动后按钮点击音立即变小/变大（实时生效）。
2. 音量改 0：点击按钮零声音（静音零播放）。
3. 震动开关切换后按钮文案变化；真机上确认震动抑制（桌面预览仅验证不报错）。
4. 画质档位循环（自动→流畅→高清）：切流畅后预览帧率明显下降（Profiler/统计面板），切回自动恢复。
5. 重启预览（或退出重进）：设置保持；"恢复默认设置"后全部回到 100/100/开/自动且即时生效；清档重开后设置区同为默认值。

DoD：

- [ ] 改动落盘且重启后保持；音量滑杆/开关实时生效；画质档位影响目标帧率或分辨率缩放（灰盒语义：目标帧率，V10-15 复核）。（待 Creator 验收）
- [x] 设置项全部来自配置 schema 默认值，无硬编码散落（DEFAULT_ACCOUNT_SETTINGS 单一真相，有测试）。

## V10-07 — 微信登录与身份接入

依赖：V10-01；真机/云环境绑定依赖用户前置（AppID + 云开发环境）。

状态：实现完成，待验收（2026-10-05）。测试 333/333、tsc 零错误；**云函数真机链路未验证**（需用户开通云开发并部署 `cloudfunctions/login/`，见下）；Creator 内模拟链路待用户确认。

工作：`platform/IdentityAdapter` 接口（登录获取身份标识/访客兜底）+ 微信实现（wx.login → 云函数换取 openid，云函数代码随任务交付）+ 开发期模拟实现（Creator/开发者工具无云环境时可跑）；存档身份域写入（openid/最后登录时间）；登录失败降级为访客模式并可重试；隐私授权入口预留（V10-16 完成合规流）。

实现摘要：`platform/IdentityAdapter.ts` 纯逻辑（接口 `IdentityAdapter.login(): Promise<IdentityResult>`；`createGuestId` 随机源注入 guest_+16hex；`applyLoginResult` 登录落档唯一路径——成功写 openid+lastLoginAt、失败访客兜底不写 openid 不推进 lastLoginAt、localGuestId 首次生成后不变、迁移老档回填 accountCreatedAt；`MockIdentityAdapter` 可注入失败模式）；`platform/WechatIdentityAdapter.ts`（wx.login → `wx.cloud.callFunction('yaoling_login')` → openid；无 wx/云环境由 `createIdentityAdapter` 工厂回退 Mock；wx 全部集中在该文件，业务零 `wx.*`）；云函数 `cloudfunctions/login/index.js`（wx-server-sdk getWXContext 直接返回 openid，无需 AppSecret/暗码交换）；`AccountSystem` 接线（onLoad 自动登录一次 + `retryIdentityLogin()` 可重试 + `identity` 只读快照；并发重入忽略；结果落盘）。

**云函数部署步骤（用户前置，完成后真机链路方可验收）**：

1. mp.weixin.qq.com 开通微信云开发并创建环境（记录环境 ID）。
2. 微信开发者工具打开构建产物工程，云开发面板导入/上传 `cloudfunctions/login/`（云端安装依赖 wx-server-sdk）。
3. 如需指定环境 ID，`createIdentityAdapter('你的环境ID')`（当前传 null 使用默认环境）。

**Creator 验收步骤（模拟链路，用户执行）**：

1. 启动 Creator 预览：控制台出现 `[Identity] no wx/cloud environment, using MockIdentityAdapter` 与 `[AccountSystem] identity login ok (openid=mock_openid_dev_0000000000)`。
2. 我的页（或存档日志）确认身份域已写入：openid=mock openid、lastLoginAt>0、localGuestId 非空；重启预览后 localGuestId/openId 保持。
3. 清档重开后重新登录：guestId 重新生成（清档语义）。

DoD：

- [x] 适配层接口 + 模拟实现有纯逻辑测试；业务代码零 `wx.*`（走查：wx 全局仅出现在 platform/WechatIdentityAdapter.ts 与 platform/Vibration.ts 平台适配层）。
- [ ] 云函数部署后真机登录写入 openid（**未验证**：等待用户云环境部署；模拟链路已可跑通全流程）。

## V10-08 — 服务器时间接入（回拨安全降级）

依赖：V10-07。

状态：实现完成，待验收（2026-10-05）。测试 337/337（含 V08-07 既有 4 项回归 + V10-08 新增 4 项）、tsc 零错误；云函数真机校时未验证（依赖用户部署 `cloudfunctions/time/`）。

工作：`platform/TimeService` 实现替换为"服务器时间 + 单调时钟偏移"（云函数返回服务器毫秒；客户端保存最近服务器时间与单调偏移，短时展示/容错）；明显回拨检测 → 安全降级（不自行发奖，商店/签到按上次可信 dayKey 冻结，待校时恢复）；断网容错回退本地时钟（记录为降级态）；接口不变、业务零改动。**收敛 V08 已知妥协**：任务/商店/签到/活动全部经新实现取"当天"。

实现摘要：`TimeService` 原地升级（接口不变）：`syncWithServer(serverNowMs)` 写偏移（offset=服务器−本地时钟）并以服务器值为可信锚点；`now()` 输出单调（微小抖动钳制）；**明显回拨**（回退 > `SERVER_TIME_ROLLBACK_THRESHOLD_MS`=60s）进入 frozen 态——时间/dayKey/weekKey 冻结在上次可信值（商店/签到不触发周期重置、不自行发奖），时钟追上或重新校时自动解除；未同步为 local 降级态（`timeStatus`/`lastTrustedNow`/`serverOffsetMs` 诊断只读）。同步通道 `platform/ServerTimeSync.ts`（wx 绑定层，云函数 `yaoling_time` 取 `serverNow`，失败返回 false 不抛错）；云函数 `cloudfunctions/time/` 随任务交付；`AccountSystem` 身份登录后自动校时一次（失败 warn 降级态，可后续再触发）。业务零改动（TimeService 引用方零修改）。

DoD：

- [x] 偏移计算/回拨检测/降级冻结有纯逻辑测试（注入时钟：服务器锚定、单调钳制、2h/24h 回退冻结、恢复路径、非法校时值忽略）。
- [x] 业务代码仍零 `Date` 直读；TimeService 接口未变（V08-07 测试全部继续通过；dayKey/weekKey 语义回归测试通过）。真机云校时**未验证**（等待用户云环境部署）。

## V10-09 — 云存档同步与冲突策略

依赖：V10-07、V10-08。

状态：实现完成，待验收（2026-10-05）。测试 347/347、tsc 零错误；**真机双端存档接力未验证**（需用户云环境：开通云开发、创建 `account_saves` 集合并设为"仅创建者可读写"）。

工作：`platform/CloudSaveAdapter` 接口 + 微信云实现（云数据库按 openid 存档文档）+ 模拟实现；同步策略（本地为准上传/下载覆盖的判定用 schemaVersion + lastSavedAt（服务器时间）+ 校验和；冲突时展示可理解选择或按评审策略合并，**禁止静默用旧档覆盖新档**，LIVEOPS §5）；启动/关键事务后节流上传；断网容错（本地缓存继续玩，恢复后补同步）；同步状态在"我的"页可见。

实现摘要：`platform/CloudSaveController.ts` 单文件叶子模块（同 Pools/Combat 先例，零跨文件值导入可 node 测试）承载：`CloudSavePayload`（openid+schemaVersion+lastSavedAt+checksum+data）、FNV-1a 32 位校验和（**剥离 cloudSync 元数据**——元数据写入不代表进度差异，避免上传后自冲突）、`CloudSaveAdapter` 接口 + `MockCloudSaveAdapter`（内存 + 可注入失败）、`decideSyncDirection`（**严格 lastSavedAt 判新旧**：本地严格新→upload、云端严格新→download、校验和相同→in_sync、**时间相同内容不同→conflict 保持本地不上传不下载**、云端 schema 高于当前→conflict 不降级覆盖）、上传节流（60s，失败不计入、恢复后立即补同步）、`CloudSaveController` 编排（启动同步 + persistSave 钩子节流上传；下载经 parseAccountSave 归一后 store.save 落地；元数据即时落盘；同步失败/未就绪零阻断）。`platform/WechatCloudSaveAdapter.ts`（wx 云数据库 `account_saves` 集合，文档 _id=openid，客户端直连无需云函数；无环境回退 Mock）；`AccountSystem` 接线（openid 就绪后建控制器启动同步、persistSave 触发节流上传、`cloudSaveStatus` 暴露）；我的页展示云同步状态（已上传/已恢复/一致/冲突/失败/未登录）。

**云数据库配置步骤（用户前置）**：微信开发者工具 → 云开发 → 数据库 → 创建集合 `account_saves` → 权限设为"仅创建者可读写"。无需云函数。

DoD：

- [x] 新旧档判定/冲突路径/断网容错有纯逻辑测试（方向判定矩阵、节流窗口、上传失败不抛错且恢复后补同步、冲突双侧均不被覆盖、下载不丢进度、内容一致收敛 in_sync 不无限重传）。
- [ ] 真机双端（换设备）存档接力可验证（**未验证**：等待用户云环境；Creator 内 Mock 链路已验证判定与容错逻辑）。

## V10-10 — 激励广告适配层与战斗复活

依赖：V10-01（次数冷却域可用 offerClaims/shop 计数模式，或新增广告计数域——随任务定案并记录）；微信联调依赖用户前置。

状态：实现完成，待验收（2026-10-05）。测试 352/352、tsc 零错误。**定案记录**：次数审计复用 offerClaims 计数模式（键 `ad_<placement>_<dayKey>` + 写入时清理旧日键，容量有界），不新增 v3 存档域；复活时序复用升级暂停语义（running→level_up_paused），**未改 BattleSession 状态转换表**。真机广告链路未验证（依赖用户配置正式 adUnitId）。

工作：`platform/AdAdapter` 接口（加载/展示/关闭/失败/奖励凭证）+ 微信激励视频实现 + 模拟实现（Creator/工具预览用，模拟发奖需明显标记）；**战斗复活**：失败结算前可选复活（每局次数/无敌时间/恢复比例/不可用场景全部配置化；失败原因页展示；不观看不影响正常退出与既得奖励，GAME_LOOP §6）；广告失败不扣次数、不自动连播；次数与冷却入存档审计。

实现摘要：`platform/AdAdapter.ts`（接口 + `adResultGrantsReward` 发奖凭证唯一点 + Mock 带【模拟广告】标记）；`platform/WechatAdAdapter.ts`（wx.createRewardedVideoAd 单例，onClose.isEnded=唯一发奖依据、中途关闭 closed_early、onError failed；展示失败重载一次不连播；无 adUnitId/无环境由工厂回退 Mock）；`AdConfig` schema（placements + revive：每局 1/每日 3/无敌 2s/回复 50%/禁用关清单）+ 校验；`battle/ReviveFlow.ts` 纯逻辑（四重门判定顺序：投放→每局→每日→不可用关卡；审计键写入与清理；恢复量计算）；`PlayerVitals.reviveWith`（纯类增量：解除死亡+回复+无敌；成就/星级不受影响——复活不发布 playerDied）；`PlayerAgent.deathReviveGate`（注入式死亡门，null=原行为）；`battle/ReviveController.ts` + `ui/ReviveOfferPanel.ts`（要约面板：观看/放弃；失败提示不发奖不扣次数；防重入）。

**Creator 装配步骤（用户执行）**：BattleScene——Systems 节点挂 `battle/ReviveController`（battleController ← Systems、playerAgent ← Player 节点）；Canvas 下新建全屏节点 `ReviveOfferPanel`（挂 `ui/ReviveOfferPanel`，content 子节点拖入槽）并拖入 ReviveController 的 revivePanel 槽。

**Creator 验收步骤（用户执行）**：

1. 正常死亡（如站桩被围）：战斗暂停弹出复活要约；点"放弃复活"→ 走原失败结算，无红色报错。
2. 点"观看广告复活"：控制台出现【模拟广告】日志 → 复活成功（血量回复约 50%、短暂无敌、战斗继续）；每局第二次死亡直接进失败结算（每局 1 次）。
3. 同日累计复活 3 次后再死亡：直接失败结算（每日 3 次审计生效，offerClaims 出现 `ad_ad_revive_<dayKey>`——注意键含 placementId 前缀 `ad_revive_<dayKey>`）。
4. 存档审计：复活后我的页最近事务/存档内 offerClaims 计数 +1；清档后审计与计数归零。

DoD：

- [x] 复活流程状态机（次数/冷却/恢复比例/无敌帧）有纯逻辑测试；广告失败/中途关闭路径不误发奖（凭证唯一点 + 不扣次数断言）。
- [x] 业务零 `wx.*`（wx 全局仅出现在 platform/ 适配层四个文件）；模拟实现发奖时日志明确标注"模拟"（UI 面板文案在真机广告位配置前均为模拟路径）。

## V10-11 — 结算广告加成与每日广告资源位

依赖：V10-10。

状态：实现完成，待验收（2026-10-05）。测试 363/363、tsc 零错误；模拟链路（Mock 广告）Creator 内可跑；真机广告依赖用户配置 adUnitId。

工作：结算页"广告奖励翻倍"可选激励位（仅 victory/defeat 全额翻倍或配置倍率，次数每日配置化）；每日广告资源位（每日有限次数领灵石，走 ECONOMY §6"每日有限资源"）；两处共用 AdAdapter 与次数/冷却配置，走经济事务发放并入审计；不与任务/成就重复投放冲突（CONFIG.md 产消复核追加一节）。

实现摘要：`AdConfig` 扩展 `settlementBonus`（placementId/rewardMultiplier=2/maxPerDay=3/results=[victory,defeat]——abort 不提供）与 `dailyResource`（res_lingshi 150/maxPerDay=2/cooldownMinutes=10）+ placements 增 `ad_settlement`、`ad_daily` + 校验（倍率>1、资源引用存在且正整数、results 合法子集）；`account/AdRewards.ts` 纯逻辑单文件（结算补差公式与 computeStageRewards 同一所有者：补差 = floor(基础×难度×比例×倍率) − 已发，defeat 基线含保留比例；applySettlementBonus 资源单事务 kind=ad_settlement_bonus → 账号经验 → 审计；claimDailyResource 单事务 kind=ad_daily_resource → 审计+冷却锚点 lastClaimAt；两处共用 offerClaims 审计模式并清理旧日键）；`platform/AdAdapterUi.ts`（三投放共享适配器单例，ReviveController 同步改用）；`BattleResultPanel` 动态"广告翻倍"按钮（三重门+本局已翻倍运行态；失败提示不扣次数可重试；发放后落盘）；`HomeHud` 动态每日资源入口（可选装配 dailyAdHost；剩余次数/冷却实时展示；ECONOMY §4 触发前明示"看广告领灵石+150"）。CONFIG.md 增补产消复核表（三投放日上限与产出归属，任务/成就无"看广告"条件零交叠）。

**Creator 装配（用户执行，仅 1 项）**：HomeScene 若要每日资源入口——在首页 UI 区建空节点 `DailyAdEntry`（如"开始战斗"按钮下方）拖入 HomeHud 的 `dailyAdHost` 槽；不装则入口不出现（结算页翻倍按钮为代码动态构建，无需装配）。

**Creator 验收（用户执行，模拟链路）**：① 打一局胜利 → 结算页出现"广告翻倍"按钮与剩余次数 → 点击（控制台【模拟广告】）→ 奖励行数值对应补差入账（资源栏可查）、按钮消失（本局已翻倍）；再来一局可用（每日 3 次）。② abort 退出（如有路径）无翻倍按钮。③ 首页点"看广告领灵石" → 入账 150、文案变剩余 1 次；10 分钟内再点提示冷却；当日第 2 次后入口只显示已领计数。④ 我的页事务审计出现 ad_settlement_bonus / ad_daily_resource 条目。

DoD：

- [x] 倍率/每日次数/冷却配置化并有测试；广告失败不扣次数；发放经经济事务幂等（同 txId 重放被经济层拒绝，审计只在发奖路径写入）。
- [x] CONFIG.md 更新产消表（广告位投放计入）；UI 触发前明示奖励内容（ECONOMY §4：按钮文案含具体资源与数量）。

## V10-12 — 埋点系统与关键漏斗接线

依赖：V10-07（上报通道；开发期 console 实现可先行）。

状态：实现完成，待验收（2026-10-05）。测试 369/369、tsc 零错误。**通道定案记录**：首发用 `wx.reportAnalytics`（微信小游戏自带分析通道，零自建服务）；Creator/无 wx 环境自动退 console 适配（走查友好）。云开发收集列为后续可选增强，不首发。

工作：`platform/AnalyticsAdapter` 接口 + 事件契约集中定义（新手漏斗/开局/结算/失败原因/Build 选择/资源产消快照/广告结果/购买结果——LIVEOPS §6）+ 微信上报实现（wx.reportAnalytics 或云开发收集，随任务定案记录）+ 批量与频率控制（低优先级事件合并、上限丢弃）、失败不阻断；开发期 console 实现便于走查；关键埋点接线（订阅成对解除）。

实现摘要：`platform/AnalyticsCore.ts` 纯逻辑叶子（`AnalyticsEventName` 13 事件集中契约——新手漏斗六步/battle_started/battle_finished/battle_defeat_reason/build_option_chosen/resource_snapshot/ad_result/purchase_result；payload 窄化为原始类型无 any；`AnalyticsBuffer` 环形缓冲容量 128/单批 16——满丢最旧计数 dropped、失败整批回填队首保序补投；critical 即时上报不缓冲）；`platform/AnalyticsChannel.ts`（console 调试 + wx.reportAnalytics 双通道，wx 集中该文件）；`platform/AnalyticsService.ts`（persist 组件，30s 定时 flush，trackAnalytics 全局空安全入口——未装配静默 no-op）。接线（全部事件驱动/事务内，无每帧路径）：新手漏斗六步（GuideEvents 唯一写入口内，Map 过滤同名子集）、开局（BattleController.start：stage/difficulty/等级境界/出战灵兽）、结算+失败原因+资源快照（AccountSystem.handleSettlement）、Build 选择（ProgressionSystem.chooseOption）、广告结果（AdAdapterUi 统一包装三投放单点）、购买结果（ShopPanel 商店 + RewardCenterPanel 礼包）。

**Creator 装配（用户执行，1 项）**：HomeScene 的 AccountRoot 挂 `platform/AnalyticsService`，勾选 persistent（与 AudioService 同节点）。

**Creator 验收（用户执行，console 通道）**：进战斗 → 控制台 30 秒内出现 `[Analytics] battle_started {...}`（或点结算后立即）；打完一局出现 battle_finished/battle_defeat_reason(败)/resource_snapshot 三条；三选一选择出 build_option_chosen；商店购买/礼包领取出 purchase_result；广告翻倍/每日灵石/复活出 ad_result。**注意：新手漏斗六步事件只在引导开启时触发**（当前 guide.enabled=false，恢复引导后可观察 guide_* 六条）。

DoD：

- [x] 事件契约类型集中且 payload 无 `any`（窄化 Record<string, string|number|boolean|null>）；批量/丢弃策略有纯逻辑测试（FIFO 分批、环形丢弃计数、失败回填保序、容量回填尾部丢弃、非法配置快速失败、契约窄化）。
- [x] 新手漏斗六步 + 开局/结算/失败埋点在模拟通道可观察（console 适配验证路径；漏斗六步事件随引导开关）；埋点失败不影响任何玩法路径（sendBatch 全 catch 返回 false、trackAnalytics 空安全 no-op、纯叶子模块零 cc 依赖不破 node 测试）。

## 布局对齐设计稿（V10-13 前置·布局定稿，2026-10-05）

用户确认按 `docs/art/` 四张 v2 设计稿（首页v2/修行v2/关卡/灵兽）对齐灰盒布局——纯表现层调整，不动任何规则/事务/配置语义；同时是 V10-13 SafeArea 的"布局稳定"前置。369/369 测试、tsc 零错误保持通过。

**映射表（设计稿元素 → 现有系统；冲突以产品文档为准）**：

| 设计稿元素 | 实现 | 说明 |
|---|---|---|
| 顶部玩家信息（等级/境界/经验） | HomeHud 顶部左（getAccountLevelProgress + describeRealmLine） | 头像/昵称不做（无昵称数据，访客身份不展示） |
| 顶部资源栏 金币+灵玉 | 灵石 + 灵玉（res_lingyu 已有） | 充值"+"不做（法币支付只评审） |
| 邮件图标 | 不做 | V0.8 阶段决策 6：不建邮件/补发队列 |
| 设置图标 | 不做独立图标 | 设置在"我的"页（V10-06） |
| 左列 签到/新手礼包/活动 | 快捷入口列：签到/礼包(奖励中心)/任务/成就 | "活动"挂件不重复放：当前唯一活动类型即签到；任务/成就从底栏迁入 |
| 主视觉+踏入秘境 CTA | 中部"踏入秘境"主按钮 → BattleScene | 原"开始战斗" |
| 功能卡片 图鉴/商店 | CTA 上方两卡，按解锁表显隐（stage2/stage3） | "仙盟·即将开放"卡不做假入口 |
| 底部五页签 首页/关卡/灵兽/修行/我的 | MainNav 五页签；首页页签=关闭面板回首页态 | 灵兽/修行按解锁表（通关第1关）显隐 |
| 修行页：境界名大字/修为进度条/突破 | RealmPanel 代码构建改版（进度条=持有/下一层消耗；圆满满条） | 境界风味文案（"灵气入体…"）不做（配置无此数据，不造内容） |
| 灵兽页：横排头像选择器+详情大卡 | BeastPanel 代码构建改版（选中高亮 + 四操作钮） | 原"上一只/下一只"浏览改为点选 |
| 关卡页：章节条+蜿蜒路径 | StagePanel 布局微调（◀ 章名 ▶ + 左右错位关卡行） | 逻辑（解锁链/难度/里程碑）不动 |

**装配变更（Creator，用户执行）**：

1. HomeScene·HomeHud 组件：槽位全面更换——旧槽（levelLabel/realmLabel/resourceLabels/startButton/realmButton/beastButton/realmPanel/beastPanel/stageButton/stagePanel）全部删除；新槽 6 个面板引用：taskPanel/achievementPanel/codexPanel/shopPanel/loginRewardPanel/rewardCenterPanel + 保留 dailyAdHost。节点置于 Canvas 下位置 (0,0)，删除旧的子节点（原标签/按钮）。
2. HomeScene·MainNav：槽位缩减为 4 个（stagePanel/realmPanel/beastPanel/profilePanel），其余面板槽删除。
3. RealmPanel / BeastPanel：改为代码构建——content 子节点下旧的 Label/Button 子节点全部删除（保留 content 本身），只留"根节点+content"两节点。
4. StagePanel / 其余面板：装配不变。
5. BattleScene：本次不动。

## V10-13 — SafeArea 与小屏适配

依赖：V10-02～V10-06 的 UI 面（导航/面板/结算/引导）；真机验证依赖用户前置。

工作：SafeArea 适配组件（刘海/圆角/状态栏/底部手势区内缩，Creator `sys.getSafeArea`）接入 HomeScene/BattleScene 全部 UI 根；关键按钮/资源/返回入口不落入危险区（UI_IA §3）；小屏窄屏重排检查清单与修复（触控热区 ≥ 视觉、关键文字不缩小）；微信开发者工具多机型分辨率矩阵过一遍。

DoD：

- [ ] 全部 UI 根节点经 SafeArea 组件内缩（走查无硬编码全屏坐标假设）；多机型模拟器矩阵无遮挡/裁切截图记录。
- [ ] 真机（用户前置）刘海机验证通过或如实标注未验证。

## V10-14 — 正式 UI/美术资源接入

依赖：V10-13（布局稳定后替换）；**美术资源由用户提供**。

状态：进行中（2026-10-07）。用户已确认采用 `docs/ART_ASSETS.md` 清单生成正式切图；P0-1 通用组件、P0-2 的 9 枚资源图标、P0-3 首页资源（背景、头像框、进入秘境按钮两态、四枚快捷入口、五组底部页签两态、导航底板、图鉴/商店卡片、每日广告底条）与 P0-4 战斗资源（玩家、四种基础怪物、三位 Boss、青霄剑、Boss 弹幕、经验灵珠、虚拟摇杆）已生成并置入 `game/assets/art/`。按用户 2026-10-06 决策，除 `bg_home.png` 外的 60 张切图均已从原始高分辨率结果重新导出为 2x RGBA PNG（例如飞剑 96×96、经验灵珠 64×64、主按钮 480×144），未采用 1x 位图放大；透明通道走查通过。当前 61 张原始 PNG 合计约 4.35MiB，压缩、图集和分包归 V10-15 包体门禁统一处理；尚未进行 Creator 九宫格装配与页面替换验收。

资源投放迁移（2026-10-06）：依更新后的 `ART_ASSETS.md`，P0 全量 61 张已同步复制到 `game/assets/resources/art/`，供 `ArtLoader` 运行时按名加载；保留原 `game/assets/art/` 副本以免破坏已有引用。P1 专属图已生成至 resources；五枚灵兽头像、槽底、关卡节点四态等已于 2026-10-07 接入代码，待 Creator 验收。

补图完成（2026-10-06）：P1 其余具名资源（灵兽槽两态、出战标记、关卡节点四态、章节箭头四态、修行背景/境界徽记/区块框、胜负标题、结算面板、复活按钮两态）及 P2 具名资源（命中特效、关卡路径、五页书法标题、活动入口、战斗地面、任务/商店面板）均已生成至 `game/assets/resources/art/`。对 P1/P2 的 35 个具名文件名已逐项检查，缺失为零；标题文字目视核验为“战斗胜利”“修行受挫”“首页”“关卡”“灵兽”“修行”“我的”。当前资源目录共 96 张 PNG；P1/P2 尚未进行 Creator 装配验收，所有压缩/图集/分包继续归 V10-15 门禁处理。

**资源清单已交付（2026-10-05）**：`docs/ART_ASSETS.md`——按 P0（通用组件/货币图标/首页/战斗实体，约 51 张）→ P1（修行/灵兽/关卡/结算专属）→ P2（可选）分级，含文件名/用途/建议尺寸/九宫格与两态规则。

**接入进展（2026-10-06 起，待 Creator 验收）**：P0 61 张已投放 `game/assets/resources/art/`（2x 口径；曾按 1x 交付导致飞剑发虚，已全量重出 2x）。管线：`ui/ArtLoader.ts`（resources 运行时按名加载 + 缓存 + **缺图回退灰盒不报错**（warn 一次）+ 幂等/复用已有 Sprite）；`PanelKit.createClickRegion` 支持 artId（普通/按下两态 + 九宫格 + 置灰），`addPanelBackdrop` 统一应用 panel_frame（全部面板自动受益）。覆盖面：首页（背景/头像框/踏入秘境/快捷图标/图鉴商店卡片/每日入口底条）+ 底部导航（tabbar 底 + 五页签两态）+ 战斗实体（玩家/四怪/三 Boss/飞剑/Boss 弹幕/经验珠，MonsterAgent 按 monsterId/Boss 同路径）+ 摇杆底盘手柄 + 修行/灵兽/关卡/复活/结算加成/返回与主次按钮。静态回归基线 369/369 测试；2026-10-07 灵兽头像/槽底、红点、关卡节点四态已接入代码并通过 tsc，待 Creator 验收。**剩余接入与验收**：任务/成就/图鉴/商店/签到/奖励中心/我的页内部按钮仍有灰盒；星级图标、境界徽记、结算胜负标题字与其余 P1/P2 专属资源仍待接入；布局、切图状态、交互与不同画布比例仍需 Creator 验收。压缩与体积优化（bg_home PNG→JPG、panel_frame 量化）归 V10-15 包体门禁统一处理。

**截图走查 P0 布局修正（2026-10-06，代码已改，待 Creator 验收）**：`BeastPanel` 操作区改为两列两行且按可见宽度限宽；`StagePanel` 难度按钮改为居中排列，领取/开战区上移避开底部导航，详情文案使用整行宽度并左对齐，关卡行不再同时绘制锁图形和锁字符；`HomeHud` 缩小头像框、把玩家信息右移避开头像装饰，并按可见高度将每日资源条定位至上方四分之一，同时把其命中区域收至底条尺寸；`PanelKit.addPanelBackdrop` 拆为独立暗色遮罩与装饰底图，降低底层首页内容的干扰。Creator 性能统计浮层为开发环境显示，不属于场景 UI；验收截图需关闭该覆盖层并单独记录性能数据。上述改动未改变规则或事务；Creator 3.8.8 严格 TypeScript 检查 `tsc -p tsconfig.json --noEmit` 通过；未运行测试。V10-14 仍未通过 Creator 页面/交互验收，需按 `work/IMPLEMENTATION_GAP_PRIORITIES.md` 逐页确认。

**编辑器/浏览器布局差异跟进（2026-10-06）**：收到同一首页在 Creator 与浏览器中的对照图后，为 `HomeHud` 与 `MainNav` 增加 `canvas-resize` 监听；尺寸变化时重排首页背景、顶部信息、主按钮、每日资源入口、快捷入口/卡片与底部导航，避免启动时读取一次屏幕尺寸后在预览器尺寸变化时沿用旧坐标。监听在 `onDisable` 对称解除。Creator 3.8.8 严格 TypeScript 检查通过；未执行 Creator/浏览器手工复验，V10-14 仍待用户验收。

**弹窗遮罩响应式修正（2026-10-07，待 Creator 验收）**：新增 `ui/PanelBackdrop.ts`，在 `canvas-resize` 时同步调整暗色遮罩与装饰底图的 `UITransform`/Graphics 绘制区域；由 `PanelKit.addPanelBackdrop` 装配，监听在 `onDisable` 解除。Creator 3.8.8 严格 TypeScript 检查通过，未运行测试及 Creator 手工复验。

**P1 状态资源接入（2026-10-07，待 Creator 验收）**：灵兽选择器接入五张灵兽头像与未选中槽底，红点替换为 `icon_reddot`；关卡列表接入普通/选中/锁定/已通关四态节点图，锁定原因保留在选中详情中，列表行不再重复绘制锁图与锁文字。资源来自 `game/assets/resources/art/`，不改变规则和点击范围。Creator 3.8.8 严格 TypeScript 检查通过；未运行测试及 Creator 手工复验。

**P1 结算标题资源接入（2026-10-07，待 Creator 验收）**：`BattleResultPanel` 为胜利/失败分别加载 `title_victory` / `title_defeat`，资源可用时显示对应书法图；资源加载失败或尚未完成时保留原文字标题，加载完成后自动切换。Creator 3.8.8 严格 TypeScript 检查通过；未运行测试及 Creator 手工复验。

**战斗页截图 P0 修正（2026-10-07，待 Creator 验收）**：根据用户运行截图修复五项阻断：BattleScene 相机黑色清场改为浅灰蓝可见底色；`BattleHud` 的血量/等级/计时与经验条按可见画布顶边定位，监听 `canvas-resize` 并在停用时解除；虚拟摇杆随画布定位至左下可触区；复活标题/说明使用屏幕中心锚点并限制宽度换行、两个操作按钮排列在其下方，打开时面板置顶；BattleStateDebugView 场景节点默认隐藏，避免内部状态字符串显示给玩家。此项解决黑屏/裁字/状态泄漏/横屏坐标带来的 P0；未加入或改变玩法规则。Creator 3.8.8 严格 TypeScript 检查 `tsc -p tsconfig.json --noEmit` 通过；未运行测试；Creator/浏览器运行截图尚未复验，故 V10-14/V10-10 仍待人工验收。

**竖屏战斗渲染 P0 跟进（2026-10-08，待 Creator 验收）**：运行截图指出此前调整后战斗主体仍不可见，且 Creator 报 `Can't add component 'cc.Sprite' ... conflicts with ... cc.Label`。根因是 3.8.8 的 Label 与 Sprite 同属互斥 UIRenderer：摇杆底盘/手柄及玩家、怪物灰盒节点含 Label，通用 `ArtLoader` 直接加 Sprite 会产生未处理 Promise rejection。现改为 Label 节点创建独立 `ArtSprite_<id>` 子节点承载切图并停用占位 Label，异步异常会记录而非成为未处理 rejection；BattleScene 正交相机视野高度从 464 调至竖屏基准 1624（此前怪物出生半径 600～850 全在可视场外）；HUD 端点标签改为边缘锚点以免 HP 裁字。严格 TypeScript 检查通过；未运行测试，仍需 Creator 预览确认角色/怪物实际绘制与摇杆触控。

工作：美术接入管线（图集/自动图集配置、九宫格、图片压缩参数、prefab 精灵替换灰盒占位、品质色/货币图标全局一致——UI_IA §4）；按页面分批替换（首页/导航/面板/战斗实体/结算）；替换不改变任何规则与坐标语义（UI 只换皮）；验收对照表（页面 × 资源 × 状态）。

DoD：

- [ ] 灰盒占位全部可替换且替换后布局/交互不回归（对照截图记录）；缺失资源回退占位不报错。
- [ ] 图集与内存占用进 V10-15 包体门禁复核。

## V10-15 — 性能与包体门禁

依赖：V10-14（包体受美术影响）；真机依赖用户前置。

工作：包体预算与分包（主包 ≤4MB：配置/代码/UI 基础资源；战斗美术/音频按需分包或远程资源，微信分包能力评估——ARCHITECTURE 微信包体节）；加载时间测量（首屏可玩时间）；真机性能门禁（中档安卓 30FPS、内存、DrawCall、GC——复用 Phase 0 Profiler 方法）；不达标项优化并记录（含音效并发、红点、粒度）；门禁数据写入 CONFIG.md/MILESTONES。

DoD：

- [ ] 主包体积实测 ≤4MB、分包清单与加载时间记录；真机 30FPS 一局 10 分钟无持续增长实体。
- [ ] 未达标项逐条记录优化措施与复测数据；无法执行项（无真机）如实标注。

## V10-16 — 合规接入与 V1.0 发布验收

依赖：V10-01～V10-15。

工作：微信合规流（隐私授权弹窗 `wx.requirePrivacyAuthorize` 接入、用户隐私保护指引配置、协议版本字段落存档设置域、拒绝授权的降级路径）；《商业化评审》文档（法币支付/退款/补单/未成年人/价格本地化——ECONOMY §5，只评审不实现）；发布验收清单（全链路：登录 → 引导 → 解锁 → 选关 → 战斗 → 复活/广告 → 培养领取 → 云存档接力 → 埋点可见 → 合规弹窗）；微信开发者工具回归 + 真机回归；MILESTONES/CONFIG.md/ARCHITECTURE 收口更新；T14 遗留跟踪并入本阶段真机验收。

DoD：

- [ ] 全量测试/类型检查通过；发布验收清单逐项执行（用户），未执行项如实标注。
- [ ] 隐私授权拒绝后游戏可玩（降级无云存档/广告受限路径明确）；商业化评审文档交付。

## 当前状态

- 进行中：V10-14 正式 UI/美术资源接入（代码修正与资源接入持续进行，Creator 页面/交互验收未完成）。
- 实现完成，待验收：V10-01～V10-06（存档 v3 / 功能解锁与导航 / 引导数据层 / 引导表现层 / 音效系统 / 设置页；均 2026-10-05，各任务含 Creator 装配/验收步骤）。测试 327/327、tsc 零错误；Creator 装配与验收由用户按任务记录执行（引导闭环 V10-04 为最大验收项）。
- 实现完成，待验收（追加）：V10-07 微信登录、V10-08 服务器时间（云函数已交付 `cloudfunctions/login|time/`）、V10-09 云存档同步（云数据库集合配置步骤见任务记录；真机云链路均未验证，依赖用户部署与云环境）。
- 实现完成，待验收（追加）：V10-10 激励广告适配层与战斗复活（模拟链路完整可跑；真机广告依赖用户配置 adUnitId）。
- **用户决策（2026-10-05，验收轮反馈）**：① 测试期**关闭新手引导**（`guide.enabled: false`——脚本/状态机/表现层保留，改回 true 整体恢复；首页不再自动进战斗）；② **音效整体后置**（四组通道 `enabled: false` 零播放，实现保留，恢复改 enabled 即可）——理由：当前阶段玩家只关心 UI/玩法，引导与音效非前置。已落地为配置单点开关并有测试（355/355）。
- 实现完成，待验收（追加）：V10-11 结算广告加成与每日广告资源位、V10-12 埋点系统与关键漏斗接线（通道定案 wx.reportAnalytics；369/369）。
- 布局对齐设计稿（2026-10-05 追加）：四页灰盒布局已按 v2 稿对齐（映射表与装配变更见上节）；等待用户按新装配步骤重配 HomeScene 并预览确认，确认后即为 V10-13 的布局基线。
- **换一批广告位（2026-10-06 追加，用户定案）**：三选一面板新增"换一批（剩 N/2）"激励位（`ad_reroll`）——重抽当前候选（同池同规则）、每局 2 次（运行态）、广告失败不扣次数、每日审计入 offerClaims。实现：`ProgressionService.rerollCurrentChoice`（纯逻辑）+ `ProgressionSystem.handleRerollRequested`（编排）+ LevelUpPanel 动态按钮。测试 369/369 保持。
- **V10-17 构筑扩展（2026-10-06 用户确认立项，排在 V10-14 换皮验收后执行）**：对齐竞品模式——法宝/道具**每局槽位上限**（N 法宝 + N 道具）+ **随局内等级逐步解锁**（非开局全量池）。设计定案：① `GongfaConfig`/`TreasureConfig`/`UpgradeOptionConfig` 增 `unlockAtBattleLevel`（局内战斗等级阈值，1 = 初始可用；此处"人物升级"= 局内等级，非账号玩家等级）；② 候选池过滤双条件——局内等级未达解锁阈值的不进候选、该类槽位已满时"新种类"不进候选（**已持有的仍可升级**）；③ "换一批"（V10-11）重抽同规则；④ 槽位上限配置化（`BattleLoadoutLimitsConfig`：法宝槽/道具槽种数）；⑤ 锁定项第一版仅过滤不展示剪影。涉及已验证的 ProgressionService 候选生成逻辑（V01-11），需完整测试：解锁边界、槽位满、重抽同规则、与 maxStacks 叠加语义。
- 执行顺序（2026-10-06 用户确认）：**V10-14 换皮及 P0 布局验收（用户）→ V10-17 构筑扩展（独立一轮+完整测试）→ V10-13 SafeArea → V10-15/16**。
- 待办：V10-13 ～ V10-17（V10-13 SafeArea 依赖布局定稿验收 + 多机型矩阵；V10-14 剩余资源接入与 Creator 验收；V10-15/16 依赖真机与用户前置）。
- **用户新增战斗待办（2026-10-08；未实现，完整优先级见 `work/IMPLEMENTATION_GAP_PRIORITIES.md`）**：P0 排查经验物上限后击杀掉落疑似丢失（必须符合 `CONFIG.md` 合并并守恒约定）、经验条未满提前升级、显示玩家/Boss 血量与第一/二/三波和 Boss 来袭提示；P1 调整等级/经验条位置（用户建议右上）、增加经验物靠近玩家后的吸附表现；后续构筑候选增加暂名“纳灵袋”，逐级扩大经验吸收范围。此记录不表示已排入 V10-17 的定案范围；开工前先对齐 `COMBAT.md`/`CONFIG.md` 与任务验收项，且按既定顺序完成 V10-14 验收后再进入构筑工作。
- **P1/P2 全量切图接线（2026-10-08，实现完成待 Creator 验收）**：用户将全量 96 张切图投放 `game/assets/resources/art/`（P0 61 在 Bundle `art` 走首选通道，其余经 resources 回退通道命中，无重试延迟）。本轮：审查用户已接线三处（Beast 头像/槽位、Stage 四态/箭头、Result 胜负标题字带文字回退——接法正确）；补接 icon_deployed 出战标记（替换文字后缀）、slot_beast_selected 选中槽、btn_revive 复活按钮、icon_star 三星行、title_calli ×5 书法标题（Home/Realm/Beast/Stage/Profile）、panel_settlement/panel_shop/panel_task 竖版底图（PanelKit `addPanelBackdrop` 增固定尺寸参数 + PanelBackdrop 支持固定框尺寸）、bg_realm 整页背景（新增 `addPageBackdrop`）+ realm_emblem + section_frame + 修为条 bar_bg/bar_fill、bg_battle 平铺背景（ArtLoader 增 `tiled` 选项，Canvas 首子节点）、战斗经验条换图、关卡页 deco_path 与按钮两态化。灵兽槽位/头像/关卡节点图标按切图原始比例调整尺寸；胜负标题字固定 360×120 防拉伸变形。未接线：fx_hit（战斗表现批）、icon_quick_activity（无入口）。tsc 通过、测试 369/369。接线明细见 `docs/ART_ASSETS.md` 2026-10-08 节。
- **验收排障记录（2026-10-08，代码/场景已改，待 Creator 复验）**：① "踏入秘境后战斗空白只剩 HUD 文字"——根因是 `BattleScene.scene` 的 `World` 节点被置为 `_active: false`（场景状态被误改，玩家/PoolRoot 整棵子树不渲染；无代码管理该标志），已直接改回 true；② "商店打不开"——静态排查确认场景装配（ShopPanel.content/HomeHud.shopPanel 槽）、解锁表绑定（`unlock_shop`）、show() 链路（互斥注册表/置顶）全部正常，最可能是解锁门控：商店卡片需通关 `stage_qingyun_03`（图鉴为 `stage_qingyun_02`，V10-05"章节内推进"定案）才出现；已在 HomeHud 增加被隐藏入口的一次性控制台提示（`[HomeHud] 入口"shop"当前按解锁表隐藏（条件 …）`）便于验收判断；③ `BattleHud` HP 上限取运行态（含境界 maxHp 加成，避免突破后 25/20 假溢出）；④ 踏入秘境按钮按切图原始比例（300×84）+ 深褐 30 号字（书法字体随资源接入）。tsc 通过、测试 369/369。
- 用户前置条件：见"用户前置条件"表——正式 AppID、云开发环境、美术/音效资源、真机为平台联调/门禁类任务的硬前置；适配层模拟实现允许先行开发。
- 已知边界（记录）：法币支付只评审不实现；插屏默认关闭；无自建服务器（云开发承担，可替换适配层）；美术资源用户提供；倍速归 V1.1。
