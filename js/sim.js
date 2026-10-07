/* Simulasi agen: rute di graf, reservasi titik, pose & animasi clay.
   v4 "hidup": detour ambient (jalan-jalan lalu kembali), aksi idle (lihat kiri/kanan, menguap,
   peregangan, angguk, minum, kebiasaan khas tiap divisi), gelembung obrolan, reaksi event.
   Lokasi/status RESMI selalu menang: detour hanya visual & dibatalkan bila data berubah. */
(function () {
  const ACH = window.ACH, world = ACH.world;
  const sim = (ACH.sim = { agents: {}, actors: [] });
  const reserved = {}; // spotId -> agentId
  const STEP = 0.36;   // durasi satu lompatan (detik)
  const ROOM_EMOTE = { meeting: '💬', tea: '☕', ramen: '🍜', whiteboard: '💡', vending: '🥤', offline: '👋' };
  const TAU = Math.PI * 2;
  const sstep = (a, b, x) => { const k = ACH.clamp((x - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };
  const plate = (p, i = 0.18) => sstep(0, i, p) * (1 - sstep(1 - i, 1, p)); // naik-tahan-turun
  const bell = (p) => Math.sin(Math.PI * ACH.clamp(p, 0, 1));
  const rnd = (a, b) => a + Math.random() * (b - a);
  // parameter global dari "sutradara" (life.js) — default aman bila life.js belum jalan
  sim.rhythm = { speed: 1, idleMul: 1, yawnMul: 1, reduced: false, fast: false };

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
  sim.freeSpot = (list, id) => (list || []).find((s) => free(s, id)) || null;

  const SIG = { research: 'page', ops: 'swipe', chief: 'unroll', engineering: 'twirl' };
  const DUR = { look: [1.6, 2.6], yawn: [2.3, 2.7], stretch: [1.9, 2.3], nod: [1.4, 1.9], sip: [2.0, 2.6], page: [1.8, 2.2], swipe: [1.8, 2.4], unroll: [3.0, 3.8], twirl: [1.6, 2.1], snap: [1.2, 1.4], doze: [3.2, 4.8], wake: [0.55, 0.65], wave: [1.2, 1.4] };

  class Agent {
    constructor(id) {
      this.id = id; this.kind = 'agent';
      this.x = 830; this.y = 330; this.path = []; this.spot = null; this.at = null; this.room = null;
      this.face = 1; this.walkT = 0; this.alpha = 1; this.alphaT = 1;
      this.emote = null; this.seed = Math.random() * 100; this.blinkT = 0; this.nextBlink = 1 + Math.random() * 4;
      this.nextEmote = 6 + Math.random() * 10; this.zzz = [];
      // v4
      this.detour = null; this.act = null; this.nextIdle = rnd(2, 9); this.lookFace = 0;
      this.bubble = null; this.pop = null; this.blips = []; this.celeb = 0; this.speakT = 0; this.drowsy = false;
      this.nextWander = 0; this.chat = null;
    }
    get walking() { return this.path.length > 0; }
    get settled() { return !this.walking && !!this.at; }
    pose() {
      if (this.walking || !this.at) return 'walk';
      return this.at.pose;
    }
    H() { return world.scaleAt(this.y); }
    status() { return this.data && this.data.eff ? this.data.eff.status : 'kerja'; }

    /* ---------- lokasi resmi ---------- */
    setRoom(room, teleport) {
      const prevRoom = this.room;
      this.room = room;
      this.cancelDetour();
      if (this.spot && reserved[this.spot.id] === this.id) delete reserved[this.spot.id];
      const s = pickSpot(this.id, room);
      reserved[s.id] = this.id;
      if (this.spot === s && this.at === s && !this.walking) return;
      this.spot = s; this.at = s;
      this.alphaT = 1; this.act = null; this.lookFace = 0;
      if (teleport) { this.x = s.x; this.y = s.y; this.path = []; this.face = s.face; this.arrive(true); return; }
      if (prevRoom === 'offline') this.alpha = Math.max(this.alpha, 0.6);
      this.path = world.route(this.x, this.y, s);
      if (room === 'offline') this.say('👋', 2.2);
    }
    /* ---------- detour ambient (murni visual) ---------- */
    goDetour(d) {
      if (!d.spot) return false;
      reserved[d.spot.id] = this.id;
      this.detour = Object.assign({ phase: 'go', until: 0 }, d);
      this.at = d.spot; this.act = null; this.lookFace = 0;
      this.path = world.route(this.x, this.y, d.spot);
      return true;
    }
    cancelDetour() {
      const d = this.detour;
      if (!d) return;
      if (d.spot && reserved[d.spot.id] === this.id) delete reserved[d.spot.id];
      if (this.chat && sim.endChat) sim.endChat(this.chat);
      this.detour = null;
    }
    endDetour() {
      const d = this.detour;
      if (!d || d.phase === 'back') return;
      if (d.spot && reserved[d.spot.id] === this.id) delete reserved[d.spot.id];
      if (this.chat && sim.endChat) sim.endChat(this.chat);
      d.phase = 'back'; this.at = this.spot; this.act = null; this.lookFace = 0;
      this.path = world.route(this.x, this.y, this.spot);
      if (!this.path.length) this.arrive(false);
    }
    say(ch, dur) { this.emote = { ch, t: 0, dur: dur || 3.2 }; }
    bub(ch, dur) { this.bubble = { ch, t: 0, dur: dur || 1.8 }; }
    popUp(ch, dur) { this.pop = { ch, t: 0, dur: dur || 1.9 }; }
    blip(ch) { if (this.blips.length < 4) this.blips.push({ ch, t: 0 }); }
    celebrate() { this.celeb = sim.rhythm.reduced ? 0 : 1.15; this.act = null; this.popUp('✨', 2); }
    arrive(quiet) {
      this.face = (this.at && this.at.face) || 1;
      const d = this.detour;
      if (d && d.phase === 'go') {
        d.phase = 'stay'; d.until = d.linger;
        if (d.emoji && !quiet) { this.say(d.emoji, 2.6); if (d.kind !== 'chat') this.bub(d.emoji, 2.2); }
        if (d.onArrive) d.onArrive(this);
        this.nextIdle = rnd(1.5, 4);
        return;
      }
      if (d && d.phase === 'back') { this.detour = null; this.nextIdle = rnd(3, 8); }
      if (this.room === 'offline') this.alphaT = 0.32;
      if (!quiet && ROOM_EMOTE[this.room] && this.room !== 'offline' && !d) this.say(ROOM_EMOTE[this.room]);
      this.nextEmote = 8 + Math.random() * 12;
    }
    /* ---------- aksi idle ---------- */
    startAct(type, o) {
      const r = DUR[type] || [1.5, 2];
      this.act = Object.assign({ type, t: 0, dur: rnd(r[0], r[1]) * (this.drowsy && type !== 'wake' ? 1.25 : 1), side: Math.random() < 0.5 ? -1 : 1, flip: Math.random() < 0.45 }, o || {});
    }
    pickIdle() {
      const R = sim.rhythm, st = this.status(), pose = this.pose();
      if (pose === 'lie' || pose === 'walk' || st === 'offline' || this.room === 'offline' || this.chat) return null;
      const W = [];
      const add = (k, w) => w > 0 && W.push([k, w]);
      const sig = SIG[this.id] || (this.id === 'content' ? (Math.random() < 0.55 ? 'sip' : 'snap') : 'look');
      const d = this.detour;
      if (R.reduced) { add('look', 2); add(sig === 'snap' ? 'sip' : sig, 1); }
      else if (d && d.phase === 'stay') {
        if (d.kind === 'tea' || d.kind === 'vending' || d.kind === 'ramen') add('sip', 4);
        add('look', 2); add('yawn', 0.6 * R.yawnMul); add('stretch', 0.5);
      } else if (this.inMeeting) { add('look', 1.2); add(sig, 0.8); }
      else {
        if (st === 'kerja' && this.at && this.at.work) { add('nod', 2.4); add(sig, 3); } else add(sig, 2);
        add('look', 2); add('stretch', 1); add('yawn', 0.7 * R.yawnMul);
        if (this.room === 'tea' || this.room === 'vending') add('sip', 3);
      }
      if (this.drowsy && !R.reduced && !(d && d.phase !== 'stay')) { add('doze', 3.2); add('yawn', 2); }
      let tot = W.reduce((s, x) => s + x[1], 0), r = Math.random() * tot;
      for (const [k, w] of W) { r -= w; if (r <= 0) return k; }
      return W.length ? W[0][0] : null;
    }

    update(dt, t) {
      const R = sim.rhythm;
      // jalan (kecepatan mengikuti ritme jam & kantuk)
      if (this.path.length) {
        const [tx, ty] = this.path[0];
        const dx = tx - this.x, dy = ty - this.y, d = Math.hypot(dx, dy);
        const v = 64 * (this.H() / 96) * R.speed * (this.drowsy ? 0.86 : 1);
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
      if (this.nextBlink <= 0) { this.blinkT = 0.13; this.nextBlink = (2.2 + Math.random() * 4.5) * (this.drowsy ? 0.7 : 1); if (Math.random() < 0.15) this.nextBlink = 0.25; }
      if (this.blinkT > 0) this.blinkT -= dt * (this.drowsy ? 0.6 : 1);
      // timer gelembung & pop
      if (this.emote) { this.emote.t += dt; if (this.emote.t > this.emote.dur) this.emote = null; }
      if (this.bubble) { this.bubble.t += dt; if (this.bubble.t > this.bubble.dur) this.bubble = null; }
      if (this.pop) { this.pop.t += dt; if (this.pop.t > this.pop.dur) this.pop = null; }
      for (let i = this.blips.length - 1; i >= 0; i--) { this.blips[i].t += dt; if (this.blips[i].t > 1.6) this.blips.splice(i, 1); }
      if (this.celeb > 0) this.celeb = Math.max(0, this.celeb - dt);
      if (this.speakT > 0) this.speakT = Math.max(0, this.speakT - dt);
      // detour: tinggal sebentar lalu kembali
      const dd = this.detour;
      if (dd && dd.phase === 'stay' && !this.walking) { dd.until -= dt; if (dd.until <= 0) this.endDetour(); }
      // aksi idle
      if (this.act) {
        this.act.t += dt;
        if (this.act.type === 'doze' && this.zzz.length < 3) { this.zt = (this.zt || 0) - dt; if (this.zt <= 0) { this.zzz.push({ t: 0, s: 0.6 + Math.random() * 0.4 }); this.zt = 0.9; } }
        if (this.act.t >= this.act.dur) {
          const was = this.act.type; this.act = null;
          if (was === 'doze') { this.startAct('wake'); this.popUp('❕', 1); }
          this.nextIdle = rnd(5, 13) * R.idleMul * (this.drowsy ? 1.35 : 1) * (R.reduced ? 3 : 1);
        }
      } else if (this.settled && !this.celeb) {
        this.nextIdle -= dt;
        if (this.nextIdle <= 0) {
          const k = this.pickIdle();
          if (k) this.startAct(k); else this.nextIdle = rnd(3, 6);
        }
      }
      // emote berkala sesuai ruangan (jarang; label sudah menampilkan aktivitas)
      if (!this.walking && this.at && !this.detour && !this.chat) {
        this.nextEmote -= dt;
        if (this.nextEmote <= 0) {
          let ch = ROOM_EMOTE[this.room];
          if (this.room === 'desk') ch = this.status() === 'kerja' ? (Math.random() < 0.5 ? '💡' : '💬') : '☕';
          if (this.room === 'offline' || this.room === 'tatami' || this.inMeeting) ch = null;
          if (ch && !R.reduced) this.say(ch, 2.6);
          this.nextEmote = 14 + Math.random() * 20;
        }
      }
      // zzz untuk tidur siang
      if (!this.walking && this.at && this.at.pose === 'lie') {
        this.zt = (this.zt || 0) - dt;
        if (this.zt <= 0) { this.zzz.push({ t: 0, s: 0.7 + Math.random() * 0.5 }); this.zt = 1.1; }
      }
      for (let i = this.zzz.length - 1; i >= 0; i--) { this.zzz[i].t += dt; if (this.zzz[i].t >= 3) this.zzz.splice(i, 1); }
    }
    // label panggung saat detour/kantuk (sidebar & log tetap data resmi)
    stageLabel() {
      const d = this.detour;
      if (d) {
        if (d.phase === 'go') return ['🚶', d.goLabel];
        if (d.phase === 'stay') return [d.emoji, d.stayLabel];
        return ['🚶', 'kembali ke ' + (this.room === 'desk' ? 'meja' : ACH.ROOM_LABEL[this.room] ? ACH.ROOM_LABEL[this.room].toLowerCase() : 'tempat')];
      }
      if (this.act && this.act.type === 'doze') return ['💤', 'terkantuk-kantuk'];
      if (this.speakT > 0) return ['🗣️', 'sedang bicara'];
      return null;
    }
    facing() { return !this.walking && this.lookFace ? this.lookFace : this.face; }
    // geometri gambar saat ini (dipakai render + hit test + label)
    geom(t) {
      const m = ACH.assets.mascotFor(this.id);
      const H = this.H(), pose = this.pose();
      const aspect = m ? m.w / m.h : 0.62;
      const g = { pose, H, x: this.x, y: this.y, lift: 0, hop: 0, sx: 1, sy: 1, tilt: 0, jx: 0, skew: 0, dw: H * aspect, dh: H, closed: false, face: this.facing() };
      const ph = t * (this.drowsy ? 1.5 : 2.4) + this.seed;
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
        g.lift = this.at.lift || 0;
        g.dh = pose === 'sit' || pose === 'stool' ? H * (m ? m.sitCut : 0.835) : H;
        g.sy = 1 + 0.013 * Math.sin(ph); g.sx = 1 - 0.006 * Math.sin(ph);
        const st = this.status();
        if (this.at.work && this.room === 'desk' && st === 'kerja' && !this.detour && !this.act) {
          if (this.at.read) g.tilt = 0.035 * Math.sin(t * 0.9 + this.seed);
          else if (Math.sin(t * 0.8 + this.seed) > 0.1) { g.jx = Math.sin(t * 40) * 0.5 * (H / 96); g.sy += 0.01 * Math.sin(t * 21); }
        }
        if (this.emote && (this.emote.ch === '💬' || this.emote.ch === '🍜')) { const e = this.emote.t; g.hop = Math.abs(Math.sin(e * 7)) * H * 0.025 * (e < 1.4 ? 1 : 0); }
        if (this.speakT > 0) { g.hop = Math.max(g.hop, Math.abs(Math.sin(t * 8.5)) * H * 0.028); g.sy += 0.012 * Math.sin(t * 17); }
        this.applyAct(g, t);
        if (this.celeb > 0) { // dua lompatan gembira
          const p = 1 - this.celeb / 1.15, s = Math.abs(Math.sin(p * Math.PI * 2));
          g.hop = s * H * 0.14; const land = s < 0.25 ? (0.25 - s) * 4 : 0;
          g.sy *= 1 + 0.06 * s - 0.1 * land; g.sx /= Math.sqrt(g.sy);
        }
      }
      if (this.blinkT > 0 || pose === 'lie') g.closed = true;
      if (pose === 'lie') { g.top = this.y - g.dw * 0.95; }
      else g.top = this.y - g.lift - g.hop - g.dh * g.sy;
      return g;
    }
    applyAct(g, t) {
      const a = this.act;
      if (!a) return;
      const p = a.t / a.dur, H = g.H, amp = sim.rhythm.reduced ? 0.5 : 1;
      switch (a.type) {
        case 'look': {
          const k = plate(p, 0.25) * amp;
          g.skew = a.side * 0.07 * k; g.tilt += a.side * 0.035 * k;
          if (a.flip && k > 0.5) g.face = a.side;
          break;
        }
        case 'yawn': {
          const e = sstep(0.05, 0.4, p) * (1 - sstep(0.7, 1, p));
          g.sy *= 1 + 0.065 * e; g.sx *= 1 - 0.03 * e; g.tilt += -0.03 * e * g.face;
          if (e > 0.35) g.closed = true;
          break;
        }
        case 'stretch': {
          const k = plate(p, 0.3);
          g.sy *= 1 + 0.1 * k; g.sx *= 1 - 0.055 * k; g.tilt += 0.03 * Math.sin(p * Math.PI * 3) * k;
          if (k > 0.6) g.closed = true;
          break;
        }
        case 'nod': { const n = Math.abs(Math.sin(p * Math.PI * 3)); g.sy *= 1 - 0.03 * n; g.lift -= 1.2 * n; break; }
        case 'sip': { const k = plate(p, 0.3); g.tilt += -0.06 * k * g.face; if (k > 0.85) g.closed = true; break; }
        case 'page': g.tilt += 0.02 * bell(p); break;
        case 'swipe': g.jx += Math.sin(t * 30) * 0.3 * bell(p); g.tilt += 0.015 * bell(p) * g.face; break;
        case 'unroll': g.tilt += 0.03 * plate(p, 0.2) * g.face; break;
        case 'twirl': g.tilt += 0.025 * Math.sin(p * Math.PI * 4); break;
        case 'snap': { const k = bell(p); g.sy *= 1 - 0.05 * k; g.sx *= 1 + 0.03 * k; break; }
        case 'doze': {
          const k = sstep(0, 0.35, p);
          g.sy *= 1 - 0.045 * k; g.tilt += 0.08 * k * a.side + 0.012 * Math.sin(t * 2.2); g.closed = true;
          break;
        }
        case 'wake': { const k = bell(p); g.hop = Math.max(g.hop, k * H * 0.06); g.sx *= 1 + 0.04 * Math.sin(p * TAU * 2); break; }
        case 'wave': g.tilt += 0.085 * Math.sin(p * Math.PI * 6) * (1 - p * 0.6); break;
      }
    }
    // overlay kecil (digambar dalam ruang sprite: u,v = 0..1 dari kiri-atas gambar penuh)
    drawProps(ctx, g, t) {
      const a = this.act;
      const U = (u) => (u - 0.5) * g.dw, V = (v) => -g.dh + v * g.H;
      if (!a) return;
      const p = a.t / a.dur;
      ctx.save();
      switch (a.type) {
        case 'yawn': {
          const e = sstep(0.05, 0.4, p) * (1 - sstep(0.7, 1, p));
          if (e < 0.05) break;
          ctx.fillStyle = '#4a2424';
          ctx.beginPath(); ctx.ellipse(U(0.5), V(0.385), g.dw * 0.06 * e, g.dw * 0.07 * e, 0, 0, TAU); ctx.fill();
          ctx.fillStyle = '#c86a6a';
          ctx.beginPath(); ctx.ellipse(U(0.5), V(0.385) + g.dw * 0.035 * e, g.dw * 0.035 * e, g.dw * 0.025 * e, 0, 0, TAU); ctx.fill();
          break;
        }
        case 'stretch': {
          const k = plate(p, 0.3);
          if (k < 0.2) break;
          ctx.strokeStyle = `rgba(255,248,232,${0.85 * k})`; ctx.lineWidth = Math.max(0.8, g.dw * 0.018); ctx.lineCap = 'round';
          [-1, 1].forEach((s) => { ctx.beginPath(); ctx.arc(U(0.5 + s * 0.52), V(0.1), g.dw * 0.07, s > 0 ? Math.PI * 0.9 : -Math.PI * 0.1, s > 0 ? Math.PI * 1.4 : Math.PI * 0.4); ctx.stroke(); });
          break;
        }
        case 'page': { // halaman buku terbalik (Research)
          const q = (p * 2) % 1, ang = Math.PI * sstep(0.1, 0.9, q);
          const x0 = U(0.12), y0 = V(0.448), w = 0.34 * g.dw, h = 0.03 * g.H;
          const tx = x0 + Math.cos(ang) * w, ty = y0 - Math.sin(ang) * w * 0.32;
          ctx.fillStyle = '#fbf3e0'; ctx.strokeStyle = 'rgba(140,110,70,0.8)'; ctx.lineWidth = Math.max(0.5, g.dw * 0.006);
          ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo((x0 + tx) / 2, Math.min(y0, ty) - w * 0.08, tx, ty);
          ctx.lineTo(tx, ty + h); ctx.quadraticCurveTo((x0 + tx) / 2, Math.min(y0, ty) - w * 0.08 + h, x0, y0 + h); ctx.closePath(); ctx.fill(); ctx.stroke();
          break;
        }
        case 'swipe': { // sapuan cahaya + ketukan di tablet (Ops)
          const x0 = U(0.17), x1 = U(0.46), y0 = V(0.49), y1 = V(0.66);
          ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.clip();
          const bx = x0 + (x1 - x0) * ((p * 1.6) % 1) * 1.4 - (x1 - x0) * 0.2;
          const gr = ctx.createLinearGradient(bx - 6, 0, bx + 6, 0);
          gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(230,248,255,0.75)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = gr; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
          const rp = (p * 2.5) % 1;
          ctx.strokeStyle = `rgba(255,255,255,${0.9 * (1 - rp)})`; ctx.lineWidth = Math.max(0.6, g.dw * 0.012);
          ctx.beginPath(); ctx.arc(U(0.36), V(0.6), g.dw * (0.02 + 0.07 * rp), 0, TAU); ctx.stroke();
          break;
        }
        case 'unroll': { // gulungan dibuka & dibaca (Chief)
          const k = plate(p, 0.22), L = 0.25 * g.H * k;
          if (L < 1) break;
          ctx.translate(U(0.47), V(0.6)); ctx.rotate(-0.18);
          const w = 0.22 * g.dw;
          ctx.fillStyle = '#f4e7c6'; ctx.strokeStyle = 'rgba(150,120,70,0.9)'; ctx.lineWidth = Math.max(0.5, g.dw * 0.007);
          ctx.beginPath(); ctx.rect(-w / 2, 0, w, L); ctx.fill(); ctx.stroke();
          ctx.strokeStyle = 'rgba(110,80,50,0.45)';
          for (let y = 0.25; y * w * 0.5 < L - 2; y += 0.6) { ctx.beginPath(); ctx.moveTo(-w * 0.32, y * w * 0.5 + 2); ctx.lineTo(w * 0.28, y * w * 0.5 + 2); ctx.stroke(); }
          ctx.fillStyle = '#e5d2a2';
          ctx.beginPath(); ctx.ellipse(0, L, w * 0.56, Math.max(1, w * 0.12), 0, 0, TAU); ctx.fill(); ctx.stroke();
          break;
        }
        case 'twirl': { // obeng diputar (Engineering)
          const cx = U(0.2), cy = V(0.47), r = 0.12 * g.dw, ang = t * 13;
          ctx.lineCap = 'round';
          for (let i = 0; i < 2; i++) {
            ctx.strokeStyle = `rgba(255,236,190,${0.75 - i * 0.3})`; ctx.lineWidth = Math.max(0.8, g.dw * (0.02 - i * 0.007));
            ctx.beginPath(); ctx.arc(cx, cy, r * (1 + i * 0.25), ang + i * 0.8, ang + i * 0.8 + 1.9); ctx.stroke();
          }
          ctx.fillStyle = 'rgba(255,255,255,0.95)';
          ctx.beginPath(); ctx.arc(cx + Math.cos(ang + 1.9) * r, cy + Math.sin(ang + 1.9) * r, Math.max(0.8, g.dw * 0.014), 0, TAU); ctx.fill();
          break;
        }
        case 'snap': { // pose kamera + kilat (Content)
          const k = Math.max(0, 1 - Math.abs(p - 0.45) / 0.25);
          if (k <= 0) break;
          const cx = U(0.82), cy = V(0.2), r = g.dw * 0.28 * k;
          const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
          gr.addColorStop(0, `rgba(255,255,255,${0.95 * k})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = gr; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
          ctx.strokeStyle = `rgba(255,255,240,${k})`; ctx.lineWidth = Math.max(0.7, g.dw * 0.012);
          for (let i = 0; i < 4; i++) { const an = i * Math.PI / 2 + 0.4; ctx.beginPath(); ctx.moveTo(cx + Math.cos(an) * r * 0.25, cy + Math.sin(an) * r * 0.25); ctx.lineTo(cx + Math.cos(an) * r * 0.8, cy + Math.sin(an) * r * 0.8); ctx.stroke(); }
          break;
        }
        case 'sip': {
          if (this.id === 'content') { // uap dari cangkir yang dipegang
            const k = plate(p, 0.3);
            ctx.strokeStyle = `rgba(255,252,244,${0.7 * k})`; ctx.lineWidth = Math.max(0.6, g.dw * 0.012); ctx.lineCap = 'round';
            for (let i = 0; i < 2; i++) {
              const x = U(0.2 + i * 0.08), y = V(0.5);
              ctx.beginPath(); ctx.moveTo(x, y);
              for (let s = 1; s <= 6; s++) ctx.lineTo(x + Math.sin(t * 4 + s + i * 2) * g.dw * 0.02, y - s * g.H * 0.018);
              ctx.stroke();
            }
          } else { // cangkir/kaleng kecil diangkat ke mulut
            const k = plate(p, 0.3), can = this.detour && this.detour.kind === 'vending';
            const x = U(ACH.lerp(0.3, 0.42, k)), y = V(ACH.lerp(0.62, 0.43, k)), w = g.dw * 0.11, h = g.dw * (can ? 0.15 : 0.1);
            ctx.translate(x, y); ctx.rotate(-0.5 * k);
            ctx.fillStyle = can ? '#c0392b' : '#f4efe4'; ctx.strokeStyle = 'rgba(60,40,20,0.5)'; ctx.lineWidth = Math.max(0.5, g.dw * 0.006);
            ctx.beginPath(); ctx.rect(-w / 2, -h / 2, w, h); ctx.fill(); ctx.stroke();
            ctx.fillStyle = can ? '#d9d9d9' : '#2e3a63'; ctx.fillRect(-w / 2, can ? -h / 2 : -h * 0.05, w, can ? h * 0.18 : h * 0.22);
          }
          break;
        }
      }
      ctx.restore();
    }
    draw(ctx, t) {
      const m = ACH.assets.mascotFor(this.id);
      if (!m) return;
      const g = this.geom(t);
      const closed = g.closed;
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
        shadow(g.x, g.y - 2, g.dh * 0.62, g.dw * 0.22, 0.5);
        shadow(g.x, g.y - 3, g.dh * 0.4, g.dw * 0.1, 0.35);
        const dir = this.at.face || 1, px = g.x - dir * g.dh * 0.36, pw = g.dw * 0.62, phh = g.dw * 0.3;
        ctx.save();
        const pg = ctx.createLinearGradient(0, g.y - phh, 0, g.y);
        pg.addColorStop(0, '#5a669c'); pg.addColorStop(1, '#2e3a63');
        ctx.fillStyle = pg; ctx.beginPath();
        ctx.ellipse(px, g.y - phh * 0.45, pw / 2, phh / 2, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.beginPath(); ctx.ellipse(px - pw * 0.08, g.y - phh * 0.62, pw * 0.3, phh * 0.16, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        const img = ACH.fx.lit(this.id + ':lie', m.standC, g.x, g.y, 1);
        ctx.translate(g.x, g.y - g.dw * 0.38);
        ctx.scale(1, 0.86);
        ctx.rotate((this.at.face || 1) * -Math.PI / 2);
        ctx.scale(g.sy, 1);
        ctx.drawImage(img, -g.dw / 2, -g.dh / 2, g.dw, g.dh);
      } else {
        const k = 1 - g.hop / (g.H * 0.3);
        if (g.pose === 'stool') {
          shadow(g.x, g.y - g.lift + 3, g.dw * 0.38, g.dw * 0.1, 0.34);
          shadow(g.x, g.y, g.dw * 0.42, g.dw * 0.12, 0.28);
        } else if (g.pose === 'sit') {
          shadow(g.x, g.y - g.lift + 2, g.dw * 0.58 * (0.7 + 0.3 * k), g.dw * 0.17 * (0.7 + 0.3 * k), 0.55);
          shadow(g.x, g.y - g.lift + 1, g.dw * 0.36 * k, g.dw * 0.08 * k, 0.4 * k);
        } else {
          shadow(g.x, g.y, g.dw * 0.5 * k, g.dw * 0.16 * k, 0.5);
          shadow(g.x, g.y, g.dw * 0.28 * k, g.dw * 0.075 * k, 0.42 * k);
        }
        const sitting = g.pose === 'sit' || g.pose === 'stool';
        const raw = sitting ? (closed ? m.sitC : m.sit) : (closed ? m.standC : m.stand);
        const img = ACH.fx.lit(this.id + (sitting ? ':sit' : ':std'), raw, g.x, g.y - g.lift, g.face);
        ctx.translate(g.x + g.jx, g.y - g.lift - g.hop);
        if (g.skew) ctx.transform(1, 0, -g.skew, 1, 0, 0); // condong badan atas = menoleh
        ctx.rotate(g.tilt);
        ctx.scale(g.face * g.sx, g.sy);
        ctx.drawImage(img, -g.dw / 2, -g.dh, g.dw, g.dh);
        this.drawProps(ctx, g, t);
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
      else if (room !== a.room) a.setRoom(room, false); // data resmi menang → detour dibatalkan
    });
    for (const id of Object.keys(sim.agents)) {
      if (seen.has(id)) continue;
      const a = sim.agents[id];
      a.cancelDetour();
      if (a.spot && reserved[a.spot.id] === id) delete reserved[a.spot.id];
      delete sim.agents[id];
      sim.actors = sim.actors.filter((x) => x !== a);
    }
  };
  sim.update = function (dt, t) {
    if (ACH.life) ACH.life.update(dt, t);
    sim.actors.forEach((a) => a.update(dt, t));
  };
  sim.reserved = reserved;
  sim.Agent = Agent;
})();
