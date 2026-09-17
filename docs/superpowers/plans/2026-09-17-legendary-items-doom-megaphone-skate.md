# 实施计划：三个新传说道具（🎯天灾指定 / 📢大喇叭 / ⛸️溜冰鞋）

- 日期：2026-09-17
- 设计文档：[2026-09-17-legendary-items-doom-megaphone-skate-design.md](../specs/2026-09-17-legendary-items-doom-megaphone-skate-design.md)（已批准）
- 源码：`/Users/gjxsc/Downloads/AIgame/throne-race/index.html`；验证脚本：`/Users/gjxsc/Downloads/AIgame/`
- 非 git 仓库：无 commit；检查点 = 验证脚本 ALL PASS
- 判停原语（冲刺/模拟共用）：`!inB(nx,ny) || blocked(x,y,nx,ny) || isCollapsed(nx,ny) || pawnAt(nx,ny)`

## For agentic workers

按任务顺序执行；SEARCH/REPLACE 均为当前源码 verbatim；随机一律走 `rnd()`；若"游戏已开局"失败，对照 verify_mudflow.py 前置。

---

## 阶段 E：传说池扩展

### E1 ITEMS +3 条

SEARCH：
```js
  bang:     {icon:'💥', name:'大爆炸',     desc:'传说道具：点击引爆，王座/所有棋子/墙全部随机重组（含你自己！）', legendary:true},
};
```
REPLACE：
```js
  bang:     {icon:'💥', name:'大爆炸',     desc:'传说道具：点击引爆，王座/所有棋子/墙全部随机重组（含你自己！）', legendary:true},
  doom:     {icon:'🎯', name:'天灾指定',   desc:'传说道具：点一名对手标记，下次暴雷/泥石流必定命中其所在格/列', legendary:true},
  megaphone:{icon:'📢', name:'大喇叭',     desc:'传说道具：4格震动波，范围内墙壁全碎、敌方棋子被震飞到棋盘边缘', legendary:true},
  skate:    {icon:'⛸️', name:'溜冰鞋',     desc:'传说道具：下一次移动直线冲到棋盘边缘，遇墙/棋子停下，途中照常触发陷阱/宝箱/王座', legendary:true},
};
```

### E2 rollLegendaryKind + pickupAt 接入

SEARCH：
```js
function rollItemKind(){                   // 普通道具加权池（传说道具不进普通池）
```
REPLACE（在其前插入新函数）：
```js
const LEGENDARY_KINDS = ['bang','doom','megaphone','skate'];   // 💎 传说池：4 道具等权
function rollLegendaryKind(){ return LEGENDARY_KINDS[Math.floor(rnd()*LEGENDARY_KINDS.length)]; }
function rollItemKind(){                   // 普通道具加权池（传说道具不进普通池）
```
SEARCH（pickupAt 内）：
```js
  const kind = b.lg ? (rnd()<0.1 ? 'bang' : rollItemKind()) : b.i;
```
REPLACE：
```js
  const kind = b.lg ? (rnd()<0.1 ? rollLegendaryKind() : rollItemKind()) : b.i;
```

### E3 帮助文案传说行更新

SEARCH：
```js
💎 <b>传说宝箱</b>（5% 出现，彩虹金光）：开箱 10% 掷出传说道具 💥 大爆炸——点击引爆，王座/棋子/墙全部随机重组（含你自己！）。<br>
```
REPLACE：
```js
💎 <b>传说宝箱</b>（5% 出现，彩虹金光）：开箱 10% 掷出传说道具（4 选 1）——💥 大爆炸：全场重组；🎯 天灾指定：标记对手，下次暴雷/泥石流必命中；📢 大喇叭：4格墙全碎+震飞敌人；⛸️ 溜冰鞋：下一次移动冲到棋盘边缘。<br>
```

---

## 阶段 F：三道具实现

### F1 🎯 useDoomItem + 暴雷/泥石流必中

**F1.1 新函数**（插在 useBangItem 之后，即 `function useBangItem` 整函数结束后）：

