# 实施计划：天灾平衡调整 + 传说宝箱（大爆炸道具化）

- 日期：2026-09-17
- 设计文档：[2026-09-17-disaster-rebalance-legendary-box-design.md](../specs/2026-09-17-disaster-rebalance-legendary-box-design.md)（已获用户批准）
- 唯一游戏源码：`/Users/gjxsc/Downloads/AIgame/throne-race/index.html`（单文件，所有函数为全局，可直接在 playwright `page.evaluate` 中调用）
- 验证脚本目录：`/Users/gjxsc/Downloads/AIgame/`（playwright sync_api + headless chromium，惯例见 verify_mudflow.py）

## For agentic workers

- 按任务顺序执行，每完成一个任务勾选对应 checkbox。
- 每个任务的"改动"给出精确的旧代码（SEARCH）与新代码（REPLACE）；行号为编写时参考，执行时以内容锚定为准。
- 本项目**不是 git 仓库**：不执行任何 git commit；每阶段的检查点 = 对应验证脚本 `RESULT: ALL PASS`。
- 所有涉及随机的改动必须走 `rnd()`（种子随机），禁止 `Math.random()`（联机一致性）。
- 验证脚本若发现 `players.length < 2`（页面未自动开局），先对照 verify_mudflow.py 的 SETUP 前置步骤补齐开局方式再跑。
- 代码注释遵循文件现有风格（中文行尾注释），仅在语义必要处添加。

## 总览

| 阶段 | 内容 | 验证 |
|---|---|---|
| A 天灾平衡 | 酸雨恰 5 堵+每人+2墙；暴雷 ⌊N²/10⌋；地陷固定 10 格；陷阱降权 0.3+无主>1 门槛；大爆炸移出天灾 | verify_disasters.py |
| B 传说宝箱 | ITEMS.bang；刷箱 5% 传说；开箱 10% 掷大爆炸；bangReshuffle 道具化；人类/AI/联机三条使用链路；渲染+快照+帮助 | verify_legendary.py |
| C 回归 | 既有验证脚本 + soak | 全部 ALL PASS |

---

## 阶段 A：天灾平衡

### Task A0：编写 verify_disasters.py（先红后绿）

新建 `/Users/gjxsc/Downloads/AIgame/verify_disasters.py`：

```python
#!/usr/bin/env python3
# 天灾平衡验证：酸雨恰5堵+每人+2墙 / 暴雷 ⌊N²/10⌋ / 地陷固定10格3回合 / 陷阱权重0.3+无主>1门槛 / 大爆炸移出天灾
import sys
from playwright.sync_api import sync_playwright

URL = "file:///Users/gjxsc/Downloads/AIgame/throne-race/index.html?mode=spectate&skill=0&seed=42"
errors, fails = [], []

def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else "  | " + str(detail)))
    if not ok:
        fails.append(name)

with sync_playwright() as pw:
    b = pw.chromium.launch(headless=True)
    page = b.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL)
    page.wait_for_timeout(1500)

    r = page.evaluate("""() => {
      const out = {};
      out.started = players.length >= 2;
      if (!out.started) return out;

      // 1) 酸雨：放 12 堵墙 → 恰好腐蚀 5 堵；每人放墙次数 +2
      wallsH.clear(); wallsV.clear(); wallOwner = {};
      for (let y=0; y<12 && y<N; y++) wallsH.add(K(2,y));
      const wallsBefore = wallsH.size + wallsV.size;
      const pb = players.map(p => p.walls);
      const ra = disasterAcid();
      out.acidCorr = wallsBefore - (wallsH.size + wallsV.size);
      out.acidCount = ra.count;
      out.acidWallsGain = players.map((p,i) => p.walls - pb[i]);

      // 2) 暴雷：格数 = ⌊N²/10⌋
      RNGSEED = 7;
      out.thunderCells = disasterThunder().cells.length;
      out.thunderExpect = Math.floor(N*N/10);

      // 3) 地陷：固定 10 格、3 回合恢复
      collapsed = [];
      const rs = disasterSink();
      out.sinkCells = collapsed.length;
      out.sinkRounds = collapsed.length ? collapsed[0].end - roundNum : -1;

      // 4) 陷阱门槛 + 权重：场上无主陷阱>1 时 3000 次掷骰不出 trapfall；bang 永不出现
      traps = [{x:0,y:0,o:null},{x:0,y:1,o:null}];
      RNGSEED = 123;
      let tf=0, bg=0;
      for (let i=0;i<3000;i++){ const k=rollDisaster(); if(k==='trapfall')tf++; if(k==='bang')bg++; }
      out.tfBlocked = tf; out.bangRolled = bg;
      out.tfWeight = Object.values(DISASTER_W).every(w => w.trapfall === 0.3);
      out.noBangW = Object.values(DISASTER_W).every(w => !('bang' in w));
      out.noBangKey = !('bang' in DISASTERS);

      // 5) 帮助文案：天灾行不再含"大爆炸洗牌"
      disastersOn = true; refreshHint();
      out.disLineOk = !document.getElementById('hint').innerHTML.includes('大爆炸洗牌');
      return out;
    }""")

    check("游戏已开局", r.get("started"), r)
    if r.get("started"):
        check("酸雨恰好腐蚀 5 堵墙", r["acidCorr"] == 5 and r["acidCount"] == 5, r)
        check("酸雨每人 +2 放墙次数", all(g == 2 for g in r["acidWallsGain"]), r["acidWallsGain"])
        check("暴雷 ⌊N²/10⌋ 格", r["thunderCells"] == r["thunderExpect"], r)
        check("地陷固定 10 格", r["sinkCells"] == 10, r)
        check("地陷 3 回合恢复", r["sinkRounds"] == 3, r)
        check("无主陷阱>1 时天降陷阱被屏蔽", r["tfBlocked"] == 0, r)
        check("大爆炸不再作为天灾掷出", r["bangRolled"] == 0 and r["noBangW"] and r["noBangKey"], r)
        check("陷阱权重全线 0.3", r["tfWeight"], r)
        check("帮助文案已移除大爆炸天灾", r["disLineOk"], r)

    b.close()

print("ERRORS:", errors if errors else "none")
if fails or errors:
    print("RESULT: FAIL (%d)" % (len(fails) + len(errors))); sys.exit(1)
print("RESULT: ALL PASS")
```

