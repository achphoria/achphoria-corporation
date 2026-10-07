/* "Hidup" — sutradara perilaku visual di sisi klien (TIDAK pernah menulis ke database):
   ritme jam WIB, jalan-jalan ambient, interaksi antaragen, giliran bicara saat rapat,
   reaksi terhadap perubahan data (tugas selesai/baru, log baru), kantuk saat lama tanpa update,
   partikel kilau & konfeti. Parameter uji: ?hidup=cepat (timer ±10× lebih cepat), ?hidup=tenang. */
(function () {
  const ACH = window.ACH, sim = ACH.sim, world = ACH.world, store = ACH.store;
  const Q = new URLSearchParams(location.search);
  const FAST = Q.get('hidup') === 'cepat';
  const TS = FAST ? 0.1 : 1;
  const R = sim.rhythm;
  const mq = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  const setReduced = () => (R.reduced = Q.get('hidup') === 'tenang' || !!(mq && mq.matches));
  setReduced(); if (mq && mq.addEventListener) mq.addEventListener('change', setReduced);
  R.fast = FAST;
  const life = (ACH.life = { fast: FAST, wanderMul: 1, maxAway: 2, lunch: false, snack: false, stats: { wanders: 0, returns: 0, chats: 0, turns: 0, celebrations: 0 } });
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const DROWSY_MIN = 45;

  /* ---------- ritme jam (WIB, ikut ?jam=) ---------- */
  let rhythmT = 0;
  function updateRhythm() {
    const h = ACH.fx.dayPhase().h;
    const morning = h >= 6 && h < 11, night = h >= 19 || h < 5.5;
    R.speed = morning ? 1.15 : night ? 0.82 : 1;
    R.idleMul = (night ? 1.25 : morning ? 0.9 : 1) * (FAST ? 0.35 : 1);
    R.yawnMul = night ? 2.6 : h < 7.5 ? 1.6 : morning ? 0.8 : 1;
    life.wanderMul = morning ? 0.72 : night ? 1.8 : 1;
    life.maxAway = night ? 1 : 2;
    life.lunch = h >= 11.5 && h < 13.5;
    life.snack = h >= 14.6 && h < 15.6;
    life.hour = h; life.night = night; life.morning = morning;
  }

  /* ---------- kantuk: lama tanpa update (tapi belum basi) ---------- */
  let drowsyT = 0;
  function updateDrowsy() {
    const cfg = store.cfg || { STALE_HOURS: 3 };
    const now = Date.now(), thr = DROWSY_MIN * 60e3, stale = cfg.STALE_HOURS * 3600e3;
    sim.actors.forEach((a) => {
      const d = a.data;
      if (!d || !d.eff) { a.drowsy = false; return; }
      const age = d.updated_at ? now - Date.parse(d.updated_at) : Infinity;
      const was = a.drowsy;
      a.drowsy = !d.eff.stale && d.eff.status !== 'offline' && age > thr && age < stale;
      if (a.drowsy && !was) a.nextIdle = Math.min(a.nextIdle, rnd(1, 4));
    });
  }

  /* ---------- rapat di kotatsu: giliran bicara ---------- */
  const meet = { next: 1.5, idx: 0, members: [] };
  function updateMeeting(dt) {
    const group = sim.actors.filter((a) => a.settled && a.at && /^k-/.test(a.at.id) && !a.detour && a.status() !== 'offline');
    const active = group.length >= 2;
    sim.actors.forEach((a) => {
      const was = a.inMeeting;
      a.inMeeting = active && group.includes(a);
      if (was && !a.inMeeting) { a.lookFace = 0; a.speakT = 0; }
    });
    meet.members = active ? group : [];
    if (!active) { meet.next = 1.2; return; }
    meet.next -= dt;
    if (meet.next > 0) return;
    const order = group.slice().sort((p, q) => p.x - q.x);
    let sp = order[meet.idx++ % order.length];
    if (Math.random() < 0.3) sp = pick(order);
    if (sp.act && sp.act.type === 'doze') { sp.act = null; sp.popUp('❕', 0.9); } // dipanggil bicara → langsung bangun
    const dur = rnd(2.2, 3.4) * (R.reduced ? 0.8 : 1);
    sp.speakT = R.reduced ? 0 : dur;
    sp.bub(pick(['💬', '💡', '📊', '🗓️', '😄', '👍']), Math.min(2.2, dur));
    sp.lookFace = Math.sign(720 - sp.x) || 1;
    group.forEach((o) => {
      if (o === sp) return;
      o.lookFace = Math.sign(sp.x - o.x) || o.face;
      if (!o.act && Math.random() < 0.55) o.startAct('nod', { dur: rnd(1.2, 1.8) });
    });
    life.stats.turns++;
    meet.next = dur + rnd(0.35, 0.9);
  }

  /* ---------- obrolan antaragen ---------- */
  const chats = [];
  const cooldown = {};
  const keyOf = (a, b) => (a.id < b.id ? a.id + '|' + b.id : b.id + '|' + a.id);
  function startChat(a, b, dur) {
    if (a.chat || b.chat || a === b) return null;
    const c = { a, b, t: 0, until: dur, next: 1.1, turn: 1 };
    a.chat = b.chat = c;
    a.lookFace = Math.sign(b.x - a.x) || 1; b.lookFace = Math.sign(a.x - b.x) || -1;
    a.act = null; b.act = null;
    if (!R.reduced) a.startAct('wave'); a.bub('👋', 1.3);
    if (!R.reduced) setTimeout(() => { if (b.chat === c) { b.startAct('wave'); } }, 450);
    chats.push(c);
    life.stats.chats++;
    return c;
  }
  sim.endChat = function (c) {
    const i = chats.indexOf(c);
    if (i >= 0) chats.splice(i, 1);
    [c.a, c.b].forEach((x) => { if (x.chat === c) { x.chat = null; if (!x.inMeeting) x.lookFace = 0; } });
    cooldown[keyOf(c.a, c.b)] = performance.now() + Math.max(8, 45 * TS) * 1000;
  };
  function updateChats(dt) {
    for (let i = chats.length - 1; i >= 0; i--) {
      const c = chats[i];
      c.t += dt;
      const far = Math.hypot(c.a.x - c.b.x, (c.a.y - c.b.y) * 1.3) > 190;
      if (c.t > c.until || c.a.walking || c.b.walking || far) { sim.endChat(c); continue; }
      c.a.lookFace = Math.sign(c.b.x - c.a.x) || 1; c.b.lookFace = Math.sign(c.a.x - c.b.x) || -1;
      c.next -= dt;
      if (c.next <= 0) {
        const s = c.turn ? c.b : c.a;
        s.bub(pick(['💬', '😄', '💡', '☕', '👍', '😂']), 1.45);
        if (!R.reduced) s.speakT = Math.max(s.speakT, 0.55);
        c.turn ^= 1; c.next = rnd(1.4, 2.1);
      }
    }
  }
  let proxT = 0;
  function proximity() {
    const ok = (a) => a.settled && a.data && a.status() !== 'offline' && a.pose() !== 'lie' && !a.inMeeting && !a.chat && (!a.detour || a.detour.phase === 'stay') && a.room !== 'offline';
    const L = sim.actors.filter(ok), now = performance.now();
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
      const a = L[i], b = L[j];
      if (a.chat || b.chat) continue;
      if (Math.hypot(a.x - b.x, (a.y - b.y) * 1.4) > 125) continue;
      if ((cooldown[keyOf(a, b)] || 0) > now) continue;
      startChat(a, b, rnd(6, 11));
    }
  }

  /* ---------- jalan-jalan ambient ---------- */
  const WANDER_FROM = ['desk', 'tea', 'vending', 'whiteboard'];
  const STATUS_MUL = { kerja: 1.5, terjadwal: 1.3, istirahat: 0.7, santai: 0.6 };
  const firstName = (a) => (a.data && a.data.name ? a.data.name.split(/[ &]/)[0] : a.id);
  function eligible(a) {
    return !R.reduced && a.data && a.status() !== 'offline' && WANDER_FROM.includes(a.room) && a.settled && !a.detour && !a.chat && !a.inMeeting
      && a.pose() !== 'lie' && !a.celeb && !(a.act && a.act.type === 'doze');
  }
  const nextGap = (a) => rnd(120, 360) * TS * (STATUS_MUL[a.status()] || 1) * life.wanderMul * (a.drowsy ? 1.2 : 1);
  function tryWander(a) {
    const W = [];
    const add = (k, w) => w > 0 && W.push([k, w]);
    if (a.room !== 'tea') add('tea', 3 + (life.morning ? 2 : 0) + (a.drowsy ? 2 : 0));
    if (a.room !== 'vending') add('vending', 2 + (life.snack ? 6 : 0) + (a.drowsy ? 2 : 0));
    if (a.room !== 'whiteboard') add('whiteboard', a.status() === 'kerja' ? 1.5 : 0.5);
    add('window', life.night ? 2 : 1.5);
    add('chat', 2.6);
    if (life.lunch) add('ramen', 8);
    for (let tries = 0; tries < 4 && W.length; tries++) {
      let tot = W.reduce((s, x) => s + x[1], 0), r = Math.random() * tot, k = W[0][0], idx = 0;
      for (let i = 0; i < W.length; i++) { r -= W[i][1]; if (r <= 0) { k = W[i][0]; idx = i; break; } }
      W.splice(idx, 1);
      const d = plan(a, k);
      if (d && a.goDetour(d)) { life.stats.wanders++; a.nextWander = nextGap(a); return true; }
    }
    a.nextWander = rnd(20, 50) * TS;
    return false;
  }
  // spot kosong yang tidak berdesakan dengan maskot lain (posisi sekarang & tujuan)
  function roomySpot(list, a) {
    const ok = (list || []).filter((sp) => (!sim.reserved[sp.id] || sim.reserved[sp.id] === a.id)
      && sim.actors.every((o) => o === a || (Math.hypot(o.x - sp.x, (o.y - sp.y) * 1.5) > 46 && (!o.at || Math.hypot(o.at.x - sp.x, (o.at.y - sp.y) * 1.5) > 46))));
    return ok.length ? pick(ok) : null;
  }
  function plan(a, kind) {
    const linger = rnd(10, 40) * (FAST ? 0.35 : 1);
    const L = (go, stay, emoji, spot) => (spot ? { kind, spot, goLabel: go, stayLabel: stay, emoji, linger } : null);
    switch (kind) {
      case 'tea': return L('ambil teh', 'sedang ambil teh', '🍵', roomySpot(world.SPOTS.tea, a));
      case 'vending': return L('ke vending', 'jajan minuman', '🥤', roomySpot(world.SPOTS.vending, a));
      case 'whiteboard': return L('ke papan tulis', 'corat-coret ide', '💡', roomySpot(world.SPOTS.whiteboard, a));
      case 'window': return L('ke jendela', 'lihat jendela', life.night ? '🌙' : '🌤️', roomySpot(world.SPOTS.window, a));
      case 'ramen': return L('ke konter ramen', 'makan ramen', '🍜', roomySpot(world.SPOTS.ramen, a));
      case 'chat': {
        const mates = sim.actors.filter((b) => b !== a && b.settled && b.data && b.status() !== 'offline' && b.pose() !== 'lie' && !b.detour && !b.chat && !b.inMeeting && b.room !== 'offline');
        if (!mates.length) return null;
        const b = pick(mates);
        const spot = world.visitSpot(b, a.x);
        if (!spot || (sim.reserved[spot.id] && sim.reserved[spot.id] !== a.id)) return null;
        if (sim.actors.some((o) => o !== a && Math.hypot(o.x - spot.x, o.y - spot.y) < 34)) return null;
        const d = L('samperin ' + firstName(b), 'ngobrol dgn ' + firstName(b), '💬', spot);
        d.linger = rnd(12, 24) * (FAST ? 0.6 : 1);
        d.onArrive = (me) => { if (b.settled && !b.chat && !b.detour) startChat(me, b, d.linger); };
        return d;
      }
    }
    return null;
  }
  function updateWanders(dt) {
    let away = sim.actors.filter((a) => a.detour && a.detour.phase !== 'back').length;
    sim.actors.forEach((a) => {
      if (a.detour && a.detour.phase === 'back' && !a.walking) a.detour = null;
      if (!a.nextWander) a.nextWander = rnd(25, 150) * TS * life.wanderMul;
      if (!eligible(a)) return;
      a.nextWander -= dt;
      if (a.nextWander > 0) return;
      if (away >= life.maxAway) { a.nextWander = rnd(15, 40) * TS; return; }
      if (tryWander(a)) away++;
    });
  }
  // statistik kembali (untuk uji): hitung transisi detour → null
  const hadDetour = new Map();
  function trackReturns() {
    sim.actors.forEach((a) => {
      const was = hadDetour.get(a.id);
      if (was && !a.detour && !a.walking) life.stats.returns++;
      hadDetour.set(a.id, !!a.detour);
    });
  }

  /* ---------- partikel: kilau & konfeti (pool, tanpa alokasi per frame) ---------- */
  const POOL = Array.from({ length: 160 }, () => ({ on: false }));
  const COLORS = ['#c0392b', '#e0a64a', '#8fb8de', '#8fae8b', '#d98c8c', '#fff4d6', '#5566a8'];
  function spawn(o) { const p = POOL.find((x) => !x.on); if (p) Object.assign(p, { on: true, t: 0 }, o); }
  life.burst = function (a) {
    const g = a.geom(performance.now() / 1000), cx = g.x, cy = g.top + g.dh * 0.25;
    for (let i = 0; i < 11; i++) spawn({ kind: 's', x: cx + rnd(-g.dw * 0.7, g.dw * 0.7), y: cy + rnd(-g.dh * 0.35, g.dh * 0.35), vx: rnd(-6, 6), vy: rnd(-22, -8), life: rnd(1.0, 1.7), s: rnd(3, 5.4), ph: rnd(0, 6) });
    if (R.reduced) return;
    for (let i = 0; i < 22; i++) {
      const an = rnd(-Math.PI * 0.95, -Math.PI * 0.05);
      const v = rnd(45, 95);
      spawn({ kind: 'c', x: cx, y: cy, vx: Math.cos(an) * v, vy: Math.sin(an) * v, life: rnd(1.4, 2.2), s: rnd(1.6, 2.6), rot: rnd(0, 6), vr: rnd(-9, 9), c: pick(COLORS), floor: a.y - rnd(0, 6) });
    }
  };
  function updateParticles(dt) {
    for (const p of POOL) {
      if (!p.on) continue;
      p.t += dt;
      if (p.t >= p.life) { p.on = false; continue; }
      if (p.kind === 'c') {
        if (p.y < p.floor) { p.vy += 150 * dt; p.vx *= 1 - dt * 1.2; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt; }
        else { p.y = p.floor; p.vx = p.vy = 0; }
      } else { p.x += p.vx * dt; p.y += p.vy * dt; p.vy *= 1 - dt; }
    }
  }
  life.drawParticles = function (ctx, t) {
    for (const p of POOL) {
      if (!p.on) continue;
      const k = p.t / p.life, a = Math.min(1, (1 - k) * 2.2);
      if (p.kind === 'c') {
        ctx.save(); ctx.globalAlpha = a; ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.scale(1, Math.abs(Math.cos(p.rot * 1.3)) * 0.8 + 0.2);
        ctx.fillStyle = p.c; ctx.fillRect(-p.s, -p.s * 0.45, p.s * 2, p.s * 0.9); ctx.restore();
      } else {
        const s = p.s * (0.6 + 0.4 * Math.sin(t * 9 + p.ph)) * (k < 0.2 ? k / 0.2 : 1);
        ctx.save(); ctx.globalAlpha = a; ctx.translate(p.x, p.y);
        ctx.fillStyle = '#ffd86b';
        ctx.beginPath();
        for (let i = 0; i < 8; i++) { const r = i % 2 ? s * 0.32 : s, an = (i * Math.PI) / 4; ctx.lineTo(Math.cos(an) * r, Math.sin(an) * r); }
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#fffbe8'; ctx.beginPath(); ctx.arc(0, 0, s * 0.28, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    }
  };

  /* ---------- reaksi terhadap perubahan data (realtime + demo) ---------- */
  let prevMode = null;
  const prevTask = new Map();
  store.on('tasks', () => {
    const list = Object.values(store.tasks);
    const react = prevMode === store.mode && prevTask.size > 0;
    if (react) {
      const happy = new Set(); // ✨ lebih penting dari ❗ pada pembaruan yang sama
      list.forEach((t) => { if (t.status === 'Selesai' && prevTask.get(t.id) !== 'Selesai') happy.add(t.agent_id); });
      list.forEach((t) => {
        const a = sim.agents[t.agent_id];
        const old = prevTask.get(t.id);
        if (!a) return;
        if (t.status === 'Selesai' && old !== 'Selesai') { a.celebrate(); life.burst(a); life.stats.celebrations++; }
        else if (!happy.has(t.agent_id) && (old === undefined || (t.status === 'Sedang kerja' && old !== 'Sedang kerja'))) a.popUp('❗', 1.9);
      });
    }
    prevMode = store.mode;
    prevTask.clear(); list.forEach((t) => prevTask.set(t.id, t.status));
  });
  store.on('log-added', (row) => { const a = row && sim.agents[row.agent_id]; if (a) a.blip('📝'); });

  /* ---------- loop utama (dipanggil sim.update) ---------- */
  life.update = function (dt) {
    rhythmT -= dt; if (rhythmT <= 0) { updateRhythm(); rhythmT = 2; }
    drowsyT -= dt; if (drowsyT <= 0) { updateDrowsy(); drowsyT = 1; }
    updateMeeting(dt);
    updateWanders(dt);
    updateChats(dt);
    proxT -= dt; if (proxT <= 0) { proximity(); proxT = 0.6; }
    trackReturns();
    updateParticles(dt);
  };
  life.startChat = startChat;
  life.tryWander = (id) => { const a = sim.agents[id]; return a ? tryWander(a) : false; };
  life.wanderTo = (id, kind) => { const a = sim.agents[id], d = a && plan(a, kind); if (d && a.goDetour(d)) { life.stats.wanders++; a.nextWander = nextGap(a); return true; } return false; }; // uji
  updateRhythm();
})();