SEARCH：
```js
  bangReshuffle(p);
  sPick(); renderPanel();
  return true;
}
```
REPLACE：
```js
  bangReshuffle(p);
  sPick(); renderPanel();
  return true;
}
function useDoomItem(p, v){                 // 🎯 天灾指定：标记对手，下次暴雷/泥石流必命中
  const i = p.inv.indexOf('doom');
  if (i<0 || !v || v===p || v.left) return false;
  p.inv.splice(i,1);
  stHit(p, 'items');
  v.doomBy = p.color;
  sPick(); renderPanel();
  fx.push({type:'stun', x:v.cell.x, y:v.cell.y, t0:performance.now(), icon:'🎯'});
  toast('🎯 '+COLORS[v.color].name+' 被标记：下次暴雷/泥石流必定命中！');
  logPush('🎯 对 '+COLORS[v.color].name+' 使用天灾指定：下次暴雷/泥石流必命中', p.color);
  return true;
}
```

**F1.2 暴雷必中**（disasterThunder，cells 行后插入；不消耗 rnd 保持随机流稳定）：

SEARCH：
```js
  const cells = shuffleArr(cands).slice(0, Math.floor(N*N/10)).map(c=>[c.x,c.y]);
  const hits = players.filter(p=>!p.left && cells.some(([x,y])=>p.cell.x===x&&p.cell.y===y));
```
REPLACE：
```js
  const cells = shuffleArr(cands).slice(0, Math.floor(N*N/10)).map(c=>[c.x,c.y]);
  const dmarked = players.find(q=>q.doomBy && !q.left);        // 🎯 天灾指定：被标者所在格必被劈中
  if (dmarked && !cells.some(([x,y])=>dmarked.cell.x===x&&dmarked.cell.y===y)) cells[0] = [dmarked.cell.x, dmarked.cell.y];
  const hits = players.filter(p=>!p.left && cells.some(([x,y])=>p.cell.x===x&&p.cell.y===y));
  for (const q of hits) if (q.doomBy) q.doomBy = null;         // 命中即消耗标记
```

**F1.3 泥石流列必含**（disasterMudflow，picked 行后插入）：

SEARCH：
```js
  const picked = shuffleArr(Array.from({length:N},(_,x)=>x)).slice(0, Math.max(1, Math.floor(N/5)));
  let broken=0; const carried=new Set();
```
REPLACE：
```js
  const picked = shuffleArr(Array.from({length:N},(_,x)=>x)).slice(0, Math.max(1, Math.floor(N/5)));
  const dmq = players.find(q=>q.doomBy && !q.left);            // 🎯 天灾指定：被标者所在列必被选中
  if (dmq){ if (!picked.includes(dmq.cell.x)) picked[0] = dmq.cell.x; dmq.doomBy = null; }   // 列入即消耗
  let broken=0; const carried=new Set();
```

### F2 📢 useMegaphoneItem + quake 特效

**F2.1 新函数**（插在 useDoomItem 之后）：