- [ ] 运行 `cd /Users/gjxsc/Downloads/AIgame && python3 verify_disasters.py` → 预期 **FAIL**（记录红色基线；若"游戏已开局"失败，先对照 verify_mudflow.py 修正开局前置）

### Task A1：酸雨 — 恰好 5 堵腐蚀、每人 +2 墙

改动 `index.html`（约 1130-1147 行），整函数替换：

SEARCH：
```js
function disasterAcid(){
  const list=[];
  for (const key of wallsH) list.push(['h', ...key.split(',').map(Number)]);
  for (const key of wallsV) list.push(['v', ...key.split(',').map(Number)]);
  let n = 0;
  if (list.length){
    n = Math.max(1, Math.floor(list.length/3));
    for (const w of shuffleArr(list).slice(0,n)){
      fx.push({type:'smash', kind:w[0], x:w[1], y:w[2], t0:performance.now()});
      removeWall(w[0], w[1], w[2]);
    }
    sSmash();
  }
  for (const p of players){ if (!p.left) p.walls += 5; }
  logPush(n ? '☔ 酸雨腐蚀了 '+n+' 堵墙，每人获得 5 次放墙机会'
            : '☔ 酸雨落下，场上没有墙可腐蚀，每人获得 5 次放墙机会', null);
  return {count:n};
}
```
REPLACE：
```js
function disasterAcid(){                     // ☔ 酸雨：恰好腐蚀 5 堵墙（不足则全腐蚀），每人 +2 放墙次数
  const list=[];
  for (const key of wallsH) list.push(['h', ...key.split(',').map(Number)]);
  for (const key of wallsV) list.push(['v', ...key.split(',').map(Number)]);
  let n = 0;
  if (list.length){
    n = Math.min(5, list.length);
    for (const w of shuffleArr(list).slice(0,n)){
      fx.push({type:'smash', kind:w[0], x:w[1], y:w[2], t0:performance.now()});
      removeWall(w[0], w[1], w[2]);
    }
    sSmash();
  }
  for (const p of players){ if (!p.left) p.walls += 2; }
  logPush(n ? '☔ 酸雨腐蚀了 '+n+' 堵墙，每人获得 2 次放墙机会'
            : '☔ 酸雨落下，场上没有墙可腐蚀，每人获得 2 次放墙机会', null);
  return {count:n};
}
```
（若原函数行尾注释与上面 SEARCH 不一致，以 SEARCH 其余部分锚定，仅替换数值与文案。）

- [ ] 完成

### Task A2：暴雷 — ⌊N²/10⌋ 格（N=11 → 12 格），眩晕保持 2 回合

SEARCH：
```js
  const cells = shuffleArr(cands).slice(0, Math.floor(N*N/4)).map(c=>[c.x,c.y]);
```
REPLACE：
```js
  const cells = shuffleArr(cands).slice(0, Math.floor(N*N/10)).map(c=>[c.x,c.y]);
```
同时把该函数行尾注释 `约 1/4` 改为 `约 1/10`（若有）。

- [ ] 完成

### Task A3：地陷 — 固定 10 格（塌 3 回合为现状 `end:roundNum+3`，不改时长）

SEARCH：
```js
  const picked = shuffleArr(cands).slice(0, Math.min(cands.length, Math.floor(N*N/10)));
```
REPLACE：
```js
  const picked = shuffleArr(cands).slice(0, Math.min(10, cands.length));
```
同时把该函数行尾注释 `约 1/10 格子塌陷` 改为 `固定 10 格塌陷`（若有）。

- [ ] 完成

### Task A4：天降陷阱降权 0.3 + 无主陷阱>1 掷骰门槛

**A4.1 权重表**（约 912-917 行），整块替换：

SEARCH：
```js
const DISASTER_W = {                              // ☄️ 各关天灾权重：沙漠重酷暑塌陷 / 冰雪重冻雨暴雪 / 熔岩重热浪喷发
  0: {acid:1,   thunder:1,   sink:1,   rain:1,   sun:1,   bang:0.35, trapfall:0.9, mudflow:0.8},
  1: {acid:1.2, thunder:0.6, sink:1.4, rain:0.3, sun:1.4, bang:0.4,  trapfall:0.8, mudflow:1},
  2: {acid:1.5, thunder:1.2, sink:1,   rain:1.5, sun:0.4, bang:0.5,  trapfall:0.8, mudflow:0.7},
  3: {acid:1,   thunder:0.8, sink:1.2, rain:0.3, sun:1.5, bang:0.8,  trapfall:0.9, mudflow:1.2},
};
```
REPLACE：
```js
const DISASTER_W = {                              // ☄️ 各关天灾权重（💥 大爆炸已道具化移出；🪤 天降陷阱统一降权）
  0: {acid:1,   thunder:1,   sink:1,   rain:1,   sun:1,   trapfall:0.3, mudflow:0.8},
  1: {acid:1.2, thunder:0.6, sink:1.4, rain:0.3, sun:1.4, trapfall:0.3, mudflow:1},
  2: {acid:1.5, thunder:1.2, sink:1,   rain:1.5, sun:0.4, trapfall:0.3, mudflow:0.7},
  3: {acid:1,   thunder:0.8, sink:1.2, rain:0.3, sun:1.5, trapfall:0.3, mudflow:1.2},
};
```

**A4.2 掷骰门槛**（约 1109-1114 行），整函数替换：

