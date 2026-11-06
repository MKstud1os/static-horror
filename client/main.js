import * as THREE from 'three';
// ---------- UI, lobby, settings ----------
const $ = id => document.getElementById(id), sock = io();
const S = Object.assign({ sens: 1, vol: .7, subs: true, gfx: 'high' }, (() => { try { return JSON.parse(localStorage.getItem('static-settings')) || {}; } catch (e) { return {}; } })());
const saveS = () => { try { localStorage.setItem('static-settings', JSON.stringify(S)); } catch (e) { /* storage unavailable */ } };
const esc = s => String(s).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
const show = id => { document.querySelectorAll('.scr').forEach(e => e.classList.add('hide')); const el = id && $(id); if (el) el.classList.remove('hide'); };
document.querySelectorAll('[data-go]').forEach(b => b.onclick = () => show(b.dataset.go));
const diffV = () => $('diff') ? $('diff').value : 'normal';
const nm = () => $('name').value.trim() || 'Guest' + (Math.random() * 90 + 10 | 0);
let lobbyCode = '', mates = [];
$('create').onclick = () => sock.emit('create', { name: nm(), diff: diffV() });
$('join').onclick = () => sock.emit('join', { code: $('code').value.trim().toUpperCase(), name: nm() }, r => $('perr').textContent = r.err || '');
$('solo').onclick = () => sock.emit('solo', { name: nm(), diff: diffV() });
$('ready').onclick = () => sock.emit('ready');
$('startbtn').onclick = () => sock.emit('start');
$('copy').onclick = () => { navigator.clipboard && navigator.clipboard.writeText(lobbyCode); $('copy').textContent = 'Copied'; setTimeout(() => $('copy').textContent = 'Copy room code', 1500); };
$('sens').oninput = e => { S.sens = +e.target.value; saveS(); };
$('vol').oninput = e => { S.vol = +e.target.value; if (master) master.gain.value = S.vol; saveS(); };
$('subsOn').onchange = e => { S.subs = e.target.checked; saveS(); };
if ($('gfx')) $('gfx').onchange = e => { S.gfx = e.target.value; saveS(); if (ren) applyGfx(); };
$('sens').value = S.sens; $('vol').value = S.vol; $('subsOn').checked = S.subs; if ($('gfx')) $('gfx').value = S.gfx;
$('fs').onclick = () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
sock.on('lobby', L => {
  lobbyCode = L.code; show('lobby'); $('rc').textContent = L.code; if ($('ldiff')) $('ldiff').textContent = 'Difficulty: ' + L.diff;
  $('plist').innerHTML = L.players.map(p => `<li>${esc(p.name)}${p.id === L.host ? ' (host)' : ''}<b>${p.ready ? 'ready' : 'waiting'}</b></li>`).join('');
  $('startbtn').classList.toggle('hide', L.host !== sock.id);
  $('startbtn').disabled = !L.players.every(p => p.ready || p.id === L.host);
});
sock.on('disconnect', () => $('conn').classList.remove('hide'));
const VER = 7; let gotVer = false; // warns you if server.js is older than main.js
function outdated() { const d = document.createElement('div'); d.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:100;background:#7a1c10;color:#fff;padding:12px;text-align:center'; d.textContent = 'Your server.js is out of date. Replace server/server.js with the newest one, then stop the server (Ctrl+C) and run npm start again.'; document.body.appendChild(d); }
sock.on('ver', v => { gotVer = true; if (v !== VER) outdated(); });
sock.on('connect', () => setTimeout(() => { if (!gotVer) outdated(); }, 2000));
sock.on('start', d => { // the facility takes a moment to build, so show a loading screen first
  G = d.G; OBJ = d.OBJ; C = d.C; CHS = d.CH; MAP = d.MAP; GATE = d.GATE; SPAWN = d.spawn; show('loading');
  setTimeout(() => { try { initGame(); } catch (err) { console.error(err); fatal(err && err.message ? err.message : String(err)); } }, 60);
});

// ---------- State ----------
let G, OBJ, C = 4, ST = { br: {}, ch: 1, pw: false, dc: 0, co: 0, cd: 0, sec: false }, scene, cam, ren, spot, gate, mon, monSkin, amb, viewScene, viewCam, vm, vmLens, MAP, GATE, SPAWN;
let rl = [], mons = [], others = {}, MS = { x: 0, z: 0, v: false, s: 'dormant' }, monT = { x: 0, z: 0 }, playing = false, ended = false;
let near = null, rvId = null, monShow = 0, warnT = 0, monAcc = 0, monInit = false;
const P = { x: 0, z: 0, yaw: 0, pitch: 0, stam: 1, cr: false, fl: true, hid: null, down: false, hx: 0, hz: 0, hidAt: 0, tired: false, noise: 0, bob: 0, stepT: 0, eye: 1.6, bobAmp: 0, mvS: 0, lastStep: 0 };
let arcs = [], CHS, chaseOn = false, chT = 0, alarmMat, chaseLight, monStepT = 0;
const arcOn = (a, t) => (t + a.o) % a.p < a.on;
let roomPos = [], poolT = 0, locEl, empEl, heartEl, hbT = 0, flashEl = null, lastRoomName = '';
const scare = { t: 0, k: null, show: false, dist: 0, yaw0: 0, fl0: true };
const k = {}, CH = ['Arrival', 'Discovery', 'Interference', 'Containment', 'Finale'];
const mc = document.createElement('canvas'); mc.width = mc.height = 64;
const mx = mc.getContext('2d'), mtex = new THREE.CanvasTexture(mc);
function drawMon(f) { // shared monitor texture: static noise, or the figure when STATIC shows itself
  mx.fillStyle = f ? '#051014' : '#0d1417'; mx.fillRect(0, 0, 64, 64);
  for (let i = 0; i < (f ? 25 : 60); i++) { const g = Math.random() * (f ? 90 : 70) | 0; mx.fillStyle = `rgb(${g},${g + 8},${g + 10})`; mx.fillRect(Math.random() * 64, Math.random() * 64, 8, 1 + Math.random() * 2); }
  if (f) { mx.fillStyle = '#000'; mx.fillRect(26, 8, 12, 56); mx.fillRect(28, 0, 8, 10); mx.fillStyle = '#dff'; mx.fillRect(29, 4, 2, 2); mx.fillRect(33, 4, 2, 2); }
  mtex.needsUpdate = true;
}

// ---------- Audio (Web Audio API, all procedural) ----------
let A = null, master, NB, pres;
function audioInit() {
  if (A) return; A = new AudioContext(); master = A.createGain(); master.gain.value = S.vol; master.connect(A.destination);
  NB = A.createBuffer(1, A.sampleRate * 2, A.sampleRate); const d = NB.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const h = A.createOscillator(), hg = A.createGain(); h.frequency.value = 50; hg.gain.value = .025; h.connect(hg); hg.connect(master); h.start();
  const s = A.createBufferSource(), f = A.createBiquadFilter(), g = A.createGain(), p = A.createPanner(); // monster presence: a spatial static hiss
  s.buffer = NB; s.loop = true; f.type = 'bandpass'; f.frequency.value = 700; f.Q.value = 2; g.gain.value = 0; p.refDistance = 3; p.rolloffFactor = 1.2;
  s.connect(f); f.connect(g); g.connect(p); p.connect(master); s.start(); pres = { g, p };
  setInterval(() => snd({ n: 1, f: 280, q: .4, d: 3, g: .05, x: P.x + 12, z: P.z - 10 }), 18000); // ventilation
}
function snd(o) {
  if (!A) return; const t = A.currentTime, g = A.createGain(); let src;
  g.gain.setValueAtTime(o.g || .3, t); g.gain.exponentialRampToValueAtTime(.001, t + o.d);
  if (o.n) { src = A.createBufferSource(); src.buffer = NB; const f = A.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = o.f || 1000; f.Q.value = o.q || 1; src.connect(f); f.connect(g); }
  else { src = A.createOscillator(); src.type = o.w || 'sawtooth'; src.frequency.setValueAtTime(o.f, t); if (o.f2) src.frequency.exponentialRampToValueAtTime(o.f2, t + o.d); src.connect(g); }
  if (o.x !== undefined) { const p = A.createPanner(); p.panningModel = 'HRTF'; p.refDistance = 3; p.rolloffFactor = 1.4; p.positionX.value = o.x; p.positionY.value = 1.5; p.positionZ.value = o.z; g.connect(p); p.connect(master); } else g.connect(master);
  src.start(t); src.stop(t + o.d + .1);
}
function sub(t) { if (!S.subs) return; const e = $('subs'); e.textContent = t; clearTimeout(sub.t); sub.t = setTimeout(() => e.textContent = '', 3500); }
const who = () => { const w = mates.filter(p => p.id !== sock.id); return w.length ? w[Math.random() * w.length | 0].n : 'someone you know'; };

// ---------- Server events ----------
sock.on('msg', t => { $('log').textContent = t; clearTimeout(sock.lt); sock.lt = setTimeout(() => $('log').textContent = '', 8000); snd({ w: 'square', f: 660, d: .1, g: .08 }); });
sock.on('fx', f => {
  const rnd = () => { const a = P.yaw + Math.random() * 6.28; return [P.x + Math.cos(a) * 14, P.z + Math.sin(a) * 14]; };
  switch (f.t) {
    case 'screen': monShow = 2.5; snd({ n: 1, f: 2500, q: .6, d: .7, g: .3, x: f.x, z: f.z }); if (f.id === sock.id) sub('[A monitor shows something standing behind you]'); else sub('[Monitors flicker]'); break;
    case 'lights': if (f.id === sock.id || Math.hypot(f.x - P.x, f.z - P.z) < 30) blackT = 9; snd({ n: 1, f: 120, q: 2, d: .8, g: .3 }); sub('[Lights fail]'); break;
    case 'radio': { const [x, z] = rnd(); for (let i = 0; i < 5; i++) setTimeout(() => snd({ x, z, f: 180 + Math.random() * 120, f2: 120 + Math.random() * 100, d: .22, g: .25 }), i * 260); snd({ x, z, n: 1, f: 3000, q: .5, d: 1.4, g: .15 }); sub(`[Radio: a voice like ${who()} whispers "...over here..."]`); break; }
    case 'steps': for (let i = 0; i < 5; i++) setTimeout(() => snd({ x: f.x, z: f.z, n: 1, f: 110, q: .8, d: .14, g: .5 }), i * 420); sub('[Footsteps in another corridor]'); break;
    case 'pc': { const [x, z] = rnd(); snd({ x, z, w: 'square', f: 880, d: .08, g: .15 }); setTimeout(() => snd({ x, z, w: 'square', f: 1320, d: .1, g: .15 }), 160); monShow = 1; sub('[A computer powers on by itself]'); break; }
    case 'warn': warnT = 2.5; break; // only a quiet light flicker, no announcement
    case 'manifest': break;
    case 'alarm': blackT = 3.2; for (let i = 0; i < 5; i++) setTimeout(() => snd({ w: 'sawtooth', f: 500, f2: 900, d: .6, g: .5 }), i * 650); snd({ w: 'sine', f: 50, f2: 25, d: 3, g: .9 }); sub('[Alarm. The chamber is discharging]'); break;
    case 'vanish': break;
    case 'emp': { // EMP pulse: a blue flash for the caster, a crackle for everyone else
      const mine = f.id === sock.id; snd({ f: 2200, f2: 90, d: .7, g: mine ? .5 : .25, x: f.x, z: f.z }); snd({ n: 1, f: 4000, q: .3, d: .5, g: .3, x: f.x, z: f.z });
      if (mine) { flash('#7fd4ff', .5); sub(f.k ? '[EMP hit: STATIC convulses]' : '[EMP pulse: nothing in range]'); } else sub('[An electric pulse rings out]'); break;
    }
    case 'scare': if (f.id === sock.id) startScare(f.k); break; // non-lethal scares only reach the player they target
    case 'caught': if (f.id === sock.id) { jumpscare(); sub('[STATIC has you]'); } else { snd({ f: 1400, f2: 150, d: .9, g: .5 }); sub('[Someone screams]'); } break;
  }
});
sock.on('snap', s => {
  if (!scene) return; ST = s.st; MS = s.m; mates = s.p; if (s.ct) chT = s.ct; monT.x = s.m.x; monT.z = s.m.z;
  if (!monInit) { mon.position.set(s.m.x, 0, s.m.z); monInit = true; }
  s.p.forEach(p => {
    if (p.id === sock.id) {
      P.down = p.d; P.ec = p.ec;
      if (P.hid && !p.h && performance.now() - P.hidAt > 600) { P.hid = null; P.x = P.hx; P.z = P.hz; }
    } else {
      let o = others[p.id]; if (!o) { o = others[p.id] = avatar(p.id, p.n); o.g.position.set(p.x, 0, p.z); }
      Object.assign(o, { tx: p.x, tz: p.z, ry: p.ry, cr: p.cr, d: p.d, h: p.h });
    }
  });
  Object.keys(others).forEach(id => { if (!s.p.find(p => p.id === id)) { scene.remove(others[id].g); delete others[id]; } });
  OBJ.forEach(o => { if (o.type === 'brk') o.scr.material.color.setHex(ST.br[o.id] ? 0x3ddc84 : 0x7a2222); if (o.type === 'fin') o.scr.material.color.setHex(ST.pw ? 0x4fd0c8 : 0xff5a40); });
  gate.visible = !ST.pw;
  $('mates').innerHTML = s.p.map(p => esc(p.n) + (p.d ? ' [DOWN]' : '')).join('<br>');
});
sock.on('chase', d => { // everyone is teleported into the hallway
  closeNote(); const me = d.pos[sock.id]; if (me) { P.x = me.x; P.z = me.z; } P.yaw = -Math.PI / 2; P.pitch = 0; P.hid = null; P.chase = true; P.stun = 0; chaseOn = true; chT = 0; blackT = 0;
  rl.forEach(l => l.visible = false); scene.fog.density = .035; snd({ f: 300, f2: 60, d: 1.6, g: 1 }); snd({ n: 1, f: 1200, q: .3, d: 1.6, g: .7 }); sub('[RUN]');
});
sock.on('end', e => {
  ended = true; playing = false; closeNote(); document.exitPointerLock(); $('hud').classList.add('hide'); $('hideov').classList.add('hide'); $('downov').classList.add('hide');
  const T = {
    escape: ['ESCAPE', 'You hit the exit at full sprint and the door seals behind you. The hallway fills with static, then silence. The carrier collapses, the monitors die one by one, and you walk out into a morning that is far too quiet. Somewhere behind you, a radio clears its throat.'],
    secret: ['THE ANSWER', 'You play the Director\'s recording backwards into the array. STATIC hears its own name, the one it was given before the experiment, and goes silent. The building exhales. Every file now says the project was never a failure. It was a conversation.'],
    fail: ['SIGNAL LOST', 'The corruption reaches the whole building, or no one is left standing. Every screen shows the same room, and then it shows you in it. Then the screens show a corridor you have not walked yet.']
  }[e.type];
  $('et').textContent = T[0]; $('ep').textContent = T[1];
  if ($('es')) $('es').textContent = `Time ${Math.floor(e.t / 60)}:${String(e.t % 60).padStart(2, '0')}   |   Notes ${e.docs}/3   |   Times caught ${e.downs}`;
  show('end');
});

// ---------- Scene ----------
function avatar(id, name) {
  const g = new THREE.Group(), col = new THREE.Color().setHSL((id.charCodeAt(0) * 37 % 360) / 360, .5, .5);
  const b = new THREE.Mesh(new THREE.BoxGeometry(.6, 1.2, .35), new THREE.MeshLambertMaterial({ color: col })); b.position.y = .9; g.add(b);
  const h = new THREE.Mesh(new THREE.SphereGeometry(.2, 8, 6), new THREE.MeshLambertMaterial({ color: 0xccbbbb })); h.position.y = 1.7; g.add(h);
  const cv = document.createElement('canvas'); cv.width = 128; cv.height = 32; const x = cv.getContext('2d'); x.fillStyle = '#fff'; x.font = '20px monospace'; x.textAlign = 'center'; x.fillText(name, 64, 24);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true })); sp.scale.set(1.6, .4, 1); sp.position.y = 2.2; g.add(sp);
  scene.add(g); return { g, tx: 0, tz: 0, ry: 0, cr: 0, d: false, h: false };
}
// ---------- Procedural textures (no image files needed) ----------
function tex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }
function speckle(g, w, h, n, a) { for (let i = 0; i < n; i++) { const v = Math.random() * 255 | 0; g.fillStyle = `rgba(${v},${v},${v},${Math.random() * a})`; g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 1 + Math.random() * 3); } }
function blotch(g, w, h, n, rgb, a, r0, r1) { for (let i = 0; i < n; i++) { const x = Math.random() * w, y = Math.random() * h, r = r0 + Math.random() * (r1 - r0), gr = g.createRadialGradient(x, y, 1, x, y, r); gr.addColorStop(0, `rgba(${rgb},${a})`); gr.addColorStop(1, `rgba(${rgb},0)`); g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r); } }
function cracks(g, w, h, n, col) { g.strokeStyle = col; g.lineWidth = 1; for (let i = 0; i < n; i++) { let x = Math.random() * w, y = Math.random() * h; g.beginPath(); g.moveTo(x, y); for (let q = 0; q < 8; q++) { x += (Math.random() - .5) * 26; y += (Math.random() - .5) * 26; g.lineTo(x, y); } g.stroke(); } }

