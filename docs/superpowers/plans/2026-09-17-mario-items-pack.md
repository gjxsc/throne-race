# 实施计划：任天堂风格道具包（8 道具 + 橡皮筋）

- 设计：[2026-09-17-mario-items-pack-design.md](../specs/2026-09-17-mario-items-pack-design.md)（已批准）
- 源码 `throne-race/index.html`；非 git 仓库；检查点 = 验证 ALL PASS
- 关键锚点（当前行号）：ITEMS 315-329 / rollItemKind·LEGENDARY_KINDS ~1870 / pickupAt kind 行 ~1949 / afterStep 1985-1987 / applyStun 2060 / spawnBox randCell ~1884 / 板点击 hammer 模式 2222 / nextTurn 1419-1420 / clickInvSlot trap 分支 ~3500 / hostApplyAction skate 分支 ~2420 / aiUseItems megaphone 段 ~1826 / 快照 dm/sk8 行 3645、3699 / fx 生命周期 2893 / fx 渲染 throne case ~3005 / applyEvent case 表 ~3607 / 棋子徽标段 ~2922 / 主渲染遮罩（画布末尾）

## 任务

### H1 ITEMS +9 / 池扩充 / 橡皮筋分类
- ITEMS 追加：mushroom/shell/fakebox/dice/boomerang（普通）+ blueshell/bomb/hourglass/eclipse（legendary:true）
- `LEGENDARY_KINDS` 扩 8：加 'blueshell','bomb','hourglass','eclipse'
- `rollItemKind` put 追加：`put('mushroom',2); put('shell',2); put('fakebox',1); put('dice',2); put('boomerang',2);`
- 新常量：`ATTACK_KINDS=['trap','confusion','hammer','shell','fakebox']`；`DEFENSE_KINDS=['wall','shield','restore','stun']`

### H2 假宝箱（状态+use+触发+过滤+渲染+快照）
- `let fakeBoxes=[]`；`fakeBoxAt(x,y)`；`useFakeBoxItem(p)`（每方限1，脚下放置，私密日志）
- `triggerFakeBox(p,cell)`：敌方踩中→眩晕2+openbox fx('fakebox')+日志；插 afterStep：`triggerTrap 后 return；triggerFakeBox 后 return`（先陷阱后假箱，再 pickupAt）
- spawnBox randCell 过滤加 `&& !fakeBoxAt(x,y)`
- 渲染：宝箱循环后画假箱（暗金 #6b541a/#3d2f08、无 bob、🎁 图标、无光晕）
- 快照：serialize `fb:fakeBoxes.map(b=>({x:b.x,y:b.y,o:b.o}))`；apply `fakeBoxes=(s.fb||[]).map(...)`

### H3-H10 九个 use 函数（插在 useSkateItem/skateDash 之后）
- `useMushroomItem(p)`：BFS 贪心冲 2 格（判停同 skateDash；doMove 逐格；位置改写即停）
- `useShellItem(p,dx,dy)`：直线滚动，撞墙反弹 1 次（第二次碎），命中任何人（含自己，反弹后）applyStun(q,2)+stHit'disaster'
- `useBoomerangItem(p,dx,dy)`：去程 4 格（墙前停）+原路折返；命中去/回各不同目标（q!==p，去程 Set 标记）；捎路径非传说宝箱（INV 满不捎）
- `useDiceItem(p)`：rnd 掷 1-6 → ①applyStun(p,1) ②③p.walls+=2 ④⑤随机敌 applyStun(t,2) ⑥rollItemKind 入包（满作废）
- `useBlueShellItem(p)`：allDists 锁定领跑非己者 applyStun(t,5)+inv 随机碎 1+blueshell fx
- `useBombItem(p,dx,dy)`：飞 3 格（墙前停、穿人格即爆）；落点 3×3：棋子 applyStun(q,2)（含自己）、墙碎（大喇叭覆盖格模式）+quake fx
- `useHourglassItem(p)`：其他全员 applyStun(q,1)+hourglass fx
- `useEclipseItem(p)`：其他玩家 `q.blindRounds=(q.blindRounds||0)+1`；若 q.ai 再 applyStun(q,1)；eclipse fx
- stHit 约定：使用者 'items'，被作用者 'disaster'