SEARCH：
```js
function rollDisaster(){
  const DW = DISASTER_W[levelId] || DISASTER_W[0];
  let r = rnd()*Object.values(DW).reduce((a,b)=>a+b,0), kind='acid';
  for (const k in DW){ r -= DW[k]; if (r<0){ kind=k; break; } }
  return kind;
}
```
REPLACE：
```js
function rollDisaster(){
  const DW = { ...(DISASTER_W[levelId] || DISASTER_W[0]) };
  if (DW.trapfall && traps.filter(t=>!t.o).length > 1) DW.trapfall = 0;   // 无主陷阱>1：本次不降天降陷阱
  let r = rnd()*Object.values(DW).reduce((a,b)=>a+b,0), kind='acid';
  for (const k in DW){ r -= DW[k]; if (r<0){ kind=k; break; } }
  return kind;
}
```

- [ ] 完成 A4.1 / [ ] 完成 A4.2

### Task A5：大爆炸移出天灾表与调度；帮助文案同步

**A5.1 DISASTERS 表**（约 902 行），删除一行：

SEARCH：
```js
  sun:    {icon:'☀️', name:'烈阳'},
  bang:   {icon:'💥', name:'大爆炸'},
  trapfall:{icon:'🪤', name:'天降陷阱'},
```
REPLACE：
```js
  sun:    {icon:'☀️', name:'烈阳'},
  trapfall:{icon:'🪤', name:'天降陷阱'},
```

**A5.2 DISASTER_SKINS 三关皮肤**（约 908-910 行），每行删掉各自 `bang:{...}` 片段：

SEARCH：
```js
  1: {acid:{icon:'🏜️',name:'沙尘暴',color:'#d9b36c'}, thunder:{icon:'🌩️',name:'沙暴雷'}, sink:{icon:'🕳️',name:'沙坑塌陷'}, rain:{icon:'💧',name:'绿洲洪流',color:'#6fd8c8'}, sun:{icon:'🌞',name:'酷暑'}, bang:{icon:'💥',name:'圣殿崩塌'}, trapfall:{icon:'🦂',name:'沙蝎巢穴'}, mudflow:{icon:'🪨',name:'沙石流',color:'#d9b36c'}},
  2: {acid:{icon:'🌨️',name:'冻雨',color:'#a8e6ff'}, thunder:{icon:'⚡',name:'白色雷暴'}, sink:{icon:'🕳️',name:'雪窟'}, rain:{icon:'❄️',name:'暴风雪',color:'#e8f4ff'}, sun:{icon:'☀️',name:'融雪烈日'}, bang:{icon:'💥',name:'雪崩'}, trapfall:{icon:'🪤',name:'冰窟陷阱'}, mudflow:{icon:'🧊',name:'冰砾崩落',color:'#bfe8ff'}},
  3: {acid:{icon:'🔥',name:'灰烬雨',color:'#ff9a5a'}, thunder:{icon:'🌩️',name:'火山雷'}, sink:{icon:'🕳️',name:'熔岩地裂'}, rain:{icon:'♨️',name:'蒸汽弥漫',color:'#cfd8dc'}, sun:{icon:'🌡️',name:'热浪'}, bang:{icon:'💥',name:'火山喷发'}, trapfall:{icon:'🪤',name:'熔岩裂隙'}, mudflow:{icon:'🌋',name:'熔岩滚石',color:'#ff8552'}},
```
REPLACE：
```js
  1: {acid:{icon:'🏜️',name:'沙尘暴',color:'#d9b36c'}, thunder:{icon:'🌩️',name:'沙暴雷'}, sink:{icon:'🕳️',name:'沙坑塌陷'}, rain:{icon:'💧',name:'绿洲洪流',color:'#6fd8c8'}, sun:{icon:'🌞',name:'酷暑'}, trapfall:{icon:'🦂',name:'沙蝎巢穴'}, mudflow:{icon:'🪨',name:'沙石流',color:'#d9b36c'}},
  2: {acid:{icon:'🌨️',name:'冻雨',color:'#a8e6ff'}, thunder:{icon:'⚡',name:'白色雷暴'}, sink:{icon:'🕳️',name:'雪窟'}, rain:{icon:'❄️',name:'暴风雪',color:'#e8f4ff'}, sun:{icon:'☀️',name:'融雪烈日'}, trapfall:{icon:'🪤',name:'冰窟陷阱'}, mudflow:{icon:'🧊',name:'冰砾崩落',color:'#bfe8ff'}},
  3: {acid:{icon:'🔥',name:'灰烬雨',color:'#ff9a5a'}, thunder:{icon:'🌩️',name:'火山雷'}, sink:{icon:'🕳️',name:'熔岩地裂'}, rain:{icon:'♨️',name:'蒸汽弥漫',color:'#cfd8dc'}, sun:{icon:'🌡️',name:'热浪'}, trapfall:{icon:'🪤',name:'熔岩裂隙'}, mudflow:{icon:'🌋',name:'熔岩滚石',color:'#ff8552'}},
```

**A5.3 maybeDisaster 调度表**（约 1122-1124 行），删 `bang:disasterBang`：

SEARCH：
```js
  const extra = ({acid:disasterAcid, thunder:disasterThunder, sink:disasterSink,
                  rain:disasterRain, sun:disasterSun, bang:disasterBang,
                  trapfall:disasterTrapfall, mudflow:disasterMudflow})[kind]() || {};
```
REPLACE：
```js
  const extra = ({acid:disasterAcid, thunder:disasterThunder, sink:disasterSink,
                  rain:disasterRain, sun:disasterSun,
                  trapfall:disasterTrapfall, mudflow:disasterMudflow})[kind]() || {};
```

**A5.4 帮助文案天灾行**（约 3403 行），删"💥 大爆炸洗牌"并补上仍在池中的 🪤/🪨：