SEARCH：
```js
  logPush('🎯 对 '+COLORS[v.color].name+' 使用天灾指定：下次暴雷/泥石流必命中', p.color);
  return true;
}
```
REPLACE：
```js
  logPush('🎯 对 '+COLORS[v.color].name+' 使用天灾指定：下次暴雷/泥石流必命中', p.color);
  return true;
}
function useMegaphoneItem(p){               // 📢 大喇叭：4 格震动波，墙全碎 + 敌方棋子射线弹飞到棋盘边缘
  const i = p.inv.indexOf('megaphone');
  if (i<0) return false;
  p.inv.splice(i,1);
  stHit(p, 'items');
  const cx=p.cell.x, cy=p.cell.y;
  const d2 = (x,y)=>Math.abs(x-cx)+Math.abs(y-cy);
  let smashed=0;
  for (const key of [...wallsH]){                    // 横墙 (x,y) 覆盖 (x,y)/(x+1,y)，取较近者计距
    const [x,y]=key.split(',').map(Number);
    if (Math.min(d2(x,y), d2(x+1,y))<=4){ fx.push({type:'smash', kind:'h', x, y, t0:performance.now()}); removeWall('h', x, y); smashed++; }
  }
  for (const key of [...wallsV]){
    const [x,y]=key.split(',').map(Number);
    if (Math.min(d2(x,y), d2(x,y+1))<=4){ fx.push({type:'smash', kind:'v', x, y, t0:performance.now()}); removeWall('v', x, y); smashed++; }
  }
  let blown=0;
  for (const q of players){                          // 敌方棋子：沿 使用者→该棋子 射线推到边缘；落点被占/王座则回收
    if (q===p || q.left || d2(q.cell.x,q.cell.y)>4) continue;
    const dx=Math.sign(q.cell.x-cx), dy=Math.sign(q.cell.y-cy);
    let lx=q.cell.x, ly=q.cell.y;
    while (lx+dx>=0 && lx+dx<N && ly+dy>=0 && ly+dy<N){ lx+=dx; ly+=dy; }
    while ((lx!==q.cell.x||ly!==q.cell.y) && (pawnAt(lx,ly) || (lx===THRONE.x&&ly===THRONE.y))){ lx-=dx; ly-=dy; }
    if (lx!==q.cell.x || ly!==q.cell.y){ teleport(q, {x:lx, y:ly}); blown++; }
    stHit(q, 'disaster');
  }
  fx.push({type:'quake', x:cx, y:cy, t0:performance.now()});
  sSmash();
  logPush('📢 大喇叭震动波：'+smashed+' 堵墙震碎'+(blown?'，'+blown+' 名棋子被震飞到棋盘边缘':''), p.color);
  sPick(); renderPanel();
  return true;
}
```

**F2.2 quake 生命周期**（2838 行 filter 链）：

SEARCH：
```js
  fx = fx.filter(f=>now-f.t0 < (f.type==='openbox'?1200:((f.type==='trapgo'||f.type==='stun'||f.type==='shieldpop'||f.type==='sinkhole'||f.type==='icecrack'||f.type==='wormhit'||f.type==='lavaspray'||f.type==='dragonbreath'||f.type==='sandstorm'||f.type==='blizzard')?900:(f.type==='dfx'?(f.kind==='mudflow'?1600:1100):500))));
```
REPLACE：
```js
  fx = fx.filter(f=>now-f.t0 < (f.type==='openbox'?1200:((f.type==='trapgo'||f.type==='stun'||f.type==='shieldpop'||f.type==='sinkhole'||f.type==='icecrack'||f.type==='wormhit'||f.type==='lavaspray'||f.type==='dragonbreath'||f.type==='sandstorm'||f.type==='blizzard'||f.type==='quake')?900:(f.type==='dfx'?(f.kind==='mudflow'?1600:1100):500))));
```

**F2.3 quake 渲染**（throne case 前插入）：

SEARCH：
```js
    }else if (f.type==='throne'){           // 👑 王座迁移：金色双环
```
REPLACE：
```js
    }else if (f.type==='quake'){            // 📢 大喇叭：震动波扩散双环
      const QX=px(f.x)+CELL/2, QY=px(f.y)+CELL/2, qk=(now-f.t0)/900;
      ctx.save();
      ctx.strokeStyle='rgba(255,215,0,'+(0.85*(1-qk))+')'; ctx.lineWidth=3;
      ctx.beginPath(); ctx.arc(QX, QY, CELL*0.5+CELL*4.5*qk, 0, Math.PI*2); ctx.stroke();
      ctx.strokeStyle='rgba(255,110,199,'+(0.6*(1-qk))+')'; ctx.lineWidth=2;
      ctx.beginPath(); ctx.arc(QX, QY, CELL*0.5+CELL*3.2*qk, 0, Math.PI*2); ctx.stroke();
      ctx.restore();
    }else if (f.type==='throne'){           // 👑 王座迁移：金色双环
```

### F3 ⛸️ useSkateItem + skateDash + applyIntent

**F3.1 新函数**（插在 useMegaphoneItem 之后）：

