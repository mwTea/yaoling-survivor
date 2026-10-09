# ART_ASSETS — 正式美术切图清单（V10-14 美术接入用）

> 交付方式：**PNG、透明背景**（全屏背景图不需要透明），按本清单**文件名**命名，放进 `game/assets/art/` 目录（平铺即可，不要建子目录打包分组）。
> 我收到后按清单逐个接入：布局/规则/坐标全部不动，只把灰盒色块替换成图片（"只换皮"）。
>
> **投放位置（2026-10-06 更新）**：`game/assets/resources/art/`（resources 目录支持运行时按名加载）。**P0 已全部到位（61 张，2x 口径）**，换皮管线已接入（见 `CODEX_TASKS_V10` V10-14 记录）。
>
> **通用规则**：
> - 命名全小写 `snake_case`；按钮两态后缀 `_n`（普通）/ `_p`（按下），只出一态也可以（我按下态复用普通态）。
> - 带 `九宫格` 标注的图请留出可拉伸边距（内容区居中、四边各留 8~16px 纯色/图案边），用于任意尺寸拉伸不糊。
> - **出图倍率（2026-10-06 修订，重要）**：清单中标注的尺寸均为 **1x 逻辑尺寸**；除 `bg_*` 全屏背景按 1x 给之外，**其余所有切图一律按 2 倍尺寸导出**（文件名不变）——手机屏幕是 2~3x 物理像素，1x 小图上机必发虚（实例：飞剑 48×48 糊，重出 96×96 后恢复锐利）。接入时我按逻辑尺寸显示，不影响布局。
> - **体积不用担心，也不要自己压缩**：按正常质量出原图。量化/JPG 转换/图集合并由我接入时统一处理（平涂 UI 量化近乎无损），包体用 V10-15 实测门禁兜底。预算分配：主包 UI 切图合计 ≤2MB（其中全屏背景我会转 JPG）；P0-4 战斗实体合计另计 ≤2MB（进战斗分包，不占主包）。
> - 全屏背景（`bg_*.png`）不透明，其余一律透明底 PNG。
> - 不需要管 @2x 后缀、不需要建图集——接入时我用 Creator 自动图集配置。

## 优先级说明

- **P0（第一批，最急）**：通用组件 + 首页 + 战斗实体——没有这批，主界面和战斗还是灰盒。
- **P1（第二批）**：修行/灵兽/关卡/结算的专属元素。
- **P2（可选项）**：特效、装饰、书法标题字、各功能面板专属底图——不给就用通用样式，不阻塞。

---

## P0-1 通用组件（14 张）

| 文件名 | 用途 | 建议尺寸 | 备注 |
|---|---|---|---|
| `btn_primary_n.png` / `btn_primary_p.png` | 主按钮（确认/开战/领取） | 240×72，九宫格 | 金/绿主色调 |
| `btn_secondary_n.png` / `btn_secondary_p.png` | 次按钮（切换/取消） | 200×64，九宫格 | 青灰调 |
| `btn_back_n.png` / `btn_back_p.png` | 面板返回箭头 | 88×88 | 圆形描边箭头 |
| `btn_close_n.png` / `btn_close_p.png` | 关闭 × | 64×64 | |
| `panel_frame.png` | 全屏面板底框 | 640×900，九宫格 | 半透明墨绿底+描边 |
| `card_frame.png` | 小卡片底框 | 220×90，九宫格 | |
| `bar_bg.png` | 进度条底 | 400×20，九宫格（横向拉伸） | |
| `bar_fill.png` | 进度条填充 | 400×14，九宫格（横向拉伸） | 金铜渐变 |
| `icon_star_filled.png` / `icon_star_empty.png` | 星级（满/空） | 40×40 | |
| `icon_lock.png` | 未解锁锁图标 | 48×48 | |
| `icon_reddot.png` | 红点 | 28×28 | |
| `frame_selected.png` | 选中描边框 | 104×72，九宫格 | 金色描边，灵兽/关卡选择高亮用 |

## P0-2 货币与资源图标（8 张）

