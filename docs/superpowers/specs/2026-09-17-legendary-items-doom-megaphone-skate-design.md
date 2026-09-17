# 设计：三个新传说道具（天灾指定 / 大喇叭 / 溜冰鞋）

- 日期：2026-09-17
- 状态：已获用户批准（口头："好的，按这个方案来"）
- 前置：传说宝箱机制已上线（见 [2026-09-17-disaster-rebalance-legendary-box-design.md](2026-09-17-disaster-rebalance-legendary-box-design.md)），本次在其传说池上扩展

## 1. 道具定义

| 道具 | 图标/名称 | 使用形态 | 效果 |
|---|---|---|---|
| 天灾指定 | 🎯 | 选目标（复用混乱卡 pendingItem 模式） | 标记 1 名对手 `v.doomBy = 使用者color`，**常驻直至命中**：下次暴雷其所在格必被劈中（眩晕2）；下次泥石流其所在列必被选中。其它天灾不影响标记；命中后清除；新标记覆盖旧标记；被标者离场则标记失效 |
| 大喇叭 | 📢 | 即时（同大爆炸模式，点击即生效） | 以使用者为中心**曼哈顿距离≤4** 的菱形范围：范围内墙壁全碎（不分敌我，同大爆炸）；每个范围内**敌方**棋子沿"使用者→该棋子"的射线方向被推到棋盘边缘格（落点被占或为王座则沿反方向回收至最近可站格）；使用者自己不受影响 |
| 溜冰鞋 | ⛸️ | 自身 buff（点击激活） | 激活后 `p.skate=1`，**下一次移动**变为冲刺：沿移动方向逐格滑行至棋盘边缘，遇墙/塌陷格/其它棋子拦停于前一格；**逐格触发**：踩中陷阱被弹回出生点则冲刺终止、宝箱照常拾取、滑到王座直接获胜 |

### 传说池分配
- 传说宝箱开箱 10% 掷传说道具不变；掷中后 4 道具（大爆炸/天灾指定/大喇叭/溜冰鞋）**等权 1/4**（新函数 `rollLegendaryKind()`，走 `rnd()` 种子随机）

### 数值与归属细则
- 大喇叭碎墙：横墙 `(x,y)` 覆盖格 `(x,y)/(x+1,y)` 取较近者计距，竖墙同理；≤4 即碎
- 大喇叭弹飞：被弹者 `stHit(p,'disaster')`，发动者 `stHit(p,'items')`（沿用大爆炸先例）
- 溜冰鞋冲刺每格走现有 `doMove`：步数统计（steps）、回合数、技能冷却递减均按实际格数累计；buff 一次性，冲刺开始即消耗
- 天灾指定：暴雷格列表强制并入被标者**当时**所在格；泥石流 `picked` 列强制并入其**当时**所在列（保持原列数，替换一个未被选中的随机列，不额外消耗 rnd，不破坏种子随机流）

## 2. 实现锚点（最小侵入，与上轮模式一致）

- **ITEMS** 新增 3 条 `legendary:true`；**pickupAt** 传说分支改调 `rollLegendaryKind()`
- **useDoomItem(p, v)**：仿 `useConfusionItem`（校验目标→消耗→置状态→fx/toast/日志→netEv）
- **useMegaphoneItem(p)**：仿 `useBangItem`（消耗→碎墙 removeWall+smash fx→逐敌 teleport 弹飞→quake 震动波 fx→日志）
- **skateDash(p, dir)**：`applyIntent` move 分支单点扩展——`p.skate` 时沿方向逐格调 `doMove`；每步后若 `p.cell` 与预期格不符（被陷阱/暴风改写）或 `winner` 产生则终止
- **disasterThunder / disasterMudflow**：各加 2-4 行 doom 命中强制逻辑（host 权威端执行，结果随天灾事件+快照同步）
- **三链路**：`clickInvSlot`（doom 走 pendingItem 选目标、megaphone/skate 即时）、`hostApplyAction`（itemuse doom/megaphone/skate 三分支）、`aiUseItems`（doom→标记领跑者 ahead[0]；megaphone→4格内墙≥2或敌≥1；skate→四方向模拟冲刺终点 BFS 距王座 < 当前则激活）
- **快照**：`serializeState` players 增 `dm:p.doomBy||null, sk8:p.skate?1:0`；`applySnapshot` 对应恢复（doomBy 含 color，用于各端渲染与后续天灾判定兜底）
- **渲染**：棋子头顶徽标（复用眩晕指示机制）：被标者 🎯、skate 激活者 ⛸️；大喇叭震动波 fx（同心圆扩散环）；道具槽金框/传说箱彩虹渲染对新道具自动生效（`legendary:true` 驱动）
- **帮助文案**：itemLine 传说行扩为 4 道具说明

## 3. 边界情况

| 场景 | 行为 |
|---|---|
| doom 标记的玩家已离场 | 天灾判定时跳过（标记作废） |
| 大喇叭范围内无墙无敌人 | 仍可使用（空放），日志照常 |
| 弹飞落点回收仍无格（极端满员） | 保持原地（该棋子弹飞落空） |
| skate 冲刺第一步就被拦 | 等于原地使用失败？——仍消耗 buff 与道具但停在原地（与"冲不出去"语义一致，AI 模拟会避免这种情况） |
| skate + confused 同时 | 冲刺方向 = 混乱镜像后的实际方向（doMove 内部已处理镜像，skateDash 用 doMove 后的实际位移续算方向） |
| 传说箱开出 skate/doom/megaphone 时道具箱满 | 宝箱留原地（既有 early-return 覆盖） |

## 4. 验证方案

- 新 `verify_legendary_items.py`：传说池 4 等权（400 采样）；doom→暴雷必中+眩晕、泥石流列必含、其它天灾不消耗标记、命中后清除、覆盖标记；megaphone→范围内墙全碎（含横竖墙覆盖格计距）、射线弹飞到边缘、落点回收、自己不受影响；skate→冲到边缘、墙拦停、塌陷拦停、棋子拦停、陷阱终止、宝箱拾取、冲王座获胜、buff 一次性；AI 三道具触发；快照 dm/sk8 字段；帮助文案
- 回归：verify_disasters / verify_legendary / verify_mudflow / verify_classic_disaster / verify_draw_stall / verify_aiturn_deadlock 全部复跑
- soak：verify_hang_soak.py 15 分钟