SEARCH：
```js
  logPush('📢 大喇叭震动波：'+smashed+' 堵墙震碎'+(blown?'，'+blown+' 名棋子被震飞到棋盘边缘':''), p.color);
  sPick(); renderPanel();
  return true;
}
```
REPLACE：
```js
  logPush('📢 大喇叭震动波：'+smashed+' 堵墙震碎'+(blown?'，'+blown+' 名棋子被震飞到棋盘边缘':''), p.color);
  sPick(); renderPanel();
  return true;
}
function useSkateItem(p){                   // ⛸️ 溜冰鞋：下一次移动变为直线冲刺
  const i = p.inv.indexOf('skate');
  if (i<0 || p.skate) return false;
  p.inv.splice(i,1);
  stHit(p, 'items');
  p.skate = true;
  sPick(); renderPanel();
  logPush('使用 ⛸️ 溜冰鞋：下一次移动将直线冲刺', p.color);
  return true;
}
function skateDash(p, cell){                // ⛸️ 冲刺：沿方向逐格滑行（每格照常结算 陷阱/宝箱/王座），遇阻/被改写位置则停
  p.skate = false;
  const dx = Math.sign(cell.x - p.cell.x), dy = Math.sign(cell.y - p.cell.y);
  if (!dx && !dy) return;
  let steps=0;
  while (!winner){
    const {x,y} = p.cell;
    const nx=x+dx, ny=y+dy;
    if (!inB(nx,ny) || blocked(x,y,nx,ny) || isCollapsed(nx,ny) || pawnAt(nx,ny)) break;   // 边缘/墙/塌陷/棋子拦停
    doMove(p, {x:nx, y:ny});
    steps++;
    if (p.cell.x!==nx || p.cell.y!==ny) break;   // 陷阱/暴风改写了落点：终止
  }
  if (steps) logPush('⛸️ 溜冰鞋冲刺 '+steps+' 格 →('+p.cell.x+','+p.cell.y+')', p.color);
}
```

**F3.2 applyIntent move 分支扩展**：

SEARCH：
```js
function applyIntent(p, a){
  if (a.type==='move') doMove(p, {x:a.x, y:a.y, slide:!!a.slide});
```
REPLACE：
```js
function applyIntent(p, a){
  if (a.type==='move'){
    if (p.skate) skateDash(p, {x:a.x, y:a.y});   // ⛸️ 冲刺接管单步移动
    else doMove(p, {x:a.x, y:a.y, slide:!!a.slide});
  }
```
（注意：原 else if 链结构——`if (a.type==='move') doMove(...); else if (...)` 改成块后需保证后续 else if 语法正确，REPLACE 已含。）

### F4 三链路接入

**F4.1 clickInvSlot**：doom 并入 pendingItem 型；megaphone/skate 即时型。

SEARCH：
```js
  }else if (kind==='trap' || kind==='confusion'){
    if (pendingItem===kind){ pendingItem=null; renderPanel(); return; }   // 再点一次取消
    pendingItem=kind;
    pendingSkill=null;                    // 与技能待选互斥
    renderPanel();
    toast(kind==='trap' ? '🪤 点击一个空格埋入陷阱（仅自己可见）' : '🌀 点击一名对手：混乱其下一步方向');
  }else{
```
REPLACE：
```js
  }else if (kind==='trap' || kind==='confusion' || kind==='doom'){
    if (pendingItem===kind){ pendingItem=null; renderPanel(); return; }   // 再点一次取消
    pendingItem=kind;
    pendingSkill=null;                    // 与技能待选互斥
    renderPanel();
    toast(kind==='trap' ? '🪤 点击一个空格埋入陷阱（仅自己可见）'
        : kind==='doom'  ? '🎯 点击一名对手：标记下次暴雷/泥石流必命中'
        : '🌀 点击一名对手：混乱其下一步方向');
  }else if (kind==='megaphone'){
    if (isOnline()){
      if (hostSim()) hostApplyAction(p, {type:'itemuse', kind:'megaphone'});
      else { busy=true; setTimeout(()=>{busy=false;},2500); netSend({t:'act', a:{type:'itemuse', kind:'megaphone'}}); }
    }else{
      useMegaphoneItem(p);
      toast('📢 震动波扩散！');
    }
  }else if (kind==='skate'){
    if (isOnline()){
      if (hostSim()) hostApplyAction(p, {type:'itemuse', kind:'skate'});
      else { busy=true; setTimeout(()=>{busy=false;},2500); netSend({t:'act', a:{type:'itemuse', kind:'skate'}}); }
    }else{
      useSkateItem(p);
      toast('⛸️ 下一次移动将直线冲刺');
    }
  }else{
```