// STATIC: a hunched, long-limbed, glossy black creature with reverse knees, claws and a stretched toothy slit
let monPh = 0;
function buildMonster() {
  const st = tex(256, 256, (g, w, h) => { g.fillStyle = '#07090a'; g.fillRect(0, 0, w, h); speckle(g, w, h, 4000, .25); cracks(g, w, h, 26, 'rgba(110,190,255,.22)'); blotch(g, w, h, 40, '160,200,230', .25, 6, 14); });
  monSkin = new THREE.MeshStandardMaterial({ map: st, bumpMap: st, bumpScale: 2, roughness: .3, metalness: .25, emissive: 0x0b1c28, emissiveIntensity: .6 });
  const skin = monSkin, eyeM = new THREE.MeshBasicMaterial({ color: 0xffffff }), toothM = new THREE.MeshBasicMaterial({ color: 0xd8d4c4 });
  const seg = (parent, len, r, x, y, z) => { const jt = new THREE.Group(); jt.position.set(x, y, z); parent.add(jt); const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len - 2 * r, 4, 8), skin); m.position.y = -len / 2; jt.add(m); return jt; };
  const root = new THREE.Group(), hips = new THREE.Group(); hips.position.y = 1.4; root.add(hips);
  const chest = new THREE.Group(); chest.rotation.x = .55; hips.add(chest); // hunched forward
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(.24, .75, 4, 10), skin); torso.position.y = .5; torso.scale.set(1, 1, .75); chest.add(torso);
  for (let i = 0; i < 6; i++) { const sp = new THREE.Mesh(new THREE.ConeGeometry(.045 - i * .004, .3 - i * .02, 5), skin); sp.position.set(0, .2 + i * .14, -.2); sp.rotation.x = -.5; chest.add(sp); } // spine spikes
  const head = new THREE.Group(); head.position.set(0, 1, .05); chest.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(.2, 16, 12), skin); skull.scale.set(.85, 1.35, 1); skull.position.set(0, .15, .08); head.add(skull);
  [-.07, .07].forEach(x => { const e = new THREE.Mesh(new THREE.SphereGeometry(.028, 8, 6), eyeM); e.scale.set(1.4, .7, .6); e.position.set(x, .2, .27); e.rotation.z = x * 3; head.add(e); });
  for (let i = 0; i < 9; i++) { const t = new THREE.Mesh(new THREE.ConeGeometry(.008, .05, 4), toothM); const a = (i - 4) * .22; t.position.set(Math.sin(a) * .11, .03 + Math.abs(i - 4) * .006, .24 + Math.cos(a) * .02); t.rotation.x = Math.PI; head.add(t); }
  const arms = [-1, 1].map(sd => {
    const sh = seg(chest, .8, .055, sd * .3, .95, 0); sh.rotation.z = sd * .12; const el = seg(sh, .85, .045, 0, -.8, 0);
    const hand = new THREE.Group(); hand.position.y = -.85; el.add(hand);
    const palm = new THREE.Mesh(new THREE.SphereGeometry(.07, 8, 6), skin); palm.scale.set(1, 1.3, .6); hand.add(palm);
    for (let i = 0; i < 4; i++) { const c = new THREE.Mesh(new THREE.ConeGeometry(.012, .34, 5), skin); c.position.set((i - 1.5) * .035, -.22, 0); c.rotation.set(Math.PI + .15, 0, (i - 1.5) * .1); hand.add(c); }
    return { sh, el };
  });
  const legs = [-1, 1].map(sd => {
    const th = seg(hips, .75, .075, sd * .17, 0, 0); th.rotation.x = -.7; const sn = seg(th, .8, .05, 0, -.75, 0); sn.rotation.x = 1.2; // reverse-jointed leg
    const ft = new THREE.Mesh(new THREE.ConeGeometry(.05, .26, 6), skin); ft.position.y = -.82; ft.rotation.x = Math.PI + .3; sn.add(ft);
    return { th, sn };
  });
  root.rig = { hips, chest, head, arms, legs, tw: 0 }; return root;
}
function animMon(dt, speed) {
  const A = mon.rig; monPh += dt * (2 + speed * 2.2); const s = Math.min(1, speed / 3), w = Math.sin(monPh * 3);
  A.legs[0].th.rotation.x = -.7 + w * .5 * s; A.legs[1].th.rotation.x = -.7 - w * .5 * s;
  A.legs[0].sn.rotation.x = 1.2 + Math.max(0, -w) * .5 * s; A.legs[1].sn.rotation.x = 1.2 + Math.max(0, w) * .5 * s;
  A.arms[0].sh.rotation.x = -w * .45 * s + Math.sin(monPh * .8) * .05; A.arms[1].sh.rotation.x = w * .45 * s - Math.sin(monPh * .8) * .05;
  A.arms[0].el.rotation.x = -.2 - Math.max(0, w) * .3 * s; A.arms[1].el.rotation.x = -.2 - Math.max(0, -w) * .3 * s;
  A.hips.position.y = 1.4 + Math.abs(Math.sin(monPh * 3)) * .06 * s; A.chest.rotation.x = .55 + Math.sin(monPh * 1.6) * .03 + w * .05 * s;
  if (Math.random() < .04) A.tw = (Math.random() - .5) * .6; A.tw *= .9; A.head.rotation.z = A.tw; A.head.rotation.y = A.tw * .8; // unnatural head twitches
  if (Math.random() < .03) A.arms[Math.random() < .5 ? 0 : 1].el.rotation.z = (Math.random() - .5) * .5;
}