| 文件名 | 用途 | 建议尺寸 |
|---|---|---|
| `icon_res_lingshi.png` | 灵石 | 40×40 |
| `icon_res_lingyu.png` | 灵玉 | 40×40 |
| `icon_res_xiuwei.png` | 修为 | 40×40 |
| `icon_res_yaodan.png` | 妖丹 | 40×40 |
| `icon_res_lingpo_qinglong.png` | 青龙灵魄 | 40×40 |
| `icon_res_lingpo_baihu.png` | 白虎灵魄 | 40×40 |
| `icon_res_lingpo_zhuque.png` | 朱雀灵魄 | 40×40 |
| `icon_res_lingpo_xuanwu.png` / `icon_res_lingpo_jiuweihu.png` | 玄武/九尾狐灵魄 | 40×40 |

## P0-3 首页（16 张）

| 文件名 | 用途 | 建议尺寸 | 备注 |
|---|---|---|---|
| `bg_home.png` | 首页全屏背景（山水楼阁主视觉） | 750×1624 | 不透明；中下部留出 CTA 区域视觉重心 |
| `icon_avatar_frame.png` | 顶部玩家头像框 | 96×96 | 圆形描边框（头像内先用色块占位） |
| `btn_enter_n.png` / `btn_enter_p.png` | "踏入秘境"主按钮 | 300×84 | 金色描边宽扁按钮 |
| `icon_quick_sign.png` | 快捷入口·签到 | 72×72 | 左列竖排图标 |
| `icon_quick_gift.png` | 快捷入口·礼包 | 72×72 | |
| `icon_quick_task.png` | 快捷入口·任务 | 72×72 | |
| `icon_quick_achieve.png` | 快捷入口·成就 | 72×72 | |
| `tab_home_n.png` / `tab_home_p.png` | 底部页签·首页 | 96×72 | `_p` 为选中态（亮色） |
| `tab_stage_n.png` / `tab_stage_p.png` | 底部页签·关卡 | 96×72 | |
| `tab_beast_n.png` / `tab_beast_p.png` | 底部页签·灵兽 | 96×72 | |
| `tab_realm_n.png` / `tab_realm_p.png` | 底部页签·修行 | 96×72 | |
| `tab_profile_n.png` / `tab_profile_p.png` | 底部页签·我的 | 96×72 | |
| `tabbar_bg.png` | 底部导航条底 | 750×120，九宫格（横向拉伸） | 半透明黑底 |
| `card_codex.png` | 图鉴卡片图 | 220×90 | |
| `card_shop.png` | 商店卡片图 | 220×90 | |
| `daily_ad_bg.png` | 每日广告入口底条（可选） | 320×52 | 不给就用次按钮样式 |

## P0-4 战斗实体与战斗 UI（13 张）

| 文件名 | 用途 | 建议尺寸 | 备注 |
|---|---|---|---|
| `entity_player.png` | 玩家（修行者） | 96×96 | 单帧即可；有序列帧/骨骼更好（先给单帧） |
| `monster_basic.png` | 妖卒 | 80×80 | |
| `monster_yaonu.png` | 妖奴 | 80×80 | |
| `monster_duzhu.png` | 毒蛛 | 80×80 | |
| `monster_shiren.png` | 石人 | 80×80 | |
| `boss_shiyao_general.png` | 噬妖妖将 | 160×160 | |
| `boss_fuchao_shuyao.png` | 腐潮树妖 | 160×160 | |
| `boss_shiyao_lord.png` | 噬妖之主 | 160×160 | |
| `proj_qingxiao_sword.png` | 青霄剑飞剑 | 48×48 | |
| `proj_boss_bullet.png` | Boss 弹幕子弹 | 28×28 | |
| `xp_gem.png` | 经验灵珠 | 32×32 | |
| `joystick_base.png` | 摇杆底盘 | 192×192 | 不透明度自定 |
| `joystick_stick.png` | 摇杆手柄 | 96×96 | |

---

## P1/P2 全量交付与接线状态（2026-10-08 更新）