**F4.2 板点击目标分发**（doom 并入）：

SEARCH：
```js
  if (pendingItem==='trap' || pendingItem==='confusion'){
```
REPLACE：
```js
  if (pendingItem==='trap' || pendingItem==='confusion' || pendingItem==='doom'){
```
SEARCH：
```js
    let intent;
    if (kind==='trap') intent={type:'itemuse', kind:'trap', x:tx, y:ty};
    else{
      const v=pawnAt(tx,ty);
      if (!v || v===pa || v.left){ toast('要点一名对手'); return; }
      intent={type:'itemuse', kind:'confusion', t:{color:v.color}};
    }
```
REPLACE：
```js
    let intent;
    if (kind==='trap') intent={type:'itemuse', kind:'trap', x:tx, y:ty};
    else{
      const v=pawnAt(tx,ty);
      if (!v || v===pa || v.left){ toast('要点一名对手'); return; }
      intent={type:'itemuse', kind: kind==='doom'?'doom':'confusion', t:{color:v.color}};
    }
```
SEARCH：
```js
      const ok = kind==='trap' ? useTrapItem(pa, tx, ty) : useConfusionItem(pa, pawnAt(tx,ty));
      if (!ok) toast(kind==='trap' ? '那里埋不了陷阱' : '目标无效');
```
REPLACE：
```js
      const ok = kind==='trap' ? useTrapItem(pa, tx, ty)
               : kind==='doom'  ? useDoomItem(pa, pawnAt(tx,ty))
               : useConfusionItem(pa, pawnAt(tx,ty));
      if (!ok) toast(kind==='trap' ? '那里埋不了陷阱' : '目标无效');
```

**F4.3 hostApplyAction 三分支**（bang 分支后）：

SEARCH：
```js
  }else if (a.type==='itemuse' && a.kind==='bang'){
    if (!useBangItem(p)) return reject('没有 💥 大爆炸道具');
  }else if (a.type==='skilluse'){
```
REPLACE：
```js
  }else if (a.type==='itemuse' && a.kind==='bang'){
    if (!useBangItem(p)) return reject('没有 💥 大爆炸道具');
  }else if (a.type==='itemuse' && a.kind==='doom'){
    const v = players.find(q=>q.color===(a.t||{}).color);
    if (!useDoomItem(p, v)) return reject('目标无效');
  }else if (a.type==='itemuse' && a.kind==='megaphone'){
    if (!useMegaphoneItem(p)) return reject('没有 📢 大喇叭');
  }else if (a.type==='itemuse' && a.kind==='skate'){
    if (!useSkateItem(p)) return reject('没有 ⛸️ 溜冰鞋');
  }else if (a.type==='skilluse'){
```

**F4.4 aiUseItems 三规则**（bang 块后、ahead 前插 megaphone+skate；ahead 后插 doom）：