SEARCH：
```js
  const disLine = disastersOn ? '☄️ <b>天灾开启</b>：每 '+disasterInterval+' 回合（同步模式每 '+(disasterInterval*4)+' 次行动）随机降临 ☔ 酸雨蚀墙、⚡ 暴雷眩晕、🕳️ 地陷塌方、🌧️ 暴雨冲走道具（+1 行动）、☀️ 烈阳火墙、💥 大爆炸洗牌。<br>' : '';
```
REPLACE：
```js
  const disLine = disastersOn ? '☄️ <b>天灾开启</b>：每 '+disasterInterval+' 回合（同步模式每 '+(disasterInterval*4)+' 次行动）随机降临 ☔ 酸雨蚀墙、⚡ 暴雷眩晕、🕳️ 地陷塌方、🌧️ 暴雨冲走道具（+1 行动）、☀️ 烈阳火墙、🪤 天降陷阱、🪨 泥石流。<br>' : '';
```

- [ ] 完成 A5.1 / [ ] 完成 A5.2 / [ ] 完成 A5.3 / [ ] 完成 A5.4

### Task A6：阶段 A 检查点

- [ ] `cd /Users/gjxsc/Downloads/AIgame && python3 verify_disasters.py` → **RESULT: ALL PASS**

---

## 阶段 B：传说宝箱（大爆炸道具化）

### Task B0：编写 verify_legendary.py（先红后绿）

新建 `/Users/gjxsc/Downloads/AIgame/verify_legendary.py`：

```python
#!/usr/bin/env python3
# 传说宝箱验证：刷箱 5% 传说 / 开箱 10% 掷大爆炸 / 满箱留原地 / bangReshuffle 道具化 / AI 与联机链路 / 帮助文案
import sys
from playwright.sync_api import sync_playwright

URL = "file:///Users/gjxsc/Downloads/AIgame/throne-race/index.html?mode=spectate&skill=0&seed=42"
errors, fails = [], []

def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else "  | " + str(detail)))
    if not ok:
        fails.append(name)

with sync_playwright() as pw:
    b = pw.chromium.launch(headless=True)
    page = b.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL)
    page.wait_for_timeout(1500)

    r = page.evaluate("""() => {
      const out = {};
      out.started = players.length >= 2;
      if (!out.started) return out;

      // 1) 刷箱 5% 传说（400 次采样，比例落在 2%~9%）
      boxes = []; let lgN=0, tot=0;
      for (let i=0;i<400;i++){ boxes=[]; spawnBox(999); if (boxes.length){ tot++; if (boxes[0].lg) lgN++; } }
      out.lgRatio = lgN/tot;
      out.lgHasField = boxes.every(b => ('lg' in b));   // 字段始终存在

      // 2) 普通池不含大爆炸（200 次采样）
      RNGSEED = 99; let bad=0;
      for (let i=0;i<200;i++){ if (rollItemKind()==='bang') bad++; }
      out.poolBang = bad;

      // 3) 传说箱开箱 10% 掷大爆炸（400 次采样，比例 5%~16%）
      const p = players[0];
      RNGSEED = 5; let bangN=0, n=0;
      for (let i=0;i<400;i++){
        p.inv = []; boxes = [{x:p.cell.x, y:p.cell.y, i:null, lg:true}];
        pickupAt(p, p.cell);
        if (p.inv.length && p.inv[p.inv.length-1]==='bang') bangN++;
        n++;
      }
      out.openBangRatio = bangN/n;

      // 4) 道具箱满 → 传说箱留在原地
      p.inv = ['wall','hammer'];
      boxes = [{x:p.cell.x, y:p.cell.y, i:null, lg:true}];
      pickupAt(p, p.cell);
      out.fullKeeps = boxes.length===1 && p.inv.length===2;

      // 5) 传说箱开出的💫照常即触发（不进道具箱则 inv 无 stun；进箱且眩晕并存照旧行为）
      RNGSEED = 11; let stunHit = null;
      for (let i=0;i<400;i++){
        p.inv = []; boxes = [{x:p.cell.x, y:p.cell.y, i:null, lg:true}];
        pickupAt(p, p.cell);
        if (p.inv.length && p.inv[p.inv.length-1]==='stun'){ stunHit = true; break; }
      }
      out.stunFromLg = stunHit;

      // 6) useBangItem / bangReshuffle：消耗道具、棋盘重组、日志记录发动者
      wallsH.clear(); wallsV.clear(); wallOwner = {};
      for (let y=0;y<10 && y<N;y++) wallsH.add(K(3,y));
      p.inv = ['bang'];
      const tBefore = {x:THRONE.x, y:THRONE.y};
      const logLen = logs.length;
      useBangItem(p);
      out.bangConsumed = p.inv.length===0;
      out.reshuffled = (THRONE.x!==tBefore.x || THRONE.y!==tBefore.y || (wallsH.size+wallsV.size)<10) ;
      out.bangLog = logs.slice(logLen).some(l => (l.msg||'').includes('大爆炸'));

      // 7) 联机主机校验链路：hostApplyAction itemuse bang（同步模式、无冻结）
      mode = 'onsync'; p.frozenUntil = 0; p.inv = ['bang'];
      let hostOk = true;
      try { hostApplyAction(p, {type:'itemuse', kind:'bang'}); } catch(e){ hostOk = false; }
      out.hostChain = hostOk && p.inv.length===0;

      // 8) AI：垫底且持大爆炸 → 引爆
      const ai = players.find(q=>q.ai) || players[1];
      players.forEach(q => { if (q!==ai) teleport(q, {x:Math.max(0,THRONE.x-1), y:Math.max(0,THRONE.y)}); });
      teleport(ai, {x: THRONE.x<5 ? N-1 : 0, y: THRONE.y<5 ? N-1 : 0});
      ai.inv = ['bang'];
      out.aiUse = aiUseItems(ai) === true && ai.inv.length===0;

      // 9) 帮助文案
      itemsOn = true; disastersOn = true; refreshHint();
      const h = document.getElementById('hint').innerHTML;
      out.helpItem = h.includes('传说宝箱') && h.includes('大爆炸');
      return out;
    }""")

    check("游戏已开局", r.get("started"), r)
    if r.get("started"):
        check("刷箱传说比例 ≈5%", 0.02 <= r["lgRatio"] <= 0.09, r["lgRatio"])
        check("宝箱均带 lg 字段", r["lgHasField"], r)
        check("普通池不出大爆炸", r["poolBang"] == 0, r)
        check("传说开箱大爆炸比例 ≈10%", 0.05 <= r["openBangRatio"] <= 0.16, r["openBangRatio"])
        check("道具箱满传说箱留原地", r["fullKeeps"], r)
        check("传说箱💫照常触发", r["stunFromLg"] is True, r)
        check("useBangItem 消耗道具", r["bangConsumed"], r)
        check("bangReshuffle 重组棋盘", r["reshuffled"], r)
        check("大爆炸日志含发动描述", r["bangLog"], r)
        check("hostApplyAction 联机链路", r["hostChain"], r)
        check("AI 垫底自动引爆", r["aiUse"], r)
        check("帮助文案含传说宝箱", r["helpItem"], r)

    b.close()

print("ERRORS:", errors if errors else "none")
if fails or errors:
    print("RESULT: FAIL (%d)" % (len(fails) + len(errors))); sys.exit(1)
print("RESULT: ALL PASS")
```