// First-person hand holding the flashlight (drawn in a second pass so it never clips into walls)
function buildViewmodel() {
  viewScene = new THREE.Scene(); viewCam = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, .01, 10);
  const va = new THREE.AmbientLight(0xffffff, .9), dl = new THREE.DirectionalLight(0xffffff, 1.4); dl.position.set(-1, 1, 1); viewScene.add(va, dl);
  vm = new THREE.Group(); vm.lag = 0; vm.amb = va; vm.dl = dl; viewScene.add(vm);
  const metal = new THREE.MeshStandardMaterial({ color: 0x2b2e31, metalness: .7, roughness: .4 }), copper = new THREE.MeshStandardMaterial({ color: 0x9a6038, metalness: .8, roughness: .35 });
  const glove = new THREE.MeshStandardMaterial({ color: 0x16181a, roughness: .7 }), sleeve = new THREE.MeshStandardMaterial({ color: 0x3f526b, roughness: .9 });
  const torch = new THREE.Group(); torch.position.set(.3, -.26, -.55); torch.rotation.set(.04, .07, 0); vm.add(torch);
  const cyl = (r, h, m, z) => { const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 16), m); c.rotation.x = Math.PI / 2; c.position.z = z; torch.add(c); };
  cyl(.026, .22, metal, 0); cyl(.04, .07, copper, -.14); cyl(.036, .02, metal, -.185); // body, head, bezel
  vmLens = new THREE.Mesh(new THREE.CircleGeometry(.032, 16), new THREE.MeshBasicMaterial({ color: 0xfff4d0 })); vmLens.position.z = -.196; vmLens.rotation.y = Math.PI; torch.add(vmLens);
  const palm = new THREE.Mesh(new THREE.BoxGeometry(.075, .05, .09), glove); palm.position.set(.012, -.012, .04); torch.add(palm);
  for (let i = 0; i < 4; i++) { const f = new THREE.Mesh(new THREE.CapsuleGeometry(.011, .045, 3, 6), glove); f.position.set(-.028, -.012, .09 - i * .024); torch.add(f); } // fingers
  const th = new THREE.Mesh(new THREE.CapsuleGeometry(.012, .05, 3, 6), glove); th.rotation.x = Math.PI / 2; th.position.set(0, .028, .02); torch.add(th); // thumb
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(.045, .055, .5, 12), sleeve), dir = new THREE.Vector3(.35, -.55, .55).normalize();
  arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir); arm.position.copy(torch.position).addScaledVector(dir, .27).add(new THREE.Vector3(.02, -.02, .1)); vm.add(arm);
}

