// STATIC server: rooms, shared game state, objectives, and the monster AI.
const express = require('express'), http = require('http'), path = require('path');
const { Server } = require('socket.io');
const app = express(), srv = http.createServer(app), io = new Server(srv);
app.use(express.static(path.join(__dirname, '..', 'client')));

const C = 4; // size of one map cell in world units

// ---------- The facility: a 5 x 4 grid of 20 rooms joined by doors ----------
const RW = 6, RH = 4, NC = 5, NR = 4, SX = RW + 1, SY = RH + 1; // room size in cells, and spacing between rooms
const GW = NC * SX + 1, MAINH = NR * SY + 1; // 36 x 21 cells
const ROOMS = [
  ['Reception', 'Lobby', 'Lab Alpha', 'Lab Beta', 'Cold Storage'],
  ['Records Office', 'Specimen Hall', 'Lab Gamma', 'Observation Lab', 'Boiler Room'],
  ['Break Room', 'CCTV Hub', 'Server Hall', 'Pipe Tunnel', 'Generator Room'],
  ['Locker Room', 'Security Office', 'Control Antechamber', 'Utility Corridor', 'Signal Chamber']];
const rx = c => 1 + c * SX, ry = r => 1 + r * SY; // top-left floor cell of the room at row r, column c
const grid = Array.from({ length: MAINH }, () => Array(GW).fill('#'));
for (let r = 0; r < NR; r++) for (let c = 0; c < NC; c++) for (let y = 0; y < RH; y++) for (let x = 0; x < RW; x++) grid[ry(r) + y][rx(c) + x] = '.';
// [row, col] door joins (row, col) with (row, col + 1) for H_DOORS, and with (row + 1, col) for V_DOORS.
const H_DOORS = [[0,0],[0,1],[0,2],[0,3],[1,1],[1,3],[2,0],[2,1],[2,3],[3,0],[3,1],[3,2],[3,3]];
const V_DOORS = [[0,0],[1,0],[2,0],[0,1],[1,1],[0,2],[2,2],[0,3],[1,3],[2,3],[0,4],[1,4]];
let GATE = null; // the only way into the Signal Chamber; closed until power is restored
H_DOORS.forEach(([r, c]) => { const y = ry(r) + 1 + (r + c) % 2, x = rx(c) + RW; grid[y][x] = '.'; if (r === 3 && c === 3) GATE = { c: x, r: y }; });
V_DOORS.forEach(([r, c]) => { grid[ry(r) + RH][rx(c) + 1 + (r + c) % 4] = '.'; });
// pillars and blocks give rooms different shapes and corners to hide behind (the outer ring of every room stays open)
for (let r = 0; r < NR; r++) for (let c = 0; c < NC; c++) {
  if ((r === 0 && c === 0) || (r === 3 && c === 4)) continue;
  [[], [[2,1],[3,2]], [[2,1],[3,1]], [[1,2],[4,1]]][(r * NC + c) % 4].forEach(([dx, dy]) => { grid[ry(r) + dy][rx(c) + dx] = '#'; });
}
const G = grid.map(row => row.join(''));
// Finale chase hallway below the facility: three 2-cell-wide runs joined by gaps, like a long serpentine corridor.
const pad = s => s + '#'.repeat(GW - s.length), hall = pad('#' + '.'.repeat(22) + '#');
G.push('#'.repeat(GW), hall, hall, pad('#'.repeat(21) + '..#'), hall, hall, pad('#..' + '#'.repeat(21)), hall, hall, '#'.repeat(GW));
const CZ = (MAINH - 11) * C; // the hallway coordinates below were designed to start at row 11
const CHASE = { // speed: just below a sprinting player (6.2), so only mistakes get you caught
  spd: 5.5, exit: { x: 90, z: 76 + CZ }, spawnZ: [50 + CZ, 54 + CZ], monster: { x: 6, z: 52 + CZ }, segZ: [52 + CZ, 64 + CZ, 76 + CZ],
  blocks: [[46,49.4],[54,54.6],[62,49.4],[70,54.6],[78,49.4], [80,61.4],[72,66.6],[64,61.4],[56,66.6],[48,61.4],[40,66.6],[24,61.4],[16,66.6], [52,73.4],[60,78.6],[68,73.4],[36,78.6]].map(([x, z]) => { const c = [52, 64, 76].find(c => Math.abs(z - c) < 5); return { x, z: (z < c ? c - 1.4 : c + 1.4) + CZ, w: 2, d: 3 }; }), // racks poke past the middle, so you must slalom
  // live cables: x, z, width, depth, cycle seconds, seconds live, time offset
  arcs: [[50,52,2.2,8,3.2,1.4,0],[58,52,2.2,8,3.6,1.5,1],[74,50,2.4,4,2.8,1.4,.5],[82,54,2.4,4,3,1.4,1.5],
    [76,64,2.2,8,3,1.5,.4],[58,64,2.2,8,3.6,1.6,1.5],[44,66,2.4,4,2.8,1.4,.2],[32,64,2.2,8,2.8,1.2,1],
    [24,76,2.2,8,3,1.4,.3],[34,78,2.4,4,2.8,1.4,.9],[44,76,2.2,8,3.4,1.5,1],[76,76,2.2,8,2.6,1.2,0],[82,74,2.4,4,2.8,1.4,1.6]].map(([x, z, w, d, p, on, o]) => ({ x, z: z + CZ, w, d, p, on, o }))
};
// Objects live on the top or bottom row of a room (dy 0 or 3), where no pillar can ever be.
const at = (r, c, dx, dy) => ({ c: rx(c) + dx, r: ry(r) + dy });
const OBJ = [
  { id: 'd1', type: 'doc', ...at(1, 0, 4, 3) }, { id: 'd2', type: 'doc', ...at(1, 3, 1, 0) }, { id: 'd3', type: 'doc', ...at(2, 4, 3, 3) },
  { id: 'sec', type: 'sec', ...at(3, 1, 2, 0) }, { id: 'b1', type: 'brk', ...at(0, 4, 4, 3) }, { id: 'b2', type: 'brk', ...at(2, 2, 1, 3) },
  { id: 'fin', type: 'fin', ...at(3, 4, 3, 3) },
  ...[[0,0,0,3],[0,1,5,0],[0,2,0,3],[0,3,5,3],[1,0,5,0],[1,1,0,3],[1,2,5,3],[1,4,0,0],[2,0,5,3],[2,1,0,0],[2,2,5,0],[2,3,0,3],[3,0,2,3],[3,3,5,0]].map((a, i) => ({ id: 'k' + (i + 1), type: 'lock', ...at(...a) })),
  ...[[0,0,3,0],[0,1,2,0],[0,2,3,3],[0,3,2,0],[1,0,2,3],[1,1,4,0],[1,3,4,3],[2,0,4,3],[2,1,2,0],[2,1,3,3],[2,2,3,0],[3,1,1,0],[3,2,2,0],[3,3,2,3]].map((a, i) => ({ id: 'm' + (i + 1), type: 'mon', ...at(...a) }))
].map(o => ({ ...o, x: (o.c + .5) * C, z: (o.r + .5) * C }));
const MAP = { SX, SY, RW, RH, NC, NR, MAINH, ROOMS };
const DOC = [
  { title: 'Memo: Project STATIC', text: 'To all research staff,\n\nProject STATIC listened to the sky. Then it began listening back.\n\nDo not answer the radios. Do not answer the monitors. If a screen shows you something standing behind you, do not turn around. Walk to the nearest door and keep walking.\n\n- Dr. Hale, Director of Research' },
  { title: 'Lab log, day 41', text: 'We stopped transmitting on day 12.\n\nThe signal did not stop.\n\nOn day 30 it started using our voices. Yesterday the speakers said my name in my own voice, from the next corridor, while I was standing in this one.\n\nIt lives in anything with power. It cannot hear you when the room is quiet, so stay still, stay low, and stay out of the light.' },
  { title: 'Scrawled note', text: 'Hale will not admit it, but the signal is not a weapon. It is a message that was never finished.\n\nHis final recording is still in the array. Play it BACKWARDS into the chamber terminal and the carrier collapses.\n\nDo not tell the Director.' }
];