### H11 橡皮筋（pickupAt）
- `const kind` 改 `let kind`；非传说箱定型后：领跑者（allDists 排序第一）开 ATTACK_KINDS → rnd()<0.5 重掷 rollItemKind()；垫底者开 DEFENSE_KINDS → 同规则重掷；重掷一次以结果为准

### H12 三链路
- clickInvSlot：mushroom/dice/blueshell/hourglass/eclipse/fakebox=即时分支（仿 bang）；shell/boomerang/bomb=pendingItem 方向模式（toast'点击相邻一格定方向'）
- 板点击：pendingItem==='shell'||'boomerang'||'bomb' 分支（hammer 模式后）：点相邻正交格→intent={type:'itemuse',kind,dx,dy}；本地直调 use(p,dx,dy)
- hostApplyAction：6 个即时分支 + 3 个方向分支（校验 |dx|+|dy|===1）
- aiUseItems（megaphone 段后追加）：blueshell/hourglass/eclipse/dice/fakebox/mushroom 持有即用；bomb=四方向模拟落点 3×3 含敌或墙≥2 且不含自己→用；shell/boomerang=四方向模拟路径命中任一对手→用

### H13 fx 渲染 + 生命周期 + applyEvent + 遮罩 + nextTurn + 快照
- fx 新 type：fly（path 插值 90ms/格，图标 kind 映射 🐢🪃💣）、blueshell（from→to 1500ms 弧线+蓝辉）、hourglass（全屏金晕 900ms）、eclipse（全屏黑闪 600ms）；生命周期表并入
- applyEvent case 表加：flyfx/blueshellfx/hourglassfx/eclipsefx → 本地 push 同款 fx
- 日蚀持续遮罩：主渲染画布末尾，`myColor` 玩家 blindRounds>0 → 全屏黑 .96+destination-out 半径 1.8 格透明圆
- nextTurn：turnIdx 推进后 `const np=players[turnIdx]; if (np && np.blindRounds>0) np.blindRounds--;`
- 快照 players 加 `bl:p.blindRounds||0` / apply `blindRounds: sp.bl||0`
- 帮助文案 itemLine 更新（新道具一句话）

## 验证
- [ ] `python3 verify_mario_items.py`（新）→ ALL PASS
- [ ] 复跑 verify_disasters/legendary/legendary_items/mudflow/classic_disaster/draw_stall/aiturn_deadlock → 全通过
- [ ] soak 15 分钟零错误

---

## 执行记录（2026-09-17）

### 结果
- 22 处 SEARCH/REPLACE 全部命中；新增约 420 行代码（9 个 use 函数 + 假箱基建 + fx 四类 + 遮罩 + 橡皮筋）
- verify_mario_items.py（新，26 断言）：**ALL PASS**——传说池 8 等权（94/102/96/103/105/93/108/99）、蘑菇冲2格/被围绕路/四面包死停原地、绿龟壳命中/反弹打自己、假宝箱三态+限1、骰子冒烟、回旋镖双击+捎箱、蓝龟壳自动锁定眩5+碎道具、炸弹 3×3 碎墙+范围眩晕+远投不自爆、沙漏冻结、日蚀遮蔽+AI 停摆、橡皮筋领跑者重掷、AI 触发、快照 fb/bl、帮助文案
- 全量回归 9 脚本全部通过
- soak：**447 采样 / 38 局胜利 / 停滞 False / PAGEERRORS 0 / CONSOLE_ERRORS 0 / 堆内存恒定 10MB** ✓

### 执行中发现的缺陷（1 个真 bug + 5 处测试问题）
1. **真 bug**：`useShellItem/useBoomerangItem/useBombItem` 的方向校验 `!dx || !dy` 在正交方向（一轴必为 0）恒真 → 三个方向型道具全部失效。修复为 `(!dx && !dy)`。教训：布尔短路校验对"恰一轴为零"的语义要写精确
2. 测试侧：蘑菇"被围停原地"预期错误（BFS 贪心被单侧围会正确绕路→改塌陷四面包死）；龟壳反弹场景构造（反弹后第一步即离开起点，需滚出撞墙弹回）；炸弹碎墙墙放 3×3 范围外（正确地没碎）；AI 炸弹敌我相邻（任何含敌 3×3 必含自己，AI 正确拒绝）；反弹回程被上一测试残留棋子拦截
3. 断言过时（2 处）：传说池 4→8 后，verify_legendary 的"传说总比例"统计集合与 verify_legendary_items 的"各 15%~35%"区间均按 8 等权更新