用户已把全量 96 张切图（P0 61 + P1 15 + P2 20）投放至 `game/assets/resources/art/`（resources 通道，ArtLoader 双通道自动命中；P0 另有 Bundle `art` 副本走首选通道）。本轮接线完成：

- **灵兽页**：头像 ×5（52×52）、`slot_beast`（104×72 原比例）、`slot_beast_selected`（选中槽高亮）、`icon_deployed`（出战标记，替换"（出战中）"文字）、`title_calli_beast`。
- **关卡页**：`node_stage_n/selected/locked/cleared` 四态（44×44）、`btn_arrow_left/right`（章节切换）、`deco_path`（蜿蜒路径装饰，垫行下层）、`title_calli_stage`；难度/领取按钮换 `btn_secondary` 两态。
- **修行页**：`bg_realm` 整页背景（新增 `addPageBackdrop`）、`realm_emblem` 徽记、`section_frame` 分区框（突破/法器卡）、`bar_bg`/`bar_fill` 修为条切图（Graphics 回退保留）、`title_calli_realm`。
- **结算页**：`title_victory`/`title_defeat`（360×120 原比例，用户接线+本轮定尺寸）、`panel_settlement` 竖版底图（640×760）、`icon_star_filled/empty` 大三星行（胜利显示，统计行文字星级保留作回退）。
- **复活**：`btn_revive_n/p`（260×60，图无字、保留按钮文字）。
- **商店/任务**：`panel_shop`/`panel_task` 竖版底图（640×900，`addPanelBackdrop` 支持固定尺寸，遮罩仍全屏）。
- **首页**：`title_calli_home`（顶部居中、顶部信息行之下）。
- **我的**：`title_calli_profile`。
- **战斗**：`bg_battle` 平铺背景（`tiled` 选项；Canvas 首子节点垫底，随画布重排）、经验条 `bar_bg`/`bar_fill`（`barSprite` 直挂帧）。

**仍未接线（后续批次）**：`fx_hit`（战斗命中特效，属战斗表现批）、`icon_quick_activity`（活动挂件位图标，当前无独立活动入口）。**体积提示（V10-15 处理）**：`bg_realm` 2.2MB、`panel_shop`/`panel_task` 各 2.15MB、`panel_settlement` 1.5MB、`bg_home` 0.6MB——压缩/量化在 V10-15 统一做，不影响本轮验收。`bg_battle`（512×512）按 TILED 原尺寸平铺，视觉密度如不合适在 V10-15 调整。

## P1 批次资源与接入状态（2026-10-06 更新）

以下 P1 资源已生成并投放到 `game/assets/resources/art/`，无需用户补交；接入按 V10-14 页面验收逐项进行：

| 文件名 | 用途 | 建议尺寸（2x） |
|---|---|---|
| `avatar_beast_qinglong/baihu/zhuque/xuanwu/jiuweihu.png` | 灵兽头像 ×5（横排选择器） | 192×192 |
| `node_stage_n/selected/locked/cleared.png` | 关卡节点四态 | 192/216/192/192 |
| `title_victory.png` / `title_defeat.png` | 结算胜负标题字 | 720×240 |
| `slot_beast.png` / `slot_beast_selected.png` | 灵兽槽底两态（可选，已有 frame_selected 兜底） | 208×144 |
| `icon_deployed.png` | 出战中标记 | 128×64 |
| `btn_arrow_left_n/p.png`、`btn_arrow_right_n/p.png` | 关卡章节切换箭头（**当前缺失已确认回退灰盒**） | 104×104 |
| `btn_revive_n/p.png` | 复活按钮（可选） | 520×120 |

已接入：经验珠缩小为 20×20 小光点（用户定案）、灵兽槽/关卡行选中金框（`frame_selected`）、锁定行锁图标（`icon_lock`）；2026-10-07 新增灵兽头像/槽底、关卡节点四态、首页红点接入，仍待 Creator 验收。

## P1-1 修行页（3 张）