说明：`logs` 元素结构若非 `{msg:...}`（如纯字符串数组），把第 6 项断言改为 `logs.slice(logLen).some(l => String(l).includes('大爆炸') || String(l.msg||'').includes('大爆炸'))`，以实际结构为准。

- [ ] 运行 `cd /Users/gjxsc/Downloads/AIgame && python3 verify_legendary.py` → 预期 **FAIL**（红色基线）

### Task B1：ITEMS.bang + 普通池抽离 + 刷箱 5% 传说

**B1.1 ITEMS 表**（约 314-322 行），在 shield 行后新增：

SEARCH：
```js
      shield:   {icon:'🛡️', name:'保护卡',     desc:'点击激活：免疫 1 次敌方指向性技能或陷阱（护盾状态仅自己可见）'},
    };
```
REPLACE：
```js
      shield:   {icon:'🛡️', name:'保护卡',     desc:'点击激活：免疫 1 次敌方指向性技能或陷阱（护盾状态仅自己可见）'},
      bang:     {icon:'💥', name:'大爆炸',     desc:'传说道具：点击引爆，王座/所有棋子/墙全部随机重组（含你自己！）', legendary:true},
    };
```

**B1.2 spawnBox**（约 1850-1863 行），抽离 `rollItemKind()` 并加传说掷骰，整块替换：

SEARCH：
```js
function spawnBox(cap=4){
  if (boxes.length >= cap) return;
  const c = randCell((x,y)=>!boxAt(x,y) && !trapAt(x,y));
  if (!c) return;
  const pool = [];
  const put = (k,w)=>{ if (ITEMS[k]) for(let i=0;i<w;i++) pool.push(k); };
  put('wall',3); put('hammer',3);
  if (skillsOn) put('restore',2);
  put('trap',2); put('confusion',2); put('stun',1); put('shield',2);
  const kind = pool[Math.floor(rnd()*pool.length)];
  boxes.push({x:c.x, y:c.y, i:kind});
  fx.push({type:'boxin', x:c.x, y:c.y, t0:performance.now()});
  netEv({type:'boxspawn', x:c.x, y:c.y});
}
```
REPLACE：
```js
function rollItemKind(){                     // 普通道具加权池（传说道具不进普通池）
  const pool = [];
  const put = (k,w)=>{ if (ITEMS[k]) for(let i=0;i<w;i++) pool.push(k); };
  put('wall',3); put('hammer',3);
  if (skillsOn) put('restore',2);
  put('trap',2); put('confusion',2); put('stun',1); put('shield',2);
  return pool[Math.floor(rnd()*pool.length)];
}
function spawnBox(cap=4){
  if (boxes.length >= cap) return;
  const c = randCell((x,y)=>!boxAt(x,y) && !trapAt(x,y));
  if (!c) return;
  const lg = rnd() < 0.05;                   // 💎 传说宝箱：5% 替换刷箱，内容开箱时才定型
  boxes.push({x:c.x, y:c.y, i: lg ? null : rollItemKind(), lg});
  fx.push({type:'boxin', x:c.x, y:c.y, t0:performance.now()});
  netEv({type:'boxspawn', x:c.x, y:c.y});
}
```

- [ ] 完成 B1.1 / [ ] 完成 B1.2

### Task B2：pickupAt — 传说箱开箱定型（10% 大爆炸，否则普通池）

（约 1915-1935 行），整函数替换：

SEARCH：
```js
function pickupAt(p, cell){               // 拾取脚下宝箱：道具箱满则留在原地
  const b = boxAt(cell.x, cell.y);
  if (!b) return;
  if (p.inv.length >= INV_CAP){
    if (p===localFreeActor()) toast('道具箱已满，宝箱留在原地');
    logPush('走到宝箱，但道具箱已满 🎁 留在原地', p.color);
    return;
  }
  boxes.splice(boxes.indexOf(b), 1);
  p.inv.push(b.i);
  sPick();
  fx.push({type:'openbox', x:b.x, y:b.y, i:b.i, t0:performance.now()});
  netEv({type:'boxopen', x:b.x, y:b.y, i:b.i});
  if (b.i==='stun'){
    applyStun(p);
    logPush('💫 打开宝箱中了眩晕！暂停 1 回合', p.color);
  }else{
    logPush('🎁 打开宝箱获得 '+ITEMS[b.i].icon+' '+ITEMS[b.i].name, p.color);
  }
  renderPanel();
}
```
REPLACE：
```js
function pickupAt(p, cell){               // 拾取脚下宝箱：道具箱满则留在原地；💎 传说宝箱开箱定型（10% 掷传说道具）
  const b = boxAt(cell.x, cell.y);
  if (!b) return;
  if (p.inv.length >= INV_CAP){
    if (p===localFreeActor()) toast('道具箱已满，宝箱留在原地');
    logPush('走到宝箱，但道具箱已满 🎁 留在原地', p.color);
    return;
  }
  const kind = b.lg ? (rnd()<0.1 ? 'bang' : rollItemKind()) : b.i;
  boxes.splice(boxes.indexOf(b), 1);
  p.inv.push(kind);
  sPick();
  fx.push({type:'openbox', x:b.x, y:b.y, i:kind, t0:performance.now()});
  netEv({type:'boxopen', x:b.x, y:b.y, i:kind});
  if (kind==='stun'){
    applyStun(p);
    logPush('💫 打开宝箱中了眩晕！暂停 1 回合', p.color);
  }else if (b.lg && kind==='bang'){
    logPush('💎 传说宝箱开出传说道具 💥 大爆炸！（点击道具箱引爆）', p.color);
  }else{
    logPush('🎁 打开宝箱获得 '+ITEMS[kind].icon+' '+ITEMS[kind].name, p.color);
  }
  renderPanel();
}
```