SEARCH：
```js
  const bi = p.inv.indexOf('bang');
  if (bi>=0){                            // 💥 垫底（无人比我离王座更远）或无路可走 → 引爆大爆炸搏一把
    const rivals = players.filter(q=>q!==p && !q.left);
    if ((rivals.length && rivals.every(q=>dists[q.color] <= myD)) || !legalMoves(p).length){
      useBangItem(p);
      return true;
    }
  }
  // 🎯 进攻目标：所有跑到我前面的对手，最近的优先打（不只盯全场第一，第二三名逼近照打）
  const ahead = players.filter(q=>q!==p && !q.left && dists[q.color] < myD)
                       .sort((a,b)=>dists[a.color]-dists[b.color]);
```
REPLACE：
```js
  const bi = p.inv.indexOf('bang');
  if (bi>=0){                            // 💥 垫底（无人比我离王座更远）或无路可走 → 引爆大爆炸搏一把
    const rivals = players.filter(q=>q!==p && !q.left);
    if ((rivals.length && rivals.every(q=>dists[q.color] <= myD)) || !legalMoves(p).length){
      useBangItem(p);
      return true;
    }
  }
  if (p.inv.indexOf('megaphone')>=0){    // 📢 4 格内墙≥2 或敌≥1 → 震一波
    const cx=p.cell.x, cy=p.cell.y, md=(x,y)=>Math.abs(x-cx)+Math.abs(y-cy);
    let wn=0, en=0;
    for (const key of wallsH){ const [x,y]=key.split(',').map(Number); if (Math.min(md(x,y),md(x+1,y))<=4) wn++; }
    for (const key of wallsV){ const [x,y]=key.split(',').map(Number); if (Math.min(md(x,y),md(x,y+1))<=4) wn++; }
    for (const q of players){ if (q!==p && !q.left && md(q.cell.x,q.cell.y)<=4) en++; }
    if (wn>=2 || en>=1){ useMegaphoneItem(p); return true; }
  }
  if (p.inv.indexOf('skate')>=0){        // ⛸️ 四方向模拟冲刺：存在终点更近王座的方向则激活
    const sdist = bfsFromThrone(wallsH,wallsV).dist;
    const cur = sdist[p.cell.y*N+p.cell.x];
    for (const [ddx,ddy] of [[1,0],[-1,0],[0,1],[0,-1]]){
      let x=p.cell.x, y=p.cell.y, moved=false;
      while (true){
        const nx=x+ddx, ny=y+ddy;
        if (!inB(nx,ny) || blocked(x,y,nx,ny) || isCollapsed(nx,ny) || pawnAt(nx,ny)) break;
        x=nx; y=ny; moved=true;
      }
      if (moved && sdist[y*N+x] < cur){ useSkateItem(p); return true; }
    }
  }
  // 🎯 进攻目标：所有跑到我前面的对手，最近的优先打（不只盯全场第一，第二三名逼近照打）
  const ahead = players.filter(q=>q!==p && !q.left && dists[q.color] < myD)
                       .sort((a,b)=>dists[a.color]-dists[b.color]);
  if (p.inv.indexOf('doom')>=0 && ahead.length){ useDoomItem(p, ahead[0]); return true; }   // 🎯 标记领跑者
```

### F5 快照字段 + 头顶徽标

**F5.1 serializeState**：

SEARCH：
```js
      cnf:p.confused?1:0, stn:p.stunTag?1:0, shd:p.shield?1:0, rb:p.rainBoost?1:0, cm:p.camel||0,
```
REPLACE：
```js
      cnf:p.confused?1:0, stn:p.stunTag?1:0, shd:p.shield?1:0, rb:p.rainBoost?1:0, cm:p.camel||0,
      dm:p.doomBy||null, sk8:p.skate?1:0,
```

**F5.2 applySnapshot**：

SEARCH：
```js
      confused: !!sp.cnf, stunTag: !!sp.stn, shield: !!sp.shd, rainBoost: !!sp.rb, camel: sp.cm||0,
```
REPLACE：
```js
      confused: !!sp.cnf, stunTag: !!sp.stn, shield: !!sp.shd, rainBoost: !!sp.rb, camel: sp.cm||0,
      doomBy: sp.dm||null, skate: !!sp.sk8,
```

**F5.3 头顶徽标**（眩晕段后、camel 段前）：

