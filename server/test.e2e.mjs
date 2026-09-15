/* 端到端协议测试：需要先起本地服务（npx wrangler dev --port 8787）
 * 用法：node server/test.e2e.mjs [ws://127.0.0.1:8787/api/room]
 */
const BASE = process.argv[2] || 'ws://127.0.0.1:8787/api/room';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ✔', name); }
  else { failed++; console.log('  ✘', name, extra); }
}

class Client {
  constructor(tag) {
    this.tag = tag;
    this.msgs = [];
    this.closed = false;
    this.closeCode = null;
  }
  connect(url) {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);
      const timer = setTimeout(() => reject(new Error('connect timeout')), 8000);
      this.ws.onopen = () => { clearTimeout(timer); resolve(); };
      this.ws.onerror = () => { clearTimeout(timer); reject(new Error('ws error')); };
      this.ws.onclose = (ev) => { this.closed = true; this.closeCode = ev.code; };
      this.ws.onmessage = (ev) => {
        try { this.msgs.push(JSON.parse(ev.data)); } catch {}
      };
    });
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  async wait(pred, label, timeout = 6000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const m = this.msgs.find(pred);
      if (m) return m;
      await sleep(50);
    }
    throw new Error(`[${this.tag}] 等不到消息: ${label}`);
  }
  seen(pred) { return this.msgs.some(pred); }
}

console.log('1) 创建房间');
const host = new Client('host');
await host.connect(`${BASE}?create=1`);
host.send({ t: 'hello', name: '房主' });
const welcome = await host.wait((m) => m.t === 'welcome', 'welcome');
check('房主拿到 welcome', welcome.isHost === true);
check('座位是 blue', welcome.seat === 'blue');
const CODE = welcome.code;
check('房间码 4 位', /^[A-Z0-9]{4}$/.test(CODE), CODE);

console.log('2) 加入');
const c2 = new Client('绿方');
await c2.connect(`${BASE}?code=${CODE}`);
c2.send({ t: 'hello', name: '小李' });
const w2 = await c2.wait((m) => m.t === 'welcome', 'welcome');
check('绿方座位', w2.seat === 'green', JSON.stringify(w2));
const roster1 = await host.wait((m) => m.t === 'roster' && m.players.length === 2, 'roster×2');
check('房主看到 2 人花名册', roster1.players[0].name === '房主' && roster1.players[1].name === '小李');

const c3 = new Client('红方');
await c3.connect(`${BASE}?code=${CODE}`);
c3.send({ t: 'hello', name: '阿红' });
await c3.wait((m) => m.t === 'welcome', 'welcome');

console.log('3) 非法加入被拒');
const cBad = new Client('错误码');
let rejected = false;
try {
  await cBad.connect(`${BASE}?code=ZZZZ`);
  cBad.send({ t: 'hello', name: 'x' });
  const err = await cBad.wait((m) => m.t === 'err' || m.t === 'welcome', 'err/welcome', 4000);
  rejected = err.t === 'err';
} catch { rejected = true; }
check('不存在的房间被拒', rejected);

console.log('4) 开局（房主广播，1 人开局 + AI 补位也可以）');
host.send({ t: 'start', settings: { sync: false, size: 9, walls: 6, items: 0, skills: true } });
const s2 = await c2.wait((m) => m.t === 'start', 'start');
check('客户端收到 start', s2.settings.size === 9 && s2.settings.walls === 6);
check('settings 白名单透传 skills 开关', s2.settings.skills === true);
check('座位表=已加入的真人（空位隐式 AI）', s2.seats.length === 3 && s2.seats[0].name === '房主');

console.log('5) 房主状态广播');
host.send({ t: 'state', s: { N: 9, turnIdx: 1, players: [{ color: 'blue' }] }, ev: [{ type: 'move', color: 'blue', jump: false }] });
const st = await c2.wait((m) => m.t === 'state', 'state');
check('客户端收到 state', st.s.turnIdx === 1 && st.ev[0].type === 'move');
const st3 = await c3.wait((m) => m.t === 'state', 'state');
check('第二个客户端也收到', st3.s.turnIdx === 1);
check('房主自己不收自己的广播', !host.seen((m) => m.t === 'state'));

console.log('6) 客户端操作转发给房主');
c2.send({ t: 'act', a: { type: 'move', x: 0, y: 6 } });
const act = await host.wait((m) => m.t === 'act', 'act');
check('房主收到 act 且带来源座位', act.from === 'green' && act.a.type === 'move' && act.a.x === 0);
c2.send({ t: 'act', a: { type: 'move', x: 0, y: 6 } });
const act2 = await host.wait((m, i) => m.t === 'act' && i > 0 && m.from === 'green' && m.a.x === 0 && m.a.y === 6, 'act#2');
check('第二条 act 也到达', !!act2);

console.log('7) 服务器拒绝越权消息');
host.send({ t: 'act', a: { type: 'move' } });          // 房主不能发 act
c2.send({ t: 'state', s: {}, ev: [] });                // 客户端不能发 state
c3.send({ t: 'start', settings: {} });                 // 非房主不能开局
await sleep(300);
check('客户端没收到转发的越权消息', !c2.seen((m) => m.t === 'act') && !c3.seen((m) => m.t === 'state' && !m.s.N));

console.log('8) 客户端掉线 → 广播 left');
c3.ws.close();
const left = await host.wait((m) => m.t === 'left', 'left');
check('房主收到 left 且带座位', left.seat === 'red' && left.name === '阿红');

console.log('9) 房主解散 → 所有人收到 host-left');
host.ws.close();
const hl2 = await c2.wait((m) => m.t === 'host-left', 'host-left', 8000);
check('客户端收到 host-left', hl2.t === 'host-left');
await sleep(300);
check('客户端连接被关闭', c2.closed);

console.log('10) 房码复用：老房间加入应被拒（实例可能还在）');
const cRe = new Client('老房码');
let reRejected = false;
try {
  await cRe.connect(`${BASE}?code=${CODE}`);
  if (cRe.closed) reRejected = true;
  else {
    cRe.send({ t: 'hello', name: 'x' });
    const m = await cRe.wait((m) => m.t === 'err' || m.t === 'welcome', 'err/welcome', 3000);
    reRejected = m.t === 'err';
  }
} catch { reRejected = true; }
check('已解散房间不可再加入', reRejected);

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