- [ ] 完成

### Task B3：disasterBang → bangReshuffle(actor) + useBangItem

（约 1220-1256 行），整函数替换并新增 `useBangItem`：

SEARCH：
```js
function disasterBang(){
  const owners=[];
  for (const k in wallOwner){
    if (!wallOwner[k]) continue;
    const [x,y]=k.slice(2).split(',').map(Number);
    owners.push([k[0], x, y, wallOwner[k]]);
  }
  wallsH.clear(); wallsV.clear(); wallOwner={}; fireWalls=[]; collapsed=[];
  const pool=[];
  for(let y=0;y<N;y++) for(let x=0;x<N;x++)
    if (!Object.values(SPAWN).some(s=>s.x===x&&s.y===y)) pool.push({x,y});
  shuffleArr(pool);
  const t = pool.pop();
  THRONE.x=t.x; THRONE.y=t.y;
  fx.push({type:'throne', x:t.x, y:t.y, t0:performance.now()});
  const taken = new Set([t.y*N+t.x]);
  for (const p of players){
    if (p.left) continue;
    const c = pool.find(c=>!taken.has(c.y*N+c.x));
    if (!c) break;
    taken.add(c.y*N+c.x);
    teleport(p, c);
    stHit(p, 'disaster');
  }
  let walls=0;
  for (const s of shuffleArr(allWallSpots().slice())){
    if (walls>=owners.length) break;
    const [kind,x,y]=s;
    if (!wallOK(kind,x,y)) continue;
    (kind==='h'?wallsH:wallsV).add(K(x,y));
    wallOwner[kind+' '+K(x,y)] = owners[walls][3];
    walls++;
  }
  sSmash(); sWall();
  logPush('💥 大爆炸！棋盘格局重组（'+walls+'/'+owners.length+' 堵墙幸存）', null);
  return {tx:THRONE.x, ty:THRONE.y};
}
```
REPLACE：
```js
function bangReshuffle(actor){              // 💥 大爆炸（传说道具）：王座/棋子/墙全部随机重组，发动者也被换位
  const owners=[];
  for (const k in wallOwner){
    if (!wallOwner[k]) continue;
    const [x,y]=k.slice(2).split(',').map(Number);
    owners.push([k[0], x, y, wallOwner[k]]);
  }
  wallsH.clear(); wallsV.clear(); wallOwner={}; fireWalls=[]; collapsed=[];
  const pool=[];
  for(let y=0;y<N;y++) for(let x=0;x<N;x++)
    if (!Object.values(SPAWN).some(s=>s.x===x&&s.y===y)) pool.push({x,y});
  shuffleArr(pool);
  const t = pool.pop();
  THRONE.x=t.x; THRONE.y=t.y;
  fx.push({type:'throne', x:t.x, y:t.y, t0:performance.now()});
  const taken = new Set([t.y*N+t.x]);
  for (const p of players){
    if (p.left) continue;
    const c = pool.find(c=>!taken.has(c.y*N+c.x));
    if (!c) break;
    taken.add(c.y*N+c.x);
    teleport(p, c);
    stHit(p, p===actor ? 'items' : 'disaster');
  }
  let walls=0;
  for (const s of shuffleArr(allWallSpots().slice())){
    if (walls>=owners.length) break;
    const [kind,x,y]=s;
    if (!wallOK(kind,x,y)) continue;
    (kind==='h'?wallsH:wallsV).add(K(x,y));
    wallOwner[kind+' '+K(x,y)] = owners[walls][3];
    walls++;
  }
  sSmash(); sWall();
  logPush('💥 '+(actor ? COLORS[actor.color].name+' 引爆' : '')+'大爆炸！棋盘格局重组（'+walls+'/'+owners.length+' 堵墙幸存）', actor ? actor.color : null);
  return {tx:THRONE.x, ty:THRONE.y};
}
function useBangItem(p){                   // 💥 大爆炸道具：消耗并引爆（免费即时动作，不占回合）
  const i = p.inv.indexOf('bang');
  if (i<0) return false;
  p.inv.splice(i,1);
  bangReshuffle(p);
  sPick(); renderPanel();
  return true;
}
```

- [ ] 完成（全文件搜索确认无残留 `disasterBang` 引用：`grep -n disasterBang index.html` 应无输出）

### Task B4：三条使用链路

**B4.1 clickInvSlot**（约 3335-3344 行），shield 分支后插入 bang 分支：