function initGame() {
  show(null); ren = new THREE.WebGLRenderer({ canvas: $('c'), antialias: false }); applyGfx();
  scene = new THREE.Scene(); scene.background = new THREE.Color(0x030405); scene.fog = new THREE.FogExp2(0x030405, .05);
  cam = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, .1, 90); cam.rotation.order = 'YXZ'; scene.add(cam);
  amb = new THREE.AmbientLight(0x5a6a70, 2.2); scene.add(amb);
  // flashlight: held slightly low and to the right, aimed at the crosshair (eye level)
  spot = new THREE.SpotLight(0xfff0d8, 55, 45, .48, .65, 2); spot.position.set(.28, -.24, -.5); cam.add(spot, spot.target); spot.target.position.set(0, 0, -12);
  const W = G[0].length, H = G.length;
  const wallT = tex(256, 256, (g, w, h) => {
    g.fillStyle = '#8a979a'; g.fillRect(0, 0, w, h); speckle(g, w, h, 2500, .12);
    g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, 0, 3, h); g.fillRect(w / 2 - 1, 0, 2, h); g.fillRect(0, h * .62, w, 2); // panel seams
    for (let i = 0; i < 14; i++) { const x = Math.random() * w, l = 30 + Math.random() * 110, gr = g.createLinearGradient(0, 0, 0, l); gr.addColorStop(0, 'rgba(20,18,10,.35)'); gr.addColorStop(1, 'rgba(20,18,10,0)'); g.fillStyle = gr; g.fillRect(x, 0, 2 + Math.random() * 7, l); } // grime streaks
    blotch(g, w, h, 5, '30,26,12', .3, 20, 60); cracks(g, w, h, 3, 'rgba(0,0,0,.5)'); g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(0, h * .9, w, h * .1); // damp stains, cracks, dark baseboard
  });
  const floorT = tex(256, 256, (g, w, h) => {
    g.fillStyle = '#2a3033'; g.fillRect(0, 0, w, h);
    for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) { const v = Math.random() * 20 | 0; g.fillStyle = `rgb(${61 + v - 10},${69 + v - 10},${73 + v - 10})`; g.fillRect(a * 64 + 1, b * 64 + 1, 62, 62); }
    speckle(g, w, h, 2500, .12); blotch(g, w, h, 8, '10,8,4', .4, 15, 45); cracks(g, w, h, 4, 'rgba(0,0,0,.6)');
  });
  const ceilT = tex(256, 256, (g, w, h) => { g.fillStyle = '#4a5255'; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(0, 0, w, 2); g.fillRect(0, 0, 2, h); g.fillRect(w / 2, 0, 2, h); g.fillRect(0, h / 2, w, 2); speckle(g, w, h, 1500, .1); blotch(g, w, h, 5, '40,34,14', .35, 20, 50); });
  floorT.repeat.set(W, H); ceilT.repeat.set(W, H);
  const fl = new THREE.Mesh(new THREE.PlaneGeometry(W * C, H * C), new THREE.MeshStandardMaterial({ map: floorT, bumpMap: floorT, bumpScale: .8, roughness: .45 })); fl.rotation.x = -Math.PI / 2; fl.position.set(W * C / 2, 0, H * C / 2); scene.add(fl);
  const ce = new THREE.Mesh(fl.geometry, new THREE.MeshStandardMaterial({ map: ceilT, roughness: .95 })); ce.rotation.x = Math.PI / 2; ce.position.set(W * C / 2, 3.2, H * C / 2); scene.add(ce);
  let n = 0; G.forEach(r => [...r].forEach(c => c === '#' && n++));
  const wm = new THREE.InstancedMesh(new THREE.BoxGeometry(C, 3.2, C), new THREE.MeshStandardMaterial({ map: wallT, bumpMap: wallT, bumpScale: 1.2, roughness: .9 }), n), mt = new THREE.Matrix4(), col = new THREE.Color(); let i = 0;
  G.forEach((r, z) => [...r].forEach((c, x) => { if (c === '#') { mt.makeTranslation((x + .5) * C, 1.6, (z + .5) * C); wm.setMatrixAt(i, mt); wm.setColorAt(i++, col.setScalar(.75 + Math.random() * .3)); } }));
  scene.add(wm);
  gate = new THREE.Mesh(new THREE.BoxGeometry(C, 3.2, C), new THREE.MeshStandardMaterial({ color: 0x6a2a24, roughness: .6, metalness: .4 })); gate.position.set((GATE.c + .5) * C, 1.6, (GATE.r + .5) * C); scene.add(gate);
  const box = (w, h, d, c, x, y, z, em) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), em ? new THREE.MeshBasicMaterial({ color: c }) : new THREE.MeshStandardMaterial({ color: c, roughness: .6, metalness: .25 })); m.position.set(x, y, z); scene.add(m); return m; };
  roomPos = []; // one ceiling fixture per room; six real lights follow you from room to room (keeps it fast)
  for (let r = 0; r < MAP.NR; r++) for (let c = 0; c < MAP.NC; c++) {
    const p = { x: (1 + c * MAP.SX + MAP.RW / 2) * C, z: (1 + r * MAP.SY + MAP.RH / 2) * C, tint: [0xcfe8ff, 0xffe2b8, 0xb8d0ff, 0xcfe8ff, 0xffe2b8, 0xff9a8a][(r * MAP.NC + c) % 6] };
    roomPos.push(p); box(1.8, .08, .45, 0xfff2d0, p.x, 3.16, p.z, 1);
  }
  for (let j = 0; j < 6; j++) { const l = new THREE.PointLight(0xffffff, 25, 24, 1.2); l.base = 25; l.fl = 0; l.off = 0; l.room = -1; scene.add(l); rl.push(l); }
  [[1, 4], [2, 3], [2, 4], [3, 3]].forEach(([r, c]) => { // pipes through the maintenance rooms
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(.12, .12, MAP.RW * C, 8), new THREE.MeshStandardMaterial({ color: 0x555a5c, roughness: .4, metalness: .6 })); pipe.rotation.z = Math.PI / 2;
    pipe.position.set((1 + c * MAP.SX + MAP.RW / 2) * C, 2.9, (1 + r * MAP.SY) * C + 1); scene.add(pipe);
  });
  const nearR = (x, z) => roomPos.reduce((a, b) => Math.hypot(a.x - x, a.z - z) < Math.hypot(b.x - x, b.z - z) ? a : b);
  OBJ.forEach(o => {
    const { x, z } = o;
    if (o.type === 'lock') box(1, 2.2, 1, 0x3a4640, x, 1.1, z);
    else if (o.type === 'doc') { box(1.6, .9, .9, 0x4a4034, x, .45, z); box(.5, .02, .35, 0xe8e2c8, x, .92, z, 1); }
    else if (o.type === 'sec') { box(2, .9, 1, 0x2a3236, x, .45, z); o.scr = box(1.2, .8, .1, 0x4fd0c8, x, 1.4, z, 1); }
    else if (o.type === 'brk') o.scr = box(1, 1.6, .4, 0x7a2222, x, 1.1, z, 1);
    else if (o.type === 'fin') { box(3, 1, 1.4, 0x2a3236, x, .5, z); o.scr = box(2.4, 1.2, .1, 0xff5a40, x, 1.7, z, 1); }
    else if (o.type === 'mon') {
      box(1.4, .9, .8, 0x3a3a34, x, .45, z);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(.9, .7), new THREE.MeshBasicMaterial({ map: mtex, side: THREE.DoubleSide })); m.position.set(x, 1.35, z);
      const l = nearR(x, z); m.lookAt(l.x, 1.35, l.z); scene.add(m); mons.push(m);
    }
  });
  // Finale chase hallway: server racks to weave around and live cables to time
  const rackM = new THREE.MeshStandardMaterial({ color: 0x1d2226, roughness: .5, metalness: .6 });
  CHS.blocks.forEach(b => {
    const rk = new THREE.Mesh(new THREE.BoxGeometry(b.w, 2.4, b.d), rackM); rk.position.set(b.x, 1.2, b.z); scene.add(rk);
    for (let q = 0; q < 3; q++) { const led = new THREE.Mesh(new THREE.BoxGeometry(b.w * .7, .06, .02), new THREE.MeshBasicMaterial({ color: Math.random() < .5 ? 0x3ddc84 : 0xff4a3a })); led.position.set(b.x, 1.2 + q * .35, b.z + b.d / 2 + .02); scene.add(led); }
  });
  arcs = CHS.arcs.map(a => {
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(a.w, a.d), new THREE.MeshBasicMaterial({ color: 0x6a5a12 })); stripe.rotation.x = -Math.PI / 2; stripe.position.set(a.x, .03, a.z); scene.add(stripe);
    const zap = new THREE.Mesh(new THREE.BoxGeometry(a.w, 2.6, a.d), new THREE.MeshBasicMaterial({ color: 0x7fd4ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })); zap.position.set(a.x, 1.3, a.z); scene.add(zap);
    [-1, 1].forEach(sd => { const cb = new THREE.Mesh(new THREE.CylinderGeometry(.05, .05, 3.2, 6), new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: .6 })); cb.position.set(a.x, 1.6, a.z + sd * a.d / 2); scene.add(cb); });
    return { a, stripe, zap };
  });
  alarmMat = new THREE.MeshBasicMaterial({ color: 0x661008 });
  CHS.segZ.forEach(z => { for (let x = 12; x <= 84; x += 12) { const al = new THREE.Mesh(new THREE.BoxGeometry(2, .06, .4), alarmMat); al.position.set(x, 3.15, z); scene.add(al); } });
  const ex = new THREE.Mesh(new THREE.BoxGeometry(.3, 2.6, 4), new THREE.MeshBasicMaterial({ color: 0x39e08a })); ex.position.set(CHS.exit.x + 1.7, 1.3, CHS.exit.z); scene.add(ex);
  const cv = document.createElement('canvas'); cv.width = 128; cv.height = 48; const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.font = 'bold 40px monospace'; cx.textAlign = 'center'; cx.fillText('EXIT', 64, 38);
  const es = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true })); es.scale.set(3, 1.1, 1); es.position.set(CHS.exit.x + .4, 2.6, CHS.exit.z); scene.add(es);
  chaseLight = new THREE.PointLight(0xff3322, 0, 28, 1.4); scene.add(chaseLight);
  mon = buildMonster(); mon.visible = false; scene.add(mon);
  const vig = document.createElement('div'); vig.style.cssText = 'position:fixed;inset:0;z-index:3;pointer-events:none;background:radial-gradient(ellipse at center,rgba(0,0,0,0) 45%,rgba(0,0,0,.65) 100%)'; document.body.appendChild(vig);
  addEventListener('resize', () => { cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix(); viewCam.aspect = cam.aspect; viewCam.updateProjectionMatrix(); ren.setSize(innerWidth, innerHeight); });
  ren.autoClear = false; buildViewmodel(); buildHud(); const sp0 = SPAWN && SPAWN[sock.id]; P.x = sp0 ? sp0.x : 2.5 * C; P.z = sp0 ? sp0.z : 2.5 * C; P.yaw = -Math.PI / 2; poolUpdate(); playing = true; $('hud').classList.remove('hide'); show('pause');
  requestAnimationFrame(loop);
}