| 文件名 | 用途 | 建议尺寸 | 备注 |
|---|---|---|---|
| `bg_realm.png` | 修行页背景（可复用 panel_frame 则不给） | 750×1624 | |
| `realm_emblem.png` | 境界徽记（境界名旁装饰） | 120×120 | |
| `section_frame.png` | 区块卡片底（突破/法器区） | 630×180，九宫格 | 不给则复用 card_frame |

## P1-2 灵兽页（8 张）

| 文件名 | 用途 | 建议尺寸 |
|---|---|---|
| `avatar_beast_qinglong.png` | 青龙头像 | 96×96 |
| `avatar_beast_baihu.png` | 白虎头像 | 96×96 |
| `avatar_beast_zhuque.png` | 朱雀头像 | 96×96 |
| `avatar_beast_xuanwu.png` | 玄武头像 | 96×96 |
| `avatar_beast_jiuweihu.png` | 九尾狐头像 | 96×96 |
| `slot_beast.png` | 头像槽底（未选中） | 104×72 |
| `slot_beast_selected.png` | 头像槽底（选中，金描边） | 104×72 |
| `icon_deployed.png` | 出战中标记 | 64×32 |

## P1-3 关卡页（6 张）

| 文件名 | 用途 | 建议尺寸 |
|---|---|---|
| `node_stage_n.png` | 关卡节点（普通） | 96×96 |
| `node_stage_selected.png` | 关卡节点（选中） | 108×108 |
| `node_stage_locked.png` | 关卡节点（锁定） | 96×96 |
| `node_stage_cleared.png` | 关卡节点（已通关） | 96×96 |
| `btn_arrow_left_n.png` / `btn_arrow_left_p.png` | 章节切换◀ | 52×52 |
| `btn_arrow_right_n.png` / `btn_arrow_right_p.png` | 章节切换▶ | 52×52 |

## P1-4 结算页（4 张）

| 文件名 | 用途 | 建议尺寸 | 备注 |
|---|---|---|---|
| `title_victory.png` | 胜利标题字 | 360×120 | 书法"战斗胜利" |
| `title_defeat.png` | 失败标题字 | 360×120 | 书法"修行受挫" |
| `panel_settlement.png` | 结算面板底 | 640×760，九宫格 | 不给则复用 panel_frame |
| `btn_revive_n.png` / `btn_revive_p.png` | 复活要约按钮（可选） | 260×60 | 不给则复用主按钮 |

---

## P2 可选项（不给不阻塞）

| 文件名 | 用途 | 建议尺寸 |
|---|---|---|
| `fx_hit.png` | 命中特效帧 | 64×64 |
| `deco_path.png` | 关卡路径装饰（石阶/云纹） | 120×480 |
| `title_calli_home.png` 等 | 各页书法标题字（首页/关卡/灵兽/修行/我的） | 240×90 |
| `icon_quick_activity.png` | 活动挂件位图标（预留） | 72×72 |
| `bg_battle.png` | 战斗场景地面/氛围图 | 512×512 可平铺 |
| `panel_task.png` / `panel_shop.png` 等 | 各功能面板专属底图 | 640×900，九宫格 |

## 字体（可选）

- 标题书法字体文件（`.ttf`/`.otf`，含商用授权确认）→ 文件名 `font_title.ttf`；不提供则标题继续用系统字体。

## 不在本清单（后置项）

- **音频**（BGM/音效）：按 2026-10-05 决策整体后置，恢复时另出清单。
- **插画整图/邮件/充值/仙盟** 相关素材：对应功能不在 V1.0 范围。

---

**交付节奏建议**：P0 共约 51 张（含两态），先给 P0 我即可完成首页+战斗的换皮并出效果；P1 随后补齐；P2 有则给。文件名务必与清单一字不差（含 `_n`/`_p` 后缀），放错名字我也能对上但会慢一些。

**画质/体积约定**：你给正常质量原图（小图可 2x），压缩全部由我接入时处理；主包 UI ≤2MB + 战斗分包 ≤2MB，超了我会先调整压缩参数再考虑拆分，不会用降分辨率的手段糊弄。