SEARCH：
```js
    }else{
      useShieldItem(p);
      toast('🛡️ 护盾已激活：将免疫 1 次敌方技能或陷阱');
    }
  }else if (kind==='trap' || kind==='confusion'){
```
REPLACE：
```js
    }else{
      useShieldItem(p);
      toast('🛡️ 护盾已激活：将免疫 1 次敌方技能或陷阱');
    }
  }else if (kind==='bang'){
    if (isOnline()){
      if (hostSim()) hostApplyAction(p, {type:'itemuse', kind:'bang'});
      else { busy=true; setTimeout(()=>{busy=false;},2500); netSend({t:'act', a:{type:'itemuse', kind:'bang'}}); }
    }else{
      useBangItem(p);
      toast('💥 大爆炸！棋盘格局重组（含你自己）');
    }
  }else if (kind==='trap' || kind==='confusion'){
```

**B4.2 hostApplyAction**（约 2302-2304 行），shield 分支后插入 bang 分支：

SEARCH：
```js
  }else if (a.type==='itemuse' && a.kind==='shield'){
    if (!useShieldItem(p)) return reject('护盾无法使用');
  }else if (a.type==='skilluse'){
```
REPLACE：
```js
  }else if (a.type==='itemuse' && a.kind==='shield'){
    if (!useShieldItem(p)) return reject('护盾无法使用');
  }else if (a.type==='itemuse' && a.kind==='bang'){
    if (!useBangItem(p)) return reject('没有 💥 大爆炸道具');
  }else if (a.type==='skilluse'){
```

**B4.3 aiUseItems**（约 1721-1745 行），在 `const myD` 之后、`ahead` 计算之前插入大爆炸规则：

SEARCH：
```js
      const dists = allDists();
      const myD = dists[p.color];
      const ahead = players.filter(q=>q!==p && !q.left && dists[q.color] < myD)
                           .sort((a,b)=>dists[a.color]-dists[b.color]);
```
REPLACE：
```js
      const dists = allDists();
      const myD = dists[p.color];
      const bi = p.inv.indexOf('bang');
      if (bi>=0){                            // 💥 垫底（无人比我离王座更远）或无路可走 → 引爆大爆炸搏一把
        const rivals = players.filter(q=>q!==p && !q.left);
        if ((rivals.length && rivals.every(q=>dists[q.color] <= myD)) || !legalMoves(p).length){
          useBangItem(p);
          return true;
        }
      }
      const ahead = players.filter(q=>q!==p && !q.left && dists[q.color] < myD)
                           .sort((a,b)=>dists[a.color]-dists[b.color]);
```

- [ ] 完成 B4.1 / [ ] 完成 B4.2 / [ ] 完成 B4.3

### Task B5：渲染 + 快照 + 帮助文案

**B5.1 宝箱渲染**（约 2710-2725 行），传说宝箱彩虹渐变+更醒目呼吸光晕，整块替换：

SEARCH：
```js
  // 宝箱（实心暗金底衬 + 悬浮 + 呼吸辉光，金边确保深底上醒目）
  for(const b of boxes){
    const bob = 2.5*Math.sin(now/300 + b.x*1.3 + b.y*0.9);
    const X=px(b.x), Y=px(b.y)+bob;
    ctx.save();
    const bg = ctx.createLinearGradient(X,Y,X+CELL,Y+CELL);
    bg.addColorStop(0,'#8a6a1e'); bg.addColorStop(1,'#57400f');
    ctx.fillStyle=bg;
    rr(X+3,Y+3,CELL-6,CELL-6, Math.max(4,CELL*0.16)); ctx.fill();
    ctx.strokeStyle='rgba(253,202,0,.9)'; ctx.lineWidth=2;
    rr(X+3,Y+3,CELL-6,CELL-6, Math.max(4,CELL*0.16)); ctx.stroke();
    ctx.shadowColor='rgba(253,202,0,.55)'; ctx.shadowBlur=10+4*Math.sin(now/200+b.x);
    ctx.font=Math.floor(CELL*0.62)+'px serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText('🎁', X+CELL/2, Y+CELL/2+2);
    ctx.restore();
  }
```
REPLACE：
```js
  // 宝箱（实心暗金底衬 + 悬浮 + 呼吸辉光；💎 传说宝箱：彩虹渐变 + 金粉呼吸光晕更醒目）
  for(const b of boxes){
    const bob = 2.5*Math.sin(now/300 + b.x*1.3 + b.y*0.9);
    const X=px(b.x), Y=px(b.y)+bob;
    ctx.save();
    const bg = ctx.createLinearGradient(X,Y,X+CELL,Y+CELL);
    if (b.lg){ bg.addColorStop(0,'#ffd700'); bg.addColorStop(.5,'#ff6ec7'); bg.addColorStop(1,'#58c7ff'); }
    else{ bg.addColorStop(0,'#8a6a1e'); bg.addColorStop(1,'#57400f'); }
    ctx.fillStyle=bg;
    rr(X+3,Y+3,CELL-6,CELL-6, Math.max(4,CELL*0.16)); ctx.fill();
    ctx.strokeStyle='rgba(253,202,0,.9)'; ctx.lineWidth=2;
    rr(X+3,Y+3,CELL-6,CELL-6, Math.max(4,CELL*0.16)); ctx.stroke();
    ctx.shadowColor = b.lg ? 'rgba(255,215,0,.9)' : 'rgba(253,202,0,.55)';
    ctx.shadowBlur = b.lg ? 15+8*Math.sin(now/160+b.x) : 10+4*Math.sin(now/200+b.x);
    ctx.font=Math.floor(CELL*0.62)+'px serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(b.lg?'💎':'🎁', X+CELL/2, Y+CELL/2+2);
    ctx.restore();
  }
```

**B5.2 道具槽金框**（约 3220-3223 行），传说道具金边发光（内联样式，不动 CSS）：

SEARCH：
```js
      return `<span class="islot${mine?' mine':''}${pendingItem===k?' on':''}" data-i="${i}" title="${it.name}：${it.desc}">${it.icon}</span>`;
```
REPLACE：
```js
      return `<span class="islot${mine?' mine':''}${pendingItem===k?' on':''}" data-i="${i}" title="${it.name}：${it.desc}"${it.legendary?' style="border-color:#ffd700;box-shadow:0 0 7px 2px rgba(255,215,0,.85);"':''}>${it.icon}</span>`;
```