const DIFF = { // monster speed, detection range, corruption rate, capture penalty, dormancy, locker search chance, EMP cooldown (s), stun length (s), scare frequency
  easy: { spd: .85, det: .7, cor: .6, pen: 5, dor: 1.4, hid: .25, emp: 45, stun: 5, sc: 1.5 },
  normal: { spd: 1, det: 1, cor: 1, pen: 8, dor: 1, hid: .45, emp: 60, stun: 4, sc: 1 },
  hard: { spd: 1.15, det: 1.35, cor: 1.5, pen: 12, dor: .7, hid: .65, emp: 90, stun: 3, sc: .7 } };
const rooms = new Map(), rand = (a, b) => a + Math.random() * (b - a), pick = a => a[Math.random() * a.length | 0];
const chapter = st => st.over || st.chase ? 5 : Math.max(st.power ? 4 : (st.br.b1 || st.br.b2) ? 3 : (st.sec || st.docs.length) ? 2 : 1, st.t > 180 ? 3 : st.t > 90 ? 2 : 1);
const msg = (r, t) => io.to(r.code).emit('msg', t);
const fx = (r, t, p, k) => io.to(r.code).emit('fx', { t, x: r.st.m.x, z: r.st.m.z, id: p && p.id, k });
const fin = (r, type) => { r.st.over = type; io.to(r.code).emit('end', { type, docs: r.st.docs.length, t: Math.round(r.st.t), downs: r.st.downs || 0 }); };
function down(r, p) { p.down = true; p.hid = false; r.st.downs = (r.st.downs || 0) + 1; r.st.corr += r.d.pen; fx(r, 'caught', p); }
function to(r, s, t) { const m = r.st.m; if (s === 'dormant') t *= r.d.dor; m.s = s; m.t = t; m.ft = 2; m.wt = 0; m.vis = ['stalking', 'hunting', 'searching'].includes(s); if (s === 'hunting') fx(r, 'manifest'); }