// ---------- Notes: E opens a full-screen note, E puts it down ----------
let noteEl = null, noteOpen = false;
function openNote(n) {
  if (!noteEl) {
    noteEl = document.createElement('div');
    noteEl.style.cssText = 'position:fixed;inset:0;z-index:50;background:rgba(0,0,0,.88);display:none;align-items:center;justify-content:center;padding:4vh 4vw;overflow:auto';
    document.body.appendChild(noteEl);
  }
  noteEl.innerHTML = `<div style="position:relative;width:min(760px,92vw);max-height:92vh;overflow:auto;padding:56px 60px 74px;background:radial-gradient(ellipse at 20% 10%,#e6dfc8,#cfc6a8 70%,#b9ae8c);color:#2a2418;font:21px/1.65 'Courier New',monospace;box-shadow:0 0 80px #000,inset 0 0 60px rgba(90,70,30,.45);transform:rotate(-.6deg)">
    <div style="font-size:15px;letter-spacing:.2em;text-transform:uppercase;opacity:.6;margin-bottom:18px">${esc(n.title)}</div>
    <div style="white-space:pre-wrap">${esc(n.text)}</div>
    <div style="position:absolute;bottom:20px;right:28px;font-size:15px;opacity:.65">[E] Put it down</div></div>`;
  noteEl.style.display = 'flex'; noteOpen = true; snd({ n: 1, f: 2500, q: .5, d: .25, g: .15 }); // paper rustle
}
function closeNote() { if (!noteEl || !noteOpen) return; noteEl.style.display = 'none'; noteOpen = false; snd({ n: 1, f: 1800, q: .5, d: .2, g: .12 }); }
sock.on('note', n => openNote(n));