---

## 后续迭代：AI 道具策略优化（2026-09-17 同日第二轮）

用户诉求：优化 AI 每种道具的使用判断，增加对抗性与策略性；初版设计被反馈"太保守会缺乏娱乐性"，修订为**策略层 + 保底释放层**双层的机制并获批。

### aiUseItems 整函数重写（~95→150 行，签名/返回语义不变）
- 0️⃣ 快赢省资源：自己 dist≤1 且直达王座 → 不耗道具直接走
- 1️⃣ 紧急拦截：全场最近敌人 dist≤3 → 蓝龟壳/沙漏(自己≤7)/日蚀 倾泻
- 2️⃣ 威胁防御：护盾仅当「领跑 或 2 格内有敌」才开（不再拿到就用）
- 3️⃣ doom 反标：目标从 ahead[0]（身前人）改为**全场最近敌人**——修复"领先者持有 doom 永远不用"的策略缺陷
- 4️⃣ 增益进攻：大喇叭宽松（范围敌≥1 或墙≥2）；炸弹四方向评分「命中数×10+Σ(20−敌dist)」取最优；龟壳/回旋镖选"命中目标 dist 最小"方向
- 5️⃣ 赶路：蘑菇即用；溜冰鞋四方向终点 dist 最小化
- 6️⃣ 资源：骰子满箱不掷；混乱/陷阱目标统一为最近敌人
- 7️⃣ 绝地：大爆炸垫底/无路引爆（保持）
- 8️⃣ 🎉 保底释放：整回合未用道具 → 35% 随机挑一件宽松使用（💥🔋除外）→ 道具期望 ~3 回合内必出场，娱乐性保险丝

### 验证
- 新 verify_ai_items.py（10 断言，种子挑选法确定性控制保底层）：**一次全绿**——快赢省资源/拦截放蓝壳/威胁远忍住/doom 反标/大喇叭宽松/炸弹选优/沙漏时机/满箱不掷/保底随性发射/bang 不进保底
- verify_mario_items 的 aiBlue 场景同步更新（蓝壳需 td≤3 拦截线）
- 全量回归 10 脚本全部通过；soak 结果见下

---

## 后续迭代 2：满箱替换 + 宝箱 FIFO + 墙数通胀治理（2026-09-17 第三轮）

用户三项需求：①满箱开箱替换选择 ②宝箱场上限 5 FIFO ③审查放墙机会来源。

### 交付
1. **满箱替换**：pickupAt 满箱分支 → host 掷骰定型 `b.pending={k,o}`（人类：宝箱开盖显示箱内道具图标，本地/远端 UI 由 draw 尾部兜底弹 `openSwapUI` 模态——点选旧道具=「替换」、未选=「不替换」，宝箱均消失；远端选择经 `itemswap` action 回 host 裁决 `resolveSwap`；AI 按 `itemValue` 价值表〔传说9/蘑菇护盾6/锤陷阱混乱5/墙骰子3/眩晕-1〕即时取舍）。他人待选宝箱锁定不可动；pending 进快照（pend 字段）
2. **宝箱 FIFO**：spawnBox 改「恒可刷，`while(boxes.length>=5) boxes.shift()` 顶掉最旧」；火龙撒箱同受 5 上限
3. **墙数通胀治理**：审查发现两处无上限补偿——火龙冲顶 burnt 全员补偿（已删，烈阳天灾本就无补偿）；泥石流 broken 全员补偿 → 封顶 `min(broken,3)`，日志同步

### 验证
- 新 verify_swap_fifo.py（14 断言）：**ALL PASS**——FIFO 三态/pending 定型/替换/放弃/他人锁/AI 升换弃保/UI 冒烟/快照 pend/泥石流封顶 3（冻结干扰+飞行回调落定后基准）
- verify_legendary 的 fullKeeps 断言随语义更新（满箱留原地 → 开盖待选）
- 全量回归 11 脚本全部通过；soak：**448 采样 / 42 局 / 零错误零停滞 / 墙数峰值 51**（通胀治理前曾见 63，治理生效）✓

### 教训重申
- spectate 局 players 全是 AI：测人类路径须临时 `p.ai=false`
- 长时序断言（泥石流 1700ms 结算）要冻结 AI/天灾干扰，且**冻结前飞行中的 aiAct 回调**需等 ~400ms 落定后再取基准