function bfs(a, b) { // shortest path over floor cells, returns cell centres
  const k = (c, r) => r * GW + c, s = [a.x / C | 0, a.z / C | 0], g = [b.x / C | 0, b.z / C | 0];
  const prev = new Map([[k(s[0], s[1]), null]]), q = [s]; let qi = 0;
  while (qi < q.length) {
    const [c, r] = q[qi++]; if (c === g[0] && r === g[1]) break;
    for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nc = c + dc, nr = r + dr;
      if (G[nr] && G[nr][nc] === '.' && !prev.has(k(nc, nr))) { prev.set(k(nc, nr), [c, r]); q.push([nc, nr]); }
    }
  }
  if (!prev.has(k(g[0], g[1]))) return [];
  const path = []; let cur = g;
  while (cur) { path.unshift({ x: (cur[0] + .5) * C, z: (cur[1] + .5) * C }); cur = prev.get(k(cur[0], cur[1])); }
  return path;
}
function step(m, goal, sp, dt) { // returns true when it has arrived
  if (m.stun > 0) return false; // stunned by an EMP: frozen in place
  m.pt -= dt;
  if (m.pt <= 0) { // re-plan often; head straight for the next cell, finish at the exact goal point
    const p = bfs(m, goal); if (p.length > 1) p.shift();
    if (p.length) p[p.length - 1] = { x: goal.x, z: goal.z };
    m.path = p; m.pt = .3;
  }
  m.ss = (m.ss || 0) + dt; // failsafe: if it has not moved for 2 seconds, snap to its cell centre and re-plan
  if (m.ss > 2) { if (m.path.length && Math.hypot(m.x - m.sx, m.z - m.sz) < .4) { m.x = ((m.x / C | 0) + .5) * C; m.z = ((m.z / C | 0) + .5) * C; m.pt = 0; } m.sx = m.x; m.sz = m.z; m.ss = 0; }
  if (!G[m.z / C | 0] || G[m.z / C | 0][m.x / C | 0] !== '.') { // never stand inside a wall: jump to the nearest floor cell
    let b = 1e9; for (let r = 0; r < G.length; r++) for (let c = 0; c < GW; c++) if (G[r][c] === '.') { const q = Math.hypot((c + .5) * C - m.x, (r + .5) * C - m.z); if (q < b) { b = q; m.nx = (c + .5) * C; m.nz = (r + .5) * C; } }
    m.x = m.nx; m.z = m.nz; m.pt = 0;
  }
  const n = m.path[0]; if (!n) return true;
  const dx = n.x - m.x, dz = n.z - m.z, d = Math.hypot(dx, dz);
  if (d < .5) { m.path.shift(); return false; }
  const nx = m.x + dx / d * sp * dt, nz = m.z + dz / d * sp * dt;
  if (G[nz / C | 0] && G[nz / C | 0][nx / C | 0] === '.') { m.x = nx; m.z = nz; } else { m.pt = 0; m.path = []; } // never step into a wall
  return false;
}