**B5.3 快照同步 lg 字段**（约 3444 / 3486 行）：

SEARCH：
```js
    boxes: boxes.map(b=>({x:b.x, y:b.y, i:b.i})),
```
REPLACE：
```js
    boxes: boxes.map(b=>({x:b.x, y:b.y, i:b.i, lg:b.lg?1:0})),
```
SEARCH：
```js
  boxes = (s.boxes||[]).map(b=>({x:b.x, y:b.y, i:b.i}));
```
REPLACE：
```js
  boxes = (s.boxes||[]).map(b=>({x:b.x, y:b.y, i:b.i, lg:!!b.lg}));
```

**B5.4 帮助文案道具行**（约 3398-3400 行），追加传说宝箱说明：

SEARCH：
```js
    ? '<b>道具开启</b>：棋盘每隔几秒出现 🎁 宝箱，走上去拾取（道具箱上限2）——🧱 +1 堵墙；🔨 砸碎一堵墙；🔋 恢复技能；🪤 埋陷阱；🌀 混乱对手；🛡️ 免疫 1 次技能/陷阱；💫 开箱即中眩晕。<br>'
```
REPLACE：
```js
    ? '<b>道具开启</b>：棋盘每隔几秒出现 🎁 宝箱，走上去拾取（道具箱上限2）——🧱 +1 堵墙；🔨 砸碎一堵墙；🔋 恢复技能；🪤 埋陷阱；🌀 混乱对手；🛡️ 免疫 1 次技能/陷阱；💫 开箱即中眩晕。<br>💎 <b>传说宝箱</b>（5% 出现，彩虹金光）：开箱 10% 掷出传说道具 💥 大爆炸——点击引爆，王座/棋子/墙全部随机重组（含你自己！）。<br>'
```

- [ ] 完成 B5.1 / [ ] 完成 B5.2 / [ ] 完成 B5.3 / [ ] 完成 B5.4

### Task B6：阶段 B 检查点

- [ ] `cd /Users/gjxsc/Downloads/AIgame && python3 verify_legendary.py` → **RESULT: ALL PASS**
- [ ] 复跑 `python3 verify_disasters.py` → 仍 **ALL PASS**

---

## 阶段 C：回归与 soak

### Task C1：对齐既有回归脚本

- [ ] 读 `/Users/gjxsc/Downloads/AIgame/verify_classic_disaster.py`：若其中钉死了旧数值（酸雨 1/3、暴雷 N²/4、地陷 N²/10、天降陷阱旧权重、大爆炸作为天灾等断言），更新为新数值/新事实后运行 → ALL PASS

### Task C2：全量回归

依次运行，全部要求 `RESULT: ALL PASS`：

- [ ] `python3 verify_mudflow.py`
- [ ] `python3 verify_draw_stall.py`
- [ ] `python3 verify_aiturn_deadlock.py`（若失败且与 aiUseItems 改动相关，修复后复跑）

### Task C3：soak

- [ ] `python3 verify_hang_soak.py`（或按其参数跑 5~10 分钟挂机 soak）→ 无报错、无卡死

### Task C4：人工冒烟（可选但推荐）

- [ ] 浏览器打开 `index.html?mode=spectate&skill=0&seed=42` 观战数局：天灾频率观感正常；出现 💎 传说宝箱且开箱可得 💥；AI 垫底会自爆；帮助文案正确。

---

## 完成标准

1. verify_disasters.py、verify_legendary.py 全绿；
2. 阶段 C 全部既有回归 + soak 全绿；
3. `grep -n "disasterBang" index.html` 无输出；`grep -n "Math.random" index.html` 相比改动前无新增。

---

## 执行记录（2026-09-17，本次实施实际发生的事）

### 结果
- 阶段 A：verify_disasters.py 红色基线 8 FAIL → 修改后 **10/10 ALL PASS**
- 阶段 B：verify_legendary.py 红色基线 → 修改后 **13/13 ALL PASS**；verify_disasters.py 复跑仍全绿
- 阶段 C：verify_classic_disaster（无 FAIL、天灾正常降临）、verify_draw_stall（自动重开正常）、verify_aiturn_deadlock（未复现）均通过；verify_mudflow 修复后 **ALL PASS**；soak（verify_hang_soak.py 完整 15 分钟）：**450 采样 / 48 局胜利 / 停滞 False / PAGEERRORS 0 / CONSOLE_ERRORS 0 / 堆内存恒定 10MB** ✓
- `grep -c disasterBang` = 0 ✓

### 与计划的偏差（3 处，均已解决）
1. **aiUseItems 插入落点**：计划中 SEARCH 锚 `const dists = allDists(); const myD = dists[p.color];` 在文件中多处出现，首处误插入 `aiTurn`（1608 行附近），导致 aiUse 断言失败。已移除并改插到 `aiUseItems` 内正确位置（`// 🎯 进攻目标` 注释之前）。教训：非唯一锚需带足上下文。
2. **verify_legendary.py 两处断言缺陷**：① `logLines` 上限 90 条会 `shift()`，800 次开箱后 `slice(logLen)` 恒空 → 改 `slice(-2)`；② `hostApplyAction` 入口 `if (p.ai || p.left) return;` 拒绝 AI → 测试改用 human 玩家并临时 `hp.ai=false`。
3. **verify_mudflow.py 时序脆弱**：`spawnBox` 每次多掷一次 `lg` 骰（多消耗一个 rnd()），全局种子随机流平移 → 固定种子下 AI 行为变化，踩中既有测试的时序竞态（飞行中的 AI 放墙回调落在 base 读取之后）。修复：SETUP 增加 `disastersOn=false`（隔离调度器）+ `p.ai=false`（冻结 AI 链）+ SETUP 后 `wait 800ms`（落定飞行回调）再读 base。游戏逻辑本身无 bug。
