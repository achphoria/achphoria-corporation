/* Efek & elemen dinamis dunia (bintang, bumi, radar, lift, disko, layar, alien, kubah, partikel) */
(function () {
  const ACH = window.ACH, world = ACH.world, W = ACH.W;
  const fx = (ACH.fx = {});
  const rect = (c, x, y, w, h, col) => { c.fillStyle = col; c.fillRect(Math.round(x), Math.round(y), w, h); };
  const rr = ACH.rng(4242);
  const stars = [];
  for (let i = 0; i < 260; i++) {
    const x = Math.floor(rr() * W), y = Math.floor(Math.pow(rr(), 1.25) * 128);
    stars.push({ x, y, b: 0.3 + rr() * 0.7, ph: rr() * 7, sp: 0.6 + rr() * 2.4, big: rr() < 0.06, c: rr() < 0.15 ? '#ffd9a8' : rr() < 0.3 ? '#a8d4ff' : '#ffffff' });
  }
  let earth = null, earthT = -99, shoot = null;

  function fillEllipse(c, cx, cy, rx, ry, col) {
    c.fillStyle = col;
    for (let y = -Math.ceil(ry); y <= Math.ceil(ry); y++) {
      const w = rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry)));
      if (w < 0.3) continue;
      c.fillRect(Math.round(cx - w), Math.round(cy + y), Math.max(1, Math.round(w * 2)), 1);
    }
  }
  fx.fillEllipse = fillEllipse;

  /* ---------- LANGIT ---------- */
  fx.drawSky = function (c, t) {
    c.drawImage(world.sky, 0, 0);
    for (const s of stars) {
      const a = s.b * (0.55 + 0.45 * Math.sin(t * s.sp + s.ph));
      c.globalAlpha = Math.max(0.08, a);
      rect(c, s.x, s.y, 1, 1, s.c);
      if (s.big) {
        c.globalAlpha = a * 0.6;
        rect(c, s.x - 1, s.y, 1, 1, s.c); rect(c, s.x + 1, s.y, 1, 1, s.c); rect(c, s.x, s.y - 1, 1, 1, s.c); rect(c, s.x, s.y + 1, 1, 1, s.c);
        if (a > 0.75) { c.globalAlpha = (a - 0.75) * 2; rect(c, s.x - 2, s.y, 1, 1, s.c); rect(c, s.x + 2, s.y, 1, 1, s.c); rect(c, s.x, s.y - 2, 1, 1, s.c); rect(c, s.x, s.y + 2, 1, 1, s.c); }
      }
    }
    c.globalAlpha = 1;
    // bintang jatuh
    if (!shoot && Math.random() < 0.0025) shoot = { x: 120 + Math.random() * 500, y: 6 + Math.random() * 40, p: 0 };
    if (shoot) {
      shoot.p += 0.02;
      for (let k = 0; k < 10; k++) { c.globalAlpha = (1 - k / 10) * (1 - shoot.p); rect(c, shoot.x + shoot.p * 90 - k * 2, shoot.y + shoot.p * 30 - k * 0.66, 1, 1, '#ffffff'); }
      c.globalAlpha = 1;
      if (shoot.p >= 1) shoot = null;
    }
    if (t - earthT > 1.2) { earth = world.renderEarth(t * 0.04); earthT = t; }
    c.drawImage(earth, 612 - earth.width / 2, 34 - earth.height / 2);
  };

  /* ---------- LATAR DINAMIS (sebelum aktor) ---------- */
  fx.drawBack = function (c, t) {
    const F = world.FLOOR, T = world.TOP;
    // radar berputar
    const tw = world.TOWER, rx0 = tw.x0 + 34, ry0 = 10;
    const cs = Math.cos(t * 0.9), w = Math.max(1, Math.abs(cs) * 10);
    rect(c, rx0 - 1, ry0, 2, 8, '#8a93a8');
    fillEllipse(c, rx0, ry0, w, 4.5, cs > 0 ? '#dfe5f0' : '#9aa3b5');
    if (cs > 0) fillEllipse(c, rx0, ry0, Math.max(0.5, w - 2), 2.8, '#b5bdcc');
    const fxp = rx0 + Math.sin(t * 0.9) * 6;
    rect(c, Math.min(rx0, fxp), ry0 - 1, Math.abs(fxp - rx0) + 1, 1, '#cfd6e6'); rect(c, fxp - 1, ry0 - 2, 2, 2, '#ff5f5f');
    // lampu suar
    if (Math.floor(t * 1.5) % 2) { rect(c, tw.x0 + 33, 5, 2, 1, '#ff3d3d'); world.glow(c, tw.x0 + 34, 5, 6, 6, '#ff3d3d', 0.6); }
    if (Math.floor(t * 1.2 + 0.5) % 2) rect(c, tw.x0 - 2, 69, 2, 1, '#ff3d3d');
    // lampu ring landasan
    const pc = world.PAD.cx;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2, on = Math.floor(t * 8) % 12 === k || Math.floor(t * 8 + 6) % 12 === k;
      rect(c, pc + Math.cos(a) * 36, F[0] - 2 + Math.sin(a) * 4.5, 1, 1, on ? '#ffe14d' : '#8a6a20');
    }
    // uap roket idle
    if (Math.random() < 0.18) ACH.sim.particles.push({ t: 'puff', x: pc + (Math.random() < 0.5 ? -6 : 6), y: F[0] - 6, vx: (Math.random() < 0.5 ? -1 : 1) * (6 + Math.random() * 10), vy: -2 - Math.random() * 3, life: 0, max: 2.5 + Math.random(), r: 1.5 });
    // lampu rover & hatch
    if (Math.floor(t * 2) % 2) rect(c, 356, F[0] - 22, 2, 1, '#6dff7a');
    rect(c, world.SHAFT.cx - 1, F[0] - 33, 2, 1, Math.floor(t * 2) % 2 ? '#3dd6ff' : '#1d6f8a');
    // berkas cahaya di lift
    const S = world.SHAFT, top = F[0] - 22, len = F[4] - top;
    for (let k = 0; k < 6; k++) {
      const y = top + ((t * 46 + k * 53) % len);
      c.globalAlpha = 0.5; rect(c, S.cx - 1, y, 2, 8, '#9ff6ff'); c.globalAlpha = 1;
    }
    // layar dinding, arcade, konsol
    for (const m of world.monitorScreens) {
      if (m.kind === 'wall') wallScreen(c, m, t);
      else if (m.kind === 'arcade') arcadeScreen(c, m, t);
      else if (m.kind === 'console') consoleScreen(c, m, t);
    }
    // layar meeting room
    for (let k = 0; k < 4; k++) {
      const px = world.R.meeting.x0 + 11 + k * 33;
      rect(c, px, 346, 14, 10, '#0a1c38');
      for (let b = 0; b < 4; b++) { const h = 2 + Math.round((Math.sin(t * 0.8 + b + k * 2) * 0.5 + 0.5) * 6); rect(c, px + 2 + b * 3, 355 - h, 2, h, k % 2 ? '#3dd6ff' : '#7cc4ff'); }
    }
    // menu kantin berkedip
    if (Math.floor(t * 1.4) % 2) rect(c, world.R.kantin.x0 + 30, world.TOP[4] + 16, 8, 6, '#ffb35c');
    rect(c, world.R.kantin.x0 + 6, F[4] - 27, 10, 6, Math.floor(t * 3) % 2 ? '#2a5a8a' : '#1e4470');
    // kapsul tidur: cahaya saat terisi
    ACH.sim.spots && ACH.sim.spots.sleep.forEach((s, i) => {
      const c0 = i % 3, r0 = Math.floor(i / 3), px = world.R.sleep.x0 + 3 + c0 * 24, py = F[4] - 18 - r0 * 18;
      if (s.occ) { c.globalAlpha = 0.35 + 0.15 * Math.sin(t * 1.5 + i); rect(c, px + 1, py + 1, 20, 11, '#2a4a9a'); c.globalAlpha = 1; }
    });
    // lantai disko
    const d = world.R.dance;
    const pal = ['#ff3dd8', '#3dd6ff', '#ffe14d', '#6dff7a', '#b46bff', '#ff6a3d'];
    for (let x = d.x0 + 2, i = 0; x < d.x1 - 2; x += 6, i++)
      for (let r = 0; r < 2; r++) {
        const k = Math.floor(ACH.hash2(i, r, Math.floor(t * 2.2)) * pal.length);
        c.globalAlpha = 0.85; rect(c, x, F[4] - 4 + r * 2, 5, 2, pal[k]); c.globalAlpha = 1;
      }
    // dinding disko: cahaya berputar
    for (let k = 0; k < 8; k++) {
      const x = d.x0 + 10 + ((k * 23 + t * 30) % (d.x1 - d.x0 - 20)), y = d.top + 16 + (k % 3) * 9;
      c.globalAlpha = 0.6; rect(c, x, y, 2, 2, pal[k % pal.length]); c.globalAlpha = 1;
    }
    // DJ bot
    const dj = d.x1 - 28, dy = F[4] - 12 - Math.abs(Math.sin(t * 4)) * 1.5;
    rect(c, dj - 5, dy - 13, 10, 9, '#cfd6e6'); rect(c, dj - 4, dy - 11, 8, 4, '#1a1a24');
    rect(c, dj - 3, dy - 10, 2, 2, Math.floor(t * 4) % 2 ? '#ff6ad5' : '#3dd6ff'); rect(c, dj + 1, dy - 10, 2, 2, Math.floor(t * 4) % 2 ? '#ff6ad5' : '#3dd6ff');
    rect(c, dj - 6, dy - 12, 1, 4, '#ff6ad5'); rect(c, dj + 5, dy - 12, 1, 4, '#ff6ad5'); rect(c, dj - 1, dy - 16, 2, 3, '#8a93a8'); rect(c, dj - 1, dy - 17, 2, 1, '#ffe14d');
    rect(c, dj - 4, dy - 4, 8, 6, '#9aa3b5');
    // treadmill berjalan
    [world.R.gym.x0 + 4, world.R.gym.x0 + 25].forEach((tx, i) => {
      const occ = ACH.sim.spots && ACH.sim.spots.gym[i].occ;
      for (let k = 0; k < 4; k++) rect(c, tx + ((k * 5 - (occ ? t * 30 : 0)) % 20 + 20) % 20, F[4] - 3, 2, 1, '#3a3f50');
    });
    // lampu modul berdenyut
    world.modules.forEach((m, i) => {
      const a = 0.5 + 0.5 * Math.sin(t * 2 + i);
      c.globalAlpha = 0.25 + a * 0.35; rect(c, m.x0 + 4, T[m.floor] + 10, world.MOD_W - 8, 1, '#ffffff'); c.globalAlpha = 1;
    });
    // cincin dasar kubah (di belakang aktor) + cahaya lembut di dalam kubah
    const D = world.DOME;
    world.glow(c, D.cx, F[0] - 10, D.rx - 10, 40, '#3dd6ff', 0.1 + 0.03 * Math.sin(t * 1.3));
    rect(c, D.cx - D.rx - 2, F[0] - 3, D.rx * 2 + 4, 2, '#3a4054'); rect(c, D.cx - D.rx - 2, F[0] - 3, D.rx * 2 + 4, 1, '#7fe6ff');
    for (let k = 0; k < 14; k++) rect(c, D.cx - D.rx + k * 15, F[0] - 2, 2, 1, Math.floor(t * 2 + k) % 3 ? '#3dd6ff' : '#ffffff');
    // LED server berkedip
    (world.leds || []).forEach((l) => { if (Math.sin(t * 3 + l.ph * 2.3) > -0.3) rect(c, l.x, l.y, 1, 1, l.c); });
    // kereta tambang otomatis
    const mp = (Math.sin(t * 0.12) * 0.5 + 0.5), mxp = 176 + mp * 440, mdir = Math.cos(t * 0.12) >= 0 ? 1 : -1;
    rect(c, mxp - 9, 424, 18, 8, '#5d6681'); rect(c, mxp - 9, 424, 18, 1, '#9aa3b5'); rect(c, mxp - 8, 426, 16, 1, '#3a4054');
    rect(c, mxp - 7, 421, 4, 3, '#9ff6ff'); rect(c, mxp - 2, 420, 4, 4, '#3dd6ff'); rect(c, mxp + 3, 422, 3, 2, '#9ff6ff');
    rect(c, mxp - 7, 432, 3, 2, '#22252f'); rect(c, mxp + 4, 432, 3, 2, '#22252f');
    rect(c, mxp + mdir * 9, 426, 1, 2, '#ffe14d'); world.glow(c, mxp + mdir * 16, 427, 12, 5, '#ffe9a0', 0.3);
    drawAliens(c, t);
  };

  function wallScreen(c, m, t) {
    const col = m.col;
    rect(c, m.x, m.y, m.w, m.h, ACH.mix('#050810', col, 0.12));
    world.icon(c, m.icon, m.x + 2, m.y + 2, col);
    for (let b = 0; b < 5; b++) {
      const h = 2 + Math.round((Math.sin(t * 1.1 + b * 1.3 + m.mod) * 0.5 + 0.5) * 7);
      rect(c, m.x + 12 + b * 3, m.y + m.h - 2 - h, 2, h, b % 2 ? col : ACH.shade(col, 0.4));
    }
    for (let x = 0; x < 9; x++) { const y = Math.round(Math.sin(t * 2 + x * 0.8 + m.mod) * 1.5); rect(c, m.x + 2 + x, m.y + 11 + y, 1, 1, '#ffffff'); }
    if (Math.random() < 0.01) { c.globalAlpha = 0.4; rect(c, m.x, m.y, m.w, m.h, '#ffffff'); c.globalAlpha = 1; }
  }
  function arcadeScreen(c, m, t) {
    rect(c, m.x, m.y, m.w, m.h, '#05060a');
    const o = Math.floor(t * 3) % 4;
    for (let i = 0; i < 3; i++) rect(c, m.x + 1 + i * 3 + (o > 1 ? 1 : 0), m.y + 1 + (o % 2), 2, 1, m.col);
    for (let i = 0; i < 3; i++) rect(c, m.x + 1 + i * 3 + (o > 1 ? 0 : 1), m.y + 3, 1, 1, ACH.shade(m.col, 0.3));
    rect(c, m.x + 4 + Math.round(Math.sin(t * 2 + m.x) * 3), m.y + m.h - 2, 2, 1, '#ffffff');
    if (Math.floor(t * 6 + m.x) % 3 === 0) rect(c, m.x + 5, m.y + 4 + (Math.floor(t * 12) % 4), 1, 1, '#ffe14d');
    world.glow(c, m.x + m.w / 2, m.y + m.h / 2, 12, 10, m.col, 0.25);
  }
  function consoleScreen(c, m, t) {
    rect(c, m.x, m.y, m.w, m.h, '#0b1a16');
    const cx = m.x + m.w / 2, cy = m.y + m.h / 2, an = t * 2 + m.x;
    for (let r = 1; r < 5; r++) rect(c, cx + Math.cos(an) * r - 0.5, cy + Math.sin(an) * r * 0.6 - 0.5, 1, 1, r === 4 ? '#b6ffd0' : '#3dff9a');
    rect(c, cx - 0.5, cy - 0.5, 1, 1, '#ffffff');
    if (Math.floor(t * 1.5 + m.x) % 3 === 0) rect(c, m.x + 1 + (Math.floor(m.x * 7 + t) % (m.w - 2)), m.y + 1 + (Math.floor(m.x + t) % (m.h - 2)), 1, 1, '#ff5f5f');
    c.globalAlpha = 0.35; rect(c, m.x, m.y + (Math.floor(t * 6) % m.h), m.w, 1, '#3dff9a'); c.globalAlpha = 1;
  }

  /* ---------- SETELAH FURNITUR DEPAN (sebelum aktor berdiri) ---------- */
  fx.drawMid = function (c, t) {
    const S = ACH.sim.spots;
    for (const m of world.monitorScreens) {
      if (m.kind !== 'desk' && m.kind !== 'lead') continue;
      const sp = m.kind === 'desk' ? S.desk[m.mod].team[m.seat] : S.desk[m.mod].lead;
      const on = sp.occ && sp.occ.mode === 'act' && !sp.occ.nap;
      rect(c, m.x, m.y, m.w, m.h, on ? ACH.mix('#06080f', m.col, 0.25) : '#070910');
      if (on) {
        const sc = Math.floor(t * 4 + m.x) % m.h;
        for (let y = 0; y < m.h; y++) {
          const ln = 1 + Math.floor(ACH.hash2(m.x, y + sc, 3) * (m.w - 1));
          rect(c, m.x + (y % 2), m.y + y, ln, 1, y === m.h - 1 ? '#ffffff' : ACH.shade(m.col, (y % 3) * 0.2));
        }
        world.glow(c, m.x + m.w / 2, m.y + m.h / 2, 9, 7, m.col, 0.22);
        if (Math.random() < 0.004) { c.globalAlpha = 0.6; rect(c, m.x, m.y, m.w, m.h, '#ffffff'); c.globalAlpha = 1; }
      } else {
        rect(c, m.x, m.y, m.w, m.h, ACH.mix('#0a0d18', m.col, 0.12));
        rect(c, m.x + 1, m.y + 1, m.w - 2, 1, ACH.mix('#0a0d18', m.col, 0.3));
        rect(c, m.x + ((Math.floor(t / 2) + m.x) % (m.w - 1)), m.y + 2 + ((Math.floor(t / 2) + m.y) % (m.h - 2)), 1, 1, ACH.shade(m.col, -0.1));
      }
    }
    // hologram meeting room
    const hx = 84, hy = 357, F4 = world.FLOOR[4];
    c.save(); c.globalCompositeOperation = 'lighter';
    c.globalAlpha = 0.18; c.fillStyle = '#5ab8ff';
    c.beginPath(); c.moveTo(hx - 4, F4 - 11); c.lineTo(hx + 4, F4 - 11); c.lineTo(hx + 13, hy + 2); c.lineTo(hx - 13, hy + 2); c.closePath(); c.fill();
    c.globalAlpha = 0.85;
    const R0 = 11;
    for (let a = 0; a < 40; a++) { const an = (a / 40) * Math.PI * 2; rect(c, hx + Math.cos(an) * R0, hy + Math.sin(an) * R0, 1, 1, '#7cc4ff'); }
    for (let k = 0; k < 4; k++) {
      const ph = t * 0.8 + (k * Math.PI) / 4, cx = Math.cos(ph);
      for (let a = 0; a < 24; a++) { const an = (a / 24) * Math.PI * 2; rect(c, hx + Math.sin(an) * R0 * cx, hy + Math.cos(an) * R0, 1, 1, cx > 0 ? '#9fdcff' : '#2f6cb0'); }
    }
    for (let k = -1; k <= 1; k++) { const yy = hy + k * 6, ww = Math.sqrt(R0 * R0 - 36 * k * k); rect(c, hx - ww, yy, ww * 2, 1, '#4f9de8'); }
    c.globalAlpha = 0.5; rect(c, hx + Math.cos(t * 2) * 15, hy + Math.sin(t * 2) * 4, 2, 2, '#ffe14d');
    c.restore();
    // air shower
    S.shower.slice(0, 3).forEach((s, i) => {
      if (!s.occ || s.occ.mode !== 'act') return;
      const px = world.R.shower.x0 + 2 + i * 21;
      for (let k = 0; k < 7; k++) { const y = world.TOP[4] + 14 + ((t * 70 + k * 9) % 44); c.globalAlpha = 0.7; rect(c, px + 8 + (k % 3) * 2, y, 1, 2, '#bff4ff'); }
      c.globalAlpha = 1;
    });
  };

  /* ---------- ALIEN ---------- */
  function drawAliens(c, t) {
    const gy = world.FLOOR[0];
    for (const a of ACH.sim.aliens) {
      const x = Math.round(a.x), y = Math.round(gy - a.y);
      const sq = a.squash, dir = a.dir || 1;
      if (a.t === 'dog') {
        const run = Math.abs(a.tx - a.x) > 4, lp = run ? Math.floor(t * 10) % 2 : 0;
        rect(c, x - 6, y - 7, 12, 5, '#12131f'); rect(c, x - 5, y - 6, 10, 4, a.c); rect(c, x - 5, y - 6, 10, 1, ACH.shade(a.c, 0.4));
        rect(c, x - 4, y - 2, 1, 2, ACH.shade(a.c, -0.3)); rect(c, x + 3, y - 2, 1, 2, ACH.shade(a.c, -0.3));
        rect(c, x - 2 + lp, y - 2, 1, 2, a.c); rect(c, x + 1 - lp, y - 2, 1, 2, a.c);
        const hx = x + dir * 5;
        rect(c, hx - 2, y - 9, 5, 4, a.c); rect(c, hx + dir * 2, y - 7, 1, 1, '#1b1b2b'); rect(c, hx - 2, y - 11, 1, 2, ACH.shade(a.c, -0.3)); rect(c, hx + 2, y - 11, 1, 2, ACH.shade(a.c, -0.3));
        rect(c, hx + dir * 3, y - 6, 1, 1, '#ff5fa2');
        const wag = Math.round(Math.sin(t * 18) * 1.5);
        rect(c, x - dir * 6, y - 8 + wag, 1, 3, a.c); rect(c, x - dir * 7, y - 9 + wag, 1, 1, '#ffffff');
        continue;
      }
      const big = a.t === 'blob' ? 1.25 : 1;
      const rx = 4.6 * big * (1 + sq * 0.5), ry = 4.2 * big * (1 - sq * 0.45);
      const cy = y - ry - 1;
      fillEllipse(c, x, cy, rx + 1, ry + 1, '#12131f');
      fillEllipse(c, x, cy, rx, ry, a.c);
      fillEllipse(c, x - 1, cy - ry * 0.35, rx * 0.55, ry * 0.35, ACH.shade(a.c, 0.35));
      rect(c, x - Math.round(rx) + 1, y - 2, Math.round(rx * 2) - 1, 1, ACH.shade(a.c, -0.3));
      // kaki kecil
      rect(c, x - 3, y - 1, 2, 1, ACH.shade(a.c, -0.45)); rect(c, x + 2, y - 1, 2, 1, ACH.shade(a.c, -0.45));
      // mata satu besar + kedip
      const ey = Math.round(cy) - 2, blink = Math.floor(t * 0.7 + a.seed) % 6 === 0;
      if (blink) rect(c, x - 2, ey + 2, 4, 1, '#1b1b2b');
      else { rect(c, x - 2, ey, 4, 4, '#ffffff'); rect(c, x + (dir > 0 ? 0 : -1), ey + 1, 2, 2, '#1b1b2b'); rect(c, x - 2, ey, 1, 1, '#d8f0ff'); }
      rect(c, x - 1, ey + 5, 2, 1, '#3a1030');
      if (a.t === 'antenna') {
        const top = Math.round(cy - ry);
        rect(c, x - 3, top - 4, 1, 4, ACH.shade(a.c, -0.3)); rect(c, x + 3, top - 4, 1, 4, ACH.shade(a.c, -0.3));
        const g = Math.floor(t * 3 + a.seed) % 2 ? '#ffe14d' : '#ffffff';
        rect(c, x - 4, top - 6, 2, 2, g); rect(c, x + 3, top - 6, 2, 2, g);
        world.glow(c, x - 3, top - 5, 4, 4, '#ffe14d', 0.5); world.glow(c, x + 4, top - 5, 4, 4, '#ffe14d', 0.5);
      }
    }
  }

  /* ---------- KUBAH FORCE-FIELD ---------- */
  let domeCanvas = null;
  function buildDome() {
    const D = world.DOME;
    const [cv, x] = ACH.canvas(D.rx * 2 + 4, D.ry + 4);
    const ox = D.rx + 2, oy = D.ry + 2;
    const inside = (px, py) => ((px - ox) ** 2) / (D.rx * D.rx) + ((py - oy) ** 2) / (D.ry * D.ry) <= 1 && py <= oy;
    // isi kaca
    for (let py = 0; py < oy; py++) for (let px = 0; px < cv.width; px++) if (inside(px, py)) { x.fillStyle = `rgba(90,200,255,${0.05 + (1 - py / oy) * 0.05})`; x.fillRect(px, py, 1, 1); }
    // grid heksagon (pointy-top)
    const hs = 6, ap = hs * Math.sqrt(3) / 2;
    for (let py = 0; py < oy; py++)
      for (let px = 0; px < cv.width; px++) {
        if (!inside(px, py)) continue;
        const X = px + 0.5, Y = py + 0.5;
        const q = ((Math.sqrt(3) / 3) * X - Y / 3) / hs, r = ((2 / 3) * Y) / hs;
        let cx = q, cz = r, cy = -cx - cz;
        let rx = Math.round(cx), ry = Math.round(cy), rz = Math.round(cz);
        const dx0 = Math.abs(rx - cx), dy0 = Math.abs(ry - cy), dz0 = Math.abs(rz - cz);
        if (dx0 > dy0 && dx0 > dz0) rx = -ry - rz; else if (dy0 > dz0) ry = -rx - rz; else rz = -rx - ry;
        const hx = hs * Math.sqrt(3) * (rx + rz / 2), hy = hs * 1.5 * rz;
        const ddx = Math.abs(X - hx), ddy = Math.abs(Y - hy);
        const d = Math.max(ddx, ddx * 0.5 + ddy * 0.866);
        if (d > ap - 0.85) { const k = 0.16 + (1 - py / oy) * 0.14; x.fillStyle = `rgba(150,235,255,${k})`; x.fillRect(px, py, 1, 1); }
      }
    // tepi
    for (let a = 0; a <= 400; a++) {
      const an = Math.PI + (a / 400) * Math.PI;
      const px = Math.round(ox + Math.cos(an) * D.rx), py = Math.round(oy + Math.sin(an) * D.ry);
      x.fillStyle = 'rgba(180,245,255,0.9)'; x.fillRect(px, py, 1, 1);
      x.fillStyle = 'rgba(120,220,255,0.45)'; x.fillRect(px + (px < ox ? 1 : -1), py + 1, 1, 1);
    }
    // kilau
    x.fillStyle = 'rgba(255,255,255,0.35)';
    for (let a = 0; a < 60; a++) { const an = Math.PI * 1.15 + (a / 60) * 0.5; x.fillRect(Math.round(ox + Math.cos(an) * (D.rx - 8)), Math.round(oy + Math.sin(an) * (D.ry - 8)), 2, 1); }
    domeCanvas = cv;
  }
  fx.drawFront = function (c, t) {
    const sim = ACH.sim, F = world.FLOOR;
    // bola
    const b = sim.ball;
    if (b) { const bx = Math.round(b.x), by = Math.round(F[0] - b.y); rect(c, bx - 1, by - 3, 3, 3, '#ff5fa2'); rect(c, bx - 1, by - 3, 1, 1, '#ffffff'); rect(c, bx, by - 2, 2, 1, '#ffe14d'); }
    // partikel
    for (const p of sim.particles) {
      const k = p.life / p.max;
      if (p.t === 'dust') { c.globalAlpha = 0.7 * (1 - k); rect(c, p.x, p.y, 1, 1, '#c9c9d3'); }
      else if (p.t === 'puff') { c.globalAlpha = 0.55 * (1 - k); fx.fillEllipse(c, p.x, p.y, p.r + k * 4, p.r + k * 3, '#e8ecf5'); }
      else if (p.t === 'steam') { c.globalAlpha = 0.45 * (1 - k); rect(c, p.x, p.y, 2, 2, '#ffffff'); }
      else if (p.t === 'sweat') { c.globalAlpha = 1 - k; rect(c, p.x, p.y, 1, 1, '#8fe3ff'); }
      else if (p.t === 'z') { c.globalAlpha = 1 - k; const s = k > 0.5 ? 1 : 0; ACH.pixText(c, 'Z', p.x, p.y, '#cfe0ff'); if (s) rect(c, p.x + 3, p.y - 1, 1, 1, '#cfe0ff'); }
      else if (p.t === 'note') { c.globalAlpha = 1 - k; rect(c, p.x, p.y, 1, 4, p.c); rect(c, p.x - 2, p.y + 3, 2, 2, p.c); rect(c, p.x + 1, p.y, 2, 1, p.c); }
    }
    c.globalAlpha = 1;
    // disko: bola & sorot lampu
    const d = world.R.dance, bx = (d.x0 + d.x1) / 2 - 10, by = d.top + 14;
    rect(c, bx, d.top, 1, 9, '#8a93a8');
    fx.fillEllipse(c, bx, by, 5, 5, '#cfd6e6');
    for (let k = 0; k < 10; k++) { const a = k * 1.7 + t * 2; rect(c, bx + Math.cos(a) * 3, by + Math.sin(a * 1.3) * 3, 1, 1, k % 3 ? '#ffffff' : '#7a849c'); }
    const pal = ['#ff3dd8', '#3dd6ff', '#ffe14d', '#6dff7a'];
    c.save(); c.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 4; k++) {
      const sx = d.x0 + 18 + k * 34, sy = d.top + 10;
      const ang = Math.sin(t * (0.7 + k * 0.17) + k) * 0.55;
      const len = 62, ex = sx + Math.sin(ang) * len, ey = sy + Math.cos(ang) * len;
      c.globalAlpha = 0.16; c.fillStyle = pal[k];
      c.beginPath(); c.moveTo(sx - 1, sy); c.lineTo(sx + 1, sy); c.lineTo(ex + 9, ey); c.lineTo(ex - 9, ey); c.closePath(); c.fill();
      c.globalAlpha = 0.9; rect(c, sx - 1, sy - 1, 3, 2, pal[k]);
    }
    c.restore();
    for (let k = 0; k < 6; k++) { const a = t * 3 + k; c.globalAlpha = 0.8; rect(c, d.x0 + 20 + ((k * 31 + t * 25) % (d.x1 - d.x0 - 40)), d.top + 18 + ((k * 17 + t * 9) % 50), 1, 1, '#ffffff'); }
    c.globalAlpha = 1;
    // robot pendamping (Helper)
    const helper = sim.agents.success;
    if (helper) {
      const [hx, hy] = helper.pos();
      if (!fx.bot) fx.bot = { x: hx, y: hy };
      const tx = hx - helper.facing * 9, ty = hy - 20 + Math.sin(t * 3) * 1.5;
      fx.bot.x += (tx - fx.bot.x) * 0.08; fx.bot.y += (ty - fx.bot.y) * 0.08;
      const rx = Math.round(fx.bot.x), ry = Math.round(fx.bot.y);
      rect(c, rx - 3, ry - 3, 7, 6, '#12131f'); rect(c, rx - 2, ry - 2, 5, 4, '#eef1f7'); rect(c, rx - 1, ry - 1, 3, 1, '#1b1b2b');
      rect(c, rx - 1 + (helper.facing > 0 ? 1 : 0), ry - 1, 1, 1, '#6dff7a'); rect(c, rx, ry - 5, 1, 2, '#8a93a8'); rect(c, rx, ry - 6, 1, 1, Math.floor(t * 3) % 2 ? '#6dff7a' : '#ffffff');
      c.globalAlpha = 0.5; rect(c, rx - 1, ry + 4, 3, 1, '#6dff7a'); c.globalAlpha = 1;
    }
    // kubah force-field + kilau bergerak
    if (!domeCanvas) buildDome();
    const D = world.DOME, ox = D.cx - D.rx - 2, oy = D.cy - D.ry - 2;
    c.drawImage(domeCanvas, ox, oy);
    const band = ((t * 55) % (D.rx * 2 + 120)) - 60;
    c.save(); c.beginPath(); c.rect(ox + band, oy, 26, D.ry + 4); c.clip();
    c.globalCompositeOperation = 'lighter'; c.globalAlpha = 0.9; c.drawImage(domeCanvas, ox, oy); c.restore();
  };
})();