function watch(r, p) { // STATIC sees through screens near a player, and learns where they are
  const m = r.st.m;
  if (OBJ.some(o => o.type === 'mon' && Math.hypot(o.x - p.x, o.z - p.z) < 12)) { m.ev = { x: p.x, z: p.z, id: p.id }; m.tid = p.id; m.aw = Math.min(1, m.aw + .18); }
}
function patrol(m, dt, sp) { // unseen, it wanders the building so it is never just parked in one place
  if (!m.pg || step(m, m.pg, sp, dt)) { const c = 1 + Math.random() * (GW - 2) | 0, r = 1 + Math.random() * (MAINH - 2) | 0; if (G[r][c] === '.') m.pg = { x: (c + .5) * C, z: (r + .5) * C }; }
}
function emitSnap(r) {
  const st = r.st, m = st.m, ch = chapter(st), now = Date.now();
  io.to(r.code).emit('snap', {
    p: Object.values(r.p).map(p => ({ id: p.id, n: p.name, x: p.x, z: p.z, ry: p.ry, cr: p.cr, fl: p.fl, d: p.down, h: p.hid, ec: Math.max(0, +((p.empAt + r.d.emp * 1000 - now) / 1000).toFixed(1)) })),
    m: { x: m.x, z: m.z, v: m.vis, s: m.s, u: m.stun > 0 ? 1 : 0 },
    st: { pw: st.power, br: st.br, dc: st.docs.length, sec: st.sec, co: st.corr, cd: 0, ch },
    ct: st.chase && st.chase.phase === 'run' ? st.chase.t : 0
  });
}
function beginChase(r) { // everyone is thrown into the hallway; STATIC appears behind them
  const st = r.st, m = st.m; st.chase = { phase: 'run', t: 0 }; const pos = {}; let i = 0;
  for (const p of Object.values(r.p)) { p.x = 22 + i * 2.5; p.z = CHASE.spawnZ[i % 2]; p.lx = p.x; p.lz = p.z; p.down = false; p.hid = false; pos[p.id] = { x: p.x, z: p.z }; i++; }
  Object.assign(m, { x: CHASE.monster.x, z: CHASE.monster.z, path: [], pt: 0, ev: null, s: 'hunting', vis: true, stun: 0 });
  io.to(r.code).emit('chase', { pos });
}
function chaseTick(r, al, dt) {
  const st = r.st, m = st.m, c = st.chase; c.t += dt;
  if (c.phase === 'intro') { m.vis = false; if (c.t >= 3) beginChase(r); return; }
  let tgt = al[0], best = 1e9; // chases whoever is closest along the hallway
  for (const p of al) { const L = bfs(m, p).length; if (L && L < best) { best = L; tgt = p; } }
  step(m, tgt, Math.min(CHASE.spd * r.d.spd, 6), dt); // never as fast as a sprinting player (6.2)
  if (Math.hypot(tgt.x - m.x, tgt.z - m.z) < 1.3 && !(m.stun > 0)) down(r, tgt);
  for (const p of al) if (Math.hypot(p.x - CHASE.exit.x, p.z - CHASE.exit.z) < 3.5) return fin(r, 'escape');
}
function tick(r) {
  const st = r.st, m = st.m, dt = .066, ch = chapter(st), D = r.d;
  const al = Object.values(r.p).filter(p => !p.down);
  if (!al.length) return fin(r, 'fail');
  if (m.stun > 0) m.stun -= dt;
  if (st.chase) { chaseTick(r, al, dt); return emitSnap(r); }
  st.t += dt; st.corr = Math.min(100, st.corr + dt * (ch >= 3 ? .15 : .03) * (m.s === 'hunting' ? 3 : 1) * D.cor);
  if (st.corr >= 100) return fin(r, 'fail');
  m.t -= dt;
  // The monster only knows what it has sensed: noise, flashlights, standing still, interactions.
  for (const p of al) {
    const moved = Math.hypot(p.x - p.lx, p.z - p.lz); p.lx = p.x; p.lz = p.z; p.still = moved < .02 ? p.still + dt : 0;
    const d = Math.hypot(p.x - m.x, p.z - m.z);
    const loud = p.hid ? 0 : (p.noise * 16 + (p.fl ? 5 : 0) + (p.still > 20 ? 6 : 0)) * D.det;
    if (d < loud || (m.vis && d < 9 && !p.hid)) { m.ev = { x: p.x, z: p.z, id: p.id }; m.tid = p.id; m.aw = Math.min(1, m.aw + dt * .25); }
  }
  m.aw = Math.max(0, m.aw - dt * .02);
  // rare scares that cannot hurt you: something behind you, in the dark, in a screen, or in your ear
  if ((st.scT -= dt) <= 0 && ch >= 2 && ['dormant', 'observing', 'interfering'].includes(m.s)) {
    st.scT = rand(90, 150) * D.sc; const tg = pick(al), kinds = ['behind', 'front', 'whisper'];
    if (OBJ.some(o => o.type === 'mon' && Math.hypot(o.x - tg.x, o.z - tg.z) < 12)) kinds.push('monitor', 'monitor');
    fx(r, 'scare', tg, pick(kinds));
  }
  let tgt = r.p[m.tid]; if (!tgt || tgt.down) { tgt = pick(al); m.tid = tgt.id; }
  const d = Math.hypot(tgt.x - m.x, tgt.z - m.z);
  switch (m.s) {
    case 'dormant': patrol(m, dt, 2.4 * D.spd); if (m.t <= 0) to(r, 'observing', rand(10, 16)); break;
    case 'observing': patrol(m, dt, 2 * D.spd);
      if ((m.ft -= dt) <= 0) { fx(r, 'screen', tgt); watch(r, tgt); m.ft = rand(3, 6); }
      if (m.ev && m.aw > .3) to(r, 'interfering', rand(10, 16)); else if (m.t <= 0) to(r, 'dormant', rand(10, 20)); break;
    case 'interfering': patrol(m, dt, 2 * D.spd);
      if ((m.ft -= dt) <= 0) { fx(r, pick(['lights', 'radio', 'screen', 'steps', 'pc']), tgt); watch(r, tgt); m.ft = rand(3, 6); }
      if (m.t <= 0) { if (ch >= 2 && m.ev && m.aw > .35) to(r, 'investigating', 30); else to(r, 'dormant', rand(8, 16)); } break;
    case 'investigating':
      if ((m.ft -= dt) <= 0) { fx(r, 'steps', tgt); m.ft = rand(4, 7); }
      if (!m.ev || m.t <= 0) to(r, 'dormant', 12);
      else if (step(m, m.ev, 3.2 * D.spd, dt)) to(r, ch >= 2 && m.aw > .5 ? 'stalking' : 'searching', rand(8, 12)); break;
    case 'stalking':
      if (m.wt <= 0 && d > 4.5) step(m, tgt, (d > 10 ? 3.6 : 2.2) * D.spd, dt); // creeps closer
      if (m.wt > 0) { m.wt -= dt; if (m.wt <= 0) to(r, 'hunting', 20); }
      else if (ch >= 3 && (m.t <= 0 || m.aw > .9 || d < 5)) { m.wt = 2.5; fx(r, 'warn', tgt); } // a quiet light flicker before every chase
      else if (m.t <= 0 || (ch < 3 && d < 5)) { fx(r, 'vanish'); to(r, 'retreating', 3); } break;
    case 'hunting':
      if (tgt.hid) { m.ev = { x: tgt.x, z: tgt.z, id: tgt.id }; to(r, 'searching', 10); break; }
      step(m, tgt, (ch >= 5 ? 5.2 : 4.4) * D.spd, dt);
      if (d < 1.3 && !(m.stun > 0)) { down(r, tgt); to(r, 'retreating', 3); }
      else if (m.t <= 0) to(r, 'searching', 10); break;
    case 'searching':
      if (step(m, m.ev || m, 3 * D.spd, dt) || m.t <= 0) { // hiding places are not safe if it gets close
        for (const p of al) if (p.hid && Math.hypot(p.x - m.x, p.z - m.z) < 5 && Math.random() < D.hid) { down(r, p); break; }
        fx(r, 'vanish'); to(r, 'retreating', 3);
      } break;
    case 'retreating':
      if (m.t <= 0) {
        for (let i = 0; i < 40; i++) {
          const c = 1 + Math.random() * (GW - 2) | 0, rr = 1 + Math.random() * (MAINH - 2) | 0; if (G[rr][c] !== '.') continue;
          const x = (c + .5) * C, z = (rr + .5) * C;
          if (al.every(p => Math.hypot(p.x - x, p.z - z) > 40)) { m.x = x; m.z = z; break; }
        }
        m.ev = null; m.aw *= .4; to(r, 'dormant', rand(12, 22) + (ch >= 3 ? 0 : 12));
      } break;
  }
  emitSnap(r);
}
setInterval(() => rooms.forEach(r => r.st && !r.st.over && tick(r)), 66);