// ---------- Input ----------
$('pause').onclick = () => { audioInit(); A.resume(); $('pause').classList.add('hide'); $('c').requestPointerLock(); };
document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement && playing && !ended) { closeNote(); show('pause'); } });
addEventListener('mousemove', e => {
  if (document.pointerLockElement !== $('c') || P.down || P.hid || noteOpen) return;
  P.yaw -= e.movementX * .0022 * S.sens; P.pitch = Math.max(-1.4, Math.min(1.4, P.pitch - e.movementY * .0022 * S.sens));
});
addEventListener('keydown', e => {
  if (!playing || document.pointerLockElement !== $('c')) return; k[e.code] = 1;
  if (['ControlLeft', 'KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyE', 'KeyF', 'KeyR'].includes(e.code)) e.preventDefault();
  if (e.code === 'KeyE' && !e.repeat) interact();
  if (e.code === 'KeyF' && !e.repeat && !noteOpen) { P.fl = !P.fl; snd({ w: 'square', f: 300, d: .04, g: .12 }); }
  if (e.code === 'KeyQ' && !e.repeat && !noteOpen && !P.down && !P.hid && !((P.ec || 0) > 0)) { sock.emit('emp'); P.ec = 1; } // EMP pulse
  if (e.code === 'KeyR' && !noteOpen && near && near.type === 'fin') sock.emit('choose', 'secret');
});
addEventListener('keyup', e => k[e.code] = 0);
addEventListener('blur', () => { for (const key in k) k[key] = 0; }); // no stuck keys when you click away
function interact() {
  if (noteOpen) return closeNote();
  if (P.down) return;
  if (P.hid) { const id = P.hid; P.x = P.hx; P.z = P.hz; P.hid = null; sock.emit('use', id); return; }
  if (rvId) return sock.emit('use', 'P' + rvId);
  if (!near) return;
  if (near.type === 'fin') return sock.emit('choose', 'shut');
  if (near.type === 'doc') return sock.emit('use', near.id); // the server answers with the note text
  sock.emit('use', near.id);
  if (near.type === 'lock') { P.hid = near.id; P.hx = P.x; P.hz = P.z; P.x = near.x; P.z = near.z; P.hidAt = performance.now(); snd({ n: 1, f: 400, q: 3, d: .25, g: .2 }); }
  else snd({ w: 'square', f: 880, d: .08, g: .1 });
}
const free = (x, z) => !(CHS && CHS.blocks.some(b => Math.abs(x - b.x) < b.w / 2 + .35 && Math.abs(z - b.z) < b.d / 2 + .35)) && [[.35, .35], [-.35, .35], [.35, -.35], [-.35, -.35]].every(([a, b]) => {
  const c = Math.floor((x + a) / C), r = Math.floor((z + b) / C);
  return G[r] && G[r][c] === '.' && !(c === GATE.c && r === GATE.r && !ST.pw);
});
function move(dt) {
  P.noise = 0; P.mvS = 0; P.cr = !P.chase && !!(k.ControlLeft || k.KeyC); if (P.down || P.hid || noteOpen) return;
  if (P.stun > 0) { P.stun -= dt; return; } // shocked
  const f = (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0), s = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0), mv = f || s;
  const spr = mv && (P.chase || (k.ShiftLeft && P.stam > 0 && !P.cr && !P.tired)), sp = P.cr ? 1.8 : spr ? 6.2 : 3.6;
  P.stam = Math.max(0, Math.min(1, P.stam + (spr && !P.chase ? -dt * .22 : dt * .15))); if (P.stam <= 0) P.tired = true; if (P.stam > .3) P.tired = false;
  if (!mv) return;
  let dx = -Math.sin(P.yaw) * f + Math.cos(P.yaw) * s, dz = -Math.cos(P.yaw) * f - Math.sin(P.yaw) * s; const l = Math.hypot(dx, dz); dx = dx / l * sp * dt; dz = dz / l * sp * dt;
  if (free(P.x + dx, P.z)) P.x += dx; if (free(P.x, P.z + dz)) P.z += dz;
  P.noise = P.cr ? .15 : spr ? 1 : .5; P.mvS = sp; P.bob += dt * sp * 1.9;
  const stp = Math.floor(P.bob / Math.PI); if (stp !== P.lastStep) { P.lastStep = stp; snd({ n: 1, f: 140, q: .8, d: .12, g: P.cr ? .05 : spr ? .3 : .15 }); } // a footstep sound on every footfall
}
setInterval(() => playing && sock.emit('pos', { x: P.x, z: P.z, ry: P.yaw, cr: P.cr ? 1 : 0, fl: P.fl && !P.hid ? 1 : 0, noise: P.hid ? 0 : P.noise }), 66);

// ---------- Polish: graphics quality, HUD extras, screen flashes, light pool ----------
function applyGfx() { ren.setPixelRatio({ low: .7, medium: 1, high: Math.min(devicePixelRatio || 1, 1.5) }[S.gfx] || 1); ren.setSize(innerWidth, innerHeight); }
function fatal(m) { const d = document.createElement('div'); d.style.cssText = 'position:fixed;inset:0;z-index:200;background:#050607;color:#e6eef0;display:flex;align-items:center;justify-content:center;text-align:center;padding:30px;font-size:18px'; d.innerHTML = `<div>The facility failed to load.<br><br>${esc(m)}<br><br>Reload the page to try again.</div>`; document.body.appendChild(d); }
function buildHud() {
  const mk = (css, parent) => { const d = document.createElement('div'); d.style.cssText = css; parent.appendChild(d); return d; };
  locEl = mk('position:absolute;top:66px;left:18px;color:#c8d0cf;font-size:13px;letter-spacing:.14em;text-transform:uppercase;opacity:.85', $('hud'));
  empEl = mk('margin-top:8px;font-size:13px;letter-spacing:.08em', $('bars'));
  heartEl = mk('position:fixed;inset:0;z-index:4;pointer-events:none;opacity:0;background:radial-gradient(ellipse at center,rgba(120,0,0,0) 40%,rgba(150,10,10,.55) 100%)', document.body);
}
function flash(col, dur) { // a quick full-screen colour flash that fades out
  if (!flashEl) { flashEl = document.createElement('div'); flashEl.style.cssText = 'position:fixed;inset:0;z-index:40;pointer-events:none;opacity:0'; document.body.appendChild(flashEl); }
  flashEl.style.transition = 'none'; flashEl.style.background = `radial-gradient(ellipse at center, ${col}, transparent 80%)`; flashEl.style.opacity = '.85';
  requestAnimationFrame(() => { flashEl.style.transition = `opacity ${dur}s ease-out`; flashEl.style.opacity = '0'; });
}
function roomName() { // which room the player is standing in, for the HUD
  const c = Math.floor(P.x / C), r = Math.floor(P.z / C);
  if (r >= MAP.MAINH) return 'Discharge Hallway';
  return MAP.ROOMS[Math.min(MAP.NR - 1, Math.max(0, Math.floor((r - 1) / MAP.SY)))][Math.min(MAP.NC - 1, Math.max(0, Math.floor((c - 1) / MAP.SX)))];
}
function poolUpdate() { // the 6 real lights always sit in the 6 nearest rooms
  if (chaseOn || !roomPos.length) return;
  const order = roomPos.map((p, i) => [Math.hypot(p.x - P.x, p.z - P.z), i]).sort((a, b) => a[0] - b[0]).slice(0, rl.length).map(a => a[1]);
  const spare = rl.filter(l => !order.includes(l.room));
  order.forEach(ri => { if (rl.some(l => l.room === ri)) return; const l = spare.shift(); if (!l) return; l.room = ri; l.position.set(roomPos[ri].x, 2.8, roomPos[ri].z); l.color.setHex(roomPos[ri].tint); l.fl = 0; l.off = 0; });
}

