/* Simulasi agen: rute di graf, reservasi titik, pose & animasi clay */
(function () {
  const ACH = window.ACH, world = ACH.world;
  const sim = (ACH.sim = { agents: {}, actors: [] });
  const reserved = {}; // spotId -> agentId
  const STEP = 0.36;   // durasi satu lompatan (detik)
  const ROOM_EMOTE = { meeting: '💬', tea: '☕', ramen: '🍜', whiteboard: '💡', vending: '🥤', offline: '👋' };

  const free = (s, id) => !reserved[s.id] || reserved[s.id] === id;
  function pickSpot(id, room) {
    if (room === 'desk') {
      const h = world.SPOTS.home[id];
      if (h && free(h, id)) return h;
      const sp = world.SPOTS.spare.find((s) => free(s, id));
      if (sp) return sp;
      return h || world.SPOTS.spare[0];
    }
    const list = world.SPOTS[room];
    if (!list) return pickSpot(id, 'desk');
    if (room === 'meeting') {
      const pref = list.find((s) => s.id === world.MEET_PREF[id]);
      if (pref && free(pref, id)) return pref;
    }
    const s = list.find((x) => free(x, id));
    return s || (room === 'offline' ? list[list.length - 1] : pickSpot(id, 'desk'));
  }

  class Agent {
    constructor(id) {
      this.id = id; this.kind = 'agent';
      this.x = 830; this.y = 330; this.path = []; this.spot = null; this.room = null;
      this.face = 1; this.walkT = 0; this.steps = 0; this.alpha = 1; this.alphaT = 1;
      this.emote = null; this.seed = Math.random() * 100; this.blinkT = 0; this.nextBlink = 1 + Math.random() * 4;
      this.nextEmote = 4 + Math.random() * 8; this.zzz = [];
    }
    get walking() { return this.path.length > 0; }
    pose() {
      if (this.walking || !this.spot) return 'walk';
      return this.spot.pose;
    }
    H() { return world.scaleAt(this.y); }
    setRoom(room, teleport) {
      const prevRoom = this.room;
      this.room = room;
      if (this.spot && reserved[this.spot.id] === this.id) delete reserved[this.spot.id];
      const s = pickSpot(this.id, room);
      reserved[s.id] = this.id;
      if (this.spot === s && !this.walking) return;
      this.spot = s;
      this.alphaT = 1;
      if (teleport) { this.x = s.x; this.y = s.y; this.path = []; this.face = s.face; this.arrive(true); return; }
      if (prevRoom === 'offline') this.alpha = Math.max(this.alpha, 0.6);
      this.path = world.route(this.x, this.y, s);
      if (room === 'offline') this.say('👋', 2.2);
    }
    say(ch, dur) { this.emote = { ch, t: 0, dur: dur || 3.2 }; }
    arrive(quiet) {
      this.face = this.spot.face || 1;
      if (this.room === 'offline') this.alphaT = 0.32;
      if (!quiet && ROOM_EMOTE[this.room] && this.room !== 'offline') this.say(ROOM_EMOTE[this.room]);
      this.nextEmote = 6 + Math.random() * 10;
    }
    update(dt, t) {
      // jalan
      if (this.path.length) {
        const [tx, ty] = this.path[0];
        const dx = tx - this.x, dy = ty - this.y, d = Math.hypot(dx, dy);
        const v = 64 * (this.H() / 96);
        if (Math.abs(dx) > 1.5) this.face = dx > 0 ? 1 : -1;
        this.walkT += dt;
        if (d <= v * dt) {
          this.x = tx; this.y = ty; this.path.shift();
          if (!this.path.length) { this.walkT = 0; this.arrive(false); }
        } else { this.x += (dx / d) * v * dt; this.y += (dy / d) * v * dt; }
      }
      this.alpha += (this.alphaT - this.alpha) * Math.min(1, dt * 2.2);
      // kedip
      this.nextBlink -= dt;
      if (this.nextBlink <= 0) { this.blinkT = 0.13; this.nextBlink = 2.2 + Math.random() * 4.5; if (Math.random() < 0.15) this.nextBlink = 0.25; }
      if (this.blinkT > 0) this.blinkT -= dt;
      // emote berkala sesuai ruangan
      if (this.emote) { this.emote.t += dt; if (this.emote.t > this.emote.dur) this.emote = null; }
      if (!this.walking && this.spot) {
        this.nextEmote -= dt;
        if (this.nextEmote <= 0) {
          const st = this.data && this.data.eff ? this.data.eff.status : 'kerja';
          let ch = ROOM_EMOTE[this.room];
          if (this.room === 'desk') ch = st === 'kerja' ? (Math.random() < 0.5 ? '💡' : '💬') : '☕';
          if (this.room === 'offline' || this.room === 'tatami') ch = null;
          if (ch) this.say(ch, 2.6);
          this.nextEmote = 8 + Math.random() * 14;
        }
      }
      // zzz untuk tidur siang
      if (!this.walking && this.spot && this.spot.pose === 'lie') {
        this.zt = (this.zt || 0) - dt;
        if (this.zt <= 0) { this.zzz.push({ t: 0, s: 0.7 + Math.random() * 0.5 }); this.zt = 1.1; }
      }
      this.zzz.forEach((z) => (z.t += dt));
      this.zzz = this.zzz.filter((z) => z.t < 3);
    }
    // geometri gambar saat ini (dipakai render + hit test + label)
    geom(t) {
      const m = ACH.assets.mascotFor(this.id);
      const H = this.H(), pose = this.pose();
      const aspect = m ? m.w / m.h : 0.62;
      const g = { pose, H, x: this.x, y: this.y, lift: 0, hop: 0, sx: 1, sy: 1, tilt: 0, jx: 0, dw: H * aspect, dh: H };
      const ph = t * 2.4 + this.seed;
      if (pose === 'walk') {
        const p = (this.walkT / STEP) % 1, n = Math.floor(this.walkT / STEP);
        const air = Math.sin(p * Math.PI);
        g.hop = air * H * 0.085;
        const land = Math.max(0, 1 - p / 0.2) * (this.walkT > 0.05 ? 1 : 0);
        g.sy = 1 + 0.05 * air - 0.08 * land; g.sx = 1 / Math.sqrt(g.sy);
        g.tilt = (n % 2 ? 1 : -1) * 0.055 * air;
      } else if (pose === 'lie') {
        g.sy = 1 + 0.02 * Math.sin(t * 1.4 + this.seed);
      } else {
        g.lift = this.spot.lift || 0;
        g.dh = pose === 'sit' || pose === 'stool' ? H * (m ? m.sitCut : 0.835) : H;
        g.sy = 1 + 0.013 * Math.sin(ph); g.sx = 1 - 0.006 * Math.sin(ph);
        const st = this.data && this.data.eff ? this.data.eff.status : 'kerja';
        if (this.spot.work && this.room === 'desk' && st === 'kerja') {
          if (this.spot.read) g.tilt = 0.035 * Math.sin(t * 0.9 + this.seed);
          else if (Math.sin(t * 0.8 + this.seed) > 0.1) { g.jx = Math.sin(t * 40) * 0.5 * (H / 96); g.sy += 0.01 * Math.sin(t * 21); }
        }
        if (this.emote && (this.emote.ch === '💬' || this.emote.ch === '🍜')) { const e = this.emote.t; g.hop = Math.abs(Math.sin(e * 7)) * H * 0.025 * (e < 1.4 ? 1 : 0); }
        if (this.room === 'tea' && this.emote && this.emote.ch === '☕') g.tilt = -0.04 * Math.sin(Math.min(1, this.emote.t) * Math.PI);
      }
      if (pose === 'lie') { g.top = this.y - g.dw * 0.95; }
      else g.top = this.y - g.lift - g.hop - g.dh * g.sy;
      return g;
    }
    draw(ctx, t) {
      const m = ACH.assets.mascotFor(this.id);
      if (!m) return;
      const g = this.geom(t);
      const closed = this.blinkT > 0 || g.pose === 'lie';
      ctx.save();
      ctx.globalAlpha = this.alpha;
      // bayangan kontak
      const shadow = (x, y, rx, ry, a) => {
        const gr = ctx.createRadialGradient(x, y, 0, x, y, rx);
        gr.addColorStop(0, `rgba(40,24,12,${a})`); gr.addColorStop(0.6, `rgba(40,24,12,${a * 0.55})`); gr.addColorStop(1, 'rgba(40,24,12,0)');
        ctx.fillStyle = gr; ctx.save(); ctx.translate(x, y); ctx.scale(1, ry / rx); ctx.translate(-x, -y);
        ctx.beginPath(); ctx.arc(x, y, rx, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      };
      if (g.pose === 'lie') {
        shadow(g.x, g.y - 2, g.dh * 0.58, g.dw * 0.2, 0.42);
        // bantal kecil indigo di bawah kepala
        const dir = this.spot.face || 1, px = g.x - dir * g.dh * 0.36, pw = g.dw * 0.62, phh = g.dw * 0.3;
        ctx.save();
        const pg = ctx.createLinearGradient(0, g.y - phh, 0, g.y);
        pg.addColorStop(0, '#5a669c'); pg.addColorStop(1, '#2e3a63');
        ctx.fillStyle = pg; ctx.beginPath();
        ctx.ellipse(px, g.y - phh * 0.45, pw / 2, phh / 2, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.beginPath(); ctx.ellipse(px - pw * 0.08, g.y - phh * 0.62, pw * 0.3, phh * 0.16, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        const img = m.standC;
        ctx.translate(g.x, g.y - g.dw * 0.38);
        ctx.scale(1, 0.86); // sedikit pipih mengikuti perspektif lantai
        ctx.rotate((this.spot.face || 1) * -Math.PI / 2);
        ctx.scale(g.sy, 1);
        ctx.drawImage(img, -g.dw / 2, -g.dh / 2, g.dw, g.dh);
      } else {
        if (g.pose === 'stool') shadow(g.x, g.y - g.lift + 3, g.dw * 0.34, g.dw * 0.08, 0.25);
        else if (g.pose === 'sit') shadow(g.x, g.y - g.lift + 2, g.dw * 0.52, g.dw * 0.14, 0.5);
        else shadow(g.x, g.y, g.dw * 0.4 * (1 - g.hop / (g.H * 0.3)), g.dw * 0.13, 0.45);
        const img = g.pose === 'sit' || g.pose === 'stool' ? (closed ? m.sitC : m.sit) : (closed ? m.standC : m.stand);
        ctx.translate(g.x + g.jx, g.y - g.lift - g.hop);
        ctx.rotate(g.tilt);
        ctx.scale(this.face * g.sx, g.sy);
        ctx.drawImage(img, -g.dw / 2, -g.dh, g.dw, g.dh);
      }
      ctx.restore();
    }
    hit(wx, wy, t) {
      const g = this.geom(t);
      if (g.pose === 'lie') return Math.abs(wx - g.x) < g.dh * 0.5 && wy > g.y - g.dw * 0.9 && wy < g.y + 4;
      return Math.abs(wx - g.x) < g.dw * 0.42 && wy > g.top && wy < g.y - g.lift + 4;
    }
  }

  sim.syncAgents = function (list) {
    const seen = new Set();
    list.forEach((d) => {
      seen.add(d.id);
      let a = sim.agents[d.id];
      const first = !a;
      if (!a) { a = sim.agents[d.id] = new Agent(d.id); sim.actors.push(a); }
      a.data = d;
      const room = d.eff.location;
      if (first) a.setRoom(room, true);
      else if (room !== a.room) a.setRoom(room, false);
    });
    for (const id of Object.keys(sim.agents)) {
      if (seen.has(id)) continue;
      const a = sim.agents[id];
      if (a.spot && reserved[a.spot.id] === id) delete reserved[a.spot.id];
      delete sim.agents[id];
      sim.actors = sim.actors.filter((x) => x !== a);
    }
  };
  sim.update = function (dt, t) { sim.actors.forEach((a) => a.update(dt, t)); };
  sim.reserved = reserved;
})();