function start(r) {
  r.d = DIFF[r.diff] || DIFF.normal; let i = 0; const spawn = {};
  for (const p of Object.values(r.p)) {
    Object.assign(p, { x: (rx(0) + 1 + i * .9) * C, z: (ry(0) + 1.5 + i % 2) * C, down: false, hid: false, still: 0, empAt: -1e9 }); i++;
    p.lx = p.x; p.lz = p.z; spawn[p.id] = { x: p.x, z: p.z };
  }
  r.st = { power: false, br: { b1: false, b2: false }, docs: [], sec: false, corr: 0, t: 0, scT: 110, downs: 0, over: null,
    m: { x: (rx(4) + 3.5) * C, z: (ry(3) + 2.5) * C, s: 'dormant', t: 15, ft: 3, vis: false, aw: 0, ev: null, tid: null, path: [], pt: 0, wt: 0, stun: 0 } };
  io.to(r.code).emit('start', { G, OBJ, C, CH: CHASE, MAP, GATE, spawn });
}
const lobby = r => io.to(r.code).emit('lobby', { code: r.code, host: r.host, diff: r.diff, players: Object.values(r.p).map(p => ({ id: p.id, name: p.name, ready: p.ready })) });

io.on('connection', s => {
  s.emit('ver', 7); // lets the page detect an out-of-date server.js
  const R = () => rooms.get(s.rc);
  const join = (code, name) => {
    const r = rooms.get(code);
    if (!r) return 'Room not found.'; if (r.st) return 'That game has already started.'; if (Object.keys(r.p).length >= 5) return 'Room is full (5 players max).';
    s.join(code); s.rc = code;
    r.p[s.id] = { id: s.id, name: String(name || 'Player').replace(/[^\w \-]/g, '').slice(0, 12) || 'Player', ready: false, x: 0, z: 0, ry: 0, cr: 0, fl: 1, noise: 0, down: false, hid: false, still: 0, lx: 0, lz: 0, empAt: -1e9 };
    lobby(r);
  };
  s.on('create', d => { const name = d && d.name, diff = d && d.diff; let c; do c = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.random() * 24 | 0]).join(''); while (rooms.has(c)); rooms.set(c, { code: c, host: s.id, p: {}, st: null, diff: DIFF[diff] ? diff : 'normal' }); join(c, name); });
  s.on('join', (d, cb) => { const err = join(d && d.code, d && d.name); cb && cb({ err }); });
  s.on('solo', d => { const name = d && d.name, diff = d && d.diff; const c = 'S' + Math.random().toString(36).slice(2, 6).toUpperCase(); rooms.set(c, { code: c, host: s.id, p: {}, st: null, diff: DIFF[diff] ? diff : 'normal' }); join(c, name); start(rooms.get(c)); });
  s.on('ready', () => { const r = R(), p = r && r.p[s.id]; if (p && !r.st) { p.ready = !p.ready; lobby(r); } });
  s.on('start', () => { const r = R(); if (r && r.host === s.id && !r.st && Object.values(r.p).every(p => p.ready || p.id === r.host)) start(r); });
  s.on('pos', d => {
    const p = R() && R().p[s.id]; if (!p || !d || p.down) return;
    if ([d.x, d.z, d.ry, d.noise].every(Number.isFinite)) Object.assign(p, { x: d.x, z: d.z, ry: d.ry, cr: d.cr ? 1 : 0, fl: d.fl ? 1 : 0, noise: Math.max(0, Math.min(1, d.noise)) });
  });
  s.on('use', id => {
    const r = R(), p = r && r.p[s.id], st = r && r.st; if (!st || st.over || !p || p.down || typeof id !== 'string') return;
    if (id[0] === 'P') { const q = r.p[id.slice(1)]; if (q && q.down && Math.hypot(p.x - q.x, p.z - q.z) < 3) { q.down = false; msg(r, p.name + ' revived ' + q.name + '.'); } return; }
    const o = OBJ.find(o => o.id === id); if (!o || Math.hypot(p.x - o.x, p.z - o.z) > 3.2) return;
    const m = st.m;
    if (o.type !== 'lock') { m.ev = { x: p.x, z: p.z, id: p.id }; m.tid = p.id; m.aw = Math.min(1, m.aw + .25); if (m.s === 'dormant') m.t = Math.min(m.t, 3); } // electronics attract it
    if (o.type === 'lock') p.hid = !p.hid;
    else if (o.type === 'doc') { if (!st.docs.includes(o.id)) st.docs.push(o.id); s.emit('note', DOC[+o.id[1] - 1]); }
    else if (o.type === 'sec') { st.sec = true; msg(r, 'Trace complete: the signal comes from the Signal Chamber, deep in the south-east of the building. Its gate has no power. Reset both breakers.'); }
    else if (o.type === 'brk' && !st.br[o.id]) {
      st.br[o.id] = true;
      if (st.br.b1 && st.br.b2) { st.power = true; msg(r, 'Power restored. The Signal Chamber gate is open. Every screen switches on.'); } else msg(r, 'Breaker reset. One more to go.');
    }
  });
  s.on('choose', k => {
    const r = R(), p = r && r.p[s.id], st = r && r.st, f = OBJ.find(o => o.type === 'fin');
    if (!st || st.over || !p || p.down || Math.hypot(p.x - f.x, p.z - f.z) > 4) return;
    if (!st.power) return msg(r, 'The terminal is dead. Restore power first.');
    if (k === 'shut' && !st.chase) { st.chase = { phase: 'intro', t: 0 }; msg(r, 'The chamber is discharging. Containment is failing. RUN.'); fx(r, 'alarm'); }
    if (k === 'secret' && !st.chase) { if (st.sec && st.docs.length >= 3) fin(r, 'secret'); else msg(r, 'Key rejected. Trace the signal and recover all 3 documents (' + st.docs.length + '/3).'); }
  });
  s.on('emp', () => { // EMP pulse: stuns STATIC if it is manifested, in front of you and close. Long cooldown.
    const r = R(), p = r && r.p[s.id], st = r && r.st; if (!st || st.over || !p || p.down || Date.now() - p.empAt < r.d.emp * 1000) return;
    p.empAt = Date.now(); const m = st.m, dx = m.x - p.x, dz = m.z - p.z, d = Math.hypot(dx, dz);
    const hit = m.vis && d < 16 && d > 0 && (-Math.sin(p.ry) * dx - Math.cos(p.ry) * dz) / d > .5;
    if (hit) m.stun = r.d.stun;
    io.to(r.code).emit('fx', { t: 'emp', x: p.x, z: p.z, id: p.id, k: hit ? 1 : 0 });
  });
  s.on('disconnect', () => {
    const r = R(); if (!r) return; delete r.p[s.id];
    const ids = Object.keys(r.p); if (!ids.length) return rooms.delete(r.code);
    if (r.host === s.id) r.host = ids[0]; if (!r.st) lobby(r);
  });
});
const PORT = process.env.PORT || 3000;
srv.listen(PORT, () => console.log('STATIC is running. Open http://localhost:' + PORT));
