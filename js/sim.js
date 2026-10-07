/* Simulasi: aktor (agen, kru tim, kru lapangan), spot ruangan, lift, alien, bola */
(function () {
  const ACH = window.ACH;
  const world = ACH.world;
  const sim = (ACH.sim = { actors: [], particles: [], aliens: [], t: 0 });
  const rand = Math.random;
  const pick = (a) => a[Math.floor(rand() * a.length)];
  const HAIRS = ['#2a1c14', '#16161f', '#5a3220', '#a8401e', '#3a2a1a', '#1e2c66', '#6b4426', '#c9a46a', '#101018'];
  const SKINS = ['#f2c49b', '#e9b98f', '#d9a57a', '#c68a5e', '#f5d0ae', '#a8704a'];

  /* ---------------- SPOT ---------------- */
  function sp(floor, x, pose, o) { return Object.assign({ floor, x, pose, yOff: 0, z: 1, facing: 1 }, o || {}); }
  function buildSpots() {
    const F = 4, S = {};
    const R = world.R;
    S.meeting = [
      ...[58, 70, 82, 94, 106].map((x) => sp(F, x, 'meetfront', { yOff: -2, z: 0 })),
      sp(F, 42, 'sit', { facing: 1 }), sp(F, 121, 'sit', { facing: -1 }),
      sp(F, 28, 'talk', { yOff: 2, facing: 1 }), sp(F, 138, 'talk', { yOff: 2, facing: -1 }),
    ];
    S.kantin = [
      ...[194, 207, 225, 239].map((x) => sp(F, x, 'eatfront', { yOff: -2, z: 0 })),
      sp(F, 200, 'eatback', { yOff: 2 }), sp(F, 232, 'eatback', { yOff: 2 }),
      sp(F, 165, 'back', { yOff: 1 }), sp(F, 179, 'back', { yOff: 1 }), sp(F, 186, 'coffee', { yOff: 3 }),
    ];
    S.arcade = [
      ...[267, 287, 307, 327].map((x) => sp(F, x, 'arcade', { yOff: 1 })), sp(F, 339, 'arcade', { yOff: 1 }),
      ...[260, 277, 297, 317].map((x) => sp(F, x, 'cheer', { yOff: 4 })),
    ];
    S.gym = [
      sp(F, 366, 'run', { yOff: -3 }), sp(F, 387, 'run', { yOff: -3 }),
      sp(F, 405, 'lift'), sp(F, 420, 'lift'), sp(F, 432, 'punch'),
      ...[396, 411, 426].map((x) => sp(F, x, 'stretch', { yOff: 4 })), sp(F, 444, 'talk', { yOff: 3, facing: -1 }),
    ];
    S.sleep = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) S.sleep.push(sp(F, R.sleep.x0 + 14 + c * 24, 'sleep', { yOff: -(10 + r * 18), z: 0, pod: true }));
    S.shower = [
      ...[588, 609, 630].map((x) => sp(F, x, 'shower', { z: 0 })),
      ...[583, 604, 625, 594, 615, 636].map((x, i) => sp(F, x, 'towel', { yOff: i < 3 ? 3 : 4 })),
    ];
    S.dance = [
      ...[660, 674, 688, 702, 716, 730].map((x) => sp(F, x, 'dance', { yOff: -1 })),
      ...[667, 681, 695, 709, 723].map((x) => sp(F, x, 'dance', { yOff: 3 })),
    ];
    S.outdoor = [604, 620, 636, 652, 668, 684, 700, 716, 744, 612, 628, 660, 692, 708].map((x, i) => sp(0, x, 'play', { yOff: i > 8 ? 3 : 0 }));
    S.command = [39, 59, 79].map((x) => sp(0, x, 'console'));
    S.rocket = [sp(0, 118, 'repair', { facing: 1 }), sp(0, 128, 'talk', { yOff: 2 }), sp(0, 104, 'idle', { yOff: 1 }), sp(0, 170, 'repair', { facing: -1, yOff: 2 })];
    S.desk = world.modules.map((m) => ({
      lead: sp(m.floor, m.x0 + world.LEAD_RX + 9, 'type', { z: 0, desk: true }),
      team: world.TEAM_RX.map((rx) => sp(m.floor, m.x0 + rx + 7, 'type', { z: 0, desk: true })),
    }));
    sim.spots = S;
    sim.roomRange = {
      meeting: [24, 144, 4], kantin: [158, 248, 4], arcade: [258, 348, 4], gym: [358, 446, 4], sleep: [500, 570, 4],
      shower: [580, 640, 4], dance: [656, 744, 4], outdoor: [604, 770, 0], command: [32, 86, 0], rocket: [100, 192, 0],
    };
  }
  function reserve(actor, room, prefer) {
    release(actor);
    const list = sim.spots[room];
    if (!list) return null;
    let s = null;
    if (prefer != null && list[prefer] && !list[prefer].occ) s = list[prefer];
    if (!s) s = list.find((q) => !q.occ);
    if (!s) {
      const [a, b, f] = sim.roomRange[room];
      const pose = room === 'dance' ? 'dance' : room === 'outdoor' ? 'play' : room === 'arcade' ? 'cheer' : room === 'gym' ? 'stretch' : 'idle';
      s = sp(f, a + rand() * (b - a), pose, { yOff: f ? 4 : 3, temp: true });
    }
    s.occ = actor;
    actor.spot = s;
    return s;
  }
  function release(actor) { if (actor.spot) { if (actor.spot.occ === actor) actor.spot.occ = null; actor.spot = null; } }

  /* ---------------- LIFT ---------------- */
  const lanes = (sim.lanes = world.SHAFT.lanes.map((x, i) => ({ x, i, y: world.FLOOR[i ? 1 : 4], queue: [], riders: [], state: 'idle', timer: 0, target: null })));
  function laneFor(from, to) { return to < from ? lanes[1] : lanes[0]; } // naik → kanan, turun → kiri
  function updateLanes(dt) {
    for (const L of lanes) {
      if (L.timer > 0) { L.timer -= dt; continue; }
      if (L.state === 'idle') {
        if (!L.queue.length) continue;
        const req = L.queue[0];
        const fy = world.FLOOR[req.from];
        if (Math.abs(L.y - fy) < 0.5) {
          // naikkan semua penumpang dengan asal & tujuan sama yang sudah menunggu
          const ready = L.queue.filter((q) => q.from === req.from && q.to === req.to && q.actor.mode === 'wait').slice(0, 3);
          if (!ready.length) continue;
          L.queue = L.queue.filter((q) => !ready.includes(q));
          L.riders = ready.map((q) => q.actor);
          L.riders.forEach((a, k) => { a.mode = 'ride'; a.rideOff = (k - (ready.length - 1) / 2) * 5; });
          L.target = req.to; L.state = 'move'; L.timer = 0.35;
        } else { L.target = req.from; L.state = 'fetch'; }
      } else {
        const ty = world.FLOOR[L.target], d = ty - L.y;
        const v = Math.max(14, Math.min(78, Math.abs(d) * 2.6));
        if (Math.abs(d) <= v * dt) {
          L.y = ty;
          if (L.state === 'move') {
            L.riders.forEach((a) => {
              a.floor = L.target; a.x = L.x + (a.rideOff || 0); a.mode = 'step'; a.steps.shift();
              if (a.pending) { const [ps, pr] = a.pending; a.pending = null; a.goSpot(ps, pr); }
            });
            L.riders = [];
          }
          L.state = 'idle'; L.timer = 0.3;
        } else L.y += Math.sign(d) * v * dt;
      }
    }
  }

  /* ---------------- AKTOR ---------------- */
  function Actor(o) {
    Object.assign(this, { floor: 1, x: 300, yOff: 0, facing: 1, mode: 'act', steps: [], anim: 0, animT: 0, walkPh: 0, hop: 0, spot: null, room: null, actT: 0, dim: false }, o);
    this.vis = ACH.visual(o.look);
  }
  sim.Actor = Actor;
  Actor.prototype.pos = function () {
    if (this.mode === 'ride') { const L = lanes.find((l) => l.riders.includes(this)); if (L) return [L.x + (this.rideOff || 0), L.y]; }
    return [this.x, world.FLOOR[this.floor] + this.yOff - this.hop];
  };
  Actor.prototype.placeAt = function (room, prefer, pose) {
    const s = reserve(this, room, prefer);
    this.room = room; this.floor = s.floor; this.x = s.x; this.yOff = s.yOff; this.facing = s.facing; this.mode = 'act'; this.steps = []; this.actT = rand() * 5;
  };
  Actor.prototype.placeSpot = function (s, room) {
    release(this); s.occ = this; this.spot = s; this.room = room;
    this.floor = s.floor; this.x = s.x; this.yOff = s.yOff; this.facing = s.facing; this.mode = 'act'; this.steps = []; this.actT = rand() * 5;
  };
  Actor.prototype.goSpot = function (s, room) {
    if (this.mode === 'ride') { this.pending = [s, room]; const o = this.spot; if (o && o !== s && o.occ === this) o.occ = null; s.occ = this; this.spot = s; this.room = room; return; }
    if (this.mode === 'wait') lanes.forEach((L) => (L.queue = L.queue.filter((q) => q.actor !== this)));
    const old = this.spot;
    if (old && old !== s && old.occ === this) old.occ = null;
    s.occ = this; this.spot = s; this.room = room;
    const st = [];
    if (Math.abs(this.yOff) > 5) st.push({ t: 'hop', y: 0 });
    if (s.floor !== this.floor) {
      const L = laneFor(this.floor, s.floor);
      st.push({ t: 'walk', x: L.x + (rand() - 0.5) * 4 }, { t: 'lift', to: s.floor, lane: L.i });
    }
    st.push({ t: 'walk', x: s.x });
    if (Math.abs(s.yOff) > 5) st.push({ t: 'hop', y: s.yOff });
    st.push({ t: 'act' });
    this.steps = st; this.mode = 'step';
  };
  Actor.prototype.goRoom = function (room, prefer) {
    const cur = this.spot;
    release(this);
    const s = reserve(this, room, prefer);
    if (cur === s) return;
    this.goSpot(s, room);
  };
  Actor.prototype.update = function (dt) {
    this.animT += dt;
    if (this.mode === 'ride' || this.mode === 'act') { if (this.mode === 'act') this.actT += dt; this.updateHop(dt); return; }
    if (this.mode === 'wait') return;
    const s = this.steps[0];
    if (!s) { this.mode = 'act'; this.actT = 0; return; }
    if (s.t === 'walk') {
      const d = s.x - this.x, v = (this.kind === 'agent' ? 34 : 25) * (this.floor === 0 ? 0.85 : 1);
      this.facing = d >= 0 ? 1 : -1;
      // yOff kecil disesuaikan perlahan saat berjalan
      const ty = this.steps.length <= 2 && this.spot && Math.abs(this.spot.yOff) <= 5 ? this.spot.yOff : 0;
      this.yOff += Math.sign(ty - this.yOff) * Math.min(Math.abs(ty - this.yOff), dt * 8);
      const prev = Math.sin(this.walkPh);
      this.walkPh += dt * (this.floor === 0 ? 6.2 : 7.5);
      // langkah gravitasi rendah: lompatan kecil melayang
      this.hop = Math.abs(Math.sin(this.walkPh)) * (this.floor === 0 ? 3 : 1.6);
      if (this.floor === 0 && Math.sign(prev) !== Math.sign(Math.sin(this.walkPh))) {
        const [px, py] = [this.x, world.FLOOR[0] + this.yOff];
        for (let k = 0; k < 3; k++) sim.particles.push({ t: 'dust', x: px + (rand() - 0.5) * 4, y: py - 1, vx: (rand() - 0.5) * 8, vy: -rand() * 5, life: 0, max: 0.9 + rand() * 0.6 });
      }
      if (Math.abs(d) <= v * dt) { this.x = s.x; this.hop = 0; this.steps.shift(); }
      else this.x += Math.sign(d) * v * dt;
    } else if (s.t === 'lift') {
      this.hop = 0;
      if (!s.req) { s.req = { actor: this, from: this.floor, to: s.to }; lanes[s.lane].queue.push(s.req); }
      this.mode = 'wait';
    } else if (s.t === 'hop') {
      if (s.p == null) { s.p = 0; s.y0 = this.yOff; }
      s.p += dt / 0.9;
      const p = Math.min(1, s.p);
      this.yOff = s.y0 + (s.y - s.y0) * ACH.ease(p) - Math.sin(p * Math.PI) * 10;
      if (p >= 1) { this.yOff = s.y; this.steps.shift(); }
    } else if (s.t === 'act') {
      this.steps.shift(); this.mode = 'act'; this.actT = 0; this.hop = 0;
      if (this.spot) { this.facing = this.spot.facing; if (this.spot.faceTo != null) this.facing = this.spot.faceTo > this.x ? 1 : -1; }
    }
  };
  Actor.prototype.updateHop = function (dt) {
    // lompatan melayang untuk dansa / main di luar / sorak
    const p = this.spot && this.spot.pose;
    if (this.mode !== 'act') { this.hop = 0; return; }
    if (p === 'dance' || p === 'play' || p === 'cheer') {
      if (this.jumpV == null) { this.jumpV = 0; this.nextJump = rand() * 2; }
      if (this.hop > 0 || this.jumpV > 0) {
        this.hop += this.jumpV * dt; this.jumpV -= (p === 'play' ? 34 : 42) * dt;
        if (this.hop <= 0) { this.hop = 0; this.jumpV = 0; if (this.floor === 0) for (let k = 0; k < 4; k++) sim.particles.push({ t: 'dust', x: this.x + (rand() - 0.5) * 6, y: world.FLOOR[0] + this.yOff - 1, vx: (rand() - 0.5) * 10, vy: -rand() * 4, life: 0, max: 1 }); }
      } else {
        this.nextJump -= dt;
        if (this.nextJump <= 0) { this.jumpV = p === 'play' ? 18 + rand() * 9 : 20 + rand() * 6; this.hop = 0.01; this.nextJump = p === 'dance' ? 0.8 + rand() * 1.2 : 1.5 + rand() * 3; }
      }
    } else this.hop = 0;
  };
  // pose sprite saat ini + frame
  Actor.prototype.pose = function () {
    const t = this.animT;
    if (this.mode === 'ride' || this.mode === 'wait') return ['idle', Math.floor(t * 0.7) % 9 === 0 ? 1 : 0];
    if (this.mode === 'step') {
      const s = this.steps[0];
      if (s && s.t === 'hop') return ['up', 0];
      return ['walk', Math.floor(((this.walkPh % (Math.PI * 2)) / (Math.PI * 2)) * 4) % 4];
    }
    const p = this.override || (this.spot ? this.spot.pose : 'idle');
    const blink = Math.floor(t * 1.3) % 7 === 0 ? 1 : 0;
    switch (p) {
      case 'type': return this.nap ? ['nap', 0] : (Math.floor(t / 2.5) % 5 === 4 ? ['sit', 0] : ['type', Math.floor(t * 6) % 2]);
      case 'sit': return ['sit', 0];
      case 'meetfront': return Math.floor(t / 1.8 + this.seed) % 3 === 0 ? ['talk', Math.floor(t * 2) % 2] : ['idle', blink];
      case 'eatfront': return Math.floor(t / 1.1 + this.seed) % 3 === 0 ? ['coffee', 0] : ['idle', blink];
      case 'eatback': case 'back': case 'console': return ['back', Math.floor(t * 3) % 2];
      case 'arcade': return ['back', Math.floor(t * 8) % 2];
      case 'cheer': return Math.floor(t / 0.7 + this.seed) % 2 ? ['up', 0] : ['idle', 0];
      case 'run': return ['run', Math.floor(t * 9) % 4];
      case 'lift': return ['lift', Math.floor(t / 1.7) % 2];
      case 'punch': return ['punch', Math.floor(t * 3.2) % 2];
      case 'stretch': return ['stretch', Math.floor(t / 2.2) % 2];
      case 'sleep': return ['sleep', 0];
      case 'shower': return ['back', Math.floor(t * 1.5) % 2];
      case 'towel': return ['idle', blink];
      case 'dance': return ['dance', Math.floor(t * 2.6 + this.seed) % 4];
      case 'play': return this.cheerT > 0 ? ['up', 0] : ['idle', blink];
      case 'talk': return ['talk', Math.floor(t * 2) % 2];
      case 'coffee': return ['coffee', 0];
      case 'repair': return ['repair', Math.floor(t * 2.5) % 2];
      case 'stand': return ['stand', 0];
      default: return ['idle', blink];
    }
  };

  /* ---------------- AGEN ---------------- */
  sim.agents = {};
  sim.syncAgents = function (agentRows) {
    // agentRows: [{id,name,division,color,slot,location,status,...}]
    const seen = new Set();
    agentRows.forEach((a) => {
      seen.add(a.id);
      let act = sim.agents[a.id];
      const look = Object.assign({}, ACH.PROFILE[a.id] || { hair: pick(HAIRS), skin: pick(SKINS), prop: null }, { color: a.color || '#cccccc' });
      if (!act) {
        act = new Actor({ id: a.id, kind: 'agent', look, key: 'A:' + a.id + ':' + look.color, seed: rand() * 5 });
        sim.agents[a.id] = act; sim.actors.push(act);
        act.data = a; act.slot = a.slot;
        if (a.eff.location === 'desk') act.placeSpot(sim.spots.desk[a.slot].lead, 'desk');
        else act.placeAt(a.eff.location, a.slot);
      } else if (act.look.color !== look.color) { act.look = look; act.vis = ACH.visual(look); act.key = 'A:' + a.id + ':' + look.color; }
      act.data = a; act.slot = a.slot;
      act.dim = a.eff.status === 'offline';
      act.nap = a.eff.status === 'istirahat' || a.eff.status === 'offline';
      if (act.room !== a.eff.location) {
        act.excursion = null; act.override = null;
        if (a.eff.location === 'desk') act.goSpot(sim.spots.desk[a.slot].lead, 'desk');
        else act.goRoom(a.eff.location, a.slot);
      }
    });
    sim.actors = sim.actors.filter((x) => x.kind !== 'agent' || seen.has(x.id) || (release(x), delete sim.agents[x.id], false));
  };

  function agentBrain(a, dt) {
    if (a.mode !== 'act') return;
    // sesekali agen di meja berdiri menghampiri anggota tim
    if (a.room === 'desk' && !a.nap) {
      if (!a.excursion && a.actT > (a.nextEx || (a.nextEx = 35 + rand() * 60))) {
        const m = world.modules[a.slot];
        const k = Math.floor(rand() * 4);
        const tx = m.x0 + world.TEAM_RX[k] + 7 + (k < 2 ? 14 : -10);
        a.excursion = true; a.nextEx = 35 + rand() * 60;
        const s = sp(m.floor, tx, 'talk', { yOff: 3, facing: k < 2 ? -1 : 1, temp: true });
        const home = sim.spots.desk[a.slot].lead;
        a.goSpot(s, 'desk'); a.returnTo = home; a.exT = 5 + rand() * 4;
      } else if (a.excursion && a.spot && a.spot.temp) {
        a.exT -= dt;
        if (a.exT <= 0) { a.excursion = null; a.goSpot(a.returnTo, 'desk'); }
      }
    }
  }

  /* ---------------- KRU TIM (NPC) ---------------- */
  function npcBrain(n, dt) {
    if (n.mode !== 'act') return;
    n.timer -= dt;
    const h = ACH.wibNow().h;
    const night = h >= 22 || h < 6;
    if (n.state === 'desk') {
      n.nap = night && n.seed > 2;
      if (n.timer <= 0) {
        const r = rand();
        const kantinCount = sim.actors.filter((x) => x.kind === 'npc' && x.state === 'kantin').length;
        if (r < 0.22 && kantinCount < 4 && !night) {
          n.state = 'kantin'; n.timer = 14 + rand() * 22; n.goRoom('kantin');
        } else if (r < 0.62) {
          const m = world.modules[n.mod];
          const lo = m.floor >= 1 ? 156 : 156, hi = 640;
          let x = Math.max(lo, Math.min(hi, n.x + (rand() - 0.5) * 170));
          if (x > 444 && x < 500) x = x < 472 ? 440 : 504;
          const s = sp(m.floor, x, rand() < 0.5 ? 'coffee' : 'talk', { yOff: 3, temp: true, facing: rand() < 0.5 ? 1 : -1 });
          n.state = 'wander'; n.timer = 5 + rand() * 8; n.goSpot(s, 'desk');
        } else {
          n.state = 'stretch'; n.timer = 3 + rand() * 3;
          const s = sp(n.home.floor, n.home.x + 9, 'stretch', { yOff: 3, temp: true });
          n.goSpot(s, 'desk');
        }
      }
    } else if (n.timer <= 0) {
      n.state = 'desk'; n.timer = 25 + rand() * 60; n.goSpot(n.home, 'desk');
    }
  }

  /* ---------------- ALIEN & BOLA ---------------- */
  function initAliens() {
    const D = world.DOME;
    const types = [['blob', '#6dff7a'], ['blob', '#b46bff'], ['antenna', '#c77dff'], ['dog', '#7dffb0'], ['blob', '#4de0a0'], ['antenna', '#ff8ad8'], ['blob', '#a06bff'], ['antenna', '#5dffd0']];
    sim.aliens = types.map(([t, c], i) => ({ t, c, x: D.cx - 76 + i * 20, y: 0, vy: 0, tx: D.cx, dir: 1, seed: rand() * 9, timer: rand() * 2, squash: 0 }));
    sim.ball = { x: D.cx, y: 0, vy: 0, vx: 0, from: null, to: null, p: 0, holder: null, wait: 1 };
  }
  function updateAliens(dt) {
    const D = world.DOME, lo = D.cx - D.rx + 12, hi = D.cx + D.rx - 14;
    const ball = sim.ball;
    for (const a of sim.aliens) {
      a.timer -= dt;
      if (a.t === 'dog') {
        a.tx = ball.x;
        const d = a.tx - a.x;
        if (Math.abs(d) > 4) { a.x += Math.sign(d) * Math.min(Math.abs(d), 34 * dt); a.dir = Math.sign(d); }
        if (a.y <= 0 && a.timer <= 0 && rand() < 0.02) { a.vy = 30; a.timer = 1; }
      } else {
        if (a.timer <= 0 && a.y <= 0) { a.tx = Math.max(lo, Math.min(hi, a.x + (rand() - 0.5) * 60)); a.vy = 22 + rand() * 18; a.timer = 0.8 + rand() * 2.2; a.squash = 0.3; }
        if (a.y > 0 || a.vy > 0) { const d = a.tx - a.x; a.x += Math.sign(d) * Math.min(Math.abs(d), 22 * dt); a.dir = Math.sign(d) || a.dir; }
      }
      if (a.y > 0 || a.vy > 0) { a.y += a.vy * dt; a.vy -= 40 * dt; if (a.y <= 0) { a.y = 0; a.vy = 0; a.squash = 0.35; } }
      a.squash = Math.max(0, a.squash - dt * 1.5);
      a.x = Math.max(lo, Math.min(hi, a.x));
    }
    // bola dioper antar pemain di kubah
    const players = sim.actors.filter((x) => x.room === 'outdoor' && x.mode === 'act');
    players.forEach((p) => (p.cheerT = Math.max(0, (p.cheerT || 0) - dt)));
    if (ball.to) {
      ball.p += dt / ball.dur;
      const p = Math.min(1, ball.p);
      const [x0, y0] = ball.from, tp = ball.to.pos ? ball.to.pos() : [ball.to.x, world.FLOOR[0]];
      const x1 = tp[0], y1 = tp[1] - 12;
      ball.x = x0 + (x1 - x0) * p;
      ball.y = (world.FLOOR[0] - y0) * (1 - p) + (world.FLOOR[0] - y1) * p + Math.sin(p * Math.PI) * ball.h;
      if (p >= 1) { ball.holder = ball.to; ball.to = null; ball.wait = 0.6 + rand() * 1.2; if (ball.holder.cheerT != null) ball.holder.cheerT = 0.6; }
    } else if (players.length >= 2) {
      ball.wait -= dt;
      const hold = ball.holder && players.includes(ball.holder) ? ball.holder : null;
      if (hold) { const [hx, hy] = hold.pos(); ball.x = hx + 4 * hold.facing; ball.y = world.FLOOR[0] - hy + 13; }
      if (ball.wait <= 0) {
        const from = hold ? hold.pos() : [ball.x, world.FLOOR[0] - ball.y];
        const targets = players.filter((p) => p !== hold);
        const to = pick(targets);
        if (hold) { hold.cheerT = 0.5; hold.facing = to.x > hold.x ? 1 : -1; }
        to.facing = from[0] > to.x ? 1 : -1;
        ball.from = [from[0], from[1] - 12]; ball.to = to; ball.p = 0; ball.dur = 1.1 + Math.abs(to.x - from[0]) / 120; ball.h = 18 + rand() * 14;
      }
    } else {
      // tanpa pemain: bola menggelinding & dikejar anjing alien
      ball.holder = null;
      if (ball.y > 0 || ball.vy > 0) { ball.y += ball.vy * dt; ball.vy -= 30 * dt; if (ball.y <= 0) { ball.y = 0; ball.vy = Math.abs(ball.vy) > 6 ? -ball.vy * 0.5 : 0; } }
      ball.x += ball.vx * dt; ball.vx *= 1 - dt * 0.6;
      if (ball.x < lo || ball.x > hi) { ball.vx = -ball.vx; ball.x = Math.max(lo, Math.min(hi, ball.x)); }
      const dog = sim.aliens.find((a) => a.t === 'dog');
      if (dog && Math.abs(dog.x - ball.x) < 5 && ball.y < 2) { ball.vx = (rand() < 0.5 ? -1 : 1) * (30 + rand() * 30); ball.vy = 20 + rand() * 15; }
    }
  }

  /* ---------------- INIT & UPDATE ---------------- */
  sim.init = function (modInfo) {
    buildSpots();
    sim.actors = []; sim.agents = {};
    // 36 kru tim
    for (let m = 0; m < 9; m++) {
      const col = modInfo[m].color;
      for (let k = 0; k < 4; k++) {
        const look = { npc: true, color: col, hair: pick(HAIRS), skin: pick(SKINS) };
        const n = new Actor({ id: 'npc-' + m + '-' + k, kind: 'npc', look, key: 'N:' + m + ':' + k + ':' + col, mod: m, seat: k, seed: rand() * 5, name: 'Kru ' + modInfo[m].division });
        n.home = sim.spots.desk[m].team[k];
        n.placeSpot(n.home, 'desk');
        n.state = 'desk'; n.timer = 4 + rand() * 50;
        sim.actors.push(n);
      }
    }
    // 3 kru lapangan di kubah
    for (let k = 0; k < 3; k++) {
      const look = { color: ['#9aa3b5', '#ff8a5c', '#5cc8ff'][k], hair: pick(HAIRS), skin: pick(SKINS) };
      const c = new Actor({ id: 'crew-' + k, kind: 'crew', look, key: 'C:' + k, seed: rand() * 5, name: 'Kru Lapangan' });
      c.placeAt('outdoor', 9 + k * 2);
      sim.actors.push(c);
    }
    // 2 kru patroli di permukaan
    for (let k = 0; k < 2; k++) {
      const look = { color: ['#ffc940', '#6dff7a'][k], hair: pick(HAIRS), skin: pick(SKINS) };
      const c = new Actor({ id: 'patrol-' + k, kind: 'crew', patrol: true, look, key: 'P:' + k, seed: rand() * 5, name: 'Kru Patroli' });
      c.placeSpot(sp(0, 200 + k * 160, 'idle', { temp: true }), 'surface');
      c.timer = 2 + rand() * 6;
      sim.actors.push(c);
    }
    initAliens();
  };
  function patrolBrain(c, dt) {
    if (c.mode !== 'act') return;
    c.timer -= dt;
    if (c.timer > 0) return;
    const opts = [[350, 'repair', -1], [250, 'repair', 1], [310, 'idle', 1], [200, 'talk', 1], [420, 'idle', -1], [104, 'idle', 1], [330, 'repair', 1]];
    const [x, pose, f] = pick(opts);
    c.goSpot(sp(0, x + (rand() - 0.5) * 16, pose, { temp: true, facing: f, yOff: 2 }), 'surface');
    c.timer = 4 + rand() * 8;
  }
  sim.recolorTeams = function (modInfo) {
    sim.actors.forEach((n) => {
      if (n.kind !== 'npc') return;
      const col = modInfo[n.mod].color;
      if (n.look.color !== col) { n.look.color = col; n.vis = ACH.visual(n.look); n.key = 'N:' + n.mod + ':' + n.seat + ':' + col; }
      n.name = 'Kru ' + modInfo[n.mod].division;
    });
  };
  sim.update = function (dt) {
    sim.t += dt;
    updateLanes(dt);
    for (const a of sim.actors) {
      a.update(dt);
      if (a.kind === 'npc') npcBrain(a, dt);
      else if (a.kind === 'agent') agentBrain(a, dt);
      else if (a.patrol) patrolBrain(a, dt);
      // partikel aktivitas
      if (a.mode === 'act' && a.spot) {
        const [x, y] = a.pos();
        if ((a.spot.pose === 'sleep' || a.nap) && rand() < dt * 0.7) sim.particles.push({ t: 'z', x: x + 4, y: y - (a.spot.pose === 'sleep' ? 6 : 16), vx: 3, vy: -5, life: 0, max: 2.6 });
        if (a.spot.pose === 'shower' && rand() < dt * 6) sim.particles.push({ t: 'steam', x: x + (rand() - 0.5) * 14, y: y - 18, vx: (rand() - 0.5) * 3, vy: -4 - rand() * 3, life: 0, max: 2 });
        if (a.spot.pose === 'dance' && rand() < dt * 0.5) sim.particles.push({ t: 'note', x: x, y: y - 22, vx: (rand() - 0.5) * 6, vy: -7, life: 0, max: 1.8, c: pick(['#ff6ad5', '#3dd6ff', '#ffe14d']) });
        if (a.spot.pose === 'run' && rand() < dt * 1.2) sim.particles.push({ t: 'sweat', x: x - 3, y: y - 16, vx: -6, vy: 4, life: 0, max: 0.6 });
      }
    }
    updateAliens(dt);
    for (const p of sim.particles) { p.life += dt; p.x += p.vx * dt; p.y += p.vy * dt; if (p.t === 'dust') p.vy += 2 * dt; if (p.t === 'sweat') p.vy += 30 * dt; }
    sim.particles = sim.particles.filter((p) => p.life < p.max);
    if (sim.particles.length > 400) sim.particles.splice(0, sim.particles.length - 400);
  };
})();