// ---------- Scares that cannot hurt you: behind you, in the dark, in a screen, in your ear ----------
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
function scareHit() { snd({ w: 'sine', f: 45, f2: 25, d: 1.2, g: 1 }); snd({ f: 2600, f2: 1800, d: .5, g: .6 }); snd({ n: 1, f: 3000, q: .4, d: .6, g: .7 }); flash('#ffffff', .35); P.shake = .9; }
function startScare(k) {
  if (chaseOn || P.down || scare.t > 0 || ended || !playing) return;
  Object.assign(scare, { k, yaw0: P.yaw, fl0: P.fl, show: false, dist: 0 });
  if (k === 'behind') { scare.t = 1.3; scare.show = true; scare.dist = -1.7; scareHit(); } // it is right behind you, until you turn around
  else if (k === 'front') { scare.t = 3.2; blackT = 2.3; P.fl = false; snd({ w: 'sine', f: 70, f2: 30, d: 2.4, g: .5 }); } // the lights die; when they return it is standing in front of you
  else if (k === 'monitor') { scare.t = 1; jumpscare(.9); } // a face slams onto the screen
  else { // whispers circle your head, then a scream from behind
    scare.t = 2.6; sub('[A whisper circles your head]');
    for (let i = 0; i < 9; i++) { const a = P.yaw + i * .8; setTimeout(() => snd({ x: P.x - Math.sin(a) * 1.2, z: P.z - Math.cos(a) * 1.2, n: 1, f: 1500 + Math.random() * 900, q: 3, d: .3, g: .4 }), i * 230); }
    setTimeout(() => { snd({ f: 1900, f2: 300, d: 1.1, g: .9, x: P.x + Math.sin(P.yaw) * 1.5, z: P.z + Math.cos(P.yaw) * 1.5 }); flash('#ffffff', .3); P.shake = .8; }, 2100);
  }
}
function scareFrame(dt) { // advances the current scare; returns true while the monster model is on show
  if (scare.t <= 0) return false;
  scare.t -= dt;
  if (scare.k === 'behind' && scare.show && Math.abs(angDiff(P.yaw, scare.yaw0)) > .9) { scare.show = false; scare.t = Math.min(scare.t, .2); snd({ n: 1, f: 200, q: .5, d: .5, g: .9 }); P.shake = .5; } // you turned: it is gone
  if (scare.k === 'front' && !scare.show && scare.t <= .9 && scare.t > 0) { scare.show = true; scare.dist = 3; scareHit(); }
  if (scare.t <= 0) { if (scare.k === 'front') P.fl = scare.fl0; scare.show = false; scare.t = 0; mon.position.set(monT.x, 0, monT.z); }
  return scare.show;
}

