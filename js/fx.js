/* Suasana: lampion bergoyang, uap teh, monitor & server berkedip, vending,
   debu cahaya, tint siang/malam berdasarkan jam WIB */
(function () {
  const ACH = window.ACH;
  const fx = (ACH.fx = {});
  const R = ACH.rng(20261007);

  // partikel uap teh dari kyusu
  const steam = [];
  const STEAM_SRC = [[667, 212], [681, 232]];
  // debu melayang di berkas cahaya jendela shoji
  const dust = Array.from({ length: 34 }, () => ({ x: 20 + R() * 300, y: 120 + R() * 420, s: 0.5 + R() * 1.1, p: R() * 10 }));
  // LED rak server
  const leds = Array.from({ length: 26 }, () => ({ x: 966 + R() * 46, y: 160 + R() * 200, c: R() < 0.7 ? '#7fc4ff' : R() < 0.5 ? '#8dffb0' : '#ffc36b', f: 0.6 + R() * 3, p: R() * 6 }));

  // fase hari dari jam WIB → nilai 0..1 untuk tiap suasana
  fx.dayPhase = function (date) {
    const { h } = ACH.wibNow(date);
    const q = new URLSearchParams(location.search).get('jam');
    const hh = q !== null && !isNaN(+q) ? +q : h;
    const sm = (a, b, x) => ACH.clamp((x - a) / (b - a), 0, 1);
    const night = Math.max(1 - sm(5, 6.5, hh), sm(18.3, 19.6, hh));
    const golden = Math.min(sm(15.5, 17, hh), 1 - sm(18.2, 19.2, hh));
    const day = Math.min(sm(6.5, 8.5, hh), 1 - sm(15.5, 17.2, hh));
    return { h: hh, night, golden, day };
  };
  let phase = fx.dayPhase();
  setInterval(() => (phase = fx.dayPhase()), 30000);

  function glow(ctx, x, y, r, col, a) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, ACH.alpha(col, a)); g.addColorStop(0.45, ACH.alpha(col, a * 0.45)); g.addColorStop(1, ACH.alpha(col, 0));
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  fx.glow = glow;

  // lapisan belakang (setelah latar, sebelum karakter)
  fx.drawBack = function (ctx, t, dt) {
    const A = ACH.assets;
    // lampion: goyang lembut di titik gantungnya
    ACH.LAMPS.forEach((L, i) => {
      const img = A.lamps[L.id];
      if (!img) return;
      const ang = 0.018 * Math.sin(t * 0.9 + i * 1.7) + 0.008 * Math.sin(t * 2.3 + i);
      ctx.save();
      ctx.translate(L.px, L.py); ctx.rotate(ang); ctx.translate(-L.px, -L.py);
      ctx.drawImage(img, L.x, L.y, L.w, L.h);
      ctx.restore();
    });
    // monitor (3 layar) berkedip halus
    ctx.save(); ctx.globalCompositeOperation = 'screen';
    const mon = 0.1 + 0.035 * Math.sin(t * 7.3) + 0.03 * ACH.noise2(t * 3, 1, 5);
    glow(ctx, 318, 278, 38, '#8fc8ff', mon);
    glow(ctx, 370, 270, 36, '#8fc8ff', mon * 0.9);
    glow(ctx, 420, 262, 30, '#9fd8ff', mon * 0.8);
    // LED server
    leds.forEach((l) => {
      const on = Math.sin(t * l.f + l.p) > 0.2;
      if (!on) return;
      ctx.fillStyle = l.c; ctx.globalAlpha = 0.85;
      ctx.fillRect(l.x, l.y, 1.6, 1.1);
      ctx.globalAlpha = 1;
      glow(ctx, l.x + 0.8, l.y + 0.5, 5, l.c, 0.25);
    });
    // vending: panel menyala berdenyut
    const vg = 0.16 + 0.04 * Math.sin(t * 1.6) + (Math.sin(t * 13) > 0.97 ? 0.08 : 0);
    ctx.fillStyle = `rgba(220,240,255,${vg * 0.55})`;
    ctx.beginPath(); ctx.moveTo(1053, 284); ctx.lineTo(1100, 297); ctx.lineTo(1100, 370); ctx.lineTo(1053, 356); ctx.closePath(); ctx.fill();
    glow(ctx, 1078, 330, 60, '#d6ecff', vg * 0.6);
    // andon (lampu lantai) berpendar
    glow(ctx, 846, 293, 34, '#ffc98a', 0.18 + 0.05 * ACH.noise2(t * 2, 3, 9));
    glow(ctx, 112, 592, 40, '#ffc98a', 0.16 + 0.05 * ACH.noise2(t * 2, 7, 9));
    ctx.restore();

    // uap teh
    if (Math.random() < dt * 6) {
      const s = STEAM_SRC[Math.random() < 0.7 ? 0 : 1];
      steam.push({ x: s[0] + (Math.random() - 0.5) * 3, y: s[1], t: 0, life: 2.2 + Math.random() * 1.4, r: 2 + Math.random() * 2, w: Math.random() * 6 });
    }
    for (let i = steam.length - 1; i >= 0; i--) {
      const p = steam[i]; p.t += dt;
      if (p.t > p.life) { steam.splice(i, 1); continue; }
      const k = p.t / p.life;
      const x = p.x + Math.sin(p.t * 2.2 + p.w) * (2 + k * 6), y = p.y - p.t * 14;
      const a = 0.28 * Math.sin(k * Math.PI);
      const g = ctx.createRadialGradient(x, y, 0, x, y, p.r + k * 7);
      g.addColorStop(0, `rgba(255,250,240,${a})`); g.addColorStop(1, 'rgba(255,250,240,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, p.r + k * 7, 0, Math.PI * 2); ctx.fill();
    }
  };

  // lapisan depan: debu cahaya + tint hari + cahaya lampion
  fx.drawFront = function (ctx, t) {
    const W = ACH.W, H = ACH.H, ph = phase;
    ctx.save();
    // debu di berkas cahaya jendela (siang/sore lebih terlihat)
    const da = 0.25 + 0.5 * (ph.day + ph.golden * 0.8) * (1 - ph.night);
    dust.forEach((d) => {
      const x = d.x + Math.sin(t * 0.3 + d.p) * 10, y = d.y + Math.sin(t * 0.21 + d.p * 2) * 14 - ((t * 3 + d.p * 40) % 60) * 0.3;
      ctx.fillStyle = `rgba(255,240,205,${da * (0.35 + 0.35 * Math.sin(t + d.p))})`;
      ctx.beginPath(); ctx.arc(x, y, d.s, 0, Math.PI * 2); ctx.fill();
    });
    // tint waktu
    if (ph.night > 0.01) {
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = `rgba(${Math.round(255 - 95 * ph.night)},${Math.round(255 - 88 * ph.night)},${Math.round(255 - 52 * ph.night)},1)`;
      ctx.fillRect(0, 0, W, H);
      // jendela shoji jadi gelap kebiruan
      ctx.fillStyle = `rgba(90,105,160,${0.55 * ph.night})`;
      ctx.beginPath(); ctx.moveTo(0, 80); ctx.lineTo(228, 72); ctx.lineTo(232, 300); ctx.lineTo(0, 330); ctx.closePath(); ctx.fill();
    }
    if (ph.day > 0.01) {
      ctx.globalCompositeOperation = 'soft-light';
      ctx.fillStyle = `rgba(235,242,255,${0.35 * ph.day})`; ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'screen';
      const g = ctx.createRadialGradient(110, 190, 10, 160, 330, 420);
      g.addColorStop(0, `rgba(255,252,240,${0.32 * ph.day})`); g.addColorStop(1, 'rgba(255,252,240,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 640, H);
    }
    if (ph.golden > 0.01) {
      ctx.globalCompositeOperation = 'soft-light';
      ctx.fillStyle = `rgba(255,170,90,${0.35 * ph.golden})`; ctx.fillRect(0, 0, W, H);
    }
    // cahaya lampion (lebih kuat saat malam), dengan kerlip
    ctx.globalCompositeOperation = 'screen';
    const nk = 0.45 + 0.75 * ph.night + 0.25 * ph.golden;
    ACH.LAMPS.forEach((L, i) => {
      const fl = 0.85 + 0.15 * ACH.noise2(t * 3.1, i * 7, 3);
      glow(ctx, L.cx, L.cy, L.r * 2.6, '#ffcf8a', 0.22 * nk * fl);
      if (ph.night > 0.05) glow(ctx, L.cx, L.cy + 260, L.r * 5, '#ffb866', 0.07 * ph.night * fl);
    });
    if (ph.night > 0.05) {
      glow(ctx, 846, 300, 70, '#ffbf7a', 0.25 * ph.night);
      glow(ctx, 112, 600, 90, '#ffbf7a', 0.25 * ph.night);
      glow(ctx, 1080, 340, 90, '#cfe6ff', 0.18 * ph.night);
      glow(ctx, 365, 280, 90, '#9cc8ff', 0.15 * ph.night);
    }
    ctx.restore();
  };
})();
