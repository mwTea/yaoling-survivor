# 妖灵修行录（yaoling-survivor）

基于 Cocos Creator 3.x + TypeScript 的微信小游戏项目。完整方向是竖屏自动战斗、生存构筑与局外修仙养成；当前代码仍处于 Phase 0 核心战斗技术验证。

## 当前状态

- V0.2 产品文档体系已建立；“设计到 ≠ 当前开发”。
- 本机已确认：Node.js `v22.22.1`、npm `11.12.1`、Git `2.39.3`。
- Cocos Creator `3.8.8` 工程已生成在 `game/`；资源目录骨架已建立。
- T00～T13 已完成；T14 微信开发者工具模拟器通过，真机验证待正式 AppID 或安卓设备。
- Phase 0 不包含后端、局外成长、正式内容或商业化；后续范围见 `docs/ROADMAP.md`。

## Creator 工程约定

使用固定版本 Cocos Creator `3.8.8` 打开 `game/`。不要重新生成或嵌套工程；`library/`、`temp/`、`build/` 等产物不得纳入版本控制。

## 文档入口

- `AGENTS.md`：所有 Codex 任务必须遵守的仓库规则。
- `docs/PRODUCT.md`：产品定位、核心体验、局内/局外边界和文档地图。
- `docs/GAME_LOOP.md`、`PROGRESSION.md`、`COMBAT.md`、`CONTENT.md`、`ECONOMY.md`：循环、成长、战斗、内容与经济。
- `docs/RETENTION.md`、`UI_IA.md`、`LIVEOPS.md`：留存、信息架构与运营平台规则。
- `docs/ROADMAP.md`：Phase 0 到 V1.2+ 的范围与 Future。
- `docs/ARCHITECTURE.md`、`CONFIG.md`：架构和配置边界；`BATTLE.md` 为 Phase 0 历史兼容索引。
- `docs/CODE_STYLE.md`：Cocos/TypeScript 编码约定。
- `docs/MILESTONES.md`：阶段拆分与验收标准。
- `docs/CODEX_TASKS.md`：按依赖顺序排列的第一批小任务。

## 开发原则

每次只领取当前阶段明确建立的一个任务，并按 Definition of Done 验收。Phase 0 的 T00～T14 不得被后续需求回填扩大。任何实现都应保持配置驱动、高频实体池化、事件契约有类型、战斗时间单点控制，以及微信小游戏兼容。
