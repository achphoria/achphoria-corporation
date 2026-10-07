/* Suasana: lampion bergoyang, uap teh & ramen, monitor & server yang bereaksi pada data,
   pencahayaan sprite (ambient lokal + rim light), papan "Hari ini" di whiteboard,
   tint siang/senja/malam berdasarkan jam WIB */
(function () {
  const ACH = window.ACH;
  const fx = (ACH.fx = {});
  const R = ACH.rng(20261007);

  // partikel uap: teh (kyusu) & ramen (mangkuk di konter)
  const steam = [];
  const TEA_SRC = [[667, 212], [681, 232]];
  const RAMEN_SRC = [[680, 226], [710, 226], [728, 231]];
  // debu melayang di berkas cahaya jendela shoji
  const dust = Array.from({ length: 34 }, () => ({ x: 20 + R() * 300, y: 120 + R() * 420, s: 0.5 + R() * 1.1, p: R() * 10 }));
  // LED rak server (fase diakumulasi supaya kecepatan bisa berubah mulus)
  const leds = Array.from({ length: 30 }, () => ({ x: 966 + R() * 46, y: 160 + R() * 200, c: R() < 0.7 ? '#7fc4ff' : R() < 0.5 ? '#8dffb0' : '#ffc36b', f: 0.6 + R() * 3, ph: R() * 6 }));
  // garis data yang "bergulir" di 3 monitor saat Ops bekerja
  const MONS = [[318, 278, 38], [370, 270, 36], [420, 262, 30]];

  // fase hari dari jam WIB → nilai 0..1 untuk tiap suasana
  fx.dayPhase = function (date) {
    const { h } = ACH.wibNow(date);
    const q = new URLSearchParams(location.search).get('jam');
    const hh = q !== null && q !== '' && !isNaN(+q) ? +q : h;
    const sm = (a, b, x) => ACH.clamp((x - a) / (b - a), 0, 1);
    const night = Math.max(1 - sm(5, 6.5, hh), sm(18.3, 19.6, hh));
    const golden = Math.min(sm(15.5, 17, hh), 1 - sm(18.2, 19.2, hh));
    const day = Math.min(sm(6.5, 8.5, hh), 1 - sm(15.5, 17.2, hh));
    return { h: hh, night, golden, day };
  };
  let phase = fx.dayPhase();
  setInterval(() => (phase = fx.dayPhase()), 30000);
  fx.phase = () => phase;

  function glow(ctx, x, y, r, col, a) {
    if (a <= 0.003) return;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, ACH.alpha(col, a)); g.addColorStop(0.45, ACH.alpha(col, a * 0.45)); g.addColorStop(1, ACH.alpha(col, 0));
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  fx.glow = glow;

  /* ---------- reaksi terhadap data (dihaluskan) ---------- */
  const react = { mon: 0, srv: 0, tea: 0, ramen: 0 };
  fx.react = react;
  function updateReact(dt) {
    const acts = ACH.sim ? ACH.sim.actors : [];
    const settled = (a, room) => a.room === room && !a.walking;
    const working = (a) => a.data && a.data.eff && a.data.eff.status === 'kerja';
    const ops = acts.find((a) => a.id === 'ops'), eng = acts.find((a) => a.id === 'engineering');
    const tgt = {
      mon: ops && settled(ops, 'desk') && working(ops) ? 1 : 0,
      srv: eng && settled(eng, 'desk') && working(eng) ? 1 : 0,
      tea: Math.min(1, acts.filter((a) => settled(a, 'tea')).length * 0.7),
      ramen: Math.min(1, acts.filter((a) => settled(a, 'ramen')).length * 0.5),
    };
    const k = 1 - Math.exp(-dt * 1.6);
    for (const key in tgt) react[key] += (tgt[key] - react[key]) * k;
  }

  /* ---------- peta cahaya lokal dari gambar latar ---------- */
  let lightMap = null; const LM_W = 64, LM_H = 36;
  let refLum = 200;
  function buildLightMap() {
    const bg = ACH.assets && ACH.assets.bg;
    if (!bg || lightMap) return;
    try {
      const [c, x] = ACH.canvas(LM_W, LM_H);
      x.drawImage(bg, 0, 0, LM_W, LM_H);
      const d = x.getImageData(0, 0, LM_W, LM_H).data;
      lightMap = d;
      const lums = [];
      for (let i = 0; i < d.length; i += 4) lums.push(0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]);
      lums.sort((a, b) => a - b);
      refLum = lums[Math.floor(lums.length * 0.88)] || 200;
    } catch (e) { lightMap = false; }
  }
  function sampleLight(x, y) {
    if (!lightMap) return [1, 1, 1];
    let r = 0, g = 0, b = 0, n = 0;
    const cx = (x / ACH.W) * LM_W, cy = (y / ACH.H) * LM_H;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const ix = ACH.clamp(Math.round(cx + dx), 0, LM_W - 1), iy = ACH.clamp(Math.round(cy + dy), 0, LM_H - 1);
      const i = (iy * LM_W + ix) * 4;
      r += lightMap[i]; g += lightMap[i + 1]; b += lightMap[i + 2]; n++;
    }
    r /= n; g /= n; b /= n;
    const lum = 0.3 * r + 0.59 * g + 0.11 * b || 1;
    const f = ACH.clamp(0.66 + 0.34 * (lum / refLum), 0.84, 1.03);
    // warna lokal (dinormalisasi) dicampur sedikit → kulit maskot ikut hangat/dingin
    return [f * ACH.lerp(1, r / lum, 0.22), f * ACH.lerp(1, g / lum, 0.22), f * ACH.lerp(1, b / lum, 0.22)];
  }
  // sumber cahaya untuk rim light (lampion & andon)
  function lights() {
    const L = ACH.LAMPS.map((l) => ({ x: l.cx, y: l.cy, k: 1 }));
    L.push({ x: 846, y: 293, k: 0.8 }, { x: 112, y: 592, k: 0.8 });
    return L;
  }
  const LIGHTS = lights();
  // rim light: sisi (−1 kiri / +1 kanan, ruang dunia) & kekuatan
  function rimAt(x, y) {
    const ph = phase;
    let sx = 0, w = 0;
    for (const l of LIGHTS) {
      const d = Math.hypot(l.x - x, (l.y - y) * 0.8);
      const k = l.k / (1 + (d / 260) ** 2);
      sx += Math.sign(l.x - x) * k; w += k;
    }
    const night = ph.night, gold = ph.golden;
    // senja: matahari dari jendela shoji (kiri)
    const sunSide = -1;
    const lampA = ACH.clamp(w, 0, 1.2) * (0.42 * night + 0.12 * gold + 0.05);
    const sunA = 0.34 * gold + 0.08 * ph.day;
    const side = lampA * Math.sign(sx || 1) + sunA * sunSide;
    return { side: Math.sign(side || -1), a: Math.min(0.55, Math.abs(lampA) + sunA), warm: night > 0.5 ? [255, 190, 120] : [255, 214, 160], top: 0.12 + 0.3 * night };
  }

  // sprite maskot yang sudah "diterangi" sesuai posisi & waktu
  const litCache = {};
  fx.lit = function (key, img, x, y, face) {
    if (lightMap === null) buildLightMap();
    let e = litCache[key];
    if (!e || e[0].width !== img.width || e[0].height !== img.height) e = litCache[key] = ACH.canvas(img.width, img.height);
    const [c, g] = e, w = c.width, h = c.height, ph = phase;
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    g.clearRect(0, 0, w, h);
    g.drawImage(img, 0, 0);
    // 1) ambient: cahaya lokal × warna waktu (malam: hangat lampion; global tint malam menyusul)
    const loc = sampleLight(x, y - 40);
    const warm = [
      1 * ph.day + 1 * ph.golden + 1 * ph.night,
      0.99 * ph.day + 0.93 * ph.golden + 0.93 * ph.night,
      0.97 * ph.day + 0.84 * ph.golden + 0.84 * ph.night,
    ];
    const tw = ph.day + ph.golden + ph.night || 1;
    const amb = loc.map((v, i) => ACH.clamp(255 * v * (tw > 0.05 ? warm[i] / tw : 1), 0, 255));
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = ACH.rgb(amb[0], amb[1], amb[2]); g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(img, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    // 2) oklusi bawah (menempel ke lantai/bantal)
    let gr = g.createLinearGradient(0, h * 0.62, 0, h);
    gr.addColorStop(0, 'rgba(48,28,14,0)'); gr.addColorStop(1, 'rgba(48,28,14,0.24)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    // 3) rim light dari lampion / matahari senja
    const rim = rimAt(x, y);
    if (rim.a > 0.02) {
      const s = rim.side * (face || 1); // ke ruang sprite (sprite bisa dicerminkan)
      const x0 = s > 0 ? w : 0, x1 = s > 0 ? w * 0.62 : w * 0.38;
      gr = g.createLinearGradient(x0, 0, x1, 0);
      gr.addColorStop(0, ACH.rgb(rim.warm[0], rim.warm[1], rim.warm[2], rim.a));
      gr.addColorStop(1, ACH.rgb(rim.warm[0], rim.warm[1], rim.warm[2], 0));
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      gr = g.createLinearGradient(0, 0, 0, h * 0.3);
      gr.addColorStop(0, ACH.rgb(rim.warm[0], rim.warm[1], rim.warm[2], rim.a * rim.top * 1.4));
      gr.addColorStop(1, ACH.rgb(rim.warm[0], rim.warm[1], rim.warm[2], 0));
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.globalCompositeOperation = 'destination-in';
      g.drawImage(img, 0, 0);
    }
    g.globalCompositeOperation = 'source-over';
    return c;
  };

  /* ---------- papan "Hari ini" di whiteboard (perspektif dinding kiri) ---------- */
  const WB = { tl: [245, 144], tr: [392, 116], br: [402, 237], bl: [252, 260] };
  const P = (u, v) => {
    const top = [ACH.lerp(WB.tl[0], WB.tr[0], u), ACH.lerp(WB.tl[1], WB.tr[1], u)];
    const bot = [ACH.lerp(WB.bl[0], WB.br[0], u), ACH.lerp(WB.bl[1], WB.br[1], u)];
    return [ACH.lerp(top[0], bot[0], v), ACH.lerp(top[1], bot[1], v)];
  };
  let boardInfo = { kerja: 0, selesai: 0, jadwal: 0 }, boardFlash = 0;
  fx.setBoard = function (info) {
    if (info.kerja !== boardInfo.kerja || info.selesai !== boardInfo.selesai) boardFlash = 1;
    boardInfo = info;
  };
  function drawBoardNote(ctx, dt) {
    const u0 = 0.43, u1 = 0.97, v0 = 0.5, v1 = 0.93, LW = 100, LH = 64;
    const o = P(u0, v0), ux = P(u1, v0), vy = P(u0, v1);
    ctx.save();
    ctx.transform((ux[0] - o[0]) / LW, (ux[1] - o[1]) / LW, (vy[0] - o[0]) / LH, (vy[1] - o[1]) / LH, o[0], o[1]);
    // kertas washi + bayangan
    ctx.shadowColor = 'rgba(40,25,10,0.35)'; ctx.shadowBlur = 3; ctx.shadowOffsetY = 1.5;
    ctx.fillStyle = '#fbf3e2';
    ctx.beginPath(); ctx.moveTo(2, 3); ctx.lineTo(LW - 1, 1); ctx.lineTo(LW, LH - 2); ctx.lineTo(1, LH); ctx.closePath(); ctx.fill();
    ctx.shadowColor = 'transparent';
    if (boardFlash > 0) { ctx.fillStyle = `rgba(255,214,120,${0.5 * boardFlash})`; ctx.fill(); boardFlash = Math.max(0, boardFlash - dt * 0.6); }
    // pita indigo di atas
    ctx.fillStyle = '#2e3a63'; ctx.fillRect(2, 3, LW - 3, 13);
    ctx.fillStyle = '#f6efe1'; ctx.font = '700 9px "Zen Maru Gothic", sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    ctx.fillText('HARI INI · 本日', LW / 2, 10);
    // dua kolom angka
    const col = (cx, n, label, color) => {
      ctx.fillStyle = color; ctx.font = '900 24px "Zen Maru Gothic", sans-serif';
      ctx.fillText(String(n), cx, 33);
      ctx.fillStyle = '#5b5346'; ctx.font = '700 9.5px "Zen Maru Gothic", sans-serif';
      ctx.fillText(label, cx, 53);
    };
    col(LW * 0.27, boardInfo.kerja, 'kerja', '#3f7a4f');
    col(LW * 0.73, boardInfo.selesai, 'selesai', '#c0392b');
    ctx.strokeStyle = 'rgba(46,58,99,0.25)'; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(LW / 2, 22); ctx.lineTo(LW / 2, 58); ctx.stroke();
    // magnet merah
    ctx.fillStyle = '#c0392b'; ctx.beginPath(); ctx.arc(LW / 2, 2, 3.4, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.beginPath(); ctx.arc(LW / 2 - 1, 1, 1.1, 0, 7); ctx.fill();
    ctx.restore();
    ctx.textAlign = 'left';
  }

  function puff(src, kind) {
    const s = src[Math.floor(Math.random() * src.length)];
    steam.push(kind === 'ramen'
      ? { x: s[0] + (Math.random() - 0.5) * 6, y: s[1], t: 0, life: 2.4 + Math.random() * 1.4, r: 3 + Math.random() * 2.5, w: Math.random() * 6, v: 11, a: 0.3, g: 9 }
      : { x: s[0] + (Math.random() - 0.5) * 3, y: s[1], t: 0, life: 2.2 + Math.random() * 1.4, r: 2 + Math.random() * 2, w: Math.random() * 6, v: 14, a: 0.22 + 0.12 * react.tea, g: 7 });
  }

  // lapisan belakang (setelah latar, sebelum karakter)
  fx.drawBack = function (ctx, t, dt) {
    const A = ACH.assets, ph = phase;
    updateReact(dt);
    // lampion: goyang lembut di titik gantungnya; badan lampion ikut menyala saat malam
    ACH.LAMPS.forEach((L, i) => {
      const img = A.lamps[L.id];
      if (!img) return;
      const ang = 0.018 * Math.sin(t * 0.9 + i * 1.7) + 0.008 * Math.sin(t * 2.3 + i);
      ctx.save();
      ctx.translate(L.px, L.py); ctx.rotate(ang); ctx.translate(-L.px, -L.py);
      ctx.drawImage(img, L.x, L.y, L.w, L.h);
      ctx.restore();
    });
    drawBoardNote(ctx, dt);
    ctx.save(); ctx.globalCompositeOperation = 'screen';
    // monitor: lebih terang & berkedip saat Ops bekerja di meja
    const m = react.mon;
    const mon = 0.09 + 0.17 * m + (0.03 + 0.05 * m) * Math.sin(t * 7.3) + (0.03 + 0.04 * m) * ACH.noise2(t * 3, 1, 5);
    MONS.forEach(([x, y, r], i) => glow(ctx, x, y, r * (1 + 0.25 * m), i ? '#8fc8ff' : '#9fd8ff', mon * (1 - i * 0.1)));
    if (m > 0.05) {
      // pantulan cahaya layar di meja + baris data bergulir
      glow(ctx, 372, 300, 90, '#8fc8ff', 0.1 * m);
      ctx.fillStyle = `rgba(190,230,255,${0.22 * m})`;
      MONS.forEach(([x, y, r], i) => {
        for (let k = 0; k < 3; k++) {
          const yy = y - r * 0.32 + ((t * 9 + k * 6 + i * 4) % 18) - 4;
          ctx.fillRect(x - r * 0.32, yy, r * (0.3 + 0.25 * ACH.noise2(t * 2 + k, i, 3)), 1.1);
        }
      });
    }
    // LED server: kedip lebih cepat saat Engineering bekerja
    const sp = 1 + 2.6 * react.srv;
    leds.forEach((l) => {
      l.ph += dt * l.f * sp;
      if (Math.sin(l.ph) <= 0.2) return;
      ctx.fillStyle = l.c; ctx.globalAlpha = 0.85;
      ctx.fillRect(l.x, l.y, 1.6, 1.1);
      ctx.globalAlpha = 1;
      glow(ctx, l.x + 0.8, l.y + 0.5, 5, l.c, 0.25 + 0.1 * react.srv);
    });
    glow(ctx, 990, 260, 90, '#7fb8ff', 0.05 + 0.09 * react.srv * (0.8 + 0.2 * Math.sin(t * 5)));
    // vending: panel menyala berdenyut
    const vg = 0.16 + 0.04 * Math.sin(t * 1.6) + (Math.sin(t * 13) > 0.97 ? 0.08 : 0);
    ctx.fillStyle = `rgba(220,240,255,${vg * 0.55})`;
    ctx.beginPath(); ctx.moveTo(1053, 284); ctx.lineTo(1100, 297); ctx.lineTo(1100, 370); ctx.lineTo(1053, 356); ctx.closePath(); ctx.fill();
    glow(ctx, 1078, 330, 60, '#d6ecff', vg * (0.6 + 0.4 * ph.night));
    // andon (lampu lantai) berpendar
    glow(ctx, 846, 293, 34, '#ffc98a', 0.18 + 0.05 * ACH.noise2(t * 2, 3, 9));
    glow(ctx, 112, 592, 40, '#ffc98a', 0.16 + 0.05 * ACH.noise2(t * 2, 7, 9));
    // lampu konter menghangat saat ada yang makan ramen
    glow(ctx, 712, 236, 60, '#ffcf8a', 0.1 * react.ramen);
    ctx.restore();

    // uap teh (selalu tipis, lebih tebal saat ada yang di stasiun teh) & uap ramen
    if (Math.random() < dt * (3 + 10 * react.tea)) puff(TEA_SRC, 'tea');
    if (Math.random() < dt * 9 * react.ramen) puff(RAMEN_SRC, 'ramen');
    for (let i = steam.length - 1; i >= 0; i--) {
      const p = steam[i]; p.t += dt;
      if (p.t > p.life) { steam.splice(i, 1); continue; }
      const k = p.t / p.life;
      const x = p.x + Math.sin(p.t * 2.2 + p.w) * (2 + k * 6), y = p.y - p.t * p.v;
      const a = p.a * Math.sin(k * Math.PI), rr = p.r + k * p.g;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rr);
      g.addColorStop(0, `rgba(255,250,240,${a})`); g.addColorStop(1, 'rgba(255,250,240,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fill();
    }
  };

  // lapisan depan: debu cahaya + tint hari + cahaya lampion
  fx.drawFront = function (ctx, t) {
    const W = ACH.W, H = ACH.H, ph = phase;
    ctx.save();
    const da = 0.25 + 0.5 * (ph.day + ph.golden * 0.8) * (1 - ph.night);
    dust.forEach((d) => {
      const x = d.x + Math.sin(t * 0.3 + d.p) * 10, y = d.y + Math.sin(t * 0.21 + d.p * 2) * 14 - ((t * 3 + d.p * 40) % 60) * 0.3;
      ctx.fillStyle = `rgba(255,240,205,${da * (0.35 + 0.35 * Math.sin(t + d.p))})`;
      ctx.beginPath(); ctx.arc(x, y, d.s, 0, Math.PI * 2); ctx.fill();
    });
    if (ph.night > 0.01) {
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = `rgba(${Math.round(255 - 95 * ph.night)},${Math.round(255 - 88 * ph.night)},${Math.round(255 - 52 * ph.night)},1)`;
      ctx.fillRect(0, 0, W, H);
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
      ctx.globalCompositeOperation = 'screen';
      const g = ctx.createLinearGradient(0, 200, 700, 520);
      g.addColorStop(0, `rgba(255,190,110,${0.16 * ph.golden})`); g.addColorStop(1, 'rgba(255,190,110,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    // cahaya lampion (lebih kuat saat malam), dengan kerlip
    ctx.globalCompositeOperation = 'screen';
    const nk = 0.45 + 0.75 * ph.night + 0.25 * ph.golden;
    ACH.LAMPS.forEach((L, i) => {
      const fl = 0.85 + 0.15 * ACH.noise2(t * 3.1, i * 7, 3);
      glow(ctx, L.cx, L.cy, L.r * 2.6, '#ffcf8a', 0.22 * nk * fl);
      if (ph.night > 0.05) {
        glow(ctx, L.cx, L.cy, L.r * 1.1, '#fff0c8', 0.28 * ph.night * fl);
        glow(ctx, L.cx, L.cy + 260, L.r * 5, '#ffb866', 0.07 * ph.night * fl);
      }
    });
    if (ph.night > 0.05) {
      glow(ctx, 846, 300, 70, '#ffbf7a', 0.25 * ph.night);
      glow(ctx, 112, 600, 90, '#ffbf7a', 0.25 * ph.night);
      glow(ctx, 1080, 340, 90, '#cfe6ff', 0.18 * ph.night);
      glow(ctx, 365, 280, 90, '#9cc8ff', (0.12 + 0.12 * react.mon) * ph.night);
      glow(ctx, 990, 260, 80, '#8fc0ff', 0.1 * react.srv * ph.night);
    }
    ctx.restore();
  };
})();