// ---------- Jumpscare: shown for 3 seconds every time STATIC catches you ----------
let scareEl = null;
function jumpscare(dur = 3) {
  if (!scareEl) { // built here in code, so it always exists
    scareEl = document.createElement('div');
    scareEl.style.cssText = 'position:fixed;inset:0;z-index:99;background:#000;display:none;align-items:center;justify-content:center;overflow:hidden';
    const c = document.createElement('canvas'); c.width = c.height = 400; c.style.cssText = 'height:100vh;width:100vw;object-fit:contain';
    scareEl.appendChild(c); document.body.appendChild(scareEl);
  }
  const g = scareEl.firstChild.getContext('2d'), t0 = performance.now(); scareEl.style.display = 'flex';
  snd({ f: 1900, f2: 260, d: 1.6, g: 1 }); snd({ n: 1, f: 2600, q: .4, d: 3, g: .9 }); snd({ w: 'square', f: 90, f2: 35, d: 2, g: .9 });
  setTimeout(() => snd({ f: 1500, f2: 200, d: 1.2, g: .8 }), 900); setTimeout(() => snd({ n: 1, f: 900, q: .6, d: 1, g: .7 }), 1800);
  const draw = () => {
    const e = (performance.now() - t0) / 1000; if (e > dur) { scareEl.style.display = 'none'; return; }
    const j = () => (Math.random() - .5) * (14 + e * 14), cx = 200 + j(), cy = 215 + j(), sc = 1 + e * .12;
    g.fillStyle = e < .15 || Math.random() < .06 ? '#fff' : '#000'; g.fillRect(0, 0, 400, 400); // white flashes
    const gr = g.createRadialGradient(cx, cy, 10, cx, cy, 280); gr.addColorStop(0, '#d8efff'); gr.addColorStop(1, '#000'); g.fillStyle = gr; g.globalAlpha = e < .15 ? .5 : 1; g.fillRect(0, 0, 400, 400); g.globalAlpha = 1;
    g.save(); g.translate(cx, cy); g.scale(sc, sc);
    g.fillStyle = '#000'; g.beginPath(); g.ellipse(0, 0, 100, 185, 0, 0, 7); g.fill(); // long dark head
    g.fillStyle = '#fff'; [-44, 44].forEach(x => { g.beginPath(); g.ellipse(x, -70, 16, 5, x / 150, 0, 7); g.fill(); }); // eyes
    g.beginPath(); g.moveTo(-64, 30); // jagged mouth
    for (let i = 1; i <= 12; i++) g.lineTo(-64 + i * 10.7, 30 + (i % 2 ? 24 : 0));
    for (let i = 12; i >= 0; i--) g.lineTo(-64 + i * 10.7, 105 + Math.random() * (20 + e * 20) * (i % 2 ? 1 : .3));
    g.closePath(); g.fill(); g.restore();
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * .5})`; g.fillRect(0, Math.random() * 400, 400, 1 + Math.random() * 3); }
    requestAnimationFrame(draw);
  };
  draw();
}

// ---------- Main loop ----------
let last = performance.now(), blackT = 0;
function loop(t) {
  requestAnimationFrame(loop); const dt = Math.min(.05, (t - last) / 1000); last = t; if (!scene) return;
  if (noteOpen && P.down) closeNote();
  if (playing) move(dt); else P.mvS = 0;
  warnT = Math.max(0, warnT - dt); monShow = Math.max(0, monShow - dt); blackT = Math.max(0, blackT - dt);
  const scaring = scareFrame(dt);
  // camera: eye height, head bob on every footfall, side sway and a little roll
  P.eye += ((P.down ? .4 : P.hid ? 1.2 : P.cr ? 1 : 1.6) - P.eye) * Math.min(1, dt * 10);
  const spd = P.down || P.hid ? 0 : P.mvS; P.bobAmp += ((spd > 0 ? 1 : 0) - P.bobAmp) * Math.min(1, dt * 7);
  const amp = P.bobAmp * (spd > 5 ? 1.5 : P.cr ? .5 : 1), bY = -Math.cos(P.bob * 2) * .04 * amp, bX = Math.sin(P.bob) * .035 * amp;
  cam.position.set(P.x + Math.cos(P.yaw) * bX, P.eye + bY, P.z - Math.sin(P.yaw) * bX);
  const sk = P.shake > 0 ? (Math.random() - .5) * P.shake * .12 : 0; P.shake = Math.max(0, (P.shake || 0) - dt * 1.5);
  cam.rotation.set(P.pitch + Math.sin(P.bob * 2) * .006 * amp + sk, P.yaw + sk, (P.down ? .6 : 0) + Math.sin(P.bob) * .012 * amp);
  spot.visible = P.fl && !P.down && !P.hid;
  const kk = 1 - Math.exp(-12 * dt);
  for (const o of Object.values(others)) { // smooth movement of other players
    const g = o.g; g.position.x += (o.tx - g.position.x) * kk; g.position.z += (o.tz - g.position.z) * kk;
    const d = Math.atan2(Math.sin(o.ry - g.rotation.y), Math.cos(o.ry - g.rotation.y)); g.rotation.y += d * kk;
    g.visible = !o.h; g.scale.y = o.cr ? .7 : 1; g.rotation.x = o.d ? -1.4 : 0; g.position.y = o.d ? .3 : 0;
  }
  const ox = mon.position.x, oz = mon.position.z; mon.position.x += (monT.x - ox) * kk; mon.position.z += (monT.z - oz) * kk;
  const mspd = Math.hypot(mon.position.x - ox, mon.position.z - oz) / Math.max(dt, .001);
  const showM = (MS.v || (MS.s === 'investigating' && Math.hypot(mon.position.x - P.x, mon.position.z - P.z) < 14)) && Math.random() > .1; mon.visible = showM;
  if (showM) { mon.rotation.y = Math.atan2(P.x - mon.position.x, P.z - mon.position.z); animMon(dt, mspd); monSkin.emissiveIntensity = .35 + Math.random() * .5; mon.scale.set(1 + (Math.random() - .5) * .04, 1 + (Math.random() - .5) * .08, 1); }
  if (MS.v && MS.u) { mon.visible = true; monSkin.emissiveIntensity = 1 + Math.random() * 1.2; mon.rotation.z = (Math.random() - .5) * .25; } else mon.rotation.z = 0; // stunned: convulsing
  if (scaring) { // scare: the monster model appears right behind or in front of you
    mon.position.set(P.x - Math.sin(P.yaw) * scare.dist, 0, P.z - Math.cos(P.yaw) * scare.dist); mon.visible = true;
    mon.rotation.y = Math.atan2(P.x - mon.position.x, P.z - mon.position.z); animMon(dt, 0); monSkin.emissiveIntensity = .8 + Math.random() * .6;
  }
  if ((poolT -= dt) <= 0) { poolT = .35; poolUpdate(); }
  rl.forEach(l => {
    if (Math.random() < .004 || (MS.v && Math.hypot(l.position.x - mon.position.x, l.position.z - mon.position.z) < 14 && Math.random() < .08)) l.fl = .2;
    l.fl = Math.max(0, l.fl - dt); let v = l.base * (ST.pw ? 1 : .55);
    if (blackT > 0) v = blackT < 1.5 && Math.random() < .3 ? v * .5 : 0; // blackout: only your flashlight works
    else if (l.fl > 0 || (warnT > 0 && Math.random() < .5)) v *= Math.random() < .5 ? .1 : 1;
    l.intensity = v;
  });
  amb.intensity += ((blackT > 0 ? .05 : chaseOn ? 1.5 : 2.2) - amb.intensity) * Math.min(1, dt * (blackT > 0 ? 20 : 3));
  if ((monAcc += dt) > .1) { monAcc = 0; drawMon(monShow > 0); }
  if (A && pres) {
    const L = A.listener; if (L.positionX) { L.positionX.value = P.x; L.positionY.value = 1.6; L.positionZ.value = P.z; L.forwardX.value = -Math.sin(P.yaw); L.forwardY.value = 0; L.forwardZ.value = -Math.cos(P.yaw); L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; }
    pres.p.positionX.value = mon.position.x; pres.p.positionY.value = 1.5; pres.p.positionZ.value = mon.position.z;
    pres.g.gain.value = MS.v ? .5 : MS.s === 'investigating' ? .12 : 0;
  }
  near = null; rvId = null; let best = 2.8;
  for (const o of OBJ) { if (o.type === 'mon') continue; const d = Math.hypot(o.x - P.x, o.z - P.z); if (d < best) { best = d; near = o; } }
  for (const [id, o] of Object.entries(others)) if (o.d && Math.hypot(o.g.position.x - P.x, o.g.position.z - P.z) < 2.6) rvId = id;
  let p = '';
  if (P.hid) p = 'E  Leave locker'; else if (rvId) p = 'E  Revive teammate'; else if (near) p = { doc: 'E  Read note', sec: 'E  Trace signal', brk: 'E  Reset breaker', lock: 'E  Hide in locker', fin: 'E  Shut down signal     R  Transmit recorded key' }[near.type];
  $('prompt').textContent = P.down ? '' : p;
  $('chap').textContent = `Chapter ${ST.ch}: ${CH[ST.ch - 1]}`;
  $('obj').textContent = chaseOn ? 'RUN! Weave around the server racks, cross live cables only when they are dark, reach the green EXIT.' : `Trace signal ${ST.sec ? 'done' : 'pending'}  |  Breakers ${Object.values(ST.br).filter(Boolean).length}/2  |  Documents ${ST.dc}/3` + (ST.cd > 0 ? `  |  SURVIVE ${Math.ceil(ST.cd)}s` : '');
  $('fl').textContent = 'Flashlight: ' + (P.fl ? 'ON' : 'OFF'); $('stam').firstChild.style.width = P.stam * 100 + '%'; $('corr').firstChild.style.width = ST.co + '%';
  $('hideov').classList.toggle('hide', !P.hid); $('downov').classList.toggle('hide', !P.down);
  const rn = roomName(); if (rn !== lastRoomName) { lastRoomName = rn; locEl.textContent = rn; }
  const ec = P.ec || 0; empEl.textContent = ec > .05 ? 'EMP  recharging ' + Math.ceil(ec) + 's' : 'EMP  ready  [Q]'; empEl.style.color = ec > .05 ? '#6d7a7b' : '#9fe8ff';
  const md = Math.hypot(mon.position.x - P.x, mon.position.z - P.z), fear = MS.v && !MS.u && md < 16 ? 1 - md / 16 : 0; // heartbeat and red edges when it is close
  heartEl.style.opacity = (fear * (.5 + .5 * Math.abs(Math.sin(performance.now() / 1000 * (2 + fear * 4))))).toFixed(2);
  if (fear > .12 && (hbT -= dt) <= 0) { hbT = 1.05 - fear * .6; snd({ w: 'sine', f: 60, f2: 38, d: .16, g: .55 * fear }); setTimeout(() => snd({ w: 'sine', f: 55, f2: 35, d: .14, g: .4 * fear }), 170); }
  if (chaseOn) { // finale: blinking cables, alarm light, shocks, the monster's footsteps
    chT += dt; const tt = performance.now() / 1000;
    arcs.forEach(({ a, zap, stripe }) => {
      const on = arcOn(a, chT), warn = !on && (chT + a.o) % a.p > a.p - .6;
      zap.material.opacity = on ? .3 + Math.random() * .4 : 0; stripe.material.color.setHex(on ? 0x7fd4ff : warn && Math.random() < .5 ? 0xffd23a : 0x6a5a12);
      if (on && Math.random() < .08) snd({ n: 1, f: 3000, q: .5, d: .12, g: .5, x: a.x, z: a.z });
    });
    alarmMat.color.setRGB(.4 + .6 * Math.abs(Math.sin(tt * 6)), .05, .03); chaseLight.position.set(P.x, 2.6, P.z); chaseLight.intensity = 8 + 5 * Math.abs(Math.sin(tt * 6));
    if (!P.down && !(P.stun > 0)) for (const { a } of arcs) if (arcOn(a, chT) && Math.abs(P.x - a.x) < a.w / 2 + .3 && Math.abs(P.z - a.z) < a.d / 2 + .3) {
      P.stun = 1.1; P.shake = .5; snd({ f: 120, f2: 40, d: .5, g: .8 }); snd({ n: 1, f: 3500, q: .4, d: .5, g: .8 }); sub('[Electric shock]'); break;
    }
    if (MS.v && (monStepT -= dt) <= 0) { monStepT = .32; snd({ n: 1, f: 80, q: .8, d: .18, g: .9, x: mon.position.x, z: mon.position.z }); }
  }
  // first-person flashlight hand: sways with your steps and lags a little when you turn
  vm.visible = !P.hid && !P.down; if (P.lastYaw === undefined) P.lastYaw = P.yaw;
  vm.lag += (-(P.yaw - P.lastYaw) * 2.5 - vm.lag) * Math.min(1, dt * 10); P.lastYaw = P.yaw;
  vm.position.set(Math.sin(P.bob) * .012 * amp, -Math.cos(P.bob * 2) * .01 * amp, 0); vm.rotation.y = vm.lag;
  vmLens.material.color.setHex(P.fl ? 0xfff4d0 : 0x2a2a2a);
  const lv = amb.intensity / 2.2; vm.amb.intensity = .15 + lv * .75; vm.dl.intensity = .2 + lv * 1.2; // the hand gets dark when the room does
  ren.clear(); ren.render(scene, cam); ren.clearDepth(); ren.render(viewScene, viewCam);
}