SEARCH：
```js
    if (isSyncMode()? now<p.frozenUntil : p.frozenTurns>0){   // ❄️ 定身 / 💫 眩晕：头顶正中悬停，直至效果结束
      ctx.font=Math.floor(CELL*0.5)+'px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(p.stunTag?'💫':'❄️', X+CELL*0.02, Y-CELL*0.6+Math.sin(now/170)*2);
    }
```
REPLACE：
```js
    if (isSyncMode()? now<p.frozenUntil : p.frozenTurns>0){   // ❄️ 定身 / 💫 眩晕：头顶正中悬停，直至效果结束
      ctx.font=Math.floor(CELL*0.5)+'px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(p.stunTag?'💫':'❄️', X+CELL*0.02, Y-CELL*0.6+Math.sin(now/170)*2);
    }
    if (p.skate || p.doomBy){          // ⛸️ 冲刺就绪 / 🎯 被天灾指定：头顶徽标（全员可见）
      ctx.font=Math.floor(CELL*0.4)+'px serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
      if (p.skate) ctx.fillText('⛸️', X+CELL*0.75, Y-CELL*0.5+Math.sin(now/200)*1.5);
      if (p.doomBy) ctx.fillText('🎯', X-CELL*0.55, Y-CELL*0.5+Math.sin(now/200+1)*1.5);
    }
```

---

## 阶段 G：验证

### G1 verify_legendary_items.py（新建，全文见执行时落盘）

断言清单：传说池 4 等权（400 采样各 15%~35%）；doom→暴雷必中+眩晕2+标记消耗、泥石流列必含+消耗、disasterAcid 不消耗、覆盖标记；megaphone→范围内横/竖墙碎、范围外留、射线弹飞到边缘、落点被占回收、自己不动；skate→冲到边缘格、墙拦停、塌陷拦停、棋子拦停、陷阱终止、宝箱拾取、冲王座获胜、buff 一次性；AI 三道具触发；快照 dm/sk8；帮助文案含三图标。

- [ ] `python3 verify_legendary_items.py` → ALL PASS
- [ ] 复跑 verify_disasters.py / verify_legendary.py → ALL PASS
- [ ] 复跑 verify_mudflow / verify_classic_disaster / verify_draw_stall / verify_aiturn_deadlock → 通过
- [ ] `python3 verify_hang_soak.py`（15 分钟）→ 零错误零停滞
- [ ] `grep -c "rollLegendaryKind\|useDoomItem\|useMegaphoneItem\|skateDash" index.html` ≥ 6（函数定义+调用齐全）

---

## 执行记录（2026-09-17）

### 结果
- 21 处 SEARCH/REPLACE 一次全部命中（锚点均为本会话 verbatim 采集）
- verify_legendary_items.py（新，24 断言）：**ALL PASS**——传说池 4 等权（99/99/113/89）、doom 暴雷必中+消耗+覆盖+泥石流列必含+酸雨不消耗、megaphone 范围碎墙（横/竖覆盖格计距）+射线弹飞+落点回收+占位者/自己不受影响、skate 冲边缘/墙拦停/陷阱终止/宝箱拾取/冲王座获胜/一次性、AI 三道具、快照 dm/sk8、帮助文案
- 全量回归 7 脚本：verify_disasters / verify_legendary / verify_mudflow / verify_classic_disaster / verify_draw_stall / verify_aiturn_deadlock 全部通过
- soak：**450 采样 / 49 局胜利 / 停滞 False / PAGEERRORS 0 / CONSOLE_ERRORS 0 / 堆内存恒定 10MB** ✓

### 与计划的偏差（2 处，均非游戏逻辑 bug）
1. **verify_legendary_items.py 6a 清场不足**：megaphone 测试结束时 p2 恰停在 (10,2)，6a 冲刺被其拦停（棋子拦停正是设计行为）→ 测试 6a 前增加清场（对手移 y=9 行 + 王座临时挪 (5,5) 冲完还原）
2. **verify_legendary.py 断言过时**：旧断言钉死"传说开箱=大爆炸 10%"，本轮 4 等权后实测 2.25%=10%×¼ 属正确行为 → 断言改为"传说道具总比例 ≈10%"；另修复同作用域 `lgN` 变量重复声明（改名 `lgOpen`）
