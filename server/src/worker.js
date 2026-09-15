/* Throne Race 在线对战 · 房间中继服务器
 *
 * Worker   ：分配 4 位房间码，把 WebSocket 升级请求转给对应房间号的 Durable Object。
 * Room（DO）：每个房间一个实例，只做大厅管理（座位分配、花名册、开局）和消息转发。
 *            游戏逻辑全部运行在房主浏览器里（房主权威），服务器不理解游戏规则。
 */

const SEATS = ['blue', 'green', 'red', 'orange'];
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉 0/O/1/I，防止看错
const MAX_PLAYERS = 4;

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' },
  });

function genCode() {
  const buf = new Uint8Array(4);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

export class Room {
  constructor() {
    this.code = null;
    this.host = null;          // 房主的 WebSocket
    this.players = new Map();  // ws -> {seat, name}，插入顺序即加入顺序，第 1 位是房主
    this.status = 'lobby';     // 'lobby' | 'playing'
  }

  roster() {
    return [...this.players.values()].map((p) => ({ seat: p.seat, name: p.name }));
  }
  freeSeat() {
    const used = new Set([...this.players.values()].map((p) => p.seat));
    return SEATS.find((s) => !used.has(s)) ?? null;
  }
  send(ws, obj) {
    try { ws.send(JSON.stringify(obj)); } catch {}
  }
  broadcast(obj, except = null) {
    for (const ws of this.players.keys()) if (ws !== except) this.send(ws, obj);
  }

  // 非 WebSocket 探测：Worker 用它检查建房码冲突 / 能否加入
  probe(url) {
    if (url.searchParams.get('create') === '1') {
      return { ok: this.players.size === 0, msg: this.players.size ? '房间码冲突，请重试' : '' };
    }
    if (this.players.size === 0) return { ok: false, msg: '房间不存在，或已解散' };
    if (this.players.size >= MAX_PLAYERS) return { ok: false, msg: '房间已满（4 人）' };
    return { ok: true };
  }

  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/probe') return json(this.probe(url));
    if (url.pathname !== '/ws' || (req.headers.get('upgrade') || '').toLowerCase() !== 'websocket')
      return json({ ok: false, msg: 'expected websocket upgrade' }, 426);

    const create = url.searchParams.get('create') === '1';
    this.code = url.searchParams.get('code') || this.code;
    if (create && this.players.size > 0) return json({ ok: false, msg: '房间码冲突，请重试' }, 409);
    if (!create && this.players.size >= MAX_PLAYERS) return json({ ok: false, msg: '房间已满' }, 409);

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    server.addEventListener('message', (ev) => this.onMessage(server, ev));
    server.addEventListener('close', () => this.onClose(server));
    server.addEventListener('error', () => this.onClose(server));
    return new Response(null, { status: 101, webSocket: client });
  }

  onMessage(ws, ev) {
    if (typeof ev.data !== 'string' || ev.data.length > 16 * 1024) return;
    let m;
    try { m = JSON.parse(ev.data); } catch { return; }

    if (m.t === 'hello') {
      if (this.players.has(ws)) return;
      if (this.players.size >= MAX_PLAYERS) {
        this.send(ws, { t: 'err', msg: '房间已满（4 人）' });
        return ws.close(4000, 'full');
      }
      let name = String(m.name ?? '').replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 12);
      if (!name) name = '玩家' + (this.players.size + 1);
      const seat = this.freeSeat();
      const isHost = this.players.size === 0;
      this.players.set(ws, { seat, name });
      if (isHost) { this.host = ws; this.status = 'lobby'; }
      this.send(ws, { t: 'welcome', seat, isHost, code: this.code, players: this.roster() });
      this.broadcast({ t: 'roster', players: this.roster() }, ws);
      return;
    }

    const me = this.players.get(ws);
    if (!me) return;

    switch (m.t) {
      case 'start': {
        if (ws !== this.host) return;
        const s = m.settings ?? {};
        const settings = {
          sync: !!s.sync,
          watch: !!s.watch,   // 观战局：4 个座位全由 AI 打，房间内全员围观
          size: [9, 11, 13, 15].includes(s.size) ? s.size : 11,
          walls: Math.min(30, Math.max(1, s.walls | 0 || 8)),
          items: [0, 3, 5, 7, 10].includes(s.items) ? s.items : 0,
          skills: s.skills !== false,   // 技能系统：默认开，仅显式 false 关闭
          disasters: s.disasters !== false,
          disasterInterval: [3, 10, 20].includes(s.disasterInterval) ? s.disasterInterval : 3,
        };
        this.status = 'playing';
        this.broadcast({ t: 'start', settings, seats: this.roster() });
        return;
      }
      case 'act': {   // 普通玩家的操作 → 转给房主校验执行
        if (this.status !== 'playing' || ws === this.host) return;
        if (!m.a || JSON.stringify(m.a).length > 512) return;
        this.send(this.host, { t: 'act', from: me.seat, a: m.a });
        return;
      }
      case 'state': { // 房主的权威状态 → 广播给其他人
        if (ws !== this.host || this.status !== 'playing') return;
        if (m.s == null || JSON.stringify(m.s).length > 256 * 1024) return;
        this.broadcast({ t: 'state', s: m.s, ev: Array.isArray(m.ev) ? m.ev.slice(0, 64) : [] }, ws);
        return;
      }
      case 'ping':
        this.send(ws, { t: 'pong' });
        return;
    }
  }

  onClose(ws) {
    const me = this.players.get(ws);
    if (!me) return;
    this.players.delete(ws);
    if (ws === this.host) {
      // 房主离开 = 房间解散
      this.broadcast({ t: 'host-left' });
      for (const other of [...this.players.keys()]) {
        try { other.close(4001, 'host-left'); } catch {}
      }
      this.players.clear();
      this.host = null;
      this.status = 'lobby';
    } else {
      this.broadcast({ t: 'left', seat: me.seat, name: me.name, players: this.roster() });
    }
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/api/room') {
      const create = url.searchParams.get('create') === '1';
      const code = (url.searchParams.get('code') || '').trim().toUpperCase();
      let finalCode = code;
      if (create) {
        let ok = false;
        for (let i = 0; i < 6 && !ok; i++) {
          finalCode = genCode();
          const stub = env.ROOM.get(env.ROOM.idFromName(finalCode));
          const r = await stub.fetch('https://do/probe?create=1');
          ok = (await r.json()).ok === true;
        }
        if (!ok) return json({ ok: false, msg: '建房失败，请重试' }, 503);
      } else {
        if (!/^[A-Z0-9]{4}$/.test(code)) return json({ ok: false, msg: '房间码应为 4 位字母数字' }, 400);
        const stub = env.ROOM.get(env.ROOM.idFromName(code));
        const r = await stub.fetch('https://do/probe?join=1');
        const p = await r.json();
        if (!p.ok) return json({ ok: false, msg: p.msg || '无法加入' }, 404);
      }
      const stub = env.ROOM.get(env.ROOM.idFromName(finalCode));
      return stub.fetch(new Request(`https://do/ws?create=${create ? 1 : 0}&code=${finalCode}`, req));
    }
    return new Response(LANDING, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  },
};

const LANDING = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Throne Race · 在线对战服务器</title>
<style>body{background:#070b14;color:#dfe7f5;font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center}a{color:#5db9ff}</style>
</head><body><div>
<h1>👑 Throne Race</h1>
<p>在线对战服务器运行中。</p>
<p><a href="https://breadbot86.github.io/throne-race/">点这里去玩游戏 →</a></p>
</div></body></html>`;
